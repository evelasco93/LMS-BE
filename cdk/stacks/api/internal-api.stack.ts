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
import { consolidateLambdaApiPermissions } from "./routes/route-helpers";
import { ClientsAffiliatesRoutes } from "./routes/clients-affiliates-routes";
import { CampaignsRoutes } from "./routes/campaigns-routes";
import { LeadsRoutes } from "./routes/leads-routes";
import { TenantConfigRoutes } from "./routes/tenant-config-routes";
import { QaAuditCherryPickRoutes } from "./routes/qa-audit-routes";
import * as path from "path";

export interface IInternalApiStackProps extends NestedStackProps {
  clientsLambda: IFunction;
  affiliatesLambda: IFunction;
  campaignsLambda: IFunction;
  leadsLambda: IFunction;
  tenantConfigLambda: IFunction;
  qaOrchestratorLambda: IFunction;
  auditLambda: IFunction;
  cherryPickLambda: IFunction;
  apiConfig: IInternalApiConfig;
  authLambdaRoleName: string;
  usersLambdaRoleName: string;
  logicalIdPrefix: string;
}

/**
 * Internal API Stack
 * Unified REST API for internal services.
 * Routes are organised by service domain — each service has its own
 * route Construct class in ./routes/ to keep this file manageable.
 *
 * Lambda resource-based policy consolidation (one wildcard permission per
 * Lambda) is applied here before any routes are registered, preventing the
 * AWS 20 KB Lambda policy size limit from being exceeded.
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
      auditLambda,
      cherryPickLambda,
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

    // ============================================================================
    // COGNITO USER POOL
    // ============================================================================
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

    // User pool groups (role-based access control)
    new CfnUserPoolGroup(this, `${logicalIdPrefix}-AdminGroup`, {
      userPoolId: this.userPool.userPoolId,
      groupName: "admin",
      description: "Admin users with full management access",
      precedence: 1,
    });
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
    // AUTH LAMBDA (custom login endpoint -- no API GW auth required)
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
    // USERS LAMBDA (admin user-management -- protected by Cognito authorizer)
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
          AUDIT_LOGS_TABLE_NAME: nameBuilder.table("audit-logs"),
          USER_TABLE_PREFERENCES_TABLE_NAME: nameBuilder.table(
            "user-table-preferences",
          ),
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

    // ============================================================================
    // LAMBDA PERMISSION CONSOLIDATION
    // Collapse all per-route Lambda::Permission resources into a single wildcard
    // permission per Lambda. Must be called BEFORE any addMethod() calls.
    // ============================================================================
    const allServiceLambdas: IFunction[] = [
      this.authLambda,
      this.usersLambda,
      clientsLambda,
      affiliatesLambda,
      campaignsLambda,
      leadsLambda,
      tenantConfigLambda,
      qaOrchestratorLambda,
      auditLambda,
      cherryPickLambda,
    ];
    for (const fn of allServiceLambdas) {
      consolidateLambdaApiPermissions(fn);
    }

    // ============================================================================
    // API RESOURCE TREE SETUP
    // ============================================================================
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

    // /v2 resource (shared root for all internal routes)
    const v2Resource = this.api.root.addResource("v2");

    // -- Auth routes (public -- no Cognito auth) --------------------------------
    const authLambdaIntegration = new LambdaIntegration(this.authLambda, {
      proxy: true,
      allowTestInvoke: false,
    });
    const authResource = v2Resource.addResource("auth");
    authResource.addResource("login").addMethod("POST", authLambdaIntegration, {
      authorizationType: AuthorizationType.NONE,
    });
    authResource
      .addResource("refresh")
      .addMethod("POST", authLambdaIntegration, {
        authorizationType: AuthorizationType.NONE,
      });

    // -- Users routes (protected) -----------------------------------------------
    const usersLambdaIntegration = new LambdaIntegration(this.usersLambda, {
      proxy: true,
      allowTestInvoke: false,
    });
    const usersResource = v2Resource.addResource("users");
    addProtectedMethod(usersResource, "POST", usersLambdaIntegration, [
      writeScope,
    ]);
    addProtectedMethod(usersResource, "GET", usersLambdaIntegration, [
      readScope,
    ]);

    const userByIdResource = usersResource.addResource("{id}");
    addProtectedMethod(userByIdResource, "GET", usersLambdaIntegration, [
      readScope,
    ]);
    addProtectedMethod(userByIdResource, "PUT", usersLambdaIntegration, [
      writeScope,
    ]);
    addProtectedMethod(userByIdResource, "DELETE", usersLambdaIntegration, [
      writeScope,
    ]);
    addProtectedMethod(
      userByIdResource.addResource("password"),
      "PUT",
      usersLambdaIntegration,
      [writeScope],
    );
    addProtectedMethod(
      userByIdResource.addResource("enable"),
      "PUT",
      usersLambdaIntegration,
      [writeScope],
    );

    const userPreferenceByTableResource = usersResource
      .addResource("preferences")
      .addResource("{tableId}");
    addProtectedMethod(
      userPreferenceByTableResource,
      "GET",
      usersLambdaIntegration,
      [readScope],
    );
    addProtectedMethod(
      userPreferenceByTableResource,
      "PUT",
      usersLambdaIntegration,
      [writeScope],
    );
    addProtectedMethod(
      userPreferenceByTableResource,
      "DELETE",
      usersLambdaIntegration,
      [writeScope],
    );

    // -- Service route constructs (one per domain) ------------------------------
    const sharedProps = {
      v2Resource,
      authorizer: this.cognitoAuthorizer,
      requireScopeChecks,
      readScope,
      writeScope,
    };

    new ClientsAffiliatesRoutes(this, `${logicalIdPrefix}-ClientsAffiliates`, {
      ...sharedProps,
      clientsLambda,
      affiliatesLambda,
    });

    new CampaignsRoutes(this, `${logicalIdPrefix}-Campaigns`, {
      ...sharedProps,
      campaignsLambda,
    });

    new LeadsRoutes(this, `${logicalIdPrefix}-Leads`, {
      ...sharedProps,
      leadsLambda,
    });

    new TenantConfigRoutes(this, `${logicalIdPrefix}-TenantConfig`, {
      ...sharedProps,
      tenantConfigLambda,
    });

    new QaAuditCherryPickRoutes(this, `${logicalIdPrefix}-QaAuditCherryPick`, {
      ...sharedProps,
      qaOrchestratorLambda,
      auditLambda,
      cherryPickLambda,
    });

    // ============================================================================
    // OUTPUTS
    // ============================================================================
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
