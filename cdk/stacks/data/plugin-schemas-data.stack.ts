import { NestedStack, NestedStackProps, RemovalPolicy } from "aws-cdk-lib";
import { Table, AttributeType, BillingMode } from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";
import { ITableConfig } from "./types/data.types";

export interface IPluginSchemasDataStackProps extends NestedStackProps {
  tableConfig: ITableConfig;
  removalPolicy?: RemovalPolicy;
  logicalIdPrefix: string;
}

/**
 * Nested stack for plugin-schemas table.
 * Stores the credential field definitions for each QA plugin so the
 * frontend can dynamically generate the credential creation form.
 */
export class PluginSchemasDataStack extends NestedStack {
  public readonly table: Table;

  constructor(
    scope: Construct,
    id: string,
    props: IPluginSchemasDataStackProps,
  ) {
    super(scope, id, props);

    const { tableConfig, removalPolicy, logicalIdPrefix } = props;

    this.table = new Table(this, `${logicalIdPrefix}-PluginSchemasTable`, {
      tableName: tableConfig.tableName,
      partitionKey: {
        name: tableConfig.partitionKey.name,
        type: AttributeType.STRING,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: tableConfig.pointInTimeRecovery
        ? { pointInTimeRecoveryEnabled: true }
        : undefined,
      deletionProtection: tableConfig.deletionProtection ?? false,
      removalPolicy: removalPolicy ?? RemovalPolicy.DESTROY,
    });
  }
}
