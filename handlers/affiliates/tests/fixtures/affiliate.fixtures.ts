import { IAffiliate } from "../../interfaces/IAffiliate.interface";
import { AffiliateStatus } from "../../enums/affiliate-status.enum";

export const mockAffiliate: IAffiliate = {
  id: "AFABCDEFGHIJ",
  name: "Test Affiliate",
  email: "test@affiliate.com",
  company: "Test Company",
  phone: "555-0000",
  status: AffiliateStatus.ACTIVE,
  affiliate_code: "AFFCODE123",
  created_at: "2026-02-16T00:00:00.000Z",
  updated_at: "2026-02-16T00:00:00.000Z",
};

export const mockExistingAffiliate: IAffiliate = {
  id: "AFEXISTING01",
  name: "Existing Affiliate",
  email: "existing@affiliate.com",
  company: "Existing Company",
  phone: "555-1111",
  status: AffiliateStatus.ACTIVE,
  affiliate_code: "AFFCODE456",
  created_at: "2026-02-15T00:00:00.000Z",
  updated_at: "2026-02-15T00:00:00.000Z",
};
