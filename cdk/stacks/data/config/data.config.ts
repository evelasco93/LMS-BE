import { IDataStackConfig } from "../types/data.types";
import { nameBuilder, platformNameBuilder } from "../../../config/base.config";

export const dataConfig: IDataStackConfig = {
  tables: {
    clients: {
      tableName: nameBuilder.table("clients"),
      partitionKey: { name: "id", type: "S" },
      gsi: [
        // NOTE: Can only add one GSI per deployment - uncomment and deploy one at a time
        // {
        //   indexName: nameBuilder.index('clients', 'status'),
        //   partitionKey: { name: 'status', type: 'S' },
        //   sortKey: { name: 'created_at', type: 'S' },
        //   projectionType: 'ALL',
        // },
      ],
      pointInTimeRecovery: true,
      deletionProtection: false,
    },
    affiliates: {
      tableName: nameBuilder.table("affiliates"),
      partitionKey: { name: "id", type: "S" },
      gsi: [
        // NOTE: Can only add one GSI per deployment - uncomment and deploy one at a time
        // {
        //   indexName: nameBuilder.index('affiliates', 'status'),
        //   partitionKey: { name: 'status', type: 'S' },
        //   sortKey: { name: 'created_at', type: 'S' },
        //   projectionType: 'ALL',
        // },
      ],
      pointInTimeRecovery: true,
      deletionProtection: false,
    },
    campaigns: {
      tableName: nameBuilder.table("campaigns"),
      partitionKey: { name: "id", type: "S" },
      gsi: [
        {
          indexName: nameBuilder.index("campaigns", "status"),
          partitionKey: { name: "status", type: "S" },
          sortKey: { name: "created_at", type: "S" },
          projectionType: "ALL",
        },
      ],
      pointInTimeRecovery: true,
      deletionProtection: false,
    },
    leads: {
      tableName: nameBuilder.table("leads"),
      partitionKey: { name: "id", type: "S" },
      pointInTimeRecovery: true,
      deletionProtection: false,
    },
    /**
     * Consolidated single table for all tenant configuration records.
     * Records are discriminated by the `type` field:
     *   credential        → tenant credentials (CR-prefixed id)
     *   credential_schema → credential schema definitions (CS-prefixed id)
     *   plugin_setting    → global plugin default configurations (PG-prefixed id)
     */
    tenantSettings: {
      tableName: nameBuilder.table("tenant-settings"),
      partitionKey: { name: "id", type: "S" },
      gsi: [
        {
          // GSI 1: list all records of a given type
          // Service uses: `${TENANT_SETTINGS_TABLE_NAME}-type-index`
          indexName: `${nameBuilder.table("tenant-settings")}-type-index`,
          partitionKey: { name: "type", type: "S" },
          projectionType: "ALL",
        },
        {
          // GSI 2: filter within a type by provider (e.g. all trusted_form credentials)
          // Service uses: `${TENANT_SETTINGS_TABLE_NAME}-type-provider-index`
          indexName: `${nameBuilder.table("tenant-settings")}-type-provider-index`,
          partitionKey: { name: "type", type: "S" },
          sortKey: { name: "provider", type: "S" },
          projectionType: "ALL",
        },
        {
          // GSI 3: look up plugin_setting records by the schema_id they reference
          // Service uses: `${TENANT_SETTINGS_TABLE_NAME}-schema-id-index`
          indexName: `${nameBuilder.table("tenant-settings")}-schema-id-index`,
          partitionKey: { name: "schema_id", type: "S" },
          projectionType: "ALL",
        },
      ],
      pointInTimeRecovery: true,
      deletionProtection: false,
    },
    /**
     * Centralized audit log table.
     * PK: entity_id, SK: log_id (time-sortable base32 string)
     * GSI 1: entity_type-changed_at-index — cross-entity activity feed
     * GSI 2: actor-index                  — all changes by a specific user
     * GSI 3: date-index                   — daily S3 export
     */
    auditLogs: {
      tableName: nameBuilder.table("audit-logs"),
      partitionKey: { name: "entity_id", type: "S" },
      sortKey: { name: "log_id", type: "S" },
      gsi: [
        {
          indexName: `${nameBuilder.table("audit-logs")}-entity-type-index`,
          partitionKey: { name: "entity_type", type: "S" },
          sortKey: { name: "changed_at", type: "S" },
          projectionType: "ALL",
        },
        {
          indexName: `${nameBuilder.table("audit-logs")}-actor-index`,
          partitionKey: { name: "actor_sub", type: "S" },
          sortKey: { name: "changed_at", type: "S" },
          projectionType: "ALL",
        },
        {
          indexName: `${nameBuilder.table("audit-logs")}-date-index`,
          partitionKey: { name: "date", type: "S" },
          sortKey: { name: "changed_at", type: "S" },
          projectionType: "ALL",
        },
      ],
      pointInTimeRecovery: true,
      deletionProtection: false,
    },
    /**
     * Lead intake log table.
     * PK: id (UUID — same as ILead.id)
     * GSI: campaign_id-received_at-index — campaign-scoped queries
     */
    leadIntakeLogs: {
      tableName: nameBuilder.table("lead-intake-logs"),
      partitionKey: { name: "id", type: "S" },
      gsi: [
        {
          indexName: `${nameBuilder.table("lead-intake-logs")}-campaign-received-at-index`,
          partitionKey: { name: "campaign_id", type: "S" },
          sortKey: { name: "received_at", type: "S" },
          projectionType: "ALL",
        },
      ],
      pointInTimeRecovery: false,
      deletionProtection: false,
    },
    /**
     * Presets table (criteria catalog, logic catalog, tenant presets).
     * PK: id (catalog_set: CCS-prefixed; catalog_version: "{setId}#v{n}")
     * GSI: criteria_set_id-index — list all versions for a given catalog set
     */
    presets: {
      tableName: nameBuilder.table("presets"),
      partitionKey: { name: "id", type: "S" },
      gsi: [
        {
          indexName: "criteria_set_id-index",
          partitionKey: { name: "criteria_set_id", type: "S" },
          projectionType: "ALL",
        },
      ],
      pointInTimeRecovery: true,
      deletionProtection: false,
    },
    /**
     * User Table Preferences table.
     * PK: user_id (Cognito sub), SK: table_id
     */
    userTablePreferences: {
      tableName: nameBuilder.table("user-table-preferences"),
      partitionKey: { name: "user_id", type: "S" },
      sortKey: { name: "table_id", type: "S" },
      pointInTimeRecovery: false,
      deletionProtection: false,
    },
    /**
     * Platform Presets table (global, tenantless).
     * PK: id (preset ID)
     * GSI: scope-index (PK: scope, SK: name) — list presets by scope
     */
    platformPresets: {
      tableName: platformNameBuilder.table("platform-presets"),
      partitionKey: { name: "id", type: "S" },
      gsi: [
        {
          indexName: "scope-index",
          partitionKey: { name: "scope", type: "S" },
          sortKey: { name: "name", type: "S" },
          projectionType: "ALL",
        },
      ],
      pointInTimeRecovery: true,
      deletionProtection: false,
    },
  },
  auditLogsBucketName:
    `${nameBuilder.table("audit-logs-bucket")}`.toLowerCase(),
};
