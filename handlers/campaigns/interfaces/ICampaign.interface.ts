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

export interface ITrustedFormPluginConfig {
  enabled: boolean;
  /** Pipeline execution stage — must be >= 2 (stage 1 is reserved for duplicate_check). Default: 2 */
  stage: number;
  /** When true, a failure at this plugin halts the pipeline and rejects the lead. Default: true */
  gate: boolean;
  /** When true, the TrustedForm certificate will be claimed after successful validation. Default: false */
  claim: boolean;
  /** Optional vendor name passed to TrustedForm during certificate claim */
  vendor?: string;
}

// ── IPQS plugin types ─────────────────────────────────────────────────────────

export type IpqsScoreOperator = "lte" | "gte" | "eq";

export interface IIpqsFraudScoreCheck {
  enabled: boolean;
  operator: IpqsScoreOperator;
  value: number;
}

export interface IIpqsCountryCheck {
  enabled: boolean;
  allowed: string[];
}

export interface IIpqsValidCheck {
  enabled: boolean;
  required: boolean;
}

export interface IIpqsBoolCheck {
  enabled: boolean;
  allowed: boolean;
}

export interface IIpqsPhoneCriteria {
  valid: IIpqsValidCheck;
  fraud_score: IIpqsFraudScoreCheck;
  country: IIpqsCountryCheck;
}

export interface IIpqsEmailCriteria {
  valid: IIpqsValidCheck;
  fraud_score: IIpqsFraudScoreCheck;
}

export interface IIpqsIpCriteria {
  fraud_score: IIpqsFraudScoreCheck;
  country_code: IIpqsCountryCheck;
  proxy: IIpqsBoolCheck;
  vpn: IIpqsBoolCheck;
}

export interface IIpqsPhoneCheckConfig {
  enabled: boolean;
  criteria: IIpqsPhoneCriteria;
}

export interface IIpqsEmailCheckConfig {
  enabled: boolean;
  criteria: IIpqsEmailCriteria;
}

export interface IIpqsIpCheckConfig {
  enabled: boolean;
  criteria: IIpqsIpCriteria;
}

export interface IIpqsPluginConfig {
  /** Master toggle — must be true for any sub-check to run */
  enabled: boolean;
  /** Pipeline execution stage — must be >= 2 (stage 1 is reserved for duplicate_check). Default: 2 */
  stage: number;
  /** When true, a failure at this plugin halts the pipeline and rejects the lead. Default: true */
  gate: boolean;
  phone: IIpqsPhoneCheckConfig;
  email: IIpqsEmailCheckConfig;
  ip: IIpqsIpCheckConfig;
}

// ── Aggregate plugin config ───────────────────────────────────────────────────

export interface ICampaignPlugins {
  duplicate_check: IDuplicateCheckPluginConfig;
  trusted_form: ITrustedFormPluginConfig;
  ipqs: IIpqsPluginConfig;
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
