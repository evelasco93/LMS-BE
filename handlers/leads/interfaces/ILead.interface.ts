import type { RequestActor } from "@shared/utils/request-audit.util";

export interface IEditHistoryEntry {
  field: string; // dot-notation path, e.g. "payload.name"
  previous_value: unknown;
  new_value: unknown;
  changed_at: string; // ISO timestamp
  changed_by?: RequestActor;
}

export interface ITrustedFormResult {
  success: boolean;
  cert_id: string;
  outcome?: string;
  error?: string;
  phone?: string;
  phone_match?: boolean;
  vendor?: string;
  previously_retained?: boolean;
  expires_at?: string;
}

export interface IIpqsCheckResult {
  success: boolean;
  raw?: Record<string, unknown>;
  error?: string;
  criteria_results?: Record<string, boolean>;
}

export interface IIpqsResult {
  success: boolean;
  phone?: IIpqsCheckResult;
  email?: IIpqsCheckResult;
  ip?: IIpqsCheckResult;
  error?: string;
}

/**
 * Tracks a single field whose value was normalised via a campaign value_mapping.
 * Stored alongside the lead so the UI can highlight mapped fields.
 */
export interface IMappedFieldEntry {
  /** The payload key that was mapped (e.g. "assault_type") */
  field: string;
  /** The raw value received from the affiliate */
  original_value: unknown;
  /** The canonical value stored in payload after mapping */
  mapped_value: string;
  mapped_at: string;
}

export interface ILogicRulesResult {
  passed: boolean;
  rejection_reason?: string;
  matched_rule_id?: string;
  matched_rule_name?: string;
}

export interface ILead {
  id: string;
  campaign_id: string;
  campaign_key: string;
  test: boolean;
  payload?: Record<string, unknown>;
  /** Fields that were normalised by a value_mapping rule at intake time */
  mapped_fields?: IMappedFieldEntry[];
  /** Result of the logic rules evaluation at lead intake time */
  logic_rules_result?: ILogicRulesResult;
  duplicate?: boolean;
  duplicate_matches?: {
    lead_ids: string[];
  };
  trusted_form_result?: ITrustedFormResult;
  ipqs_result?: IIpqsResult;
  created_at: string;
  affiliate_status_at_intake?: string;
  rejected?: boolean;
  rejection_reason?: string;
  /** True when a QA pipeline gate plugin failed and halted processing */
  pipeline_halted?: boolean;
  /** Stage number where the pipeline was halted (1 = duplicate_check, 2+ = configurable plugins) */
  halt_stage?: number;
  /** Name of the plugin that triggered the halt */
  halt_plugin?: string;
  /** Affiliate-readable reason for the halt */
  halt_reason?: string;
  created_by?: RequestActor;
  updated_at?: string;
  updated_by?: RequestActor;
  edit_history?: IEditHistoryEntry[];
  /**
   * Set of payload field keys that were manually edited after intake.
   * Used by the frontend to visually distinguish edited fields.
   */
  edited_fields?: string[];
  is_deleted?: boolean;
  active?: boolean;
  deleted_at?: string;
  deleted_by?: RequestActor;
}
