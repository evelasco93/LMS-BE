import { RequestActor } from "@shared/utils/request-audit.util";

export interface ITableColumnConfig {
  key: string;
  visible: boolean;
  order: number;
  width?: number;
}

export interface ITableSortConfig {
  field: string;
  direction: "asc" | "desc";
}

export interface ITableFilterConfig {
  field: string;
  value: unknown;
  operator?: string;
}

export interface ITableConfig {
  columns?: ITableColumnConfig[];
  sort?: ITableSortConfig[];
  filters?: ITableFilterConfig[];
}

/**
 * Stores a per-user, per-table UI configuration.
 * PK: user_id (Cognito sub from JWT)
 * SK: table_id (e.g. "leads_view", "campaigns_view")
 */
export interface IUserTablePreference {
  user_id: string;
  table_id: string;
  config: ITableConfig;
  updated_at: string;
  updated_by?: RequestActor;
}

export type UpsertTablePreferenceRequest = {
  config: ITableConfig;
};
