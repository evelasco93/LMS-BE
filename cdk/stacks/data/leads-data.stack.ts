import { NestedStack, NestedStackProps, RemovalPolicy } from "aws-cdk-lib";
import {
  Table,
  AttributeType,
  BillingMode,
  ProjectionType,
} from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";
import { ITableConfig } from "./types/data.types";

export interface ILeadsDataStackProps extends NestedStackProps {
  tableConfig: ITableConfig;
  removalPolicy?: RemovalPolicy;
  logicalIdPrefix: string;
}

/**
 * Nested stack for leads data resources
 */
export class LeadsDataStack extends NestedStack {
  public readonly table: Table;

  constructor(scope: Construct, id: string, props: ILeadsDataStackProps) {
    super(scope, id, props);

    const { tableConfig, removalPolicy, logicalIdPrefix } = props;

    this.table = new Table(this, `${logicalIdPrefix}-LeadsTable`, {
      tableName: tableConfig.tableName,
      partitionKey: {
        name: tableConfig.partitionKey.name,
        type: this.getAttributeType(tableConfig.partitionKey.type),
      },
      sortKey: tableConfig.sortKey
        ? {
            name: tableConfig.sortKey.name,
            type: this.getAttributeType(tableConfig.sortKey.type),
          }
        : undefined,
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: tableConfig.pointInTimeRecovery
        ? { pointInTimeRecoveryEnabled: true }
        : undefined,
      deletionProtection: tableConfig.deletionProtection || false,
      removalPolicy: removalPolicy ?? RemovalPolicy.DESTROY,
    });

    // Query-first read path for campaign-scoped lead listing.
    this.table.addGlobalSecondaryIndex({
      indexName: `${tableConfig.tableName}-campaign-created-at-index`,
      partitionKey: {
        name: "campaign_id",
        type: AttributeType.STRING,
      },
      sortKey: {
        name: "created_at",
        type: AttributeType.STRING,
      },
      projectionType: ProjectionType.ALL,
    });

    // Global newest-first list path for unscoped all-leads queries.
    this.table.addGlobalSecondaryIndex({
      indexName: `${tableConfig.tableName}-entity-type-created-at-index`,
      partitionKey: {
        name: "entity_type",
        type: AttributeType.STRING,
      },
      sortKey: {
        name: "created_at",
        type: AttributeType.STRING,
      },
      projectionType: ProjectionType.ALL,
    });
  }

  private getAttributeType(type: "S" | "N" | "B") {
    switch (type) {
      case "N":
        return AttributeType.NUMBER;
      case "B":
        return AttributeType.BINARY;
      case "S":
      default:
        return AttributeType.STRING;
    }
  }
}
