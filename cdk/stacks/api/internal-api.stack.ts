import { NestedStack, NestedStackProps, CfnOutput } from 'aws-cdk-lib';
import { RestApi, LambdaIntegration, Cors } from 'aws-cdk-lib/aws-apigateway';
import { IFunction } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';
import { IInternalApiConfig } from './types/api.types';

export interface IInternalApiStackProps extends NestedStackProps {
  clientsLambda: IFunction;
  affiliatesLambda: IFunction;
  apiConfig: IInternalApiConfig;
}

/**
 * Internal API Stack
 * Unified REST API for internal services (Clients and Affiliates)
 * Routes are organized by resource type: /v2/clients and /v2/affiliates
 * Each route is proxied to its respective Lambda function
 */
export class InternalApiStack extends NestedStack {
  public readonly api: RestApi;

  constructor(scope: Construct, id: string, props: IInternalApiStackProps) {
    super(scope, id, props);

    const { clientsLambda, affiliatesLambda, apiConfig } = props;

    // ============================================================================
    // REST API SETUP
    // ============================================================================
    this.api = new RestApi(this, 'InternalApi', {
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
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
      },
    });

    // ============================================================================
    // CLIENTS INTEGRATION
    // ============================================================================
    const clientsLambdaIntegration = new LambdaIntegration(clientsLambda, {
      proxy: true,
      allowTestInvoke: true,
    });

    // /v2/clients resource
    const v2Resource = this.api.root.addResource('v2');
    const clientsResource = v2Resource.addResource('clients');

    // POST /v2/clients - Create client
    clientsResource.addMethod('POST', clientsLambdaIntegration);

    // GET /v2/clients - List clients
    clientsResource.addMethod('GET', clientsLambdaIntegration);

    // /v2/clients/{id} resource
    const clientResource = clientsResource.addResource('{id}');

    // GET /v2/clients/{id} - Get client
    clientResource.addMethod('GET', clientsLambdaIntegration);

    // PUT /v2/clients/{id} - Update client
    clientResource.addMethod('PUT', clientsLambdaIntegration);

    // DELETE /v2/clients/{id} - Delete client
    clientResource.addMethod('DELETE', clientsLambdaIntegration);

    // ============================================================================
    // AFFILIATES INTEGRATION
    // ============================================================================
    const affiliatesLambdaIntegration = new LambdaIntegration(affiliatesLambda, {
      proxy: true,
      allowTestInvoke: true,
    });

    // /v2/affiliates resource
    const affiliatesResource = v2Resource.addResource('affiliates');

    // POST /v2/affiliates - Create affiliate
    affiliatesResource.addMethod('POST', affiliatesLambdaIntegration);

    // GET /v2/affiliates - List affiliates
    affiliatesResource.addMethod('GET', affiliatesLambdaIntegration);

    // /v2/affiliates/{id} resource
    const affiliateResource = affiliatesResource.addResource('{id}');

    // GET /v2/affiliates/{id} - Get affiliate
    affiliateResource.addMethod('GET', affiliatesLambdaIntegration);

    // PUT /v2/affiliates/{id} - Update affiliate
    affiliateResource.addMethod('PUT', affiliatesLambdaIntegration);

    // DELETE /v2/affiliates/{id} - Delete affiliate
    affiliateResource.addMethod('DELETE', affiliatesLambdaIntegration);

    // ============================================================================
    // API OUTPUTS
    // ============================================================================
    new CfnOutput(this, 'InternalApiUrl', {
      value: this.api.url,
      description: 'Internal API Gateway URL',
      exportName: `${apiConfig.name}-url`,
    });

    new CfnOutput(this, 'InternalApiId', {
      value: this.api.restApiId,
      description: 'Internal API Gateway ID',
      exportName: `${apiConfig.name}-id`,
    });
  }
}
