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

export interface ILead {
  id: string;
  campaign_id: string;
  campaign_key: string;
  test: boolean;
  payload?: Record<string, unknown>;
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
  created_by?: RequestActor;
  updated_at?: string;
  updated_by?: RequestActor;
  edit_history?: IEditHistoryEntry[];
  is_deleted?: boolean;
  active?: boolean;
  deleted_at?: string;
  deleted_by?: RequestActor;
}
