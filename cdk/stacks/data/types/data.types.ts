import { IBaseStackProps } from "../../../types/base.types";

/**
 * DynamoDB Key Configuration
 */
export interface IKeyConfig {
  name: string;
  type: "S" | "N" | "B";
}

/**
 * DynamoDB GSI Configuration
 */
export interface IGsiConfig {
  indexName: string;
  partitionKey: IKeyConfig;
  sortKey?: IKeyConfig;
  projectionType: "ALL" | "KEYS_ONLY" | "INCLUDE";
  nonKeyAttributes?: string[];
}

/**
 * DynamoDB Table Configuration
 */
export interface ITableConfig {
  tableName: string;
  partitionKey: IKeyConfig;
  sortKey?: IKeyConfig;
  gsi?: IGsiConfig[];
  pointInTimeRecovery?: boolean;
  deletionProtection?: boolean;
}

/**
 * Data Stack Configuration
 */
export interface IDataStackConfig {
  tables: {
    clients: ITableConfig;
    affiliates: ITableConfig;
    campaigns: ITableConfig;
    /** Campaign dashboard widget definitions keyed by campaign and widget */
    campaignDashboardWidgets: ITableConfig;
    leads: ITableConfig;
    /** Metrics domain single-table (item-type model) */
    metrics: ITableConfig;
    /** Consolidated single table for credentials, credential schemas, and plugin settings */
    tenantSettings: ITableConfig;
    /** Centralized audit log table — one item per mutation across all entity types */
    auditLogs: ITableConfig;
    /** Raw HTTP intake log — one record per POST /leads submission attempt */
    leadIntakeLogs: ITableConfig;
    /** Versioned presets — criteria catalog, logic catalog, and tenant preset records */
    presets: ITableConfig;
    /** Per-user, per-table UI configuration (column visibility, sort, filters) */
    userTablePreferences: ITableConfig;
    /** Platform-wide presets (field sets, rule sets, etc.) by scope */
    platformPresets: ITableConfig;
  };
  /** S3 bucket name for daily audit log NDJSON exports (Athena-queryable) */
  auditLogsBucketName: string;
}

/**
 * Data Stack Props
 */
export interface IDataStackProps extends IBaseStackProps {
  dataConfig: IDataStackConfig;
}
