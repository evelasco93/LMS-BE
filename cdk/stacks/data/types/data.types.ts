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
    leads: ITableConfig;
    /** Consolidated single table for credentials, credential schemas, and plugin settings */
    tenantSettings: ITableConfig;
    /** Centralized audit log table — one item per mutation across all entity types */
    auditLogs: ITableConfig;
    /** Raw HTTP intake log — one record per POST /leads submission attempt */
    leadIntakeLogs: ITableConfig;
    /** Versioned criteria catalog sets — catalog_set + catalog_version records */
    criteriaCatalog: ITableConfig;
    /** Per-user, per-table UI configuration (column visibility, sort, filters) */
    userTablePreferences: ITableConfig;
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
