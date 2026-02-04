import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { ResourceNameBuilder } from '../../common/utils/resourceNameBuilder';

export interface ApiStackProps extends cdk.StackProps {
  resourceNameBuilder: ResourceNameBuilder;
  leadIntakeFunction: lambda.IFunction;
}

export class ApiStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { resourceNameBuilder, leadIntakeFunction } = props;

    // Create REST API
    this.api = new apigateway.RestApi(this, 'LeadIntakeApi', {
      restApiName: resourceNameBuilder.buildApiName('lead-intake'),
      description: 'Lead Intake API Gateway',
      deployOptions: {
        stageName: resourceNameBuilder.getEnvironment(),
        description: `${resourceNameBuilder.getEnvironment()} stage`,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Api-Key',
          'X-Amz-Security-Token',
        ],
      },
    });

    // Lambda Integration
    const lambdaIntegration = new apigateway.LambdaIntegration(leadIntakeFunction, {
      proxy: true,
      allowTestInvoke: true,
    });

    // Create resource hierarchy: /smashorbit/prototype/lead
    const smashOrbitResource = this.api.root.addResource('smashorbit');
    const prototypeResource = smashOrbitResource.addResource('prototype');
    const leadResource = prototypeResource.addResource('lead');

    // Add POST method
    leadResource.addMethod('POST', lambdaIntegration, {
      requestParameters: {
        'method.request.header.Content-Type': true,
      },
      requestValidatorOptions: {
        requestValidatorName: 'Validate body and headers',
        validateRequestBody: false,
        validateRequestParameters: true,
      },
      methodResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Content-Type': true,
          },
        },
        {
          statusCode: '400',
        },
        {
          statusCode: '500',
        },
      ],
    });

    // Add GET method
    leadResource.addMethod('GET', lambdaIntegration, {
      methodResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Content-Type': true,
          },
        },
        {
          statusCode: '500',
        },
      ],
    });

    // Output the API URL
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.api.url,
      description: 'API Gateway URL',
    });

    // Output the API ID
    new cdk.CfnOutput(this, 'ApiId', {
      value: this.api.restApiId,
      description: 'API Gateway ID',
    });

    // Output the full endpoint
    new cdk.CfnOutput(this, 'LeadEndpoint', {
      value: `${this.api.url}smashorbit/prototype/lead`,
      description: 'Lead Intake Endpoint',
    });
  }
}
