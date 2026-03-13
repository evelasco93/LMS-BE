import { IDataStackConfig } from "../types/data.types";
import { nameBuilder } from "../../../config/base.config";

export const dataConfig: IDataStackConfig = {
  tables: {
    clients: {
      tableName: nameBuilder.table("clients"),
      partitionKey: { name: "id", type: "S" },
      gsi: [
        {
          indexName: nameBuilder.index("clients", "email"),
          partitionKey: { name: "email", type: "S" },
          projectionType: "ALL",
        },
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
        {
          indexName: nameBuilder.index("affiliates", "email"),
          partitionKey: { name: "email", type: "S" },
          projectionType: "ALL",
        },
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
  },
  auditLogsBucketName:
    `${nameBuilder.table("audit-logs-bucket")}`.toLowerCase(),
};
