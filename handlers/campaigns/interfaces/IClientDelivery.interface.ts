/**
 * Defines how a single key in the outbound webhook payload is resolved.
 * - "field"  → look up `field_name` in the lead's payload (snake_case key from base_criteria)
 * - "static" → use `static_value` verbatim
 */
export interface IWebhookFieldMapping {
  /** Destination key in the outbound payload sent to the client webhook */
  key: string;
  value_source: "field" | "static" | "lead_id";
  /** Optional per-field destination for sold pixels (query or body). */
  parameter_target?: "query" | "body";
  /** Required when value_source === "field". Must match a field_name in campaign base_criteria */
  field_name?: string;
  /** Required when value_source === "static" */
  static_value?: string;
}

/**
 * A single rule used to scan the client webhook response and determine
 * whether the lead was accepted or rejected by the client.
 * All string/number/boolean leaf values in the response body are scanned
 * (case-insensitive substring match). First matching rule wins.
 */
export interface IWebhookAcceptanceRule {
  /** Value to search for (case-insensitive, partial match) in any response leaf value */
  match_value: string;
  /** Outcome when this rule matches */
  action: "passed" | "failed";
}

// ── Destination (multi-destination model) ─────────────────────────────────────

export type DestinationType = "webhook" | "email" | "google_sheets";

/**
 * A named destination within a client's delivery configuration.
 * Each client can have multiple destinations; exactly one must be marked `is_primary`.
 * The primary destination determines the overall sold/not-sold outcome.
 */
export interface IDestination {
  /** Unique destination ID (DS-prefixed) */
  id: string;
  /** Human-readable name (e.g. "Primary CRM Webhook") */
  name: string;
  /** Destination type — currently only "webhook" is supported */
  type: DestinationType;
  /** Destination URL for the outbound request */
  url: string;
  /** HTTP method */
  method: "POST" | "GET" | "PUT" | "PATCH";
  /** Optional request headers */
  headers?: Record<string, string>;
  /** Defines how to build the outbound payload — must have at least one entry */
  payload_mapping: IWebhookFieldMapping[];
  /** Response acceptance rules — first match wins. Optional; required only for primary destination going LIVE. */
  acceptance_rules?: IWebhookAcceptanceRule[];
  /**
   * Per-field state mapping overrides for this destination.
   * Key = field_name, value = mapping direction. Overrides field-level state_mapping.
   */
  state_mapping_override?: Record<
    string,
    "abbr_to_name" | "name_to_abbr" | null
  >;
  /** When true, this destination determines the overall sold/not-sold outcome */
  is_primary: boolean;
  /**
   * Required for non-webhook destinations.
   * Controls whether a successful send/update should mark the lead as sold or rejected.
   */
  non_webhook_delivery_action?: "passed" | "failed";
  /** TrustedForm claim — hard-coded to true server-side */
  readonly claim_trusted_form?: true;
  /** When true, failed TF claim blocks delivery to this destination */
  require_successful_claim?: boolean;
}

// ── Response Validation (contract-level, decoupled from destinations) ────────

/**
 * A single validation rule that checks a specific destination's webhook
 * response for a match_value substring (case-insensitive).
 */
export interface IValidationRule {
  /** The destination whose webhook response is evaluated */
  destination_id: string;
  /** Value to search for (case-insensitive, partial match) in the response */
  match_value: string;
  /** Outcome when this condition matches */
  action: "passed" | "failed";
}

/**
 * Contract-level response validation.
 *
 * Rules are evaluated in order with OR semantics (first match wins).
 * No group-level AND semantics are supported.
 */
export interface IContractResponseValidation {
  /** Ordered rules list; first matching rule determines accepted/rejected outcome */
  rules: IValidationRule[];
}

/** @deprecated Prefer IValidationRule. */
export type IValidationCondition = IValidationRule;
/** @deprecated Group AND semantics are deprecated; retained for backward compatibility reads. */
export interface IValidationGroup {
  conditions: IValidationRule[];
}
/** @deprecated Prefer IContractResponseValidation. */
export interface IClientResponseValidation extends IContractResponseValidation {}

/**
 * Full webhook delivery configuration for a campaign client.
 * Required before a client can be set to LIVE status.
 */
