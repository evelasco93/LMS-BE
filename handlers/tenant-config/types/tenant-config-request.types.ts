import {
  CredentialType,
  IPluginSchemaField,
} from "../interfaces/ITenantConfig.interface";

export type CreateCredentialRequest = {
  provider: string;
  /** Human-readable label shown in frontend dropdowns */
  name: string;
  type: CredentialType;
  credentials: Record<string, string>;
  /** Optional vendor name for TrustedForm certificate claims */
  vendor?: string;
};

export type UpdateCredentialRequest = {
  name?: string;
  type?: CredentialType;
  credentials?: Record<string, string>;
  vendor?: string;
};

/** @deprecated kept for backward-compat; use CreateCredentialRequest */
export type UpsertCredentialRequest = CreateCredentialRequest;

export type CreatePluginSchemaRequest = {
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
