import { NestedStack, NestedStackProps, Duration } from "aws-cdk-lib";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { Role } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { ILambdaConfig } from "./types/services.types";
import * as path from "path";

export interface IAuditServiceStackProps extends NestedStackProps {
  lambdaConfig: ILambdaConfig;
  roleName: string;
  logicalIdPrefix: string;
}

/**
 * Audit Service Nested Stack
 * Contains the Audit Lambda function (query + S3 export)
 */
export class AuditServiceStack extends NestedStack {
  public readonly lambda: NodejsFunction;

  constructor(scope: Construct, id: string, props: IAuditServiceStackProps) {
    super(scope, id, props);

    const { lambdaConfig, roleName, logicalIdPrefix } = props;

    const role = Role.fromRoleName(
      this,
      `${logicalIdPrefix}-AuditLambdaRole`,
      roleName,
    );

    this.lambda = new NodejsFunction(this, `${logicalIdPrefix}-AuditFunction`, {
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
        target: "node22",
        keepNames: true,
        sourcesContent: false,
        tsconfig: path.join(
          __dirname,
          "../../../handlers/audit/tsconfig.build.json",
        ),
        externalModules: ["@aws-sdk/*", "js-yaml"],
      },
    });
  }
}
