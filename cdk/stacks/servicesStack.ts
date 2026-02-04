import * as cdk from "aws-cdk-lib";
import { Construct } from "constructs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as iam from "aws-cdk-lib/aws-iam";
import { ResourceNameBuilder } from "../../common/utils/resourceNameBuilder";
import * as path from "path";

export interface ServicesStackProps extends cdk.StackProps {
  resourceNameBuilder: ResourceNameBuilder;
  lambdaExecutionRole: iam.IRole;
  leadsTableName: string;
  tenant: string;
  environment: string;
  system: string;
}

export class ServicesStack extends cdk.Stack {
  public readonly leadIntakeFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: ServicesStackProps) {
    super(scope, id, props);

    const {
      resourceNameBuilder,
      lambdaExecutionRole,
      leadsTableName,
      tenant,
      environment,
      system,
    } = props;

    // Lambda Function for Lead Intake using NodejsFunction with esbuild bundling
    this.leadIntakeFunction = new NodejsFunction(this, "LeadIntakeFunction", {
      functionName: resourceNameBuilder.buildLambdaName("lead-intake"),
      entry: path.join(__dirname, "../../handler/index.ts"),
      handler: "handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      architecture: lambda.Architecture.ARM_64,
      role: lambdaExecutionRole,
      timeout: cdk.Duration.seconds(30),
      memorySize: 512,
      bundling: {
        minify: false,
        sourceMap: true,
        target: "node20",
        keepNames: true,
        loader: {
          ".node": "file",
        },
        externalModules: ["js-yaml"],
      },

      environment: {
        TENANT: tenant,
        SYSTEM: system,
        ENVIRONMENT: environment,
        LEADS_TABLE_NAME: leadsTableName,
        IPQS_BASE_URL: "https://ipqualityscore.com/api/json",
        IPQS_API_KEY: "I94LCTXsckfNWJuW6vJX84RP5c5pLykU",
        TRUSTEDFORM_USERNAME: "API",
        TRUSTEDFORM_PASSWORD: "de3b2f39055939221023f0325f33d25a",
      },
    });

    // Output the function ARN
    new cdk.CfnOutput(this, "LeadIntakeFunctionArn", {
      value: this.leadIntakeFunction.functionArn,
      description: "Lead Intake Lambda Function ARN",
    });

    // Output the function name
    new cdk.CfnOutput(this, "LeadIntakeFunctionName", {
      value: this.leadIntakeFunction.functionName,
      description: "Lead Intake Lambda Function Name",
    });
  }
}
