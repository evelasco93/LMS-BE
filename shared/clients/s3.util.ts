import {
  S3Client,
  S3ClientConfig,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  CopyObjectCommand,
  PutObjectCommandInput,
  GetObjectCommandInput,
  DeleteObjectCommandInput,
  ListObjectsV2CommandInput,
  HeadObjectCommandInput,
  CopyObjectCommandInput,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';

/**
 * S3 Utility Class
 * Compatible with AWS SDK v3
 */
export class S3Util {
  private readonly client: S3Client;

  constructor(config?: S3ClientConfig) {
    this.client = new S3Client(config || {});
  }

  /**
   * Upload an object to S3
   */
  async putObject(params: PutObjectCommandInput): Promise<void> {
    const command = new PutObjectCommand(params);
    await this.client.send(command);
  }

  /**
   * Upload JSON data to S3
   */
  async putJSON(
    bucket: string,
    key: string,
    data: any,
    metadata?: Record<string, string>
  ): Promise<void> {
    await this.putObject({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(data),
      ContentType: 'application/json',
      Metadata: metadata,
    });
  }

  /**
   * Get an object from S3
   */
  async getObject(params: GetObjectCommandInput): Promise<{
    body: string;
    metadata?: Record<string, string>;
  }> {
    const command = new GetObjectCommand(params);
    const response = await this.client.send(command);
    
    const body = await this.streamToString(response.Body as Readable);
    
    return {
      body,
      metadata: response.Metadata,
    };
  }

  /**
   * Get JSON object from S3
   */
  async getJSON<T = any>(bucket: string, key: string): Promise<T> {
    const { body } = await this.getObject({
      Bucket: bucket,
      Key: key,
    });
    
    return JSON.parse(body);
  }

  /**
   * Delete an object from S3
   */
  async deleteObject(params: DeleteObjectCommandInput): Promise<void> {
    const command = new DeleteObjectCommand(params);
    await this.client.send(command);
  }

  /**
   * List objects in a bucket
   */
  async listObjects(params: ListObjectsV2CommandInput): Promise<{
    objects: Array<{
      key: string;
      size: number;
      lastModified: Date;
    }>;
    isTruncated: boolean;
    nextContinuationToken?: string;
  }> {
    const command = new ListObjectsV2Command(params);
    const response = await this.client.send(command);
    
    const objects = (response.Contents || []).map((item) => ({
      key: item.Key!,
      size: item.Size || 0,
      lastModified: item.LastModified || new Date(),
    }));
    
    return {
      objects,
      isTruncated: response.IsTruncated || false,
      nextContinuationToken: response.NextContinuationToken,
    };
  }

  /**
   * Check if an object exists
   */
  async objectExists(bucket: string, key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: bucket,
        Key: key,
      });
      await this.client.send(command);
      return true;
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Copy an object within S3
   */
  async copyObject(params: CopyObjectCommandInput): Promise<void> {
    const command = new CopyObjectCommand(params);
    await this.client.send(command);
  }

  /**
   * Get object metadata
   */
  async getObjectMetadata(
    bucket: string,
    key: string
  ): Promise<{
    contentType?: string;
    contentLength?: number;
    lastModified?: Date;
    metadata?: Record<string, string>;
  }> {
    const command = new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
    });
    
    const response = await this.client.send(command);
    
    return {
      contentType: response.ContentType,
      contentLength: response.ContentLength,
      lastModified: response.LastModified,
      metadata: response.Metadata,
    };
  }

  /**
   * List all objects (handles pagination)
   */
  async listAllObjects(
    bucket: string,
    prefix?: string
  ): Promise<Array<{
    key: string;
    size: number;
    lastModified: Date;
  }>> {
    const allObjects: Array<{
      key: string;
      size: number;
      lastModified: Date;
    }> = [];
    
    let continuationToken: string | undefined;
    
    do {
      const result = await this.listObjects({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      });
      
      allObjects.push(...result.objects);
      continuationToken = result.nextContinuationToken;
    } while (continuationToken);
    
    return allObjects;
  }

  /**
   * Convert stream to string
   */
  private async streamToString(stream: Readable): Promise<string> {
    const chunks: Buffer[] = [];
    
    return new Promise((resolve, reject) => {
      stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      stream.on('error', (err) => reject(err));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    });
  }

  /**
   * Get the underlying S3 client
   */
  getClient(): S3Client {
    return this.client;
  }
}

/**
 * Create an S3 utility instance
 */
export function createS3Util(config?: S3ClientConfig): S3Util {
  return new S3Util(config);
}

/**
 * Singleton instance for Lambda functions
 */
let s3UtilInstance: S3Util | null = null;

export function getS3Util(): S3Util {
  if (!s3UtilInstance) {
    s3UtilInstance = new S3Util();
  }
  return s3UtilInstance;
}
