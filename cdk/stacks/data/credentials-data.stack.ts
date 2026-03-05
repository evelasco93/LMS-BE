import { NestedStack, NestedStackProps, RemovalPolicy } from "aws-cdk-lib";
import {
  Table,
  AttributeType,
  BillingMode,
  ProjectionType,
} from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";
import { ITableConfig } from "./types/data.types";

export interface ICredentialsDataStackProps extends NestedStackProps {
  tableConfig: ITableConfig;
  removalPolicy?: RemovalPolicy;
  logicalIdPrefix: string;
}

/**
 * Nested stack for credentials data resources
 */
export class CredentialsDataStack extends NestedStack {
  public readonly table: Table;

  constructor(scope: Construct, id: string, props: ICredentialsDataStackProps) {
    super(scope, id, props);

    const { tableConfig, removalPolicy, logicalIdPrefix } = props;

    this.table = new Table(this, `${logicalIdPrefix}-CredentialsTable`, {
      tableName: tableConfig.tableName,
      partitionKey: {
        name: tableConfig.partitionKey.name,
        type: this.getAttributeType(tableConfig.partitionKey.type),
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: tableConfig.pointInTimeRecovery
        ? { pointInTimeRecoveryEnabled: true }
        : undefined,
      deletionProtection: tableConfig.deletionProtection || false,
      removalPolicy: removalPolicy ?? RemovalPolicy.DESTROY,
    });

    // GSI: query credentials by provider
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
          projectionType: ProjectionType.ALL,
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
}
