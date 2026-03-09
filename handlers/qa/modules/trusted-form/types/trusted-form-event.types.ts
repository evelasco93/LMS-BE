export interface TrustedFormEvent {
  campaign_id: string;
  credentials_id: string;
  cert_id: string;
  phone?: string;
  vendor?: string;
  /** When true, claim the certificate after successful validation. Default: false */
  claim?: boolean;
}
