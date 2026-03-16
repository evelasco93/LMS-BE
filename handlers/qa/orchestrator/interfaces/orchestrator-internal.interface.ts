import { IpqsResult, TrustedFormResult } from "./IOrchestrator.interface";

/** Minimal shape of a tenant-settings credential record we need */
export interface TenantCredentialLookup {
  id: string;
  type: "credential";
  credential_type: string;
  credentials: Record<string, string>;
  enabled: boolean;
  is_deleted?: boolean;
}

/** Minimal shape of a plugin_setting record */
export interface PluginSettingLookup {
  id: string;
  type: "plugin_setting";
  schema_id: string;
  credentials_id: string;
  enabled: boolean;
  is_deleted?: boolean;
}

/** Internal result shape for a single plugin task within a pipeline stage */
export interface StageTaskResult {
  /** Plugin identifier: 'trusted_form' | 'ipqs' */
  name: string;
  /** Whether the plugin ran successfully */
  success: boolean;
  /** When true, a failure halts the rest of the pipeline */
  gate: boolean;
  /** Affiliate-readable reason populated when success=false and gate=true */
  haltReason?: string;
  trustedFormResult?: TrustedFormResult;
  ipqsResult?: IpqsResult;
}
