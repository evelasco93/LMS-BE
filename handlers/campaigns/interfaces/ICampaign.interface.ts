import { CampaignStatus } from "../enums/campaign-status.enum";
import { CampaignParticipantStatus } from "../enums/campaign-participant-status.enum";
import { RequestActor } from "@shared/utils/request-audit.util";
import {
  IAffiliateSoldPixelConfig,
  IClientDeliveryConfig,
  IContractResponseValidation,
  IDestination,
  ILeadDistributionConfig,
} from "./IClientDelivery.interface";

export interface IEditHistoryEntry {
  field: string;
  previous_value: unknown;
  new_value: unknown;
  changed_at: string; // ISO timestamp
  changed_by?: RequestActor;
}

export interface ICampaignValidationBypassConfig {
  /** Skip TrustedForm claim/validation checks when true. */
  trusted_form_claim?: boolean;
  /** Skip duplicate-check gating when true. */
  duplicate_check?: boolean;
  /** Skip IPQS phone gating when true. */
  ipqs_phone?: boolean;
  /** Skip IPQS email gating when true. */
  ipqs_email?: boolean;
  /** Skip IPQS IP gating when true. */
  ipqs_ip?: boolean;
  /** Emergency switch to bypass all validation gates. */
  all?: boolean;
}

export type ParticipantLogicMode = "pinned" | "inherit_campaign";

export interface ICampaignContractOverride {
  criteria_set_id?: string;
  criteria_set_version?: number;
  logic_set_id?: string;
  logic_set_version?: number;
  /** Explicit mode governing how this participant resolves logic rules. */
  logic_mode?: ParticipantLogicMode;
  /** Inline logic rule overrides scoped to this contract on this campaign. */
  logic_rules?: ILogicRule[];
  validation_bypass?: ICampaignValidationBypassConfig;
  metadata?: Record<string, unknown>;
}

/** @deprecated Prefer ICampaignContractOverride. */
export interface ICampaignClientOverride extends ICampaignContractOverride {}

export interface ICampaignAffiliateOverride {
  criteria_set_id?: string;
  criteria_set_version?: number;
  logic_set_id?: string;
  logic_set_version?: number;
  /** Explicit mode governing how this participant resolves logic rules. */
  logic_mode?: ParticipantLogicMode;
  /** Inline logic rule overrides scoped to this affiliate on this campaign. */
  logic_rules?: ILogicRule[];
  validation_bypass?: ICampaignValidationBypassConfig;
  metadata?: Record<string, unknown>;
}

export interface ICampaignAffiliate {
  affiliate_id: string;
  campaign_key: string;
  added_at?: string;
  status?: CampaignParticipantStatus;
  /** Optional fire-and-forget sold pixel webhook fired only when a lead is sold. */
  sold_pixel_config?: IAffiliateSoldPixelConfig;
  /** Per-affiliate rules evaluated against lead payload before firing the sold pixel. Empty = always fire. */
  pixel_criteria?: ILogicRule[];
  /** Per-affiliate rules evaluated post-delivery to refine whether a lead counts as "sold". Empty = use webhook result only. */
  sold_criteria?: ILogicRule[];
  /** Override campaign default_cherry_pickable for this affiliate. Absent = use campaign default. */
  cherry_pick_override?: boolean;
  /** Affiliate-scoped QA validation bypass flags. */
  validation_bypass?: ICampaignValidationBypassConfig;
  /** Maximum number of live leads this affiliate may send to this campaign. Absent = uncapped */
  lead_cap?: number;
  /** Running count of sold leads for this affiliate. Incremented atomically post-delivery */
  leads_sent?: number;
  /** Derived on read: remaining live leads before cap is reached. null means uncapped */
  leads_remaining?: number | null;
  /** Derived on read: completion percentage (0-100) of configured lead_cap. null means uncapped */
  quota_completion_percent?: number | null;
}

export interface ICampaignContract {
  /** Stable participant identity for campaign routing and APIs. */
  contract_id: string;
  /** Client entity this contract belongs to. Multiple contracts may share one client_id. */
  client_id: string;
  added_at?: string;
  status?: CampaignParticipantStatus;
  /** @deprecated Use `destinations` instead. Retained for backward compatibility during migration. */
  delivery_config?: IClientDeliveryConfig;
  /** Named delivery destinations. Replaces single `delivery_config`. */
  destinations?: IDestination[];
  /** Client-level response validation referencing one or more destinations. Replaces per-destination acceptance_rules. */
  response_validation?: IContractResponseValidation;
  /** Weight used for weighted distribution (higher = more leads). Default: 1 */
  weight?: number;
  /** Running count of leads successfully delivered to this contract. Used for weighted distribution */
  leads_delivered_count?: number;
}

/** @deprecated Prefer ICampaignContract. */
export type ICampaignClient = ICampaignContract;

