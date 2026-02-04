#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { DataStack, IamStack, ServicesStack, ApiStack } from "./stacks";
import { ResourceNameBuilder } from "../common/utils/resourceNameBuilder";

const app = new cdk.App();

// Get environment variables
const environment = process.env.CDK_ENV || "dev";
const tenant = process.env.CDK_TENANT || "smashorbit";
const system = process.env.CDK_SYSTEM || "prototype-lms";
const region = process.env.AWS_REGION || "us-east-1";
const account = process.env.AWS_ACCOUNT_ID || process.env.CDK_DEFAULT_ACCOUNT;

// Initialize resource name builder
const resourceNameBuilder = new ResourceNameBuilder({
  tenant,
  environment,
  system,
});

// Stack props
const stackProps: cdk.StackProps = {
  env: {
    account,
    region,
  },
};

// Create Data Stack (DynamoDB)
const dataStack = new DataStack(
  app,
  `${tenant}-${system}-data-${environment}-stack`,
  {
    ...stackProps,
    resourceNameBuilder,
  },
);

// Create IAM Stack
const iamStack = new IamStack(
  app,
  `${tenant}-${system}-iam-${environment}-stack`,
  {
    ...stackProps,
    resourceNameBuilder,
    leadsTableArn: dataStack.leadsTable.tableArn,
  },
);

// IAM stack depends on Data stack
iamStack.addDependency(dataStack);

// Create Services Stack (Lambda)
const servicesStack = new ServicesStack(
  app,
  `${tenant}-${system}-services-${environment}-stack`,
  {
    ...stackProps,
    resourceNameBuilder,
    lambdaExecutionRole: iamStack.lambdaExecutionRole,
    leadsTableName: dataStack.leadsTable.tableName,
    tenant,
    environment,
    system,
  },
);

// Services stack depends on IAM stack
servicesStack.addDependency(iamStack);

// Create API Stack (API Gateway)
const apiStack = new ApiStack(
  app,
  `${tenant}-${system}-api-${environment}-stack`,
  {
    ...stackProps,
    resourceNameBuilder,
    leadIntakeFunction: servicesStack.leadIntakeFunction,
  },
);

// API stack depends on Services stack
apiStack.addDependency(servicesStack);

// Add tags to all stacks
const tags = {
  Environment: environment,
  Tenant: tenant,
  Project: "LeadIntake",
  ManagedBy: "CDK",
};

Object.entries(tags).forEach(([key, value]) => {
  cdk.Tags.of(app).add(key, value);
});

app.synth();
