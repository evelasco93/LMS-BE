export interface ArnBuilderConfig {
  region: string;
  accountId: string;
  tenant: string;
  environment: string;
}

export type ArnServiceType = 
  | 'lambda'
  | 'iam'
  | 'dynamodb'
  | 'apigateway'
  | 'execute-api';

export class ArnBuilder {
  private region: string;
  private accountId: string;
  private tenant: string;
  private environment: string;

  constructor(config: ArnBuilderConfig) {
    this.region = config.region;
    this.accountId = config.accountId;
    this.tenant = config.tenant;
    this.environment = config.environment;
  }

  /**
   * Builds a Lambda function ARN
   */
  buildLambdaArn(functionName: string): string {
    const fullName = `${this.tenant}-${this.environment}-lambda-${functionName}`;
    return `arn:aws:lambda:${this.region}:${this.accountId}:function:${fullName}`;
  }

  /**
   * Builds an IAM role ARN
   */
  buildRoleArn(roleName: string): string {
    const fullName = `${this.tenant}-${this.environment}-role-${roleName}`;
    return `arn:aws:iam::${this.accountId}:role/${fullName}`;
  }

  /**
   * Builds a DynamoDB table ARN
   */
  buildDynamoDbArn(tableName: string): string {
    const fullName = `${this.tenant}-${this.environment}-dynamodb-${tableName}`;
    return `arn:aws:dynamodb:${this.region}:${this.accountId}:table/${fullName}`;
  }

  /**
   * Builds an API Gateway ARN
   */
  buildApiGatewayArn(apiId: string, method: string = '*', path: string = '*'): string {
    return `arn:aws:execute-api:${this.region}:${this.accountId}:${apiId}/*/${method}/${path}`;
  }

  /**
   * Builds a generic ARN
   */
  buildArn(service: string, resource: string): string {
    return `arn:aws:${service}:${this.region}:${this.accountId}:${resource}`;
  }

  /**
   * Get the region
   */
  getRegion(): string {
    return this.region;
  }

  /**
   * Get the account ID
   */
  getAccountId(): string {
    return this.accountId;
  }
}
