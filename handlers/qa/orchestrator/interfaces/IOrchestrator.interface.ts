export interface DuplicateCheckPluginConfig {
  enabled: boolean;
  criteria: string[];
}

export interface CampaignPluginsConfig {
  duplicate_check?: DuplicateCheckPluginConfig;
}

export interface DuplicateCheckResult {
  duplicate: boolean;
  duplicate_matches: {
    lead_ids: string[];
  };
}

export interface OrchestratorResponse extends DuplicateCheckResult {
  plugin_results: {
    duplicate_check: {
      enabled: boolean;
      duplicate: boolean;
      matched_lead_ids: string[];
    };
  };
}
