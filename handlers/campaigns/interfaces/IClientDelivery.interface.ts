/**
 * Defines how a single key in the outbound webhook payload is resolved.
 * - "field"  → look up `field_name` in the lead's payload (snake_case key from base_criteria)
 * - "static" → use `static_value` verbatim
 */
export interface IWebhookFieldMapping {
  /** Destination key in the outbound payload sent to the client webhook */
  key: string;
  value_source: "field" | "static";
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

/**
 * Persisted result of a single webhook delivery attempt stored on the lead record.
 */
export interface ILeadDeliveryResult {
  client_id: string;
  delivered_at: string;
  webhook_url: string;
  webhook_method: string;
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
  /** The client's weight value at the time of delivery (relevant for weighted mode) */
  client_weight_at_delivery: number;
}
