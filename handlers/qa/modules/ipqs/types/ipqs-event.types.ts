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
  config: {
    phone: IIpqsPhoneCheckConfig;
    email: IIpqsEmailCheckConfig;
    ip: IIpqsIpCheckConfig;
  };
}
