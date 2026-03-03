import { Stack, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import { InternalApiStack } from "./internal-api.stack";
import { ExternalLeadsApiStack } from "./external-leads-api.stack";
import { IApiStackProps } from "./types/api.types";

/**
 * API Stack
 * Consolidates API Gateway resources for all services
 */
export class ApiStack extends Stack {
  public readonly internalApi: InternalApiStack;
  public readonly externalLeadsApi: ExternalLeadsApiStack;

  constructor(scope: Construct, id: string, props: IApiStackProps) {
    super(scope, id, props);

    const {
      config,
      apiConfig,
      clientsLambda,
      affiliatesLambda,
      campaignsLambda,
      leadsLambda,
      tenantConfigLambda,
      authLambdaRoleName,
      usersLambdaRoleName,
    } = props;

    // Create Internal API Stack
    this.internalApi = new InternalApiStack(
      this,
      `${config.appPrefix}-InternalApiNested`,
      {
        clientsLambda,
        affiliatesLambda,
        campaignsLambda,
        leadsLambda,
        tenantConfigLambda,
        apiConfig: apiConfig.internalApi,
        authLambdaRoleName,
        usersLambdaRoleName,
      },
    );

    this.externalLeadsApi = new ExternalLeadsApiStack(
      this,
      `${config.appPrefix}-ExternalLeadsApiNested`,
      {
        leadsLambda,
        apiConfig: apiConfig.externalLeadsApi,
      },
    );

    // Stack outputs
    new CfnOutput(this, `${config.appPrefix}-InternalApiEndpoint`, {
      value: this.internalApi.api.url,
      description: "Internal API Endpoint",
      exportName: `${config.appPrefix}-InternalApiEndpoint`,
    });

    new CfnOutput(this, `${config.appPrefix}-InternalApiId`, {
      value: this.internalApi.api.restApiId,
      description: "Internal API ID",
      exportName: `${config.appPrefix}-InternalApiId`,
    });

    new CfnOutput(this, `${config.appPrefix}-ExternalLeadsApiEndpoint`, {
      value: this.externalLeadsApi.api.url,
      description: "External Leads API Endpoint",
      exportName: `${config.appPrefix}-ExternalLeadsApiEndpoint`,
    });

    new CfnOutput(this, `${config.appPrefix}-ExternalLeadsApiId`, {
      value: this.externalLeadsApi.api.restApiId,
      description: "External Leads API ID",
      exportName: `${config.appPrefix}-ExternalLeadsApiId`,
    });

    new CfnOutput(this, `${config.appPrefix}-InternalApiCognitoUserPoolId`, {
      value: this.internalApi.userPool.userPoolId,
      description: "Cognito User Pool ID for internal API login",
      exportName: `${config.appPrefix}-InternalApiCognitoUserPoolId`,
    });

    new CfnOutput(this, `${config.appPrefix}-InternalApiCognitoClientId`, {
      value: this.internalApi.userPoolClient.userPoolClientId,
      description: "Cognito App Client ID for internal API OAuth",
      exportName: `${config.appPrefix}-InternalApiCognitoClientId`,
    });

    new CfnOutput(this, `${config.appPrefix}-InternalApiCognitoDomainName`, {
      value: this.internalApi.cognitoDomainName,
      description: "Cognito domain name for internal API OAuth",
      exportName: `${config.appPrefix}-InternalApiCognitoDomainName`,
    });

    // Apply tags
    if (config.tags) {
      Object.entries(config.tags).forEach(([key, value]) => {
        this.tags.setTag(key, value);
      });
    }
  }
}
