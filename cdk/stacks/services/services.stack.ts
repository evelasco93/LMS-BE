import { Stack, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { IServicesStackProps } from './types/services.types';
import { ClientsServiceStack } from './clients-service.stack';
import { AffiliatesServiceStack } from './affiliates-service.stack';
import { IFunction } from 'aws-cdk-lib/aws-lambda';

/**
 * Services Stack
 * Consolidates all service-related nested stacks (Lambdas)
 */
export class ServicesStack extends Stack {
  public readonly clientsLambda: IFunction;
  public readonly affiliatesLambda: IFunction;

  constructor(scope: Construct, id: string, props: IServicesStackProps) {
    super(scope, id, props);

    const { config, servicesConfig } = props;

    // Create Clients Service Stack
    const clientsServiceStack = new ClientsServiceStack(this, `${config.appPrefix}-ClientsService`, {
      lambdaConfig: servicesConfig.clients.lambda,
      roleName: servicesConfig.clients.lambda.roleName,
    });

    this.clientsLambda = clientsServiceStack.lambda;

    // Create Affiliates Service Stack
    const affiliatesServiceStack = new AffiliatesServiceStack(this, `${config.appPrefix}-AffiliatesService`, {
      lambdaConfig: servicesConfig.affiliates.lambda,
      roleName: servicesConfig.affiliates.lambda.roleName,
    });

    this.affiliatesLambda = affiliatesServiceStack.lambda;

    // Outputs
    new CfnOutput(this, `${config.appPrefix}-ClientsLambdaArn`, {
      value: this.clientsLambda.functionArn,
      description: 'Clients Lambda Function ARN',
      exportName: `${config.appPrefix}-clients-lambda-arn`,
    });

    new CfnOutput(this, `${config.appPrefix}-AffiliatesLambdaArn`, {
      value: this.affiliatesLambda.functionArn,
      description: 'Affiliates Lambda Function ARN',
      exportName: `${config.appPrefix}-affiliates-lambda-arn`,
    });

    // Apply tags
    if (config.tags) {
      Object.entries(config.tags).forEach(([key, value]) => {
        this.tags.setTag(key, value);
      });
    }
  }
}
