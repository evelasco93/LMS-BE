export interface DuplicateCheckPluginConfig {
  enabled: boolean;
  criteria: string[];
}

export interface TrustedFormPluginConfig {
  enabled: boolean;
}

export interface IpqsCheckConfig {
  enabled: boolean;
  criteria?: Record<string, unknown>;
}

export interface IpqsPluginConfig {
  enabled: boolean;
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
