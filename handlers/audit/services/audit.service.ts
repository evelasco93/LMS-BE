import { injectable, inject } from "inversify";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { S3Util } from "@shared/clients/s3.util";
import { Logger } from "@shared/services/logger.util";
import { AuditConstants } from "../constants/audit.constants";
import { AuditLogItem } from "@shared/interfaces/IAuditLog.interface";
import { AuditQueryResult } from "../interfaces/audit-query.interface";

@injectable()
export class AuditService {
  constructor(
    @inject("DynamoDBUtil") private readonly dynamoDBUtil: DynamoDBUtil,
    @inject("S3Util") private readonly s3Util: S3Util,
    @inject("Logger") private readonly logger: Logger,
    @inject("AuditConstants") private readonly constants: AuditConstants,
  ) {}

  /**
   * Returns paginated audit log entries for a single entity.
   * Results are ordered newest-first (ScanIndexForward: false).
   */
  async getEntityHistory(
    entityId: string,
    limit = 50,
    cursor?: string,
  ): Promise<
    { result: true; data: AuditQueryResult } | { result: false; error: string }
  > {
    try {
      const params: any = {
        TableName: this.constants.AUDIT_LOGS_TABLE_NAME,
        KeyConditionExpression: "entity_id = :eid",
        ExpressionAttributeValues: { ":eid": entityId },
        Limit: limit,
        ScanIndexForward: false,
      };

      if (cursor) {
        params.ExclusiveStartKey = JSON.parse(
          Buffer.from(cursor, "base64url").toString("utf-8"),
        );
      }

      const result = await this.dynamoDBUtil.query<AuditLogItem>(params);

      const nextCursor = result.lastEvaluatedKey
        ? Buffer.from(JSON.stringify(result.lastEvaluatedKey)).toString(
            "base64url",
          )
        : undefined;

      return {
        result: true,
        data: { items: result.items, nextCursor },
      };
    } catch (error: any) {
      this.logger.error("Failed to query entity history", error);
      return { result: false, error: error.message ?? "Query failed" };
    }
  }

  /**
   * Cross-entity admin activity feed.
   * Queries entity_type-changed_at-index GSI or actor_sub-changed_at-index GSI.
   */
  async getActivityFeed(opts: {
    entity_type?: string;
    actor_sub?: string;
    from?: string;
    to?: string;
    limit?: number;
    cursor?: string;
  }): Promise<
    { result: true; data: AuditQueryResult } | { result: false; error: string }
  > {
    try {
      const limit = opts.limit ?? 50;

      const useActorIndex = !!opts.actor_sub && !opts.entity_type;
      const indexName = useActorIndex
        ? `${this.constants.AUDIT_LOGS_TABLE_NAME}-actor-index`
        : `${this.constants.AUDIT_LOGS_TABLE_NAME}-entity-type-index`;

      const pkAttr = useActorIndex ? "actor_sub" : "entity_type";
      const pkValue = useActorIndex ? opts.actor_sub! : opts.entity_type!;

      if (!pkValue) {
        return { result: false, error: "entity_type or actor_sub is required" };
      }

      let keyCondition = `${pkAttr} = :pkval`;
      const exprValues: Record<string, any> = { ":pkval": pkValue };

      if (opts.from && opts.to) {
        keyCondition += " AND changed_at BETWEEN :from AND :to";
        exprValues[":from"] = opts.from;
        exprValues[":to"] = opts.to;
      } else if (opts.from) {
        keyCondition += " AND changed_at >= :from";
        exprValues[":from"] = opts.from;
      } else if (opts.to) {
        keyCondition += " AND changed_at <= :to";
        exprValues[":to"] = opts.to;
      }

      const params: any = {
        TableName: this.constants.AUDIT_LOGS_TABLE_NAME,
        IndexName: indexName,
        KeyConditionExpression: keyCondition,
        ExpressionAttributeValues: exprValues,
        Limit: limit,
        ScanIndexForward: false,
      };

      if (opts.cursor) {
        params.ExclusiveStartKey = JSON.parse(
          Buffer.from(opts.cursor, "base64url").toString("utf-8"),
        );
      }

      const result = await this.dynamoDBUtil.query<AuditLogItem>(params);

      const nextCursor = result.lastEvaluatedKey
        ? Buffer.from(JSON.stringify(result.lastEvaluatedKey)).toString(
            "base64url",
          )
        : undefined;

      return {
        result: true,
        data: { items: result.items, nextCursor },
      };
    } catch (error: any) {
      this.logger.error("Failed to query activity feed", error);
      return { result: false, error: error.message ?? "Query failed" };
    }
  }

  /**
   * Full table scan — returns all audit log entries with cursor-based pagination.
   * Results are unordered (DynamoDB scan order). Use limit + cursor to page through.
   */
  async getAllRecords(
    limit = 50,
    cursor?: string,
  ): Promise<
    { result: true; data: AuditQueryResult } | { result: false; error: string }
  > {
    try {
      const params: any = {
        TableName: this.constants.AUDIT_LOGS_TABLE_NAME,
        Limit: limit,
      };

      if (cursor) {
        params.ExclusiveStartKey = JSON.parse(
          Buffer.from(cursor, "base64url").toString("utf-8"),
        );
      }

      const result = await this.dynamoDBUtil.scan<AuditLogItem>(params);

      const nextCursor = result.lastEvaluatedKey
        ? Buffer.from(JSON.stringify(result.lastEvaluatedKey)).toString(
            "base64url",
          )
        : undefined;

      return {
        result: true,
        data: { items: result.items, nextCursor },
      };
    } catch (error: any) {
      this.logger.error("Failed to scan audit table", error);
      return { result: false, error: error.message ?? "Scan failed" };
    }
  }

  /**
   * Exports all audit log entries for a given calendar date to S3 as NDJSON.
   * Called by EventBridge Scheduler daily and optionally via POST /audit/export.
   * S3 path: audit/YYYY/MM/DD/audit.ndjson
   */
  async exportToS3(
    date: string,
  ): Promise<
    | { result: true; s3Key: string; count: number }
    | { result: false; error: string }
  > {
    try {
      this.logger.info("Starting S3 audit export", { date });

      const indexName = `${this.constants.AUDIT_LOGS_TABLE_NAME}-date-index`;

      const allItems = await this.dynamoDBUtil.queryAll<AuditLogItem>({
        TableName: this.constants.AUDIT_LOGS_TABLE_NAME,
        IndexName: indexName,
        KeyConditionExpression: "#d = :date",
        ExpressionAttributeNames: { "#d": "date" },
        ExpressionAttributeValues: { ":date": date },
      });

      const [year, month, day] = date.split("-");
      const s3Key = `audit/${year}/${month}/${day}/audit.ndjson`;
      const body = allItems.map((item) => JSON.stringify(item)).join("\n");

      await this.s3Util.putObject({
        Bucket: this.constants.AUDIT_LOGS_S3_BUCKET,
        Key: s3Key,
        Body: body,
        ContentType: "application/x-ndjson",
      });

      this.logger.info("S3 audit export complete", {
        date,
        count: allItems.length,
        s3Key,
      });
      return { result: true, s3Key, count: allItems.length };
    } catch (error: any) {
      this.logger.error("S3 audit export failed", error);
      return { result: false, error: error.message ?? "Export failed" };
    }
  }
}
