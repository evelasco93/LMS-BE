// ── Operator for numeric fraud-score comparisons ─────────────────────────────
export type IpqsScoreOperator = "lte" | "gte" | "eq";

// ── Per-field criteria sub-types ──────────────────────────────────────────────

/** Compare a numeric fraud_score against a threshold. */
export interface IIpqsFraudScoreCheck {
  enabled: boolean;
  /** lte = score ≤ value; gte = score ≥ value; eq = exact match */
  operator: IpqsScoreOperator;
  value: number;
}

/** Check that the country code is in an allowlist. */
export interface IIpqsCountryCheck {
  enabled: boolean;
  /** 2-letter ISO-3166-1 alpha-2 codes, e.g. ["US","CA"] */
  allowed: string[];
}

/** Check whether `valid` equals the required value. */
export interface IIpqsValidCheck {
  enabled: boolean;
  /** If true, the IPQS `valid` field must be true to pass; false means it must be false. */
  required: boolean;
}

/** Check whether a boolean field (proxy, vpn) equals the expected value. */
export interface IIpqsBoolCheck {
  enabled: boolean;
  /** Expected value — pass only if the API field matches this. */
  allowed: boolean;
}

// ── Per-check-type criteria ───────────────────────────────────────────────────

export interface IIpqsPhoneCriteria {
  valid: IIpqsValidCheck;
  fraud_score: IIpqsFraudScoreCheck;
  country: IIpqsCountryCheck;
}

export interface IIpqsEmailCriteria {
  valid: IIpqsValidCheck;
  fraud_score: IIpqsFraudScoreCheck;
}

export interface IIpqsIpCriteria {
  fraud_score: IIpqsFraudScoreCheck;
  country_code: IIpqsCountryCheck;
  proxy: IIpqsBoolCheck;
  vpn: IIpqsBoolCheck;
}

// ── Per-check-type config (enabled + criteria) ────────────────────────────────

export interface IIpqsPhoneCheckConfig {
  enabled: boolean;
  criteria: IIpqsPhoneCriteria;
}

export interface IIpqsEmailCheckConfig {
  enabled: boolean;
  criteria: IIpqsEmailCriteria;
}

export interface IIpqsIpCheckConfig {
  enabled: boolean;
  criteria: IIpqsIpCriteria;
}

// ── IPQS raw API responses ────────────────────────────────────────────────────

export interface IpqsPhoneApiResponse {
  success: boolean;
  message?: string;
  valid?: boolean;
  fraud_score?: number;
  country?: string;
  [key: string]: unknown;
}

export interface IpqsEmailApiResponse {
  success: boolean;
  message?: string;
  valid?: boolean;
  fraud_score?: number;
  [key: string]: unknown;
}

export interface IpqsIpApiResponse {
  success: boolean;
  message?: string;
  fraud_score?: number;
  country_code?: string;
  proxy?: boolean;
  vpn?: boolean;
  [key: string]: unknown;
}

// ── Per-check result ──────────────────────────────────────────────────────────

export interface IIpqsCheckResult {
  /** Whether this individual check passed all enabled criteria */
  success: boolean;
  /** Per-criterion pass/fail (keys only for enabled criteria). */
  criteria_results?: Record<string, boolean>;
  fraud_score?: number;
  valid?: boolean;
  country?: string;
  proxy?: boolean;
  vpn?: boolean;
  error?: string;
  /** Full raw API response for debugging / storage */
  raw?: Record<string, unknown>;
}

// ── Overall IPQS result (stored on the lead) ──────────────────────────────────

export interface IIpqsResult {
  /** true only if all enabled checks passed */
  success: boolean;
  phone?: IIpqsCheckResult;
  email?: IIpqsCheckResult;
  ip?: IIpqsCheckResult;
  error?: string;
}

// ── Credential record shape (minimal — matches tenant-settings table) ─────────

export interface IpqsCredentialRecord {
  id: string;
  provider: string;
  name: string;
  credential_type: string;
  credentials: Record<string, string>;
}
