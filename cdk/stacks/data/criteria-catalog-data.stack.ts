import { NestedStack, NestedStackProps, RemovalPolicy } from "aws-cdk-lib";
import {
  Table,
  AttributeType,
  BillingMode,
  ProjectionType,
} from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";
import { ITableConfig } from "./types/data.types";

export interface ICriteriaCatalogDataStackProps extends NestedStackProps {
  tableConfig: ITableConfig;
  removalPolicy?: RemovalPolicy;
  logicalIdPrefix: string;
}

/**
 * Nested stack for the criteria-catalog table.
 *
 * Single-table design — two record types discriminated by `record_type`:
 *   record_type = "catalog_set"     → CCS-prefixed PK: catalog set metadata
 *   record_type = "catalog_version" → PK: "{setId}#v{n}", version snapshot
 *
 * One GSI:
 *   criteria_set_id-index → partition key: criteria_set_id (STRING)
 *     Used to list all versions belonging to a given catalog set.
 */
export class CriteriaCatalogDataStack extends NestedStack {
  public readonly table: Table;

  constructor(
    scope: Construct,
    id: string,
    props: ICriteriaCatalogDataStackProps,
  ) {
    super(scope, id, props);

    const { tableConfig, removalPolicy, logicalIdPrefix } = props;

    this.table = new Table(this, `${logicalIdPrefix}-CriteriaCatalogTable`, {
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

    // GSI: list all version records for a given catalog set
    this.table.addGlobalSecondaryIndex({
      indexName: tableConfig.gsi![0].indexName,
      partitionKey: { name: "criteria_set_id", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });
  }
}
