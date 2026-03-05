export interface DuplicateCheckPluginConfig {
  enabled: boolean;
  criteria: string[];
}

export interface TrustedFormPluginConfig {
  enabled: boolean;
  credentials_id?: string;
}

export interface CampaignPluginsConfig {
  duplicate_check?: DuplicateCheckPluginConfig;
  trusted_form?: TrustedFormPluginConfig;
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

export interface OrchestratorResponse extends DuplicateCheckResult {
  trusted_form_result?: TrustedFormResult;
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
  };
}
