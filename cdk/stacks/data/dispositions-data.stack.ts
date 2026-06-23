import { NestedStack, NestedStackProps, RemovalPolicy } from "aws-cdk-lib";
import {
  AttributeType,
  BillingMode,
  ProjectionType,
  Table,
} from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";
import { ITableConfig } from "./types/data.types";

export interface IDispositionsDataStackProps extends NestedStackProps {
  dispositionsTableConfig: ITableConfig;
  dispositionRowsTableConfig: ITableConfig;
  publicDashboardsTableConfig: ITableConfig;
  removalPolicy?: RemovalPolicy;
  logicalIdPrefix: string;
}

export class DispositionsDataStack extends NestedStack {
  public readonly dispositionsTable: Table;
  public readonly dispositionRowsTable: Table;
  public readonly publicDashboardsTable: Table;

  constructor(
    scope: Construct,
    id: string,
    props: IDispositionsDataStackProps,
  ) {
    super(scope, id, props);

    const {
      dispositionsTableConfig,
      dispositionRowsTableConfig,
      publicDashboardsTableConfig,
      removalPolicy,
      logicalIdPrefix,
    } = props;

    this.dispositionsTable = this.createTable(
      `${logicalIdPrefix}-DispositionsTable`,
      dispositionsTableConfig,
      removalPolicy,
    );

    this.dispositionRowsTable = this.createTable(
      `${logicalIdPrefix}-DispositionRowsTable`,
      dispositionRowsTableConfig,
      removalPolicy,
    );

    this.publicDashboardsTable = this.createTable(
      `${logicalIdPrefix}-PublicDashboardsTable`,
      publicDashboardsTableConfig,
      removalPolicy,
    );
  }

  private createTable(
    id: string,
    tableConfig: ITableConfig,
    removalPolicy?: RemovalPolicy,
  ): Table {
    const table = new Table(this, id, {
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
        table.addGlobalSecondaryIndex({
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

    return table;
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
