import { CampaignStatus } from "../enums/campaign-status.enum";
import { CampaignParticipantStatus } from "../enums/campaign-participant-status.enum";

export interface ICampaignAffiliate {
  affiliate_id: string;
  campaign_key: string;
  added_at?: string;
  status?: CampaignParticipantStatus;
}

export interface ICampaignClient {
  client_id: string;
  added_at?: string;
  status?: CampaignParticipantStatus;
}

export interface ICampaignStatusChange {
  from: CampaignStatus | null;
  to: CampaignStatus;
  changed_at: string;
}

export type DuplicateCheckCriteriaField = "phone" | "email";

export interface IDuplicateCheckPluginConfig {
  enabled: boolean;
  criteria: DuplicateCheckCriteriaField[];
}

export interface ICampaignPlugins {
  duplicate_check: IDuplicateCheckPluginConfig;
}

export interface ICampaign {
  id: string;
  name: string;
  status: CampaignStatus;
  clients: ICampaignClient[];
  affiliates: ICampaignAffiliate[];
  plugins: ICampaignPlugins;
  status_history: ICampaignStatusChange[];
  created_at: string;
  updated_at: string;
}
