export interface DuplicateCheckPluginConfig {
  enabled: boolean;
  criteria: string[];
}

export interface TrustedFormPluginConfig {
  enabled: boolean;
  stage?: number;
  gate?: boolean;
  vendor?: string;
}

export interface IpqsCheckConfig {
  enabled: boolean;
  criteria?: Record<string, unknown>;
}

export interface IpqsPluginConfig {
  enabled: boolean;
  stage?: number;
  gate?: boolean;
  phone?: IpqsCheckConfig;
  email?: IpqsCheckConfig;
  ip?: IpqsCheckConfig;
}

export interface CampaignPluginsConfig {
  duplicate_check?: DuplicateCheckPluginConfig;
  trusted_form?: TrustedFormPluginConfig;
  ipqs?: IpqsPluginConfig;
}

export interface DuplicateCheckResult {
  duplicate: boolean;
  duplicate_matches: {
    lead_ids: string[];
  };
}

export interface TrustedFormResult {
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

export interface IpqsCheckResult {
  success: boolean;
  raw?: Record<string, unknown>;
  error?: string;
  criteria_results?: Record<string, boolean>;
}

export interface IpqsResult {
  success: boolean;
  phone?: IpqsCheckResult;
  email?: IpqsCheckResult;
  ip?: IpqsCheckResult;
  error?: string;
}

/**
 * Response shape returned by the TrustedForm GET /validate API.
 * Returned verbatim from POST /qa/trusted-form/validate.
 */
export interface TrustedFormValidateResponse {
  outcome?: "success" | "failure" | "error";
  reason?: string | null;
  /** Populated on API/network error when we short-circuit before calling TF */
  error?: string;
}

export interface OrchestratorResponse extends DuplicateCheckResult {
  trusted_form_result?: TrustedFormResult;
  ipqs_result?: IpqsResult;
  /** True when a gate plugin failed and halted the remaining pipeline stages */
  pipeline_halted?: boolean;
  /** Stage number where the pipeline was halted */
  halt_stage?: number;
  /** Name of the plugin that triggered the halt */
  halt_plugin?: string;
  /** Affiliate-readable reason for the halt (sourced from rejection-messages constants) */
  halt_reason?: string;
  plugin_results: {
    duplicate_check: {
      enabled: boolean;
      duplicate: boolean;
      matched_lead_ids: string[];
    };
    trusted_form?: {
      enabled: boolean;
      success?: boolean;
      error?: string;
    };
    ipqs?: {
      enabled: boolean;
      success?: boolean;
      error?: string;
    };
  };
}
