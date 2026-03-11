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
  /** Audit trail of every plugin configuration change */
  plugin_history?: IEditHistoryEntry[];
}

// ── Base Criteria ─────────────────────────────────────────────────────────────

export type BaseCriteriaDataType =
  | "List"
  | "US State"
  | "Text"
  | "Number"
  | "Date"
  | "Boolean";

export interface IFieldOption {
  /** Internal value sent in the lead payload */
  value: string;
  /** Human-readable display label shown to the affiliate */
  label: string;
}

/**
 * Maps one or more incoming raw values (case-insensitive) to a single canonical value.
 * E.g. { from: ["RAPE", "sexual assault"], to: "abuse" }
 */
export interface IValueMapping {
  /** Raw incoming values that should be normalized (matched case-insensitively) */
  from: string[];
  /** The canonical value to store in the lead payload after normalization */
  to: string;
}

export interface IBaseCriteriaField {
  id: string;
  /** 1-based display order of this field */
  order: number;
  /** Human-readable label shown in the UI (e.g. "Rideshare Abuse") */
  field_label: string;
  /** Snake-case key used in the lead payload (e.g. "rideshare_abuse") */
  field_name: string;
  data_type: BaseCriteriaDataType;
  required: boolean;
  description?: string;
  /** Applicable only when data_type === "List" */
  options?: IFieldOption[];
  /**
   * Value mappings applied to incoming lead payloads before storage.
   * Each entry maps one or more raw values → a single canonical value (case-insensitive).
   */
  value_mappings?: IValueMapping[];
  /**
   * When set, automatically normalises state values on this field using the chosen direction:
   * - `"abbr_to_name"` — "CA" → "California"
   * - `"name_to_abbr"` — "California" → "CA"
   * Uses built-in presets — no need to supply a manual `value_mappings` array.
   */
  state_mapping?: "abbr_to_name" | "name_to_abbr";
  /** When true, a linked client may override this field's definition */
  client_override: boolean;
  /** When true, a linked affiliate may override this field's definition */
  affiliate_override: boolean;
  created_at: string;
  updated_at: string;
  created_by?: RequestActor;
  updated_by?: RequestActor;
}

export type BaseCriteriaHistoryEvent =
  | "field_added"
  | "field_updated"
  | "field_removed"
  | "fields_reordered";

export interface IBaseCriteriaHistoryEntry {
  event: BaseCriteriaHistoryEvent;
  /** ID of the field that was added/updated/removed (absent for reorder) */
  field_id?: string;
  /** Key of the field at time of event */
  field_name?: string;
  /** Per-field diffs recorded for field_updated events */
  changes?: IEditHistoryEntry[];
  changed_at: string;
  changed_by?: RequestActor;
}

// ── Logic rule types ─────────────────────────────────────────────────────────

export type LogicRuleOperator =
  | "is"
  | "is_not"
  | "contains"
  | "does_not_contain"
  | "starts_with"
  | "ends_with"
  | "greater_than"
  | "less_than"
  | "is_empty"
  | "is_not_empty";

export type LogicRuleAction = "pass" | "fail";

export interface ILogicRuleCondition {
  id: string;
  /** Must match a field_name in the campaign's base_criteria */
  field_name: string;
  operator: LogicRuleOperator;
  /**
   * The comparison value(s). Not needed for is_empty / is_not_empty.
   * For list fields a single string is compared; pass an array to match any of multiple values
   * (only applicable to "is" / "is_not" operators).
   */
  value?: string | string[];
}

export interface ILogicRuleGroup {
  id: string;
  /** Conditions within a group are evaluated with AND — all must match for the group to match */
  conditions: ILogicRuleCondition[];
}

export interface ILogicRule {
  id: string;
  /** Human-readable name shown in the Logic Builder UI */
  name: string;
  /**
   * What happens when this rule matches a lead:
   * - "pass" — lead is allowed through (short-circuit, remaining rules not evaluated)
   * - "fail" — lead is rejected
   */
  action: LogicRuleAction;
  /** When false, this rule is ignored during lead evaluation */
  enabled: boolean;
  /**
   * Groups are evaluated with OR — a rule matches when any group matches.
   * Each group's conditions are evaluated with AND.
   */
  groups: ILogicRuleGroup[];
  created_at: string;
  updated_at: string;
  created_by?: RequestActor;
  updated_by?: RequestActor;
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
  /** Base criteria fields that every lead must satisfy for this campaign */
  base_criteria?: IBaseCriteriaField[];
  /** Full audit trail of all base criteria changes */
  base_criteria_history?: IBaseCriteriaHistoryEntry[];
  /** Logic rules applied after criteria validation — first matching rule determines pass/fail */
  logic_rules?: ILogicRule[];
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
