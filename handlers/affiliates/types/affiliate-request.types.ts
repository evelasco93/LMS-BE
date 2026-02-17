import { AffiliateStatus } from "../enums/affiliate-status.enum";

export type CreateAffiliateRequest = {
  name: string;
  email: string;
  phone?: string;
  company?: string;
  affiliate_code?: string;
};

export type UpdateAffiliateRequest = Partial<
  Omit<CreateAffiliateRequest, "email">
> & {
  email?: string;
  status?: AffiliateStatus;
};

export type ListAffiliatesQuery = {
  status?: AffiliateStatus;
  limit?: number;
  lastEvaluatedKey?: string;
};
