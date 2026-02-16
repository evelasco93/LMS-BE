/**
 * ARN Builder Utility
 * Builds AWS ARNs deterministically for various resource types
 */

export interface IArnBuilderConfig {
  region: string;
  account?: string;
}

export class ArnBuilder {
  private readonly region: string;
  private readonly account: string;

  constructor(config: IArnBuilderConfig) {
    this.region = config.region;
    this.account = config.account || '${AWS::AccountId}';
  }

  /**
   * Build DynamoDB table ARN
   */
  dynamoTable(tableName: string): string {
    return `arn:aws:dynamodb:${this.region}:${this.account}:table/${tableName}`;
  }

  /**
   * Build Lambda function ARN
   */
  lambda(functionName: string): string {
    return `arn:aws:lambda:${this.region}:${this.account}:function:${functionName}`;
  }

  /**
   * Build IAM role ARN
   */
  role(roleName: string): string {
    return `arn:aws:iam::${this.account}:role/${roleName}`;
  }

  /**
   * Build S3 bucket ARN
   */
  s3Bucket(bucketName: string): string {
    return `arn:aws:s3:::${bucketName}`;
  }

  /**
   * Build S3 object ARN
   */
  s3Object(bucketName: string, objectKey: string = '*'): string {
    return `arn:aws:s3:::${bucketName}/${objectKey}`;
  }

  /**
   * Build API Gateway ARN
   */
  apiGateway(apiId: string, stage: string = '*', method: string = '*', path: string = '*'): string {
    return `arn:aws:execute-api:${this.region}:${this.account}:${apiId}/${stage}/${method}/${path}`;
  }

  /**
   * Build CloudWatch Logs ARN
   */
  logGroup(logGroupName: string): string {
    return `arn:aws:logs:${this.region}:${this.account}:log-group:${logGroupName}`;
  }

  /**
   * Build SNS topic ARN
   */
  snsTopic(topicName: string): string {
    return `arn:aws:sns:${this.region}:${this.account}:${topicName}`;
  }

  /**
   * Build SQS queue ARN
   */
  sqsQueue(queueName: string): string {
    return `arn:aws:sqs:${this.region}:${this.account}:${queueName}`;
  }
}
