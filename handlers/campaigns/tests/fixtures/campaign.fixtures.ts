import { CampaignStatus } from "../../enums/campaign-status.enum";
import { CampaignParticipantStatus } from "../../enums/campaign-participant-status.enum";
import { ICampaign } from "../../interfaces/ICampaign.interface";

const now = "2024-01-01T00:00:00.000Z";

export const mockCampaign: ICampaign = {
  id: "CMABCDEFGH",
  name: "Summer Promo",
  status: CampaignStatus.ACTIVE,
  clients: [{ client_id: "CL123", status: CampaignParticipantStatus.LIVE }],
  affiliates: [
    {
      affiliate_id: "AF123",
      campaign_key: "111111111111",
      status: CampaignParticipantStatus.LIVE,
    },
  ],
  status_history: [
    { from: null, to: CampaignStatus.DRAFT, changed_at: now },
    { from: CampaignStatus.DRAFT, to: CampaignStatus.TEST, changed_at: now },
    { from: CampaignStatus.TEST, to: CampaignStatus.ACTIVE, changed_at: now },
  ],
  plugins: {
    duplicate_check: {
      enabled: true,
      criteria: ["phone", "email"],
    },
    trusted_form: {
      enabled: true,
    },
  },
  created_at: now,
  updated_at: now,
};

export const emptyCampaign: ICampaign = {
  id: "CMEMPTY01",
  name: "Empty Campaign",
  status: CampaignStatus.DRAFT,
  clients: [],
  affiliates: [],
  status_history: [{ from: null, to: CampaignStatus.DRAFT, changed_at: now }],
  plugins: {
    duplicate_check: {
      enabled: true,
      criteria: ["phone", "email"],
    },
    trusted_form: {
      enabled: true,
    },
  },
  created_at: now,
  updated_at: now,
};

export const campaignWithAffiliate: ICampaign = {
  id: "CMAFFIL01",
  name: "Affiliate Campaign",
  status: CampaignStatus.ACTIVE,
  clients: [],
  affiliates: [
    {
      affiliate_id: "AF777",
      campaign_key: "777777777777",
      status: CampaignParticipantStatus.LIVE,
    },
  ],
  status_history: [
    { from: null, to: CampaignStatus.DRAFT, changed_at: now },
    { from: CampaignStatus.DRAFT, to: CampaignStatus.TEST, changed_at: now },
    { from: CampaignStatus.TEST, to: CampaignStatus.ACTIVE, changed_at: now },
  ],
  plugins: {
    duplicate_check: {
      enabled: true,
      criteria: ["phone", "email"],
    },
    trusted_form: {
      enabled: true,
    },
  },
  created_at: now,
  updated_at: now,
};
