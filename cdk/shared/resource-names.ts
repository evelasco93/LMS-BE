/**
 * Resource Name Builder
 * Implements the naming convention for LMS infrastructure
 * Pattern: {tenant}-{system}-{resource}-{environment}
 */

export class ResourceNameBuilder {
  constructor(
    private readonly system: string,
    private readonly environment: string,
    private readonly tenant?: string,
  ) {}

  /**
   * Build DynamoDB table name
   * Pattern: {tenant}-{system}-{resource}-{environment}
   */
  public table(resourceName: string): string {
    return this.tenant
      ? `${this.tenant}-${this.system}-${resourceName}-${this.environment}`
      : `${this.system}-${resourceName}-${this.environment}`;
  }

  /**
   * Build Lambda function name
   * Pattern: {tenant}-{system}-{service}-{environment}
   */
  public lambda(service: string): string {
    return this.tenant
      ? `${this.tenant}-${this.system}-${service}-${this.environment}`
      : `${this.system}-${service}-${this.environment}`;
  }

  /**
   * Build IAM role name
   * Pattern: {tenant}-{system}-{resource}-role-{environment}
   */
  public role(resourceName: string): string {
    return this.tenant
      ? `${this.tenant}-${this.system}-${resourceName}-role-${this.environment}`
      : `${this.system}-${resourceName}-role-${this.environment}`;
  }

  /**
   * Build API Gateway name
   * Pattern: {tenant}-{system}-{service}-api-{environment}
   */
  public api(service?: string): string {
    if (this.tenant) {
      return service
        ? `${this.tenant}-${this.system}-${service}-api-${this.environment}`
        : `${this.tenant}-${this.system}-api-${this.environment}`;
    }
    return service
      ? `${this.system}-${service}-api-${this.environment}`
      : `${this.system}-api-${this.environment}`;
  }

  /**
   * Build GSI index name
   * Pattern: {tenant}-{system}-{table}-{indexType}-index-{environment}
   */
  public index(table: string, indexType: string): string {
    return this.tenant
      ? `${this.tenant}-${this.system}-${table}-${indexType}-index-${this.environment}`
      : `${this.system}-${table}-${indexType}-index-${this.environment}`;
  }

  /**
   * Build Stack name
   * Pattern: {system}-{stackType}-{environment}-stack
   */
  public stack(stackType: string): string {
    return `${this.system}-${stackType}-${this.environment}-stack`;
  }

  /**
   * Build S3 bucket name
   * Pattern: {tenant}-{system}-{resource}-{environment}-{accountId}
   */
  public bucket(resourceName: string, accountId: string): string {
    const prefix = this.tenant
      ? `${this.tenant}-${this.system}-${resourceName}-${this.environment}`
      : `${this.system}-${resourceName}-${this.environment}`;
    return `${prefix}-${accountId}`.toLowerCase();
  }

  /**
   * Build GSI name
   * Pattern: {attribute}-index
   */
  public gsi(attributeName: string): string {
    return `${attributeName}-index`;
  }

  /**
   * Build policy name
   * Pattern: {tenant}-{system}-{resource}-policy-{environment}
   */
  public policy(resourceName: string): string {
    return this.tenant
      ? `${this.tenant}-${this.system}-${resourceName}-policy-${this.environment}`
      : `${this.system}-${resourceName}-policy-${this.environment}`;
  }

  /**
   * Build Secrets Manager secret name
   * Pattern: {tenant}-{system}-{resource}-secret-{environment}
   */
  public secret(resourceName: string): string {
    return this.tenant
      ? `${this.tenant}-${this.system}-${resourceName}-secret-${this.environment}`
      : `${this.system}-${resourceName}-secret-${this.environment}`;
  }
}

/**
 * Create a resource name builder instance
 */
export function createResourceNameBuilder(
  project: string,
  environment: string,
): ResourceNameBuilder {
  return new ResourceNameBuilder(project, environment);
}
