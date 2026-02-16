import {
  DynamoDBClient,
  DynamoDBClientConfig,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
  DeleteCommand,
  QueryCommand,
  ScanCommand,
  BatchGetCommand,
  BatchWriteCommand,
  GetCommandInput,
  PutCommandInput,
  UpdateCommandInput,
  DeleteCommandInput,
  QueryCommandInput,
  ScanCommandInput,
  BatchGetCommandInput,
  BatchWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';

/**
 * DynamoDB Utility Class
 * Compatible with AWS SDK v3 and latest CDK version
 */
export class DynamoDBUtil {
  private readonly docClient: DynamoDBDocumentClient;

  constructor(config?: DynamoDBClientConfig) {
    const client = new DynamoDBClient(config || {});
    
    // Create Document client with marshalling options
    this.docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: {
        removeUndefinedValues: true,
        convertClassInstanceToMap: true,
      },
      unmarshallOptions: {
        wrapNumbers: false,
      },
    });
  }

  /**
   * Get a single item by key
   */
  async get<T = any>(params: GetCommandInput): Promise<T | null> {
    const command = new GetCommand(params);
    const result = await this.docClient.send(command);
    return (result.Item as T) || null;
  }

  /**
   * Put (create or replace) an item
   */
  async put(params: PutCommandInput): Promise<void> {
    const command = new PutCommand(params);
    await this.docClient.send(command);
  }

  /**
   * Update an item
   */
  async update(params: UpdateCommandInput): Promise<any> {
    const command = new UpdateCommand(params);
    const result = await this.docClient.send(command);
    return result.Attributes;
  }

  /**
   * Delete an item
   */
  async delete(params: DeleteCommandInput): Promise<void> {
    const command = new DeleteCommand(params);
    await this.docClient.send(command);
  }

  /**
   * Query items
   */
  async query<T = any>(params: QueryCommandInput): Promise<{
    items: T[];
    lastEvaluatedKey?: Record<string, any>;
    count: number;
  }> {
    const command = new QueryCommand(params);
    const result = await this.docClient.send(command);
    
    return {
      items: (result.Items as T[]) || [],
      lastEvaluatedKey: result.LastEvaluatedKey,
      count: result.Count || 0,
    };
  }

  /**
   * Scan items
   */
  async scan<T = any>(params: ScanCommandInput): Promise<{
    items: T[];
    lastEvaluatedKey?: Record<string, any>;
    count: number;
  }> {
    const command = new ScanCommand(params);
    const result = await this.docClient.send(command);
    
    return {
      items: (result.Items as T[]) || [],
      lastEvaluatedKey: result.LastEvaluatedKey,
      count: result.Count || 0,
    };
  }

  /**
   * Batch get items
   */
  async batchGet(params: BatchGetCommandInput): Promise<Record<string, any[]>> {
    const command = new BatchGetCommand(params);
    const result = await this.docClient.send(command);
    return result.Responses || {};
  }

  /**
   * Batch write items
   */
  async batchWrite(params: BatchWriteCommandInput): Promise<void> {
    const command = new BatchWriteCommand(params);
    await this.docClient.send(command);
  }

  /**
   * Query all items (handles pagination automatically)
   */
  async queryAll<T = any>(params: QueryCommandInput): Promise<T[]> {
    const allItems: T[] = [];
    let lastEvaluatedKey: Record<string, any> | undefined;

    do {
      const command = new QueryCommand({
        ...params,
        ExclusiveStartKey: lastEvaluatedKey,
      });
      
      const result = await this.docClient.send(command);
      
      if (result.Items) {
        allItems.push(...(result.Items as T[]));
      }
      
      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    return allItems;
  }

  /**
   * Scan all items (handles pagination automatically)
   */
  async scanAll<T = any>(params: ScanCommandInput): Promise<T[]> {
    const allItems: T[] = [];
    let lastEvaluatedKey: Record<string, any> | undefined;

    do {
      const command = new ScanCommand({
        ...params,
        ExclusiveStartKey: lastEvaluatedKey,
      });
      
      const result = await this.docClient.send(command);
      
      if (result.Items) {
        allItems.push(...(result.Items as T[]));
      }
      
      lastEvaluatedKey = result.LastEvaluatedKey;
    } while (lastEvaluatedKey);

    return allItems;
  }

  /**
   * Build update expression from object
   */
  buildUpdateExpression(updates: Record<string, any>): {
    UpdateExpression: string;
    ExpressionAttributeNames: Record<string, string>;
    ExpressionAttributeValues: Record<string, any>;
  } {
    const setExpressions: string[] = [];
    const ExpressionAttributeNames: Record<string, string> = {};
    const ExpressionAttributeValues: Record<string, any> = {};

    Object.entries(updates).forEach(([key, value], index) => {
      const nameKey = `#attr${index}`;
      const valueKey = `:val${index}`;
      
      setExpressions.push(`${nameKey} = ${valueKey}`);
      ExpressionAttributeNames[nameKey] = key;
      ExpressionAttributeValues[valueKey] = value;
    });

    return {
      UpdateExpression: `SET ${setExpressions.join(', ')}`,
      ExpressionAttributeNames,
      ExpressionAttributeValues,
    };
  }

  /**
   * Get the underlying document client
   */
  getClient(): DynamoDBDocumentClient {
    return this.docClient;
  }
}

/**
 * Create a DynamoDB utility instance
 */
export function createDynamoDBUtil(config?: DynamoDBClientConfig): DynamoDBUtil {
  return new DynamoDBUtil(config);
}

/**
 * Singleton instance for Lambda functions
 */
let dynamoDBUtilInstance: DynamoDBUtil | null = null;

export function getDynamoDBUtil(): DynamoDBUtil {
  if (!dynamoDBUtilInstance) {
    dynamoDBUtilInstance = new DynamoDBUtil();
  }
  return dynamoDBUtilInstance;
}
