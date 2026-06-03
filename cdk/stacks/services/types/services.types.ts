import { IBaseStackProps } from "../../../types/base.types";

/**
 * Lambda Function Configuration
 */
export interface ILambdaConfig {
  /** Function name */
  functionName: string;

  /** Entry point file path */
  entry: string;

  /** Handler function name */
  handler: string;

  /** Memory size in MB */
  memorySize?: number;

  /** Timeout in seconds */
  timeout?: number;

  /** Environment variables */
  environment?: Record<string, string>;

  /** IAM role name to use */
  roleName: string;
}

/**
 * Service Configuration (Clients or Affiliates)
 */
export interface IServiceConfig {
  lambda: ILambdaConfig;
  tableName: string;
  tableArn: string;
}

/**
 * Services Stack Configuration
 */
export interface IServicesStackConfig {
  clients: IServiceConfig;
  affiliates: IServiceConfig;
  campaigns: IServiceConfig;
  leads: IServiceConfig;
  metrics: IServiceConfig;
  tenantConfig: IServiceConfig;
  qaOrchestrator: IServiceConfig;
  qaDuplicateCheck: IServiceConfig;
  qaTrustedForm: IServiceConfig;
  qaIpqs: IServiceConfig;
  qaCriteriaValidation: IServiceConfig;
  qaLogicRules: IServiceConfig;
  audit: IServiceConfig;
  cherryPick: IServiceConfig;
  /** CR-001: retry consumer for the metrics emit DLQ. */
  metricsDlqRetry: {
    lambda: ILambdaConfig;
    /** Visibility timeout (seconds) for the main DLQ. */
    dlqVisibilityTimeoutSeconds: number;
    /** Retention period (days) for both queues. */
    retentionDays: number;
    /** Redrive count from main DLQ to terminal parking queue. */
    maxReceiveCount: number;
    /** Event source batching. */
    batchSize: number;
    maxBatchingWindowSeconds: number;
  };
}

/**
 * Services Stack Props
 */
export interface IServicesStackProps extends IBaseStackProps {
  servicesConfig: IServicesStackConfig;
}
