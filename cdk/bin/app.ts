#!/usr/bin/env node
import "source-map-support/register";
import { App } from "aws-cdk-lib";
import { PolicyStatement, Effect } from "aws-cdk-lib/aws-iam";
import { DataStack } from "../stacks/data/data.stack";
import { IamStack } from "../stacks/iam/iam.stack";
import { ServicesStack } from "../stacks/services/services.stack";
import { ApiStack } from "../stacks/api/api.stack";
import { baseConfig, arnBuilder, nameBuilder } from "../config/base.config";
import { iamConfig } from "../stacks/iam/config/iam.config";
import { dataConfig } from "../stacks/data/config/data.config";
import { servicesConfig } from "../stacks/services/config/services.config";
import { apiConfig } from "../stacks/api/config/api.config";

const app = new App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: baseConfig.region,
};

// 1. IAM Stack
const iamStack = new IamStack(app, `${baseConfig.appPrefix}-IamStack`, {
  env,
  config: baseConfig,
  iamConfig,
  description: `${baseConfig.system.toUpperCase()} - IAM Roles and Policies`,
});

// 2. Data Stack
const dataStack = new DataStack(app, `${baseConfig.appPrefix}-DataStack`, {
  env,
  config: baseConfig,
  dataConfig,
  description: `${baseConfig.system.toUpperCase()} - Data Layer (DynamoDB)`,
});

// Add DynamoDB permissions to IAM roles
iamStack.clientsLambdaRole.addToPolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:Scan",
    ],
    resources: [
      dataStack.clientsTable.tableArn,
      `${dataStack.clientsTable.tableArn}/index/*`,
    ],
  }),
);

// Read-only access to campaigns + leads for deletion safeguard checks
iamStack.clientsLambdaRole.addToPolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["dynamodb:Scan", "dynamodb:Query"],
    resources: [
      dataStack.campaignsTable.tableArn,
      `${dataStack.campaignsTable.tableArn}/index/*`,
      dataStack.leadsTable.tableArn,
      `${dataStack.leadsTable.tableArn}/index/*`,
    ],
  }),
);

iamStack.clientsLambdaRole.addToPolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
    resources: [dataStack.internalApiAuthTokenSecret.secretArn],
  }),
);

iamStack.affiliatesLambdaRole.addToPolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:Scan",
    ],
    resources: [
      dataStack.affiliatesTable.tableArn,
      `${dataStack.affiliatesTable.tableArn}/index/*`,
    ],
  }),
);

// Read-only access to campaigns + leads for deletion safeguard checks
iamStack.affiliatesLambdaRole.addToPolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["dynamodb:Scan", "dynamodb:Query"],
    resources: [
      dataStack.campaignsTable.tableArn,
      `${dataStack.campaignsTable.tableArn}/index/*`,
      dataStack.leadsTable.tableArn,
      `${dataStack.leadsTable.tableArn}/index/*`,
    ],
  }),
);

iamStack.affiliatesLambdaRole.addToPolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
    resources: [dataStack.internalApiAuthTokenSecret.secretArn],
  }),
);

iamStack.campaignsLambdaRole.addToPolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:Scan",
    ],
    resources: [
      dataStack.campaignsTable.tableArn,
      `${dataStack.campaignsTable.tableArn}/index/*`,
      dataStack.clientsTable.tableArn,
      `${dataStack.clientsTable.tableArn}/index/*`,
      dataStack.affiliatesTable.tableArn,
      `${dataStack.affiliatesTable.tableArn}/index/*`,
      dataStack.leadsTable.tableArn,
      `${dataStack.leadsTable.tableArn}/index/*`,
    ],
  }),
);

iamStack.campaignsLambdaRole.addToPolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
    resources: [dataStack.internalApiAuthTokenSecret.secretArn],
  }),
);

iamStack.leadsLambdaRole.addToPolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:Scan",
    ],
    resources: [
      dataStack.leadsTable.tableArn,
      `${dataStack.leadsTable.tableArn}/index/*`,
      dataStack.campaignsTable.tableArn,
      `${dataStack.campaignsTable.tableArn}/index/*`,
    ],
  }),
);

iamStack.leadsLambdaRole.addToPolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["lambda:InvokeFunction"],
    resources: [arnBuilder.lambda(nameBuilder.lambda("qa-orchestrator"))],
  }),
);

iamStack.leadsLambdaRole.addToPolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"],
    resources: [
      dataStack.ipqsCredentialsSecret.secretArn,
      dataStack.trustedFormsCredentialsSecret.secretArn,
    ],
  }),
);

iamStack.tenantConfigLambdaRole.addToPolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: [
      "secretsmanager:CreateSecret",
      "secretsmanager:PutSecretValue",
      "secretsmanager:UpdateSecret",
      "secretsmanager:GetSecretValue",
      "secretsmanager:DescribeSecret",
      "secretsmanager:DeleteSecret",
      "secretsmanager:RestoreSecret",
    ],
    resources: [
      dataStack.ipqsCredentialsSecret.secretArn,
      dataStack.trustedFormsCredentialsSecret.secretArn,
      dataStack.internalApiAuthTokenSecret.secretArn,
      arnBuilder.secret(nameBuilder.secret("tenant-config")),
    ],
  }),
);

iamStack.qaOrchestratorLambdaRole.addToPolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["lambda:InvokeFunction"],
    resources: [arnBuilder.lambda(nameBuilder.lambda("qa-duplicate-check"))],
  }),
);

iamStack.qaDuplicateCheckLambdaRole.addToPolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:Scan"],
    resources: [
      dataStack.leadsTable.tableArn,
      `${dataStack.leadsTable.tableArn}/index/*`,
    ],
  }),
);

// 3. Services Stack
const servicesStack = new ServicesStack(
  app,
  `${baseConfig.appPrefix}-ServicesStack`,
  {
    env,
    config: baseConfig,
    servicesConfig,
    description: `${baseConfig.system.toUpperCase()} - Lambda Functions`,
  },
);

servicesStack.addDependency(iamStack);
servicesStack.addDependency(dataStack);

// 4. API Stack
const apiStack = new ApiStack(app, `${baseConfig.appPrefix}-ApiStack`, {
  env,
  config: baseConfig,
  apiConfig,
  clientsLambda: servicesStack.clientsLambda,
  affiliatesLambda: servicesStack.affiliatesLambda,
  campaignsLambda: servicesStack.campaignsLambda,
  leadsLambda: servicesStack.leadsLambda,
  tenantConfigLambda: servicesStack.tenantConfigLambda,
  authLambdaRoleName: iamStack.authLambdaRole.roleName,
  usersLambdaRoleName: iamStack.usersLambdaRole.roleName,
  description: `${baseConfig.system.toUpperCase()} - API Gateway`,
});

apiStack.addDependency(servicesStack);

app.synth();