export interface IClientDeliveryConfig {
  /** Destination URL for the outbound lead webhook */
  url: string;
  /** HTTP method used for the webhook request */
  method: "POST" | "GET" | "PUT" | "PATCH";
  /** Optional request headers (e.g. Authorization, Content-Type overrides) */
  headers?: Record<string, string>;
  /** Defines how to build the outbound payload — must have at least one entry */
  payload_mapping: IWebhookFieldMapping[];
  /**
   * Rules for interpreting the webhook response.
   * Leaf values in the response are matched case-insensitively (substring).
   * First matching rule wins. No match → sold = false.
   * Must have at least one entry before client can go LIVE.
   */
  acceptance_rules: IWebhookAcceptanceRule[];
  /**
   * TrustedForm certificates are always claimed before delivering to any client.
   * This field is hard-coded to `true` server-side and never accepted from the
   * caller — it exists only so the stored config is self-documenting.
   */
  readonly claim_trusted_form: true;
  /**
   * When true, a failed TrustedForm certificate claim will block delivery to
   * this client. When false (or absent), claim failures are logged but delivery
   * proceeds regardless.
   */
  require_successful_claim?: boolean;
}

/**
 * Distribution mode controlling how leads are routed across multiple LIVE clients.
 */
export interface ILeadDistributionConfig {
  /** "round_robin" — cycles through LIVE clients in order; "weighted" — routes by weight ratio */
  mode: "round_robin" | "weighted";
  /** When false, no delivery is attempted even if LIVE clients with delivery config exist */
  enabled: boolean;
}

export interface IResolvedWebhookPayloadEntry {
  key: string;
  parameter_target: "query" | "body";
  value_source: "field" | "static";
  field_name?: string;
  static_value?: string;
  value: unknown;
}

export interface ILeadDeliveryPayloadSnapshot {
  configured_webhook_url: string;
  final_webhook_url: string;
  webhook_method: IClientDeliveryConfig["method"];
  attempt: number;
  headers: Record<string, string>;
  query_params?: Record<string, unknown>;
  body_payload?: Record<string, unknown>;
  body_raw?: string;
  effective_mapped_payload: IResolvedWebhookPayloadEntry[];
}

/**
 * Configuration for firing an affiliate conversion pixel when a lead is sold.
 * This call is fire-and-forget and does not impact affiliate intake latency.
 */
export interface IAffiliateSoldPixelConfig {
  /** Master toggle. Pixel is only fired when enabled and the lead is sold. */
  enabled: boolean;
  /** Destination URL for the outbound affiliate pixel webhook. */
  url: string;
  /** HTTP method used for the pixel webhook request. */
  method: "POST" | "GET" | "PUT" | "PATCH";
  /** Optional headers (for auth/custom metadata). */
  headers?: Record<string, string>;
  /** Mapping entries used to compose body/query values from lead/static fields. */
  payload_mapping: IWebhookFieldMapping[];
  /**
   * Deprecated fallback for mappings without parameter_target.
   * New clients should set payload_mapping[].parameter_target per row.
   */
  parameter_mode?: "query" | "body";
}

/**
 * Persisted result of a single webhook delivery attempt stored on the lead record.
 */
export interface ILeadDeliveryResult {
  contract_id: string;
  client_id: string;
  delivered_at: string;
  /** Number of webhook attempts performed (includes retries) */
  attempts: number;
  webhook_url: string;
  /** Resolved URL actually called, including query params when present */
  final_webhook_url?: string;
  webhook_method: string;
  /** Query string values sent to the destination webhook */
  sent_query_params?: Record<string, unknown>;
  /** Request body payload sent to the destination webhook */
  sent_body_payload?: Record<string, unknown>;
  /** Full outbound request snapshot for the final webhook attempt */
  sent_payload_snapshot?: ILeadDeliveryPayloadSnapshot;
  /** HTTP status code returned by the client webhook (absent on network/timeout error) */
  webhook_response_status?: number;
  /** Parsed response body from the client webhook */
  webhook_response_body?: unknown;
  /** Whether the client accepted the lead based on acceptance_rules evaluation */
  accepted: boolean;
  /** The match_value string of the rule that matched (for audit/debugging) */
  acceptance_match?: string;
  /** Error message when the request failed (network error, timeout, etc.) */
  error?: string;
  /** Distribution mode that was active when this lead was routed (round_robin | weighted) */
  distribution_mode: "round_robin" | "weighted";
  /** The contract's weight value at the time of delivery (relevant for weighted mode) */
  contract_weight_at_delivery: number;
  /** @deprecated Use contract_weight_at_delivery. */
  client_weight_at_delivery?: number;
}
