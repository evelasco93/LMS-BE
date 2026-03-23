import { IMappedFieldEntry } from "./ILead.interface";
import { IEditHistoryEntry } from "@shared/utils/request-audit.util";

export interface BaseCriteriaField {
  id: string;
  field_name: string;
  required: boolean;
  value_mappings?: { from: string[]; to: string }[];
  state_mapping?: "abbr_to_name" | "name_to_abbr";
}

export interface ValueMappingResult {
  payload: Record<string, unknown>;
  mappedFields: IMappedFieldEntry[];
  editHistory: IEditHistoryEntry[];
  editedFields: string[];
}

export interface CriteriaValidationResponse {
  valid: boolean;
  missing_fields?: string[];
  rejection_reason?: string;
}

export interface LogicRulesResponse {
  passed: boolean;
  rejection_reason?: string;
  condition_failures?: Array<{
    field: string;
    operator: string;
    expected: string | string[];
    received: string;
  }>;
  matched_rule_id?: string;
  matched_rule_name?: string;
}

export interface QaOrchestratorResult {
  duplicate?: boolean;
  duplicate_matches?: {
    lead_ids?: string[];
  };
  trusted_form_result?: {
    success: boolean;
    cert_id: string;
    outcome?: string;
    error?: string;
    phone?: string;
    phone_match?: boolean;
    vendor?: string;
    previously_retained?: boolean;
    expires_at?: string;
  };
  ipqs_result?: {
    success: boolean;
    phone?: {
      success: boolean;
      raw?: Record<string, unknown>;
      error?: string;
      criteria_results?: Record<string, boolean>;
    };
    email?: {
      success: boolean;
      raw?: Record<string, unknown>;
      error?: string;
      criteria_results?: Record<string, boolean>;
    };
    ip?: {
      success: boolean;
      raw?: Record<string, unknown>;
      error?: string;
      criteria_results?: Record<string, boolean>;
    };
    error?: string;
  };
  /** True when a gate plugin failed and halted the remaining pipeline stages */
  pipeline_halted?: boolean;
  /** Stage number where the pipeline was halted */
  halt_stage?: number;
  /** Name of the plugin that triggered the halt */
  halt_plugin?: string;
  /** Affiliate-readable rejection message from the halting plugin */
  halt_reason?: string;
}
