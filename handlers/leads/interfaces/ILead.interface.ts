import type { RequestActor } from "@shared/utils/request-audit.util";
import type {
  ILeadDeliveryResult,
  IAffiliateSoldPixelConfig,
} from "../../campaigns/interfaces/IClientDelivery.interface";
import type { ICampaignValidationBypassConfig } from "../../campaigns/interfaces/ICampaign.interface";

export type LeadSoldStatus = "sold" | "not_sold" | "not_delivered";

export interface ITrustedFormResult {
  success: boolean;
  cert_id: string;
  outcome?: string;
  error?: string;
  phone?: string;
  phone_match?: boolean;
  vendor?: string;
  previously_retained?: boolean;
  expires_at?: string;
}

export interface IIpqsCheckResult {
  success: boolean;
  raw?: Record<string, unknown>;
  error?: string;
  criteria_results?: Record<string, boolean>;
}

export interface IIpqsResult {
  success: boolean;
  phone?: IIpqsCheckResult;
  email?: IIpqsCheckResult;
  ip?: IIpqsCheckResult;
  error?: string;
}

/**
 * Tracks a single field whose value was normalised via a campaign value_mapping.
 * Stored alongside the lead so the UI can highlight mapped fields.
 */
export interface IMappedFieldEntry {
  /** The payload key that was mapped (e.g. "assault_type") */
  field: string;
  /** The raw value received from the affiliate */
  original_value: unknown;
  /** The canonical value stored in payload after mapping */
  mapped_value: string;
  mapped_at: string;
}

export interface ILogicRuleConditionFailure {
  field: string;
  operator: string;
  expected: string | string[];
  received: string;
}

export interface ILogicRulesResult {
  passed: boolean;
  rejection_reason?: string;
  rejection_errors?: string[];
  condition_failures?: ILogicRuleConditionFailure[];
  matched_rule_id?: string;
  matched_rule_name?: string;
}

export interface ILead {
  id: string;
  campaign_id: string;
  campaign_key: string;
  test: boolean;
  /** Immutable copy of the raw `source` field from the intake payload, captured at ingestion time. */
  original_source?: string;
  /** Normalized order number: always >= 1. Null/0/invalid inputs are coerced to 1. */
  order_number?: number;
  payload?: Record<string, unknown>;
  /** Fields that were normalised by a value_mapping rule at intake time */
  mapped_fields?: IMappedFieldEntry[];
  /** Result of the logic rules evaluation at lead intake time */
  logic_rules_result?: ILogicRulesResult;
  /** True when campaign-level logic rules rejected the lead (client delivery may still occur) */
  affiliate_logic_failed?: boolean;
  duplicate?: boolean;
  duplicate_matches?: {
    lead_ids: string[];
  };
  trusted_form_result?: ITrustedFormResult;
  ipqs_result?: IIpqsResult;
  created_at: string;
  affiliate_status_at_intake?: string;
  rejected?: boolean;
  rejection_reason?: string;
  /** Per-field human-readable errors explaining why the lead was rejected */
  rejection_errors?: string[];
  /** True when a QA pipeline gate plugin failed and halted processing */
  pipeline_halted?: boolean;
  /** Stage number where the pipeline was halted (1 = duplicate_check, 2+ = configurable plugins) */
  halt_stage?: number;
  /** Name of the plugin that triggered the halt */
  halt_plugin?: string;
  /** Affiliate-readable reason for the halt */
  halt_reason?: string;
  /** Whether the lead was sold (delivered and accepted) by a client. Absent until delivery is attempted */
  sold?: boolean;
  /** True when the webhook accepted but sold_criteria rules failed, overriding sold to false */
  sold_criteria_failed?: boolean;
  /** ID of the client the lead was delivered to */
  sold_to_client_id?: string;
  /** Full result of the webhook delivery attempt */
  delivery_result?: ILeadDeliveryResult;
  /** Full result of the affiliate sold-pixel dispatch attempt */
  affiliate_pixel_result?: IAffiliatePixelResult;
  /** Derived on read for UI convenience */
  sold_status?: LeadSoldStatus;
  created_by?: RequestActor;
  updated_at?: string;
  updated_by?: RequestActor;
  is_deleted?: boolean;
  active?: boolean;
  deleted_at?: string;
  deleted_by?: RequestActor;
  /** Whether this lead is eligible to be cherry-picked by an operator */
  cherry_pickable?: boolean;
  /** Whether this lead has been cherry-picked */
  cherry_picked?: boolean;
  /** Metadata recorded when a cherry-pick delivery is executed */
  cherry_pick_meta?: ICherryPickMeta;
  /** End-to-end routing and validation trace for debugging/observability. */
  decision_trace?: ILeadDecisionTrace;
}

export interface ILeadDecisionTrace {
  version: number;
  intake?: {
    original_source?: string;
    order_number?: number;
    order_number_normalized?: boolean;
    /** How test mode was determined: "affiliate_status" | "payload_detection" | null */
    test_detected_by?: "affiliate_status" | "payload_detection";
    captured_at: string;
  };
  qa?: {
    duplicate_detected?: boolean;
    pipeline_halted?: boolean;
    halt_plugin?: string;
    halt_reason?: string;
    bypass_applied?: ICampaignValidationBypassConfig;
    evaluated_at: string;
  };
  routing?: {
    distribution_enabled?: boolean;
    eligible_client_ids?: string[];
    selected_client_id?: string;
    forced_single_client?: boolean;
    evaluated_at: string;
  };
  final_decision?: {
    accepted: boolean;
    reason: string;
    decided_at: string;
  };
}

export interface IAffiliatePixelResult {
  affiliate_id: string;
  campaign_id: string;
  fired_at: string;
  webhook_url: string;
  final_webhook_url: string;
  webhook_method: IAffiliateSoldPixelConfig["method"];
  sent_query_params?: Record<string, unknown>;
  sent_body_payload?: Record<string, unknown>;
  webhook_response_status?: number;
  webhook_response_body?: string;
  success: boolean;
  error?: string;
}

export interface ICherryPickMeta {
  /** The client the lead was cherry-picked to */
  target_client_id: string;
  /** The campaign from which the cherry-pick was executed */
  source_campaign_id: string;
  /** Result of the webhook delivery attempt */
  delivery_result: ILeadDeliveryResult;
  /** ISO timestamp of when the cherry-pick was executed */
  executed_at: string;
  /** Actor who triggered the cherry-pick */
  executed_by?: RequestActor;
}
