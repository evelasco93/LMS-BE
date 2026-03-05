import type { RequestActor } from "@shared/utils/request-audit.util";

export type CredentialType = "api_key" | "basic_auth" | "bearer_token";

// ── Plugin Schemas ───────────────────────────────────────────────────────────

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
 * Stored in DynamoDB plugin-schemas table.
 * Each record describes what credential fields a specific plugin integration needs.
 * Frontend reads this to dynamically render the credential creation form.
 */
export interface IPluginSchemaRecord {
  /** Auto-generated PS-prefixed ID */
  id: string;
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
}

/**
 * Stored in DynamoDB credentials table.
 * Sensitive credential values (apiKey, password, token) are AES-256-GCM encrypted.
 * Non-sensitive metadata (provider, type, name, vendor) is stored in plaintext.
 */
export interface TenantCredentialRecord {
  /** Auto-generated CR-prefixed ID */
  id: string;
  /** Provider identifier, e.g. "trusted_form", "ipqs" */
  provider: string;
  /** Human-readable label shown in frontend dropdowns */
  name: string;
  /** Credential auth type */
  type: CredentialType;
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
  enabled?: boolean;
  created_at: string;
  updated_at: string;
  created_by?: RequestActor;
  updated_by?: RequestActor;
}
