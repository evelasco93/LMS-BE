import { IBaseCriteriaField } from "./ICampaign.interface";
import { ILogicRule } from "./ICampaign.interface";
import { RequestActor } from "@shared/utils/request-audit.util";

/**
 * Metadata record for a named criteria catalog set.
 * PK: id  (CCS-prefixed, e.g. "CCSA1B2C3D4")
 * record_type: "catalog_set"
 */
export interface ICriteriaCatalogSet {
  id: string;
  record_type: "catalog_set";
  name: string;
  description?: string;
  tags?: string[];
  latest_version: number;
  created_at: string;
  updated_at: string;
  created_by?: RequestActor;
  updated_by?: RequestActor;
}

/**
 * An immutable snapshot of one criteria catalog version.
 * PK: id  (format: "{criteria_set_id}#v{version}", e.g. "CCSA1B2C3D4#v2")
 * record_type: "catalog_version"
 * The `criteria_set_id` field drives the GSI for listing all versions of a set.
 */
export interface ICriteriaCatalogVersion {
  id: string;
  record_type: "catalog_version";
  criteria_set_id: string;
  version: number;
  /** Denormalised name from the parent set, for display without an extra fetch. */
  name: string;
  fields: IBaseCriteriaField[];
  /** Campaign IDs that have applied this version — updated atomically on assignment. */
  campaigns_using: string[];
  created_at: string;
  created_by?: RequestActor;
}

// ── Request types ────────────────────────────────────────────────────────────

export type CreateCriteriaCatalogRequest = {
  name: string;
  description?: string;
  tags?: string[];
  /** Initial set of fields (optional — can be added later). */
  fields?: Pick<
    IBaseCriteriaField,
    | "field_label"
    | "field_name"
    | "data_type"
    | "required"
    | "description"
    | "options"
    | "value_mappings"
    | "state_mapping"
    | "client_override"
    | "affiliate_override"
  >[];
};

export type UpdateCriteriaCatalogRequest = {
  name?: string;
  description?: string;
  /** Full replacement field list for the new version. */
  fields: Pick<
    IBaseCriteriaField,
    | "field_label"
    | "field_name"
    | "data_type"
    | "required"
    | "description"
    | "options"
    | "value_mappings"
    | "state_mapping"
    | "client_override"
    | "affiliate_override"
  >[];
};

export type ApplyCriteriaCatalogRequest = {
  criteria_set_id: string;
  version: number;
};

// ── Logic Catalog (separate from criteria catalog) ─────────────────────────

export interface ILogicCatalogSet {
  id: string;
  record_type: "logic_set";
  name: string;
  description?: string;
  tags?: string[];
  latest_version: number;
  created_at: string;
  updated_at: string;
  created_by?: RequestActor;
  updated_by?: RequestActor;
}

export interface ILogicCatalogVersion {
  id: string;
  record_type: "logic_version";
  logic_set_id: string;
  version: number;
  name: string;
  rules: ILogicRule[];
  campaigns_using: string[];
  created_at: string;
  created_by?: RequestActor;
}

export type CreateLogicCatalogRequest = {
  name: string;
  description?: string;
  tags?: string[];
  rules?: Pick<ILogicRule, "name" | "action" | "enabled" | "groups">[];
};

export type UpdateLogicCatalogRequest = {
  name?: string;
  description?: string;
  rules: Pick<ILogicRule, "name" | "action" | "enabled" | "groups">[];
};

export type ApplyLogicCatalogRequest = {
  logic_set_id: string;
  version: number;
};
