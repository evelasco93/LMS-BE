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
}
