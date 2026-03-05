import type { RequestActor } from "@shared/utils/request-audit.util";

export interface IEditHistoryEntry {
  field: string; // dot-notation path, e.g. "payload.name"
  previous_value: unknown;
  new_value: unknown;
  changed_at: string; // ISO timestamp
  changed_by?: RequestActor;
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
