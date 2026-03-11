import {
  NestedStack,
  NestedStackProps,
  CfnOutput,
  Duration,
} from "aws-cdk-lib";
import {
  RestApi,
  LambdaIntegration,
  Cors,
  CognitoUserPoolsAuthorizer,
  AuthorizationType,
  IResource,
} from "aws-cdk-lib/aws-apigateway";
import {
  UserPool,
  UserPoolClient,
  OAuthScope,
  UserPoolClientIdentityProvider,
  AccountRecovery,
  VerificationEmailStyle,
  ResourceServerScope,
  CfnUserPoolGroup,
} from "aws-cdk-lib/aws-cognito";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime, IFunction } from "aws-cdk-lib/aws-lambda";
import { Role } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { IInternalApiConfig } from "./types/api.types";
import { nameBuilder } from "../../config/base.config";
import * as path from "path";

export interface IInternalApiStackProps extends NestedStackProps {
  clientsLambda: IFunction;
  affiliatesLambda: IFunction;
  campaignsLambda: IFunction;
  leadsLambda: IFunction;
  tenantConfigLambda: IFunction;
  qaOrchestratorLambda: IFunction;
  apiConfig: IInternalApiConfig;
  authLambdaRoleName: string;
  usersLambdaRoleName: string;
  logicalIdPrefix: string;
}

/**
 * Internal API Stack
 * Unified REST API for internal services (Clients and Affiliates)
 * Routes are organized by resource type: /v2/clients and /v2/affiliates
 * Each route is proxied to its respective Lambda function
 */
export class InternalApiStack extends NestedStack {
  public readonly api: RestApi;
  public readonly userPool: UserPool;
  public readonly userPoolClient: UserPoolClient;
  public readonly cognitoAuthorizer: CognitoUserPoolsAuthorizer;
  public readonly cognitoDomainName: string;
  public readonly authLambda: NodejsFunction;
  public readonly usersLambda: NodejsFunction;

