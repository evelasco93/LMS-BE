import { injectable } from "inversify";
import type { CredentialType } from "../interfaces/ITenantConfig.interface";

// ── Canonical Plugin Registry ─────────────────────────────────────────────────

/**
 * The fixed list of plugins supported by the platform.
 * Add entries here when onboarding a new integration.
 * This registry is the source-of-truth for the Plugin Settings page — the frontend
 * will always see exactly this many plugin cards, never more, never fewer.
 */
export const AVAILABLE_PLUGINS = [
  {
    provider: "trusted_form",
    name: "TrustedForm",
    credential_type: "basic_auth" as CredentialType,
    description:
      "TrustedForm certificate verification for lead compliance tracking.",
  },
  {
    provider: "ipqs",
    name: "IPQS",
    credential_type: "api_key" as CredentialType,
    description:
      "IP Quality Score fraud detection and lead validation service.",
  },
] as const;

export type AvailablePlugin = (typeof AVAILABLE_PLUGINS)[number];
export type AvailablePluginProvider = AvailablePlugin["provider"];

// ── DynamoDB / env constants ──────────────────────────────────────────────────

@injectable()
export class TenantConfigConstants {
  public readonly TENANT_SETTINGS_TABLE_NAME: string;
  public readonly CREDENTIALS_ENCRYPTION_KEY: string;
  /** Optional: when set, disabling a plugin cascades disabled=false to all campaigns */
  public readonly CAMPAIGNS_TABLE_NAME: string;
  public readonly AUDIT_LOGS_TABLE_NAME: string;
  public readonly PRESETS_TABLE_NAME: string;
  public readonly PLATFORM_PRESETS_TABLE_NAME: string;

  constructor() {
    this.TENANT_SETTINGS_TABLE_NAME =
      process.env.TENANT_SETTINGS_TABLE_NAME ?? "";
    this.CREDENTIALS_ENCRYPTION_KEY =
      process.env.CREDENTIALS_ENCRYPTION_KEY ?? "";
    this.CAMPAIGNS_TABLE_NAME = process.env.CAMPAIGNS_TABLE_NAME ?? "";
    this.AUDIT_LOGS_TABLE_NAME = process.env.AUDIT_LOGS_TABLE_NAME ?? "";
    this.PRESETS_TABLE_NAME =
      process.env.PRESETS_TABLE_NAME ?? "";
    this.PLATFORM_PRESETS_TABLE_NAME =
      process.env.PLATFORM_PRESETS_TABLE_NAME ?? "";

    if (!this.TENANT_SETTINGS_TABLE_NAME) {
      throw new Error("TENANT_SETTINGS_TABLE_NAME env var is required");
    }
    if (!this.CREDENTIALS_ENCRYPTION_KEY) {
      throw new Error("CREDENTIALS_ENCRYPTION_KEY env var is required");
    }
  }
}
