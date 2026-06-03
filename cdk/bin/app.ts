import { App } from "aws-cdk-lib";
import { DataStack } from "../stacks/data/data.stack";
import { IamStack } from "../stacks/iam/iam.stack";
import { ServicesStack } from "../stacks/services/services.stack";
import { ApiStack } from "../stacks/api/api.stack";
import { baseConfig } from "../config/base.config";
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
  metricsLambda: servicesStack.metricsLambda,
  tenantConfigLambda: servicesStack.tenantConfigLambda,
  qaOrchestratorLambda: servicesStack.qaOrchestratorLambda,
  auditLambda: servicesStack.auditLambda,
  cherryPickLambda: servicesStack.cherryPickLambda,
  authLambdaRoleName: iamStack.authLambdaRole.roleName,
  usersLambdaRoleName: iamStack.usersLambdaRole.roleName,
  description: `${baseConfig.system.toUpperCase()} - API Gateway`,
});

apiStack.addDependency(servicesStack);

app.synth();
