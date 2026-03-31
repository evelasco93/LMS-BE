import {
  CredentialType,
  IPluginSchemaField,
} from "../interfaces/ITenantConfig.interface";

// ── Credentials ───────────────────────────────────────────────────────────────

export type CreateCredentialRequest = {
  provider: string;
  /** FK to ICredentialSchemaRecord.id — links this credential to its schema */
  schema_id?: string;
  /** Human-readable label shown in frontend dropdowns */
  name: string;
  credential_type: CredentialType;
  credentials: Record<string, string>;
  /** Optional vendor name for TrustedForm certificate claims */
  vendor?: string;
};

export type UpdateCredentialRequest = {
  name?: string;
  credential_type?: CredentialType;
  credentials?: Record<string, string>;
  vendor?: string;
};

// ── Credential Schemas ────────────────────────────────────────────────────────

export type CreateCredentialSchemaRequest = {
  /** Machine-readable provider identifier, e.g. "trusted_form" */
  provider: string;
  /** Human-readable plugin name, e.g. "TrustedForm" */
  name: string;
  /** Which credential type this plugin expects */
  credential_type: CredentialType;
  /** Ordered list of credential fields the frontend should render */
  fields: IPluginSchemaField[];
  /** Optional human-readable description */
  description?: string;
};

export type UpdateCredentialSchemaRequest = {
  name?: string;
  description?: string;
  fields?: IPluginSchemaField[];
};

// ── Plugin Settings ───────────────────────────────────────────────────────────

export type SetPluginSettingRequest = {
  /** FK to TenantCredentialRecord.id — the global default credential to use for this plugin.
   *  Omit to register/enable the plugin without assigning a credential yet. */
  credentials_id?: string | null;
  /** Whether this global plugin setting is active (defaults to true) */
  enabled?: boolean;
};

export type UpdatePluginSettingRequest = {
  credentials_id?: string;
  enabled?: boolean;
};

// ── Tag Definitions ─────────────────────────────────────────────────────────

export type CreateTagDefinitionRequest = {
  label: string;
  color?: string;
};

export type UpdateTagDefinitionRequest = {
  label?: string;
  color?: string;
};
