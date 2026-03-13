import { NestedStack, NestedStackProps, RemovalPolicy } from "aws-cdk-lib";
import {
  Table,
  AttributeType,
  BillingMode,
  ProjectionType,
} from "aws-cdk-lib/aws-dynamodb";
import {
  Bucket,
  BucketEncryption,
  BlockPublicAccess,
} from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import { ITableConfig } from "./types/data.types";

export interface IAuditLogsDataStackProps extends NestedStackProps {
  tableConfig: ITableConfig;
  s3BucketName: string;
  removalPolicy?: RemovalPolicy;
  logicalIdPrefix: string;
}

/**
 * Nested stack for the centralized audit log table.
 *
 * Single-table design for all entity audit events:
 *   PK: entity_id  (e.g. "LDABC123", "CAMP-001", "CLT-001")
 *   SK: log_id     (ULID — lexicographically sorted by time, globally unique)
 *
 * Three GSIs:
 *   1. entity_type-changed_at-index
 *      PK: entity_type, SK: changed_at
 *      → Admin activity feed filtered by entity type
 *
 *   2. actor_sub-changed_at-index
 *      PK: actor_sub, SK: changed_at
 *      → All changes made by a specific user
 *
 *   3. date-index
 *      PK: date  (YYYY-MM-DD)
 *      → Daily S3 export queries via EventBridge Scheduler
 */
export class AuditLogsDataStack extends NestedStack {
  public readonly table: Table;
  public readonly bucket: Bucket;

  constructor(scope: Construct, id: string, props: IAuditLogsDataStackProps) {
    super(scope, id, props);

    const { tableConfig, s3BucketName, removalPolicy, logicalIdPrefix } = props;

    this.table = new Table(this, `${logicalIdPrefix}-AuditLogsTable`, {
      tableName: tableConfig.tableName,
      partitionKey: {
        name: tableConfig.partitionKey.name,
        type: AttributeType.STRING,
      },
      sortKey: {
        name: tableConfig.sortKey!.name,
        type: AttributeType.STRING,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: tableConfig.pointInTimeRecovery
        ? { pointInTimeRecoveryEnabled: true }
        : undefined,
      deletionProtection: tableConfig.deletionProtection ?? false,
      removalPolicy: removalPolicy ?? RemovalPolicy.DESTROY,
    });

    // GSI 1: query all audit events for a given entity_type ordered by time
    this.table.addGlobalSecondaryIndex({
      indexName: tableConfig.gsi![0].indexName,
      partitionKey: { name: "entity_type", type: AttributeType.STRING },
      sortKey: { name: "changed_at", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // GSI 2: query all events performed by a specific actor (by Cognito sub)
    this.table.addGlobalSecondaryIndex({
      indexName: tableConfig.gsi![1].indexName,
      partitionKey: { name: "actor_sub", type: AttributeType.STRING },
      sortKey: { name: "changed_at", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // GSI 3: daily export — fetch all events for a calendar date
    this.table.addGlobalSecondaryIndex({
      indexName: tableConfig.gsi![2].indexName,
      partitionKey: { name: "date", type: AttributeType.STRING },
      sortKey: { name: "changed_at", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // S3 bucket for NDJSON audit exports (daily EventBridge → Lambda → S3)
    this.bucket = new Bucket(this, `${logicalIdPrefix}-AuditLogsBucket`, {
      bucketName: s3BucketName,
      encryption: BucketEncryption.S3_MANAGED,
      blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      versioned: false,
      removalPolicy: removalPolicy ?? RemovalPolicy.RETAIN,
    });
  }
}
