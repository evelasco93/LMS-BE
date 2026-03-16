import { NestedStack, NestedStackProps, RemovalPolicy } from "aws-cdk-lib";
import {
  Table,
  AttributeType,
  BillingMode,
  ProjectionType,
} from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";
import { ITableConfig } from "./types/data.types";

export interface ILeadIntakeLogsDataStackProps extends NestedStackProps {
  tableConfig: ITableConfig;
  removalPolicy?: RemovalPolicy;
  logicalIdPrefix: string;
}

/**
 * Nested stack for the lead intake log table.
 *
 * Every `POST /leads` and `POST /leads/test` request writes one record here so
 * that the raw HTTP context (body, headers, response summary) is available for
 * diagnostics and the frontend intake-logs UI.
 *
 * DynamoDB layout:
 *   PK: id              (same UUID as the resulting ILead.id)
 *
 * GSI:
 *   campaign_id-received_at-index
 *     PK: campaign_id, SK: received_at
 *     → Efficient campaign-scoped queries ordered by time (default access pattern)
 */
export class LeadIntakeLogsDataStack extends NestedStack {
  public readonly table: Table;

  constructor(
    scope: Construct,
    id: string,
    props: ILeadIntakeLogsDataStackProps,
  ) {
    super(scope, id, props);

    const { tableConfig, removalPolicy, logicalIdPrefix } = props;

    this.table = new Table(this, `${logicalIdPrefix}-LeadIntakeLogsTable`, {
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

    // GSI: query all intake logs for a specific campaign ordered by received_at
    this.table.addGlobalSecondaryIndex({
      indexName: tableConfig.gsi![0].indexName,
      partitionKey: { name: "campaign_id", type: AttributeType.STRING },
      sortKey: { name: "received_at", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });
  }
}