  constructor(scope: Construct, id: string, props: IInternalApiStackProps) {
    super(scope, id, props);

    const {
      clientsLambda,
      affiliatesLambda,
      campaignsLambda,
      leadsLambda,
      tenantConfigLambda,
      qaOrchestratorLambda,
      apiConfig,
      authLambdaRoleName,
      usersLambdaRoleName,
      logicalIdPrefix,
    } = props;

    // ============================================================================
    // REST API SETUP
    // ============================================================================
    this.api = new RestApi(this, `${logicalIdPrefix}-InternalApi`, {
      restApiName: apiConfig.name,
      description: apiConfig.description,
      deployOptions: {
        stageName: apiConfig.stageName,
        metricsEnabled: true,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: Cors.ALL_METHODS,
        allowHeaders: [
          "Content-Type",
          "X-Amz-Date",
          "Authorization",
          "X-Api-Key",
          "X-Amz-Security-Token",
        ],
      },
    });

    const readScope = "internal-api/read";
    const writeScope = "internal-api/write";
    const requireScopeChecks =
      process.env.INTERNAL_API_REQUIRE_SCOPES === "true";
    const readResourceScope = new ResourceServerScope({
      scopeName: "read",
      scopeDescription: "Read access for internal API",
    });
    const writeResourceScope = new ResourceServerScope({
      scopeName: "write",
      scopeDescription: "Write access for internal API",
    });

    this.userPool = new UserPool(
      this,
      `${logicalIdPrefix}-InternalApiUserPool`,
      {
        userPoolName: `${apiConfig.name}-users`,
        selfSignUpEnabled: false,
        signInAliases: {
          email: true,
        },
        autoVerify: {
          email: true,
        },
        accountRecovery: AccountRecovery.EMAIL_ONLY,
        userVerification: {
          emailSubject: "Verify your internal API account",
          emailBody: "Thanks for signing in. Your verification code is {####}.",
          emailStyle: VerificationEmailStyle.CODE,
        },
      },
    );

    const resourceServer = this.userPool.addResourceServer(
      `${logicalIdPrefix}-InternalApiResourceServer`,
      {
        identifier: "internal-api",
        scopes: [readResourceScope, writeResourceScope],
      },
    );

    this.userPoolClient = this.userPool.addClient(
      `${logicalIdPrefix}-InternalApiAppClient`,
      {
        userPoolClientName: `${apiConfig.name}-app-client`,
        authFlows: {
          userPassword: true,
          userSrp: true,
        },
        generateSecret: false,
        preventUserExistenceErrors: true,
        oAuth: {
          callbackUrls: apiConfig.callbackUrls,
          logoutUrls: apiConfig.logoutUrls,
          flows: {
            authorizationCodeGrant: true,
          },
          scopes: [
            OAuthScope.OPENID,
            OAuthScope.EMAIL,
            OAuthScope.PROFILE,
            OAuthScope.resourceServer(resourceServer, readResourceScope),
            OAuthScope.resourceServer(resourceServer, writeResourceScope),
          ],
        },
        supportedIdentityProviders: [UserPoolClientIdentityProvider.COGNITO],
      },
    );

    const userPoolDomain = this.userPool.addDomain(
      `${logicalIdPrefix}-InternalApiDomain`,
      {
        cognitoDomain: {
          domainPrefix:
            apiConfig.cognitoDomainPrefix ??
            `${apiConfig.name.replace(/[^a-zA-Z0-9-]/g, "").toLowerCase()}-${this.account.slice(-6).toLowerCase()}`,
        },
      },
    );
    this.cognitoDomainName = userPoolDomain.domainName;

    // ──────────────────────────────────────────────────────────────────────────
    // USER POOL GROUPS (role-based access control)
    // ──────────────────────────────────────────────────────────────────────────
    // "admin" — full management access (create/delete users, etc.)
    new CfnUserPoolGroup(this, `${logicalIdPrefix}-AdminGroup`, {
      userPoolId: this.userPool.userPoolId,
      groupName: "admin",
      description: "Admin users with full management access",
      precedence: 1,
    });

    // "staff" — standard authenticated access
    new CfnUserPoolGroup(this, `${logicalIdPrefix}-StaffGroup`, {
      userPoolId: this.userPool.userPoolId,
      groupName: "staff",
      description: "Staff users with standard access",
      precedence: 2,
    });

    this.cognitoAuthorizer = new CognitoUserPoolsAuthorizer(
      this,
      `${logicalIdPrefix}-InternalApiAuthorizer`,
      {
        cognitoUserPools: [this.userPool],
      },
    );

    // ============================================================================
    // AUTH LAMBDA (custom login endpoint - wraps Cognito, no API GW auth required)
    // ============================================================================
    const authRole = Role.fromRoleName(
      this,
      `${logicalIdPrefix}-AuthLambdaRole`,
      authLambdaRoleName,
    );
    this.authLambda = new NodejsFunction(
      this,
      `${logicalIdPrefix}-AuthFunction`,
      {
        functionName: nameBuilder.lambda("auth"),
        entry: path.join(__dirname, "../../../handlers/auth/main.ts"),
        handler: "handler",
        runtime: Runtime.NODEJS_22_X,
        role: authRole,
        memorySize: 256,
        timeout: Duration.seconds(10),
        environment: {
          COGNITO_USER_POOL_ID: this.userPool.userPoolId,
          COGNITO_CLIENT_ID: this.userPoolClient.userPoolClientId,
          NODE_ENV: "production",
        },
        bundling: {
          minify: true,
          sourceMap: true,
          target: "node20",
          keepNames: true,
          sourcesContent: false,
          tsconfig: path.join(
            __dirname,
            "../../../handlers/auth/tsconfig.build.json",
          ),
          externalModules: ["@aws-sdk/*", "js-yaml"],
        },
      },
    );

    // ============================================================================
    // USERS LAMBDA (admin user-management endpoint — protected by Cognito authorizer)
    // ============================================================================
    const usersRole = Role.fromRoleName(
      this,
      `${logicalIdPrefix}-UsersLambdaRole`,
      usersLambdaRoleName,
    );
    this.usersLambda = new NodejsFunction(
      this,
      `${logicalIdPrefix}-UsersFunction`,
      {
        functionName: nameBuilder.lambda("users"),
        entry: path.join(__dirname, "../../../handlers/users/main.ts"),
        handler: "handler",
        runtime: Runtime.NODEJS_22_X,
        role: usersRole,
        memorySize: 256,
        timeout: Duration.seconds(15),
        environment: {
          COGNITO_USER_POOL_ID: this.userPool.userPoolId,
          NODE_ENV: "production",
        },
        bundling: {
          minify: true,
          sourceMap: true,
          target: "node20",
          keepNames: true,
          sourcesContent: false,
          tsconfig: path.join(
            __dirname,
            "../../../handlers/users/tsconfig.build.json",
          ),
          externalModules: ["@aws-sdk/*", "js-yaml"],
        },
      },
    );

    // Grant the users Lambda admin permissions on the User Pool.
    // Both the imported role and the user pool are in this nested stack,
    // so there is no cross-stack circular reference.
    this.userPool.grant(
      usersRole,
      "cognito-idp:AdminCreateUser",
      "cognito-idp:AdminSetUserPassword",
      "cognito-idp:AdminDeleteUser",
      "cognito-idp:AdminDisableUser",
      "cognito-idp:AdminEnableUser",
      "cognito-idp:AdminGetUser",
      "cognito-idp:ListUsers",
      "cognito-idp:AdminAddUserToGroup",
      "cognito-idp:AdminRemoveUserFromGroup",
      "cognito-idp:AdminListGroupsForUser",
      "cognito-idp:ListGroups",
      "cognito-idp:AdminUpdateUserAttributes",
    );

    const addProtectedMethod = (
      resource: IResource,
      httpMethod: string,
      integration: LambdaIntegration,
      scopes: string[],
    ) => {
      const methodOptions: any = {
        authorizationType: AuthorizationType.COGNITO,
        authorizer: this.cognitoAuthorizer,
      };

      if (requireScopeChecks) {
        methodOptions.authorizationScopes = scopes;
      }

      resource.addMethod(httpMethod, integration, methodOptions);
    };

    // ============================================================================
    // CLIENTS INTEGRATION
    // ============================================================================
    const clientsLambdaIntegration = new LambdaIntegration(clientsLambda, {
      proxy: true,
      allowTestInvoke: false,
    });

    // /v2 resource (shared root)
    const v2Resource = this.api.root.addResource("v2");

    // ============================================================================
    // AUTH ROUTES (unprotected - public login/refresh endpoints)
    // ============================================================================
    const authLambdaIntegration = new LambdaIntegration(this.authLambda, {
      proxy: true,
      allowTestInvoke: false,
    });
    const authResource = v2Resource.addResource("auth");

    // POST /v2/auth/login - exchange email+password for tokens
    authResource.addResource("login").addMethod("POST", authLambdaIntegration, {
      authorizationType: AuthorizationType.NONE,
    });

    // POST /v2/auth/refresh - exchange refresh_token for new tokens
    authResource
      .addResource("refresh")
      .addMethod("POST", authLambdaIntegration, {
        authorizationType: AuthorizationType.NONE,
      });

    // ============================================================================
    // USERS ROUTES (protected — admin role enforced inside the Lambda)
    // ============================================================================
    const usersLambdaIntegration = new LambdaIntegration(this.usersLambda, {
      proxy: true,
      allowTestInvoke: false,
    });
    const usersResource = v2Resource.addResource("users");

    // POST /v2/users  — create user (admin only)
    addProtectedMethod(usersResource, "POST", usersLambdaIntegration, [
      writeScope,
    ]);
    // GET /v2/users   — list users (admin only)
    addProtectedMethod(usersResource, "GET", usersLambdaIntegration, [
      readScope,
    ]);

    const userByIdResource = usersResource.addResource("{id}");
    // GET /v2/users/{id}    — get user (admin only)
    addProtectedMethod(userByIdResource, "GET", usersLambdaIntegration, [
      readScope,
    ]);
    // PUT /v2/users/{id}    — update role (admin only)
    addProtectedMethod(userByIdResource, "PUT", usersLambdaIntegration, [
      writeScope,
    ]);
    // DELETE /v2/users/{id} — delete user (admin only)
    addProtectedMethod(userByIdResource, "DELETE", usersLambdaIntegration, [
      writeScope,
    ]);

    // PUT /v2/users/{id}/password — reset password (admin only)
    const userPasswordResource = userByIdResource.addResource("password");
    addProtectedMethod(userPasswordResource, "PUT", usersLambdaIntegration, [
      writeScope,
    ]);

    // PUT /v2/users/{id}/enable — re-enable a disabled (soft-deleted) user (admin only)
    const userEnableResource = userByIdResource.addResource("enable");
    addProtectedMethod(userEnableResource, "PUT", usersLambdaIntegration, [
      writeScope,
    ]);

    // ============================================================================
    // CLIENTS INTEGRATION
    // ============================================================================
    const clientsResource = v2Resource.addResource("clients");

    // POST /v2/clients - Create client
    addProtectedMethod(clientsResource, "POST", clientsLambdaIntegration, [
      writeScope,
    ]);

    // GET /v2/clients - List clients
    addProtectedMethod(clientsResource, "GET", clientsLambdaIntegration, [
      readScope,
    ]);

    // /v2/clients/{id} resource
    const clientResource = clientsResource.addResource("{id}");

    // GET /v2/clients/{id} - Get client
    addProtectedMethod(clientResource, "GET", clientsLambdaIntegration, [
      readScope,
    ]);

    // PUT /v2/clients/{id} - Update client
    addProtectedMethod(clientResource, "PUT", clientsLambdaIntegration, [
      writeScope,
    ]);

    // DELETE /v2/clients/{id} - Delete client
    addProtectedMethod(clientResource, "DELETE", clientsLambdaIntegration, [
      writeScope,
    ]);

    // ============================================================================
    // AFFILIATES INTEGRATION
    // ============================================================================
    const affiliatesLambdaIntegration = new LambdaIntegration(
      affiliatesLambda,
      {
        proxy: true,
        allowTestInvoke: false,
      },
    );

    // /v2/affiliates resource
    const affiliatesResource = v2Resource.addResource("affiliates");

    // POST /v2/affiliates - Create affiliate
    addProtectedMethod(
      affiliatesResource,
      "POST",
      affiliatesLambdaIntegration,
      [writeScope],
    );

    // GET /v2/affiliates - List affiliates
    addProtectedMethod(affiliatesResource, "GET", affiliatesLambdaIntegration, [
      readScope,
    ]);

    // /v2/affiliates/{id} resource
    const affiliateResource = affiliatesResource.addResource("{id}");

    // GET /v2/affiliates/{id} - Get affiliate
    addProtectedMethod(affiliateResource, "GET", affiliatesLambdaIntegration, [
      readScope,
    ]);

    // PUT /v2/affiliates/{id} - Update affiliate
    addProtectedMethod(affiliateResource, "PUT", affiliatesLambdaIntegration, [
      writeScope,
    ]);

    // DELETE /v2/affiliates/{id} - Delete affiliate
    addProtectedMethod(
      affiliateResource,
      "DELETE",
      affiliatesLambdaIntegration,
      [writeScope],
    );

    // ============================================================================
    // CAMPAIGNS INTEGRATION
    // ============================================================================
    const campaignsLambdaIntegration = new LambdaIntegration(campaignsLambda, {
      proxy: true,
      allowTestInvoke: false,
    });

    const campaignsResource = v2Resource.addResource("campaigns");
    // POST /v2/campaigns - create campaign
    addProtectedMethod(campaignsResource, "POST", campaignsLambdaIntegration, [
      writeScope,
    ]);
    // GET /v2/campaigns - list campaigns
    addProtectedMethod(campaignsResource, "GET", campaignsLambdaIntegration, [
      readScope,
    ]);

    const campaignResource = campaignsResource.addResource("{id}");

    // GET /v2/campaigns/{id} - get campaign by id
    addProtectedMethod(campaignResource, "GET", campaignsLambdaIntegration, [
      readScope,
    ]);
    // PUT /v2/campaigns/{id} - update campaign name
    addProtectedMethod(campaignResource, "PUT", campaignsLambdaIntegration, [
      writeScope,
    ]);
    // DELETE /v2/campaigns/{id} - soft/hard delete campaign
    addProtectedMethod(campaignResource, "DELETE", campaignsLambdaIntegration, [
      writeScope,
    ]);

    // clients under campaign
    const campaignClientsResource = campaignResource.addResource("clients");
    // link client to campaign
    addProtectedMethod(
      campaignClientsResource,
      "POST",
      campaignsLambdaIntegration,
      [writeScope],
    );
    // update/delete linked client
    const campaignClientResource =
      campaignClientsResource.addResource("{clientId}");
    addProtectedMethod(
      campaignClientResource,
      "PUT",
      campaignsLambdaIntegration,
      [writeScope],
    );
    addProtectedMethod(
      campaignClientResource,
      "DELETE",
      campaignsLambdaIntegration,
      [writeScope],
    );

    // affiliates under campaign
    const campaignAffiliatesResource =
      campaignResource.addResource("affiliates");
    // link affiliate to campaign (generates campaign key)
    addProtectedMethod(
      campaignAffiliatesResource,
      "POST",
      campaignsLambdaIntegration,
      [writeScope],
    );
    // update/delete linked affiliate
    const campaignAffiliateResource =
      campaignAffiliatesResource.addResource("{affiliateId}");
    addProtectedMethod(
      campaignAffiliateResource,
      "PUT",
      campaignsLambdaIntegration,
      [writeScope],
    );
    addProtectedMethod(
      campaignAffiliateResource,
      "DELETE",
      campaignsLambdaIntegration,
      [writeScope],
    );

    // rotate affiliate campaign_key
    const rotateAffiliateKeyResource =
      campaignAffiliateResource.addResource("rotate-key");
    addProtectedMethod(
      rotateAffiliateKeyResource,
      "POST",
      campaignsLambdaIntegration,
      [writeScope],
    );

    // update campaign status
    campaignResource.addResource("status").addMethod(
      "PUT",
      campaignsLambdaIntegration,
      requireScopeChecks
        ? {
            authorizationType: AuthorizationType.COGNITO,
            authorizer: this.cognitoAuthorizer,
            authorizationScopes: [writeScope],
          }
        : {
            authorizationType: AuthorizationType.COGNITO,
            authorizer: this.cognitoAuthorizer,
          },
    );

    // update campaign plugins configuration
    campaignResource.addResource("plugins").addMethod(
      "PUT",
      campaignsLambdaIntegration,
      requireScopeChecks
        ? {
            authorizationType: AuthorizationType.COGNITO,
            authorizer: this.cognitoAuthorizer,
            authorizationScopes: [writeScope],
          }
        : {
            authorizationType: AuthorizationType.COGNITO,
            authorizer: this.cognitoAuthorizer,
          },
    );

    // ── Base Criteria routes ──────────────────────────────────────────────────
    const campaignCriteriaResource = campaignResource.addResource("criteria");
    addProtectedMethod(
      campaignCriteriaResource,
      "GET",
      campaignsLambdaIntegration,
      [readScope],
    );
    addProtectedMethod(
      campaignCriteriaResource,
      "POST",
      campaignsLambdaIntegration,
      [writeScope],
    );

    // declare static sub-resources BEFORE {fieldId} to avoid route shadowing
    const campaignCriteriaBaseFieldsResource =
      campaignCriteriaResource.addResource("base-fields");
    addProtectedMethod(
      campaignCriteriaBaseFieldsResource,
      "POST",
      campaignsLambdaIntegration,
      [writeScope],
    );

    const campaignCriteriaReorderResource =
      campaignCriteriaResource.addResource("reorder");
    addProtectedMethod(
      campaignCriteriaReorderResource,
      "PUT",
      campaignsLambdaIntegration,
      [writeScope],
    );

    const campaignCriteriaHistoryResource =
      campaignCriteriaResource.addResource("history");
    addProtectedMethod(
      campaignCriteriaHistoryResource,
      "GET",
      campaignsLambdaIntegration,
      [readScope],
    );

    const campaignCriteriaFieldResource =
      campaignCriteriaResource.addResource("{fieldId}");
    addProtectedMethod(
      campaignCriteriaFieldResource,
      "PUT",
      campaignsLambdaIntegration,
      [writeScope],
    );
    addProtectedMethod(
      campaignCriteriaFieldResource,
      "DELETE",
      campaignsLambdaIntegration,
      [writeScope],
    );

    const campaignCriteriaMappingsResource =
      campaignCriteriaFieldResource.addResource("mappings");
    addProtectedMethod(
      campaignCriteriaMappingsResource,
      "PUT",
      campaignsLambdaIntegration,
      [writeScope],
    );

    // ============================================================================
    // LEADS INTEGRATION
    // ============================================================================
    const leadsLambdaIntegration = new LambdaIntegration(leadsLambda, {
      proxy: true,
      allowTestInvoke: false,
    });

    const leadsResource = v2Resource.addResource("leads");
    // list leads (internal only)
    addProtectedMethod(leadsResource, "GET", leadsLambdaIntegration, [
      readScope,
    ]);

    const leadByIdResource = leadsResource.addResource("{id}");
    // get lead by id
    addProtectedMethod(leadByIdResource, "GET", leadsLambdaIntegration, [
      readScope,
    ]);
    // update lead
    addProtectedMethod(leadByIdResource, "PUT", leadsLambdaIntegration, [
      writeScope,
    ]);
    // delete lead — soft by default, ?permanent=true for hard delete (admin only)
    addProtectedMethod(leadByIdResource, "DELETE", leadsLambdaIntegration, [
      writeScope,
    ]);

    // ============================================================================
    // TENANT CONFIG INTEGRATION
    // ============================================================================
    const tenantConfigLambdaIntegration = new LambdaIntegration(
      tenantConfigLambda,
      {
        proxy: true,
        allowTestInvoke: false,
      },
    );

    const tenantConfigResource = v2Resource.addResource("tenant-config");

    // ── Credentials ──────────────────────────────────────────────────────────
    const credentialsResource = tenantConfigResource.addResource("credentials");

    addProtectedMethod(
      credentialsResource,
      "POST",
      tenantConfigLambdaIntegration,
      [writeScope],
    );
    addProtectedMethod(
      credentialsResource,
      "GET",
      tenantConfigLambdaIntegration,
      [readScope],
    );

    const credentialByIdResource = credentialsResource.addResource("{id}");
    addProtectedMethod(
      credentialByIdResource,
      "GET",
      tenantConfigLambdaIntegration,
      [readScope],
    );
    addProtectedMethod(
      credentialByIdResource,
      "PUT",
      tenantConfigLambdaIntegration,
      [writeScope],
    );
    addProtectedMethod(
      credentialByIdResource,
      "DELETE",
      tenantConfigLambdaIntegration,
      [writeScope],
    );

    const credentialRestoreResource =
      credentialByIdResource.addResource("restore");
    addProtectedMethod(
      credentialRestoreResource,
      "PUT",
      tenantConfigLambdaIntegration,
      [writeScope],
    );

    const credentialDisableResource =
      credentialByIdResource.addResource("disable");
    addProtectedMethod(
      credentialDisableResource,
      "PUT",
      tenantConfigLambdaIntegration,
      [writeScope],
    );

    const credentialEnableResource =
      credentialByIdResource.addResource("enable");
    addProtectedMethod(
      credentialEnableResource,
      "PUT",
      tenantConfigLambdaIntegration,
      [writeScope],
    );

    // ── Credential Schemas ────────────────────────────────────────────────────
    const credSchemasResource =
      tenantConfigResource.addResource("credential-schemas");
    addProtectedMethod(
      credSchemasResource,
      "POST",
      tenantConfigLambdaIntegration,
      [writeScope],
    );
    addProtectedMethod(
      credSchemasResource,
      "GET",
      tenantConfigLambdaIntegration,
      [readScope],
    );

    const credSchemaByIdResource = credSchemasResource.addResource("{id}");
    addProtectedMethod(
      credSchemaByIdResource,
      "GET",
      tenantConfigLambdaIntegration,
      [readScope],
    );
    addProtectedMethod(
      credSchemaByIdResource,
      "PUT",
      tenantConfigLambdaIntegration,
      [writeScope],
    );
    addProtectedMethod(
      credSchemaByIdResource,
      "DELETE",
      tenantConfigLambdaIntegration,
      [writeScope],
    );

    const credSchemaRestoreResource =
      credSchemaByIdResource.addResource("restore");
    addProtectedMethod(
      credSchemaRestoreResource,
      "PUT",
      tenantConfigLambdaIntegration,
      [writeScope],
    );

    // ── Plugins (registry) ───────────────────────────────────────────────────
    const pluginsResource = tenantConfigResource.addResource("plugins");
    addProtectedMethod(pluginsResource, "GET", tenantConfigLambdaIntegration, [
      readScope,
    ]);

    // ── Plugin Settings ───────────────────────────────────────────────────────
    const pluginSettingsResource =
      tenantConfigResource.addResource("plugin-settings");
    addProtectedMethod(
      pluginSettingsResource,
      "GET",
      tenantConfigLambdaIntegration,
      [readScope],
    );

    const pluginSettingBySchemaResource =
      pluginSettingsResource.addResource("{provider}");
    addProtectedMethod(
      pluginSettingBySchemaResource,
      "GET",
      tenantConfigLambdaIntegration,
      [readScope],
    );
    addProtectedMethod(
      pluginSettingBySchemaResource,
      "PUT",
      tenantConfigLambdaIntegration,
      [writeScope],
    );
    addProtectedMethod(
      pluginSettingBySchemaResource,
      "DELETE",
      tenantConfigLambdaIntegration,
      [writeScope],
    );

    const pluginSettingUpdateResource =
      pluginSettingBySchemaResource.addResource("update");
    addProtectedMethod(
      pluginSettingUpdateResource,
      "PUT",
      tenantConfigLambdaIntegration,
      [writeScope],
    );

    const pluginSettingDisableResource =
      pluginSettingBySchemaResource.addResource("disable");
    addProtectedMethod(
      pluginSettingDisableResource,
      "PUT",
      tenantConfigLambdaIntegration,
      [writeScope],
    );

    const pluginSettingEnableResource =
      pluginSettingBySchemaResource.addResource("enable");
    addProtectedMethod(
      pluginSettingEnableResource,
      "PUT",
      tenantConfigLambdaIntegration,
      [writeScope],
    );

    const pluginSettingRestoreResource =
      pluginSettingBySchemaResource.addResource("restore");
    addProtectedMethod(
      pluginSettingRestoreResource,
      "PUT",
      tenantConfigLambdaIntegration,
      [writeScope],
    );

    // ============================================================================
    // QA ORCHESTRATOR HTTP ROUTES
    // ============================================================================
    const qaOrchestratorLambdaIntegration = new LambdaIntegration(
      qaOrchestratorLambda,
      { proxy: true, allowTestInvoke: false },
    );

    const qaResource = v2Resource.addResource("qa");

    // ── TrustedForm ───────────────────────────────────────────────────────────
    const qaTrustedFormResource = qaResource.addResource("trusted-form");

    // POST /v2/qa/trusted-form/validate — proxy to TrustedForm API (auto-resolve or explicit credentials_id)
    // Note: duplicate-check and full lead validation are lambda-to-lambda only (no HTTP route)
    const qaValidateResource = qaTrustedFormResource.addResource("validate");
    addProtectedMethod(
      qaValidateResource,
      "POST",
      qaOrchestratorLambdaIntegration,
      [writeScope],
    );

    // ── IPQS ─────────────────────────────────────────────────────────────────
    const qaIpqsResource = qaResource.addResource("ipqs");

    // POST /v2/qa/ipqs/check — run an IPQS fraud-score check directly (auto-resolve credentials)
    const qaIpqsCheckResource = qaIpqsResource.addResource("check");
    addProtectedMethod(
      qaIpqsCheckResource,
      "POST",
      qaOrchestratorLambdaIntegration,
      [writeScope],
    );

    new CfnOutput(this, `${logicalIdPrefix}-InternalApiCognitoUserPoolId`, {
      value: this.userPool.userPoolId,
      description: "Cognito User Pool ID for internal API OAuth",
    });

    new CfnOutput(
      this,
      `${logicalIdPrefix}-InternalApiCognitoUserPoolClientId`,
      {
        value: this.userPoolClient.userPoolClientId,
        description: "Cognito App Client ID for custom login screen",
      },
    );

    new CfnOutput(this, `${logicalIdPrefix}-InternalApiCognitoDomainName`, {
      value: userPoolDomain.domainName,
      description: "Cognito domain for OAuth2 authorize/token endpoints",
    });
  }
}
