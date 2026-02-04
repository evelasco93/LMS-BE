export interface ResourceNameBuilderConfig {
  tenant: string;
  environment: string;
  system?: string;
}

export type ServiceType = 
  | 'function'
  | 'role'
  | 'policy'
  | 'table'
  | 'api'
  | 'stage'
  | 'deployment'
  | 'resource'
  | 'method';

export class ResourceNameBuilder {
  private tenant: string;
  private environment: string;
  private system?: string;

  constructor(config: ResourceNameBuilderConfig) {
    this.tenant = config.tenant;
    this.environment = config.environment;
    this.system = config.system;
  }

  /**
   * Builds a resource name in the format: tenant-system-env-serviceType-suffix
   * @param serviceType - The type of service (lambda, role, etc.)
   * @param suffix - Optional suffix to append
   */
  build(serviceType: ServiceType, suffix?: string): string {
    const parts = [this.tenant];
    if (this.system) {
      parts.push(this.system);
    }
    parts.push(this.environment, serviceType);
    if (suffix) {
      parts.push(suffix);
    }
    return parts.join('-');
  }

  /**
   * Builds a Lambda function name
   */
  buildLambdaName(functionName: string): string {
    return this.build('function', functionName);
  }

  /**
   * Builds an IAM role name
   */
  buildRoleName(roleName: string): string {
    return this.build('role', roleName);
  }

  /**
   * Builds a DynamoDB table name
   */
  buildTableName(tableName: string): string {
    return this.build('table', tableName);
  }

  /**
   * Builds an API Gateway name
   */
  buildApiName(apiName: string): string {
    return this.build('api', apiName);
  }

  /**
   * Builds a policy name
   */
  buildPolicyName(policyName: string): string {
    return this.build('policy', policyName);
  }

  /**
   * Get the tenant name
   */
  getTenant(): string {
    return this.tenant;
  }

  /**
   * Get the environment
   */
  getEnvironment(): string {
    return this.environment;
  }

  /**
   * Get the system name
   */
  getSystem(): string | undefined {
    return this.system;
  }
}
