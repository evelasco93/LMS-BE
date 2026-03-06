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
  };
}

/**
 * Data Stack Props
 */
export interface IDataStackProps extends IBaseStackProps {
  dataConfig: IDataStackConfig;
}
