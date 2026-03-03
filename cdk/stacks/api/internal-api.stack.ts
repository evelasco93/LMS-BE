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
  apiConfig: IInternalApiConfig;
  authLambdaRoleName: string;
  usersLambdaRoleName: string;
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
      apiConfig,
      authLambdaRoleName,
      usersLambdaRoleName,
    } = props;

    // ============================================================================
    // REST API SETUP
    // ============================================================================
    this.api = new RestApi(this, "InternalApi", {
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

    this.userPool = new UserPool(this, "InternalApiUserPool", {
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
    });

    const resourceServer = this.userPool.addResourceServer(
      "InternalApiResourceServer",
      {
        identifier: "internal-api",
        scopes: [readResourceScope, writeResourceScope],
      },
    );

    this.userPoolClient = this.userPool.addClient("InternalApiAppClient", {
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
    });

    const userPoolDomain = this.userPool.addDomain("InternalApiDomain", {
      cognitoDomain: {
        domainPrefix:
          apiConfig.cognitoDomainPrefix ??
          `${apiConfig.name.replace(/[^a-zA-Z0-9-]/g, "").toLowerCase()}-${this.account.slice(-6).toLowerCase()}`,
      },
    });
    this.cognitoDomainName = userPoolDomain.domainName;

    // ──────────────────────────────────────────────────────────────────────────
    // USER POOL GROUPS (role-based access control)
    // ──────────────────────────────────────────────────────────────────────────
    // "admin" — full management access (create/delete users, etc.)
    new CfnUserPoolGroup(this, "AdminGroup", {
      userPoolId: this.userPool.userPoolId,
      groupName: "admin",
      description: "Admin users with full management access",
      precedence: 1,
    });

    // "staff" — standard authenticated access
    new CfnUserPoolGroup(this, "StaffGroup", {
      userPoolId: this.userPool.userPoolId,
      groupName: "staff",
      description: "Staff users with standard access",
      precedence: 2,
    });

    this.cognitoAuthorizer = new CognitoUserPoolsAuthorizer(
      this,
      "InternalApiAuthorizer",
      {
        cognitoUserPools: [this.userPool],
      },
    );

    // ============================================================================
    // AUTH LAMBDA (custom login endpoint - wraps Cognito, no API GW auth required)
    // ============================================================================
    const authRole = Role.fromRoleName(
      this,
      "AuthLambdaRole",
      authLambdaRoleName,
    );
    this.authLambda = new NodejsFunction(this, "AuthFunction", {
      functionName: nameBuilder.lambda("auth"),
      entry: path.join(__dirname, "../../../handlers/auth/main.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_20_X,
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
    });

    // ============================================================================
    // USERS LAMBDA (admin user-management endpoint — protected by Cognito authorizer)
    // ============================================================================
    const usersRole = Role.fromRoleName(
      this,
      "UsersLambdaRole",
      usersLambdaRoleName,
    );
    this.usersLambda = new NodejsFunction(this, "UsersFunction", {
      functionName: nameBuilder.lambda("users"),
      entry: path.join(__dirname, "../../../handlers/users/main.ts"),
      handler: "handler",
      runtime: Runtime.NODEJS_20_X,
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
    });

    // Grant the users Lambda admin permissions on the User Pool.
    // Both the imported role and the user pool are in this nested stack,
    // so there is no cross-stack circular reference.
    this.userPool.grant(
      usersRole,
      "cognito-idp:AdminCreateUser",
      "cognito-idp:AdminSetUserPassword",
      "cognito-idp:AdminDeleteUser",
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
      allowTestInvoke: true,
    });

    // /v2 resource (shared root)
    const v2Resource = this.api.root.addResource("v2");

    // ============================================================================
    // AUTH ROUTES (unprotected - public login/refresh endpoints)
    // ============================================================================
    const authLambdaIntegration = new LambdaIntegration(this.authLambda, {
      proxy: true,
      allowTestInvoke: true,
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
      allowTestInvoke: true,
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
        allowTestInvoke: true,
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
      allowTestInvoke: true,
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

    // ============================================================================
    // LEADS INTEGRATION
    // ============================================================================
    const leadsLambdaIntegration = new LambdaIntegration(leadsLambda, {
      proxy: true,
      allowTestInvoke: true,
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

    // ============================================================================
    // TENANT CONFIG INTEGRATION
    // ============================================================================
    const tenantConfigLambdaIntegration = new LambdaIntegration(
      tenantConfigLambda,
      {
        proxy: true,
        allowTestInvoke: true,
      },
    );

    const tenantConfigResource = v2Resource.addResource("tenant-config");
    const credentialsResource = tenantConfigResource.addResource("credentials");

    addProtectedMethod(
      credentialsResource,
      "GET",
      tenantConfigLambdaIntegration,
      [readScope],
    );
    addProtectedMethod(
      credentialsResource,
      "PUT",
      tenantConfigLambdaIntegration,
      [writeScope],
    );

    const credentialByProviderResource =
      credentialsResource.addResource("{provider}");
    credentialByProviderResource.addMethod(
      "GET",
      tenantConfigLambdaIntegration,
      requireScopeChecks
        ? {
            authorizationType: AuthorizationType.COGNITO,
            authorizer: this.cognitoAuthorizer,
            authorizationScopes: [readScope],
          }
        : {
            authorizationType: AuthorizationType.COGNITO,
            authorizer: this.cognitoAuthorizer,
          },
    );
    credentialByProviderResource.addMethod(
      "DELETE",
      tenantConfigLambdaIntegration,
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

    new CfnOutput(this, "InternalApiCognitoUserPoolId", {
      value: this.userPool.userPoolId,
      description: "Cognito User Pool ID for internal API OAuth",
    });

    new CfnOutput(this, "InternalApiCognitoUserPoolClientId", {
      value: this.userPoolClient.userPoolClientId,
      description: "Cognito App Client ID for custom login screen",
    });

    new CfnOutput(this, "InternalApiCognitoDomainName", {
      value: userPoolDomain.domainName,
      description: "Cognito domain for OAuth2 authorize/token endpoints",
    });
  }
}
