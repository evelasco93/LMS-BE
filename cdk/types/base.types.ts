import { StackProps } from 'aws-cdk-lib';

/**
 * Base configuration for all LMS stacks
 */
export interface IBaseStackConfig {
  /** System name (e.g., 'lms') */
  system: string;
  
  /** Environment (e.g., 'dev', 'staging', 'prod') */
  environment: string;
  
  /** AWS Region */
  region: string;
  
  /** Tenant ID (optional for multi-tenancy) */
  tenant?: string;
  
  /** Application prefix for logical IDs (e.g., 'dev', 'tenant1-dev') */
  appPrefix: string;
  
  /** Common tags to apply to all resources */
  tags?: Record<string, string>;
}

/**
 * Base props for all LMS stacks
 * Combines CDK StackProps with our base configuration
 */
export interface IBaseStackProps extends StackProps {
  config: IBaseStackConfig;
}
