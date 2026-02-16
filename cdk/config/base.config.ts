import { IBaseStackConfig } from '../types/base.types';
import { ResourceNameBuilder } from '../shared/resource-names';
import { ArnBuilder } from '../shared/arn-builder';

const environment = process.env.ENVIRONMENT || 'dev';
const tenant = process.env.TENANT;
const system = process.env.SYSTEM || 'lms';
const region = process.env.CDK_DEFAULT_REGION || 'us-east-1';
const account = process.env.CDK_DEFAULT_ACCOUNT;

// Validate required environment variables
if (!tenant) {
  throw new Error('TENANT environment variable is required. Run: source ./scripts/env-dev.sh');
}

if (!environment) {
  throw new Error('ENVIRONMENT environment variable is required. Run: source ./scripts/env-dev.sh');
}

// Create app prefix for logical IDs (tenant-system-env)
const appPrefix = `${tenant}-${system}-${environment}`;

export const baseConfig: IBaseStackConfig = {
  system,
  environment,
  tenant,
  region,
  appPrefix,
  tags: {
    Environment: environment,
    System: system,
    ManagedBy: 'CDK',
    ...(tenant && { Tenant: tenant }),
  },
};

export const nameBuilder = new ResourceNameBuilder(system, environment, tenant);
export const arnBuilder = new ArnBuilder({ region, account });
