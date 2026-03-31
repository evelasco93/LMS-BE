import {
  CampaignPluginsConfig,
  ValidationBypassDirectives,
} from "../interfaces/IOrchestrator.interface";

export interface OrchestratorEvent {
  campaign_id: string;
  lead_id?: string;
  affiliate_id?: string;
  /** Whether this is a test lead — duplicate check only matches against leads of the same type */
  test?: boolean;
  payload?: Record<string, unknown>;
  plugins?: CampaignPluginsConfig;
  bypass?: ValidationBypassDirectives;
  /** Bare TrustedForm cert ID or full cert URL — used by trusted_form plugin */
  cert_id?: string;
  /** Lead phone number — used by trusted_form plugin for phone match */
  phone?: string;
  /** Lead email address — used by ipqs plugin */
  email?: string;
  /** Lead IP address — used by ipqs plugin */
  ip_address?: string;
}
