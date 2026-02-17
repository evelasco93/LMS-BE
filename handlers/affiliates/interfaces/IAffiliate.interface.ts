import { AffiliateStatus } from "../enums/affiliate-status.enum";

export interface IAffiliate {
  id: string;
  name: string;
  email: string;
  phone?: string;
  company?: string;
  status: AffiliateStatus;
  affiliate_code?: string;
  created_at: string;
  updated_at: string;
}
