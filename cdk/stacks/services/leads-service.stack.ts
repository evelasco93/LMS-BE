import { NestedStack, NestedStackProps, Duration } from "aws-cdk-lib";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { Role } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { ILambdaConfig } from "./types/services.types";
import * as path from "path";

export interface ILeadsServiceStackProps extends NestedStackProps {
  lambdaConfig: ILambdaConfig;
  roleName: string;
}

export class LeadsServiceStack extends NestedStack {
  public readonly lambda: NodejsFunction;

  constructor(scope: Construct, id: string, props: ILeadsServiceStackProps) {
    super(scope, id, props);

    const { lambdaConfig, roleName } = props;
    const role = Role.fromRoleName(this, "LeadsLambdaRole", roleName);

    this.lambda = new NodejsFunction(this, "LeadsFunction", {
      functionName: lambdaConfig.functionName,
      entry: lambdaConfig.entry,
      handler: lambdaConfig.handler,
      runtime: Runtime.NODEJS_20_X,
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
          "../../../handlers/leads/tsconfig.build.json",
        ),
        externalModules: ["@aws-sdk/*", "js-yaml"],
      },
    });
  }
}
