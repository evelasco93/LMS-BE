import type { RequestActor } from "@shared/utils/request-audit.util";

export type CredentialType = "api_key" | "basic_auth" | "bearer_token";

/**
 * Discriminator values stored in the `type` attribute of every tenant-settings record.
 * Used as the partition key on the type-index GSI for efficient list-by-type queries.
 */
export type TenantSettingsRecordType =
  | "credential"
  | "credential_schema"
  | "plugin_setting";

// ── Credential Schemas ────────────────────────────────────────────────────────

/** The HTML input type used to render the field in the frontend form */
export type PluginSchemaFieldType = "text" | "password" | "select";

/**
 * Describes a single credential input field required by a plugin.
 * Frontend uses this list to dynamically render the credential creation form.
 */
export interface IPluginSchemaField {
  /** Internal key that maps to the credential object, e.g. "apiKey", "username" */
  name: string;
  /** Human-readable label shown above the form input, e.g. "API Key" */
  label: string;
  /** Input type for form rendering */
  type: PluginSchemaFieldType;
  /** Whether the field must be provided */
  required: boolean;
  /** Optional hint shown inside the input, e.g. "Enter your API key" */
  placeholder?: string;
  /** Choices for select-type fields */
  options?: string[];
}

/**
 * Stored in the tenant-settings table with type = "credential_schema".
 * Each record describes what credential fields a specific plugin integration needs.
 * Frontend reads this to dynamically render the credential creation form.
 */
export interface ICredentialSchemaRecord {
  /** Auto-generated CS-prefixed ID */
  id: string;
  /** Discriminator for single-table design — always "credential_schema" */
  type: "credential_schema";
  /** Machine-readable provider identifier, e.g. "trusted_form", "ipqs" */
  provider: string;
  /** Human-readable plugin name, e.g. "TrustedForm", "IPQS" */
  name: string;
  /** Which credential type this plugin expects */
  credential_type: CredentialType;
  /** Ordered list of fields the frontend should render for this plugin's credential */
  fields: IPluginSchemaField[];
  /** Optional human-readable description shown in the UI */
  description?: string;
  created_at: string;
  updated_at: string;
  created_by?: RequestActor;
  updated_by?: RequestActor;
  /** Soft-delete fields */
  is_deleted: boolean;
  active: boolean;
  deleted_at: string | null;
  deleted_by: RequestActor | null;
}

// ── Credentials ───────────────────────────────────────────────────────────────

/**
 * Stored in the tenant-settings table with type = "credential".
 * Sensitive credential values (apiKey, password, token) are AES-256-GCM encrypted.
 * Non-sensitive metadata (provider, type, name, vendor) is stored in plaintext.
 */
export interface TenantCredentialRecord {
  /** Auto-generated CR-prefixed ID */
  id: string;
  /** Discriminator for single-table design — always "credential" */
  type: "credential";
  /** FK to ICredentialSchemaRecord.id — links this credential to its schema */
  schema_id?: string;
  /** Provider identifier, e.g. "trusted_form", "ipqs" */
  provider: string;
  /** Human-readable label shown in frontend dropdowns */
  name: string;
  /** Credential auth type */
  credential_type: CredentialType;
  /**
   * Sensitive fields stored AES-256-GCM encrypted.
   * basic_auth: { username (plaintext), password (encrypted) }
   * api_key:    { apiKey (encrypted) }
   * bearer_token: { token (encrypted) }
   */
  credentials: Record<string, string>;
  /**
   * Optional plaintext vendor name used in TrustedForm certificate claims.
   * e.g. "SummitEdgeLegal"
   */
  vendor?: string;
  /**
   * Whether this credential is active. Defaults to true when omitted.
   * Set to false to soft-disable without deleting.
   */
  enabled: boolean;
  created_at: string;
  updated_at: string;
  created_by?: RequestActor;
  updated_by?: RequestActor;
  /** Soft-delete fields */
  is_deleted: boolean;
  active: boolean;
  deleted_at: string | null;
  deleted_by: RequestActor | null;
}

// ── Plugin Settings ───────────────────────────────────────────────────────────

/**
 * Stored in the tenant-settings table with type = "plugin_setting".
 * Keyed by provider — exactly one record per canonical plugin regardless of how many
 * credential schemas exist.  The QA orchestrator reads this to resolve which credential
 * to use when executing a plugin.
 */
export interface IPluginSettingRecord {
  /** Auto-generated PG-prefixed ID */
  id: string;
  /** Discriminator for single-table design — always "plugin_setting" */
  type: "plugin_setting";
  /** Canonical provider identifier, e.g. "trusted_form" or "ipqs".
   *  Used as the sort-key on the type-provider-index GSI. */
  provider: string;
  /** FK to TenantCredentialRecord.id — the global default credential to use.
   *  Null when the plugin is registered but no credential has been assigned yet. */
  credentials_id: string | null;
  /** Whether this global plugin setting is active */
  enabled: boolean;
  created_at: string;
  updated_at: string;
  created_by?: RequestActor;
  updated_by?: RequestActor;
  /** Soft-delete fields */
  is_deleted: boolean;
  active: boolean;
  deleted_at: string | null;
  deleted_by: RequestActor | null;
}

/**
 * Returned by GET /tenant-config/plugin-settings.
 * Merges the stored plugin_setting record (or a synthetic default when unconfigured)
 * with the registry metadata from AVAILABLE_PLUGINS so the frontend gets everything
 * it needs in one call: name, credential_type, description + current setting state.
 */
export type IPluginView = IPluginSettingRecord & {
  /** Human-readable plugin name from the registry, e.g. "TrustedForm" */
  name: string;
  /** Credential auth type required by this plugin, e.g. "basic_auth" */
  credential_type: CredentialType;
  /** Human-readable description of the plugin shown in the Settings UI */
  description: string;
};
