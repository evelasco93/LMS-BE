import { AffiliateStatus } from "../enums/affiliate-status.enum";

export type CreateAffiliateRequest = {
  name: string;
  notes?: string;
  company?: string;
  affiliate_code?: string;
};

export type UpdateAffiliateRequest = Partial<CreateAffiliateRequest> & {
  status?: AffiliateStatus;
};

export type ListAffiliatesQuery = {
  status?: AffiliateStatus;
  limit?: number;
  lastEvaluatedKey?: string;
  includeDeleted?: boolean;
};
