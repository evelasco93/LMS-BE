import {
  DynamoDBClient,
  DynamoDBClientConfig,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  ScanCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
  PutCommandInput,
  GetCommandInput,
  ScanCommandInput,
  QueryCommandInput,
  UpdateCommandInput,
  DeleteCommandInput,
} from '@aws-sdk/lib-dynamodb';

export class DynamoDbUtil {
  private client: DynamoDBDocumentClient;
  private tableName: string;

  constructor(tableName: string, region: string = 'us-east-1') {
    const config: DynamoDBClientConfig = {
      region,
    };

    const ddbClient = new DynamoDBClient(config);
    this.client = DynamoDBDocumentClient.from(ddbClient, {
      marshallOptions: {
        removeUndefinedValues: true,
        convertClassInstanceToMap: true,
      },
    });
    this.tableName = tableName;
  }

  /**
   * Write an item to DynamoDB
   */
  async put(item: Record<string, any>): Promise<void> {
    const params: PutCommandInput = {
      TableName: this.tableName,
      Item: item,
    };

    await this.client.send(new PutCommand(params));
  }

  /**
   * Get an item from DynamoDB by key
   */
  async get(key: Record<string, any>): Promise<Record<string, any> | null> {
    const params: GetCommandInput = {
      TableName: this.tableName,
      Key: key,
    };

    const result = await this.client.send(new GetCommand(params));
    return result.Item || null;
  }

  /**
   * Scan the entire table
   */
  async scan(filterExpression?: string, expressionAttributeValues?: Record<string, any>): Promise<Record<string, any>[]> {
    const params: ScanCommandInput = {
      TableName: this.tableName,
    };

    if (filterExpression) {
      params.FilterExpression = filterExpression;
    }

    if (expressionAttributeValues) {
      params.ExpressionAttributeValues = expressionAttributeValues;
    }

    const result = await this.client.send(new ScanCommand(params));
    return result.Items || [];
  }

  /**
   * Query items using an index
   */
  async query(
    keyConditionExpression: string,
    expressionAttributeValues: Record<string, any>,
    indexName?: string
  ): Promise<Record<string, any>[]> {
    const params: QueryCommandInput = {
      TableName: this.tableName,
      KeyConditionExpression: keyConditionExpression,
      ExpressionAttributeValues: expressionAttributeValues,
    };

    if (indexName) {
      params.IndexName = indexName;
    }

    const result = await this.client.send(new QueryCommand(params));
    return result.Items || [];
  }

  /**
   * Update an item in DynamoDB
   */
  async update(
    key: Record<string, any>,
    updateExpression: string,
    expressionAttributeValues: Record<string, any>,
    expressionAttributeNames?: Record<string, string>
  ): Promise<Record<string, any> | null> {
    const params: UpdateCommandInput = {
      TableName: this.tableName,
      Key: key,
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: 'ALL_NEW',
    };

    if (expressionAttributeNames) {
      params.ExpressionAttributeNames = expressionAttributeNames;
    }

    const result = await this.client.send(new UpdateCommand(params));
    return result.Attributes || null;
  }

  /**
   * Delete an item from DynamoDB
   */
  async delete(key: Record<string, any>): Promise<void> {
    const params: DeleteCommandInput = {
      TableName: this.tableName,
      Key: key,
    };

    await this.client.send(new DeleteCommand(params));
  }

  /**
   * Batch write items (for bulk inserts)
   */
  async batchWrite(items: Record<string, any>[]): Promise<void> {
    // Process in batches of 25 (DynamoDB limit)
    const batchSize = 25;
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      await Promise.all(batch.map(item => this.put(item)));
    }
  }

  /**
   * Query a GSI by partition key value
   */
  async queryByGsi(
    indexName: string,
    partitionKeyName: string,
    partitionKeyValue: string
  ): Promise<Record<string, any>[]> {
    return this.query(
      `${partitionKeyName} = :pkValue`,
      { ':pkValue': partitionKeyValue },
      indexName
    );
  }
}
