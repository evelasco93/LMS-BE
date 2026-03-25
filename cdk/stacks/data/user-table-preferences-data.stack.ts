import { NestedStack, NestedStackProps, RemovalPolicy } from "aws-cdk-lib";
import { Table, AttributeType, BillingMode } from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";
import { ITableConfig } from "./types/data.types";

export interface IUserTablePreferencesDataStackProps extends NestedStackProps {
  tableConfig: ITableConfig;
  removalPolicy?: RemovalPolicy;
  logicalIdPrefix: string;
}

/**
 * Nested stack for the user-table-preferences table.
 *
 * PK: user_id  (Cognito sub — string)
 * SK: table_id (e.g. "leads_view", "campaigns_view" — string)
 *
 * One item per (user, table) pair. No GSIs needed: access is always by
 * the calling user's own sub, supplied directly via JWT.
 */
export class UserTablePreferencesDataStack extends NestedStack {
  public readonly table: Table;

  constructor(
    scope: Construct,
    id: string,
    props: IUserTablePreferencesDataStackProps,
  ) {
    super(scope, id, props);

    const { tableConfig, removalPolicy, logicalIdPrefix } = props;

    this.table = new Table(
      this,
      `${logicalIdPrefix}-UserTablePreferencesTable`,
      {
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
      },
    );
  }
}
