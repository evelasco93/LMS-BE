import { NestedStack, NestedStackProps, RemovalPolicy } from "aws-cdk-lib";
import {
  Table,
  AttributeType,
  BillingMode,
  ProjectionType,
} from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";
import { ITableConfig } from "./types/data.types";

export interface ITenantSettingsDataStackProps extends NestedStackProps {
  tableConfig: ITableConfig;
  removalPolicy?: RemovalPolicy;
  logicalIdPrefix: string;
}

/**
 * Nested stack for the consolidated tenant-settings table.
 *
 * Single-table design: one item per record, discriminated by the `type` attribute.
 *   type = "credential"        → tenant credential (CR-prefixed id)
 *   type = "credential_schema" → credential schema (CS-prefixed id)
 *   type = "plugin_setting"    → global plugin setting (PG-prefixed id)
 *
 * Three GSIs — all created on initial deploy since this is a brand-new table:
 *   1. type-index          → partition key: type
 *      Used by list-all-of-type queries (e.g. list all credentials)
 *   2. type-provider-index → partition key: type, sort key: provider
 *      Used to filter credentials/schemas by provider within a type
 *   3. schema-id-index     → partition key: schema_id
 *      Used to look up plugin_setting records by their referenced schema id
 */
export class TenantSettingsDataStack extends NestedStack {
  public readonly table: Table;

  constructor(
    scope: Construct,
    id: string,
    props: ITenantSettingsDataStackProps,
  ) {
    super(scope, id, props);

    const { tableConfig, removalPolicy, logicalIdPrefix } = props;

    this.table = new Table(this, `${logicalIdPrefix}-TenantSettingsTable`, {
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

    // GSI 1: query all records of a given type (credential | credential_schema | plugin_setting)
    this.table.addGlobalSecondaryIndex({
      indexName: tableConfig.gsi![0].indexName,
      partitionKey: { name: "type", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // GSI 2: query by type + provider (e.g. all trusted_form credentials)
    this.table.addGlobalSecondaryIndex({
      indexName: tableConfig.gsi![1].indexName,
      partitionKey: { name: "type", type: AttributeType.STRING },
      sortKey: { name: "provider", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // GSI 3: look up plugin_setting by the schema_id it references
    this.table.addGlobalSecondaryIndex({
      indexName: tableConfig.gsi![2].indexName,
      partitionKey: { name: "schema_id", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });
  }
}
