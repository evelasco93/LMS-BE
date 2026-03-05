import { CampaignStatus } from "../enums/campaign-status.enum";
import { CampaignParticipantStatus } from "../enums/campaign-participant-status.enum";
import { RequestActor } from "@shared/utils/request-audit.util";

export interface IEditHistoryEntry {
  field: string;
  previous_value: unknown;
  new_value: unknown;
  changed_at: string; // ISO timestamp
  changed_by?: RequestActor;
}

export type ParticipantHistoryEvent =
  | "linked"
  | "status_changed"
  | "key_rotated";

export interface IParticipantHistoryEntry {
  event: ParticipantHistoryEvent;
  field?: string;
  from?: string;
  to?: string;
  changed_at: string;
  changed_by?: RequestActor;
}

export interface ICampaignAffiliate {
  affiliate_id: string;
  campaign_key: string;
  added_at?: string;
  status?: CampaignParticipantStatus;
  history?: IParticipantHistoryEntry[];
}

export interface ICampaignClient {
  client_id: string;
  added_at?: string;
  status?: CampaignParticipantStatus;
  history?: IParticipantHistoryEntry[];
}

export interface IRemovedAffiliate {
  affiliate_id: string;
  campaign_key?: string;
  added_at?: string;
  status_at_removal?: CampaignParticipantStatus;
  removed_at: string;
  removed_by?: RequestActor;
}

export interface IRemovedClient {
  client_id: string;
  added_at?: string;
  status_at_removal?: CampaignParticipantStatus;
  removed_at: string;
  removed_by?: RequestActor;
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
  removed_clients?: IRemovedClient[];
  removed_affiliates?: IRemovedAffiliate[];
  plugins: ICampaignPlugins;
  status_history: ICampaignStatusChange[];
  ever_linked_participants?: boolean;
  has_received_leads?: boolean;
  created_at: string;
  updated_at: string;
  created_by?: RequestActor;
  updated_by?: RequestActor;
  deleted_by?: RequestActor;
  deleted_at?: string;
  is_deleted?: boolean;
  active?: boolean;
  edit_history?: IEditHistoryEntry[];
}