export interface IRemovedAffiliate {
  affiliate_id: string;
  campaign_key?: string;
  added_at?: string;
  status_at_removal?: CampaignParticipantStatus;
  removed_at: string;
  removed_by?: RequestActor;
}

export interface IRemovedContract {
  contract_id: string;
  client_id: string;
  added_at?: string;
  status_at_removal?: CampaignParticipantStatus;
  removed_at: string;
  removed_by?: RequestActor;
}

/** @deprecated Prefer IRemovedContract. */
export type IRemovedClient = IRemovedContract;

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

// ── Base Criteria ─────────────────────────────────────────────────────────────

export type BaseCriteriaDataType =
  | "List"
  | "Text"
  | "Number"
  | "Date"
  | "Boolean";

/**
 * Legacy data types preserved for backward compatibility with existing DB records.
 * On read they are normalised to "List".
 */
export type LegacyCriteriaDataType = "US State" | "Yes/No";

export type CasingMode =
  | "default"
  | "title_case"
  | "capitalize_first"
  | "lowercase"
  | "uppercase";

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
  /** Casing transform applied to this field's values. Overrides campaign-level default_field_casing. */
  casing?: CasingMode;
  /** When true, this field was auto-added as a system base field and cannot be deleted. */
  system_field?: boolean;
  /** When true, a linked client may override this field's definition */
  client_override: boolean;
  /** When true, a linked affiliate may override this field's definition */
  affiliate_override: boolean;
  created_at: string;
  updated_at: string;
  created_by?: RequestActor;
  updated_by?: RequestActor;
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

export interface ILogicRule {
  id: string;
  /** Human-readable name shown in the Rules UI */
  name: string;
  /** When false, this rule is ignored during lead evaluation */
  enabled: boolean;
  /**
   * Conditions within a rule are evaluated with AND — all must match.
   * Multiple rules are evaluated with OR — a lead passes if ANY enabled rule matches.
   * If no rules match, the lead is rejected.
   */
  conditions: ILogicRuleCondition[];
  created_at: string;
  updated_at: string;
  created_by?: RequestActor;
  updated_by?: RequestActor;
}

export interface ICampaign {
  id: string;
  name: string;
  status: CampaignStatus;
  contracts?: ICampaignContract[];
  /** @deprecated Prefer `contracts`. */
  clients?: ICampaignContract[];
  affiliates: ICampaignAffiliate[];
  removed_contracts?: IRemovedContract[];
  /** @deprecated Prefer `removed_contracts`. */
  removed_clients?: IRemovedContract[];
  removed_affiliates?: IRemovedAffiliate[];
  plugins: ICampaignPlugins;
  ever_linked_participants?: boolean;
  has_received_leads?: boolean;
  /** Base criteria fields that every lead must satisfy for this campaign */
  base_criteria?: IBaseCriteriaField[];
  /** ID of the criteria catalog set this campaign's base_criteria was last sourced from */
  criteria_set_id?: string;
  /** The catalog version whose fields are reflected in base_criteria */
  criteria_set_version?: number;
  /** ID of the logic catalog set this campaign's logic_rules was last sourced from */
  logic_set_id?: string;
  /** The logic catalog version currently reflected in logic_rules */
  logic_set_version?: number;
  /** Optional human-readable logic version marker retained for compatibility. */
  logic_version?: string;
  /** Campaign-level keyword tags (simple label strings). */
  tags?: string[];
  /** Contract-scoped override map keyed by contract_id. */
  contract_overrides?: Record<string, ICampaignContractOverride>;
  /** @deprecated Prefer `contract_overrides`. */
  client_overrides?: Record<string, ICampaignContractOverride>;
  /** Affiliate-scoped override map keyed by affiliate_id. */
  affiliate_overrides?: Record<string, ICampaignAffiliateOverride>;
  /** Logic rules applied after criteria validation \u2014 lead passes if ANY enabled rule matches, rejected if none match */
  logic_rules?: ILogicRule[];
  /** When true, rejected (non-test) leads are auto-marked cherry_pickable. Default: false */
  default_cherry_pickable?: boolean;
  /** Default casing transform applied to all field values unless overridden at field level. */
  default_field_casing?: CasingMode;
  /** Lead distribution configuration (round_robin or weighted across LIVE contracts) */
  distribution?: ILeadDistributionConfig;
  /** Tracks the last contract that received a lead for round-robin cycling */
  rr_last_contract_id?: string;
  /** @deprecated Prefer rr_last_contract_id. */
  rr_last_client_id?: string;
  created_at: string;
  updated_at: string;
  created_by?: RequestActor;
  updated_by?: RequestActor;
  deleted_by?: RequestActor;
  deleted_at?: string;
  is_deleted?: boolean;
  active?: boolean;
}
