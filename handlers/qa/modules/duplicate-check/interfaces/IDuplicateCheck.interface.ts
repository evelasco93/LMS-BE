export interface LeadRecord {
  id: string;
  campaign_id: string;
  payload?: Record<string, unknown>;
}

export interface DuplicateCheckResponse {
  duplicate: boolean;
  duplicate_matches: {
    lead_ids: string[];
  };
}
