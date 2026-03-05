import { CampaignPluginsConfig } from "../interfaces/IOrchestrator.interface";

export interface OrchestratorEvent {
  campaign_id: string;
  payload?: Record<string, unknown>;
  plugins?: CampaignPluginsConfig;
  /** Bare TrustedForm cert ID or full cert URL — used by trusted_form plugin */
  cert_id?: string;
  /** Lead phone number — used by trusted_form plugin for phone match */
  phone?: string;
}
