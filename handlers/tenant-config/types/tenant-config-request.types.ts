import { CredentialType } from "../interfaces/ITenantConfig.interface";

export type UpsertCredentialRequest = {
  provider: string;
  type: CredentialType;
  credentials: Record<string, string>;
};
