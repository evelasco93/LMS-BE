import { NestedStack, NestedStackProps, RemovalPolicy } from "aws-cdk-lib";
import {
  AttributeType,
  BillingMode,
  ProjectionType,
  Table,
} from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";
import { ITableConfig } from "./types/data.types";

export interface IMetricsDataStackProps extends NestedStackProps {
  tableConfig: ITableConfig;
  removalPolicy?: RemovalPolicy;
  logicalIdPrefix: string;
}

/**
 * Nested stack for metrics domain data resources.
 */
export class MetricsDataStack extends NestedStack {
  public readonly table: Table;

  constructor(scope: Construct, id: string, props: IMetricsDataStackProps) {
    super(scope, id, props);

    const { tableConfig, removalPolicy, logicalIdPrefix } = props;

    this.table = new Table(this, `${logicalIdPrefix}-MetricsTable`, {
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
      deletionProtection: tableConfig.deletionProtection ?? false,
      removalPolicy: removalPolicy ?? RemovalPolicy.DESTROY,
    });

    if (tableConfig.gsi) {
      for (const gsi of tableConfig.gsi) {
        this.table.addGlobalSecondaryIndex({
          indexName: gsi.indexName,
          partitionKey: {
            name: gsi.partitionKey.name,
            type: this.getAttributeType(gsi.partitionKey.type),
          },
          sortKey: gsi.sortKey
            ? {
                name: gsi.sortKey.name,
                type: this.getAttributeType(gsi.sortKey.type),
              }
            : undefined,
          projectionType: this.getProjectionType(gsi.projectionType),
          nonKeyAttributes: gsi.nonKeyAttributes,
        });
      }
    }
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

  private getProjectionType(type: "ALL" | "KEYS_ONLY" | "INCLUDE") {
    switch (type) {
      case "KEYS_ONLY":
        return ProjectionType.KEYS_ONLY;
      case "INCLUDE":
        return ProjectionType.INCLUDE;
      case "ALL":
      default:
        return ProjectionType.ALL;
    }
  }
}
