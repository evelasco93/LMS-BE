import { NestedStack, NestedStackProps, Duration } from 'aws-cdk-lib';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { Role } from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { ILambdaConfig } from './types/services.types';
import * as path from 'path';

export interface IAffiliatesServiceStackProps extends NestedStackProps {
  lambdaConfig: ILambdaConfig;
  roleName: string;
}

/**
 * Affiliates Service Nested Stack
 * Contains the Affiliates Lambda function
 */
export class AffiliatesServiceStack extends NestedStack {
  public readonly lambda: NodejsFunction;

  constructor(scope: Construct, id: string, props: IAffiliatesServiceStackProps) {
    super(scope, id, props);

    const { lambdaConfig, roleName } = props;

    // Import existing IAM role
    const role = Role.fromRoleName(this, 'AffiliatesLambdaRole', roleName);

    // Create Lambda function with bundling
    this.lambda = new NodejsFunction(this, 'AffiliatesFunction', {
      functionName: lambdaConfig.functionName,
      entry: lambdaConfig.entry,
      handler: lambdaConfig.entry,
      runtime: Runtime.NODEJS_20_X,
      role,
      memorySize: lambdaConfig.memorySize || 512,
      timeout: Duration.seconds(lambdaConfig.timeout || 30),
      environment: lambdaConfig.environment,
      bundling: {
        minify: false,
        sourceMap: true,
        target: 'node20',
        keepNames: true,
        externalModules: [
          '@aws-sdk/*',
          'js-yaml',
        ],
      },
    });
  }
}
