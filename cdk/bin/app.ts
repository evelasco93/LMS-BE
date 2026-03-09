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

// ── Clients ───────────────────────────────────────────────────────────────────
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

// ── Affiliates ────────────────────────────────────────────────────────────────
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

// ── Campaigns ─────────────────────────────────────────────────────────────────
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

// Tenant-level plugin guard: campaigns lambda queries tenant-settings to check if a plugin is globally enabled
iamStack.campaignsLambdaRole.addToPolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["dynamodb:GetItem", "dynamodb:Query"],
    resources: [
      dataStack.tenantSettingsTable.tableArn,
      `${dataStack.tenantSettingsTable.tableArn}/index/*`,
    ],
  }),
);

// ── Leads ─────────────────────────────────────────────────────────────────────
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

// ── Tenant Config ─────────────────────────────────────────────────────────────
// Full CRUD on the consolidated tenant-settings DynamoDB table
iamStack.tenantConfigLambdaRole.addToPolicy(
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
      dataStack.tenantSettingsTable.tableArn,
      `${dataStack.tenantSettingsTable.tableArn}/index/*`,
    ],
  }),
);

// Cascade: when a plugin is globally disabled, tenant-config lambda updates all campaigns
iamStack.tenantConfigLambdaRole.addToPolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Scan"],
    resources: [dataStack.campaignsTable.tableArn],
  }),
);

// ── QA Orchestrator ───────────────────────────────────────────────────────────
iamStack.qaOrchestratorLambdaRole.addToPolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["lambda:InvokeFunction"],
    resources: [
      arnBuilder.lambda(nameBuilder.lambda("qa-duplicate-check")),
      arnBuilder.lambda(nameBuilder.lambda("qa-trusted-form")),
      arnBuilder.lambda(nameBuilder.lambda("qa-ipqs")),
    ],
  }),
);

iamStack.qaOrchestratorLambdaRole.addToPolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["dynamodb:GetItem", "dynamodb:Query"],
    resources: [
      dataStack.tenantSettingsTable.tableArn,
      `${dataStack.tenantSettingsTable.tableArn}/index/*`,
    ],
  }),
);

// ── QA Duplicate Check ────────────────────────────────────────────────────────
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

// ── QA TrustedForm ────────────────────────────────────────────────────────────
iamStack.qaTrustedFormLambdaRole.addToPolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["dynamodb:GetItem"],
    resources: [dataStack.tenantSettingsTable.tableArn],
  }),
);

// ── QA IPQS ───────────────────────────────────────────────────────────────────
iamStack.qaIpqsLambdaRole.addToPolicy(
  new PolicyStatement({
    effect: Effect.ALLOW,
    actions: ["dynamodb:GetItem"],
    resources: [dataStack.tenantSettingsTable.tableArn],
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
  qaOrchestratorLambda: servicesStack.qaOrchestratorLambda,
  authLambdaRoleName: iamStack.authLambdaRole.roleName,
  usersLambdaRoleName: iamStack.usersLambdaRole.roleName,
  description: `${baseConfig.system.toUpperCase()} - API Gateway`,
});

apiStack.addDependency(servicesStack);

app.synth();
