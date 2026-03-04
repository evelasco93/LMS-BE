import { NestedStack, NestedStackProps, Duration } from "aws-cdk-lib";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { Role } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { ILambdaConfig } from "./types/services.types";
import * as path from "path";

export interface IQaOrchestratorServiceStackProps extends NestedStackProps {
  lambdaConfig: ILambdaConfig;
  roleName: string;
  logicalIdPrefix: string;
}

export class QaOrchestratorServiceStack extends NestedStack {
  public readonly lambda: NodejsFunction;

  constructor(
    scope: Construct,
    id: string,
    props: IQaOrchestratorServiceStackProps,
  ) {
    super(scope, id, props);

    const { lambdaConfig, roleName, logicalIdPrefix } = props;
    const role = Role.fromRoleName(this, `${logicalIdPrefix}-QaOrchestratorLambdaRole`, roleName);

    this.lambda = new NodejsFunction(this, `${logicalIdPrefix}-QaOrchestratorFunction`, {
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
          "../../../handlers/qa/orchestrator/tsconfig.build.json",
        ),
        externalModules: ["@aws-sdk/*", "js-yaml"],
      },
    });
  }
}
