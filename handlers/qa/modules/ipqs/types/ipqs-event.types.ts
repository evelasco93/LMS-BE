import {
  IIpqsPhoneCheckConfig,
  IIpqsEmailCheckConfig,
  IIpqsIpCheckConfig,
} from "../interfaces/IIpqs.interface";

export interface IpqsEvent {
  campaign_id: string;
  credentials_id: string;
  /** Formatted phone number — e.g. "+15551234567" or "15551234567" */
  phone?: string;
  email?: string;
  ip_address?: string;
  /** Per-check config. Sub-keys are optional; absent = disabled with all criteria off. */
  config?: {
    phone?: Partial<IIpqsPhoneCheckConfig>;
    email?: Partial<IIpqsEmailCheckConfig>;
    ip?: Partial<IIpqsIpCheckConfig>;
  };
}
