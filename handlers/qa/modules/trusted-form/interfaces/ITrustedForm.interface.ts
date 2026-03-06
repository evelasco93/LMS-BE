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
  retain?: {
    results?: {
      expires_at?: string;
      masked_cert_url?: string;
      previously_retained?: boolean;
    };
    vendor?: string;
  };
  match_lead?: {
    result?: {
      success?: boolean;
      phone_match?: boolean;
      email_match?: boolean;
    };
    phone?: string;
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
