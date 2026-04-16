import { AffiliateStatus } from "../enums/affiliate-status.enum";
import { RequestActor } from "@shared/utils/request-audit.util";

export interface IAffiliate {
  id: string;
  name: string;
  notes?: string;
  company?: string;
  status: AffiliateStatus;
  affiliate_code?: string;
  created_at: string;
  updated_at: string;
  created_by?: RequestActor;
  updated_by?: RequestActor;
  deleted_by?: RequestActor;
  deleted_at?: string;
  is_deleted?: boolean;
  active?: boolean;
}
