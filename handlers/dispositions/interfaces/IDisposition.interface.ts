export type DispositionType = "CPA" | "CPL";

export type DispositionStatusMappingRule = {
  from_status: string;
  to_status: string;
};

export type DispositionRow = {
  disposition_id: string;
  lead_id: string;
  source_key: string;
  included: boolean;
  derived_status: string;
  override_status?: string;
  effective_status: string;
  incoming_status?: string;
  transaction_id?: string;
  transaction_id_masked?: string;
  pub_id?: string;
  marketing_source?: string;
  received_at?: string;
  updated_at: string;
};

export type Disposition = {
  id: string;
  name: string;
  name_key: string;
  dispo_type: DispositionType;
  campaign_id?: string;
  source_keys: string[];
  status_mapping: DispositionStatusMappingRule[];
  transaction_id_field?: string;
  spend_inputs?: {
    total?: number;
    by_source_key?: Record<string, number>;
  };
  live_updates?: boolean;
  created_at: string;
  updated_at: string;
  is_deleted?: boolean;
};

export type PublicDashboardTab = {
  id: string;
  label: string;
  widgets: Array<Record<string, unknown>>;
};

export type PublicDashboard = {
  disposition_id: string;
  uuid?: string;
  is_published: boolean;
  revoked_at?: string;
  layout: {
    tabs: PublicDashboardTab[];
  };
  published_at?: string;
  updated_at: string;
};

export type CandidateLead = {
  lead_id: string;
  source_key: string;
  incoming_status: string;
  derived_status: string;
  override_status?: string;
  effective_status: string;
  included: boolean;
  pub_id?: string;
  marketing_source?: string;
  received_at?: string;
  transaction_id?: string;
  transaction_id_masked?: string;
};
