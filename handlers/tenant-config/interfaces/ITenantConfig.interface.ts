import type { RequestActor } from "@shared/utils/request-audit.util";

export type CredentialType = "api_key" | "basic_auth" | "bearer_token";

export interface TenantCredentialRecord {
  provider: string;
  type: CredentialType;
  credentials: Record<string, string>;
  updated_at: string;
  updated_by?: RequestActor;
}
