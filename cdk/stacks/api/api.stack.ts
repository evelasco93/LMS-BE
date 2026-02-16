import { Stack, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { InternalApiStack } from './internal-api.stack';
import { IApiStackProps } from './types/api.types';

/**
 * API Stack
 * Consolidates API Gateway resources for all services
 */
export class ApiStack extends Stack {
  public readonly internalApi: InternalApiStack;

  constructor(scope: Construct, id: string, props: IApiStackProps) {
    super(scope, id, props);

    const { config, apiConfig, clientsLambda, affiliatesLambda } = props;

    // Create Internal API Stack
    this.internalApi = new InternalApiStack(this, `${config.appPrefix}-InternalApiNested`, {
      clientsLambda,
      affiliatesLambda,
      apiConfig: apiConfig.internalApi,
    });

    // Stack outputs
    new CfnOutput(this, `${config.appPrefix}-InternalApiEndpoint`, {
      value: this.internalApi.api.url,
      description: 'Internal API Endpoint',
      exportName: `${config.appPrefix}-InternalApiEndpoint`,
    });

    new CfnOutput(this, `${config.appPrefix}-InternalApiId`, {
      value: this.internalApi.api.restApiId,
      description: 'Internal API ID',
      exportName: `${config.appPrefix}-InternalApiId`,
    });

    // Apply tags
    if (config.tags) {
      Object.entries(config.tags).forEach(([key, value]) => {
        this.tags.setTag(key, value);
      });
    }
  }
}
