import { NestedStack, NestedStackProps, RemovalPolicy } from "aws-cdk-lib";
import { Table, AttributeType, BillingMode } from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";
import { ITableConfig } from "./types/data.types";

export interface ICampaignsDataStackProps extends NestedStackProps {
  tableConfig: ITableConfig;
  dashboardWidgetsTableConfig: ITableConfig;
  removalPolicy?: RemovalPolicy;
  logicalIdPrefix: string;
}

/**
 * Nested stack for campaigns data resources (DynamoDB table, future storage)
 */
export class CampaignsDataStack extends NestedStack {
  public readonly table: Table;
  public readonly dashboardWidgetsTable: Table;

  constructor(scope: Construct, id: string, props: ICampaignsDataStackProps) {
    super(scope, id, props);

    const {
      tableConfig,
      dashboardWidgetsTableConfig,
      removalPolicy,
      logicalIdPrefix,
    } = props;

    this.table = new Table(this, `${logicalIdPrefix}-CampaignsTable`, {
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

    // TODO: add GSIs when ready
    // if (tableConfig.gsi) { ... }

    this.dashboardWidgetsTable = new Table(
      this,
      `${logicalIdPrefix}-CampaignDashboardWidgetsTable`,
      {
        tableName: dashboardWidgetsTableConfig.tableName,
        partitionKey: {
          name: dashboardWidgetsTableConfig.partitionKey.name,
          type: this.getAttributeType(
            dashboardWidgetsTableConfig.partitionKey.type,
          ),
        },
        sortKey: dashboardWidgetsTableConfig.sortKey
          ? {
              name: dashboardWidgetsTableConfig.sortKey.name,
              type: this.getAttributeType(
                dashboardWidgetsTableConfig.sortKey.type,
              ),
            }
          : undefined,
        billingMode: BillingMode.PAY_PER_REQUEST,
        pointInTimeRecoverySpecification:
          dashboardWidgetsTableConfig.pointInTimeRecovery
            ? { pointInTimeRecoveryEnabled: true }
            : undefined,
        deletionProtection:
          dashboardWidgetsTableConfig.deletionProtection || false,
        removalPolicy: removalPolicy ?? RemovalPolicy.DESTROY,
      },
    );
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
