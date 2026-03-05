export interface TrustedFormCredentials {
  username: string;
  password: string;
}

export interface TrustedFormValidateResponse {
  outcome?: string;
  reason?: string;
  [key: string]: unknown;
}

export interface TrustedFormClaimResponse {
  cert?: {
    id?: string;
    expires_at?: string;
    previously_retained?: boolean;
    vendor?: string;
  };
  outcome?: string;
  reason?: string;
  [key: string]: unknown;
}

export interface TrustedFormResult {
  success: boolean;
  cert_id: string;
  outcome?: string;
  error?: string;
  phone?: string;
  phone_match?: boolean;
  vendor?: string;
  previously_retained?: boolean;
  expires_at?: string;
}

export interface CredentialRecord {
  id: string;
  provider: string;
  name: string;
  type: string;
  credentials: Record<string, string>;
  vendor?: string;
}
