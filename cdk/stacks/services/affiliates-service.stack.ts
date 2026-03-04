import { NestedStack, NestedStackProps, Duration } from "aws-cdk-lib";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { Role } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { ILambdaConfig } from "./types/services.types";
import * as path from "path";

export interface IAffiliatesServiceStackProps extends NestedStackProps {
  lambdaConfig: ILambdaConfig;
  roleName: string;
  logicalIdPrefix: string;
}

/**
 * Affiliates Service Nested Stack
 * Contains the Affiliates Lambda function
 */
export class AffiliatesServiceStack extends NestedStack {
  public readonly lambda: NodejsFunction;

  constructor(
    scope: Construct,
    id: string,
    props: IAffiliatesServiceStackProps,
  ) {
    super(scope, id, props);

    const { lambdaConfig, roleName, logicalIdPrefix } = props;

    // Import existing IAM role
    const role = Role.fromRoleName(this, `${logicalIdPrefix}-AffiliatesLambdaRole`, roleName);

    // Create Lambda function with bundling
    this.lambda = new NodejsFunction(this, `${logicalIdPrefix}-AffiliatesFunction`, {
      functionName: lambdaConfig.functionName,
      entry: lambdaConfig.entry,
      handler: lambdaConfig.handler,
      runtime: Runtime.NODEJS_22_X,
      role,
      memorySize: lambdaConfig.memorySize || 512,
      timeout: Duration.seconds(lambdaConfig.timeout || 30),
      environment: lambdaConfig.environment,
      bundling: {
        minify: true,
        sourceMap: true,
        target: "node20",
        keepNames: true,
        sourcesContent: false,
        tsconfig: path.join(
          __dirname,
          "../../../handlers/affiliates/tsconfig.build.json",
        ),
        externalModules: ["@aws-sdk/*", "js-yaml"],
      },
    });
  }
}
