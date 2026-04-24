import {
  NestedStack,
  NestedStackProps,
  RemovalPolicy,
  CustomResource,
  Duration,
  Stack,
} from "aws-cdk-lib";
import {
  Table,
  AttributeType,
  BillingMode,
  ProjectionType,
} from "aws-cdk-lib/aws-dynamodb";
import * as cr from "aws-cdk-lib/custom-resources";
import * as crypto from "crypto";
import { Construct } from "constructs";
import { ITableConfig } from "./types/data.types";
import { PLATFORM_PRESETS_SEED } from "./seed/platform-presets-seed";

export interface IPlatformPresetsDataStackProps extends NestedStackProps {
  tableConfig: ITableConfig;
  removalPolicy?: RemovalPolicy;
  logicalIdPrefix: string;
}

/**
 * Nested stack for the platform-presets table.
 *
 * Stores platform-level preset definitions (e.g. US States, Yes/No).
 * PK: id (String)
 * GSI: scope-index (PK: scope, SK: name) — list presets by scope.
 */
export class PlatformPresetsDataStack extends NestedStack {
  public readonly table: Table;

  constructor(
    scope: Construct,
    id: string,
    props: IPlatformPresetsDataStackProps,
  ) {
    super(scope, id, props);

    const { tableConfig, removalPolicy, logicalIdPrefix } = props;

    this.table = new Table(this, `${logicalIdPrefix}-PlatformPresetsTable`, {
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

    // GSI: list presets by scope (e.g. "platform", "system")
    this.table.addGlobalSecondaryIndex({
      indexName: tableConfig.gsi![0].indexName,
      partitionKey: { name: "scope", type: AttributeType.STRING },
      sortKey: { name: "name", type: AttributeType.STRING },
      projectionType: ProjectionType.ALL,
    });

    // ── Seed platform presets on deploy ────────────────────────────────────
    const now = new Date().toISOString();
    for (const preset of PLATFORM_PRESETS_SEED) {
      const item: Record<string, unknown> = {
        id: { S: preset.id },
        scope: { S: "platform" },
        name: { S: preset.name },
        description: { S: preset.description ?? "" },
        data_type: { S: preset.data_type },
        created_at: { S: now },
        updated_at: { S: now },
      };

      // List-type presets store options
      if (preset.options) {
        item.options = {
          L: preset.options.map((o) => ({
            M: {
              value: { S: o.value.trim().toLowerCase().replace(/\s+/g, "_") },
              label: { S: o.label },
            },
          })),
        };
      }

      // FieldSet-type presets store fields
      if (preset.fields) {
        item.fields = {
          L: preset.fields.map((f) => ({
            M: {
              field_label: { S: f.field_label },
              field_name: { S: f.field_name },
              data_type: { S: f.data_type },
              required: { BOOL: f.required },
              ...(f.description ? { description: { S: f.description } } : {}),
            },
          })),
        };
      }

      if (preset.locked) {
        item.locked = { BOOL: true };
      }
      if (preset.casing) {
        item.casing = { S: preset.casing };
      }
      if (preset.mapping_modes) {
        item.mapping_modes = {
          L: preset.mapping_modes.map((m) => ({ S: m })),
        };
      }

      // Content hash so CDK detects seed data changes and triggers onUpdate
      const contentHash = crypto
        .createHash("md5")
        .update(JSON.stringify(preset))
        .digest("hex")
        .slice(0, 8);

      new cr.AwsCustomResource(this, `Seed-${preset.id}`, {
        onCreate: {
          service: "DynamoDB",
          action: "putItem",
          parameters: {
            TableName: tableConfig.tableName,
            Item: item,
          },
          physicalResourceId: cr.PhysicalResourceId.of(
            `seed-${preset.id}-${contentHash}`,
          ),
        },
        onUpdate: {
          service: "DynamoDB",
          action: "putItem",
          parameters: {
            TableName: tableConfig.tableName,
            Item: item,
          },
          physicalResourceId: cr.PhysicalResourceId.of(
            `seed-${preset.id}-${contentHash}`,
          ),
        },
        policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
          resources: [
            Stack.of(this).formatArn({
              service: "dynamodb",
              resource: "table",
              resourceName: tableConfig.tableName,
            }),
          ],
        }),
      });
    }
  }
}
