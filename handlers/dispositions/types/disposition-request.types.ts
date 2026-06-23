import {
  DispositionStatusMappingRule,
  DispositionType,
  PublicDashboardTab,
} from "../interfaces/IDisposition.interface";

export type ListDispositionsQuery = {
  source_key?: string;
  includeDeleted?: boolean;
};

export type CreateDispositionRequest = {
  name: string;
  dispo_type: DispositionType;
  campaign_id?: string;
  source_keys: string[];
  status_mapping?: DispositionStatusMappingRule[];
  transaction_id_field?: string;
  spend_inputs?: {
    total?: number;
    by_source_key?: Record<string, number>;
  };
  live_updates?: boolean;
};

export type UpdateDispositionRequest = Partial<CreateDispositionRequest>;

export type PutDispositionRowsRequest = {
  rows: Array<{
    lead_id: string;
    source_key?: string;
    included: boolean;
    derived_status?: string;
    override_status?: string;
    transaction_id?: string;
    pub_id?: string;
    marketing_source?: string;
    received_at?: string;
  }>;
};

export type CandidateLeadsQuery = {
  included?: boolean;
  limit?: number;
};

export type UpsertPublicDashboardRequest = {
  layout: {
    tabs: PublicDashboardTab[];
  };
};
