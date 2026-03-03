import { CampaignPluginsConfig } from "../interfaces/IOrchestrator.interface";

export interface OrchestratorEvent {
  campaign_id: string;
  payload?: Record<string, unknown>;
  plugins?: CampaignPluginsConfig;
}
