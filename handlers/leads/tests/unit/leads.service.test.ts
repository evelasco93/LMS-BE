import { describe, it, expect, beforeEach, vi } from "vitest";
import { LeadsService } from "../../services/leads.service";
import { CreateLeadRequest } from "../../types/lead-request.types";
import { CampaignStatus } from "../../enums/campaign-status.enum";
import { CampaignParticipantStatus } from "../../../campaigns/enums/campaign-participant-status.enum";
import {
  getTestContainer,
  getMockDynamoDBUtil,
  getMockLambdaInvokeUtil,
  getMockConstants,
} from "../setup";
import { ILead } from "../../interfaces/ILead.interface";

interface MockCampaign {
  id: string;
  status: CampaignStatus;
  affiliates: {
    affiliate_id: string;
    campaign_key: string;
    status?: CampaignParticipantStatus;
  }[];
  plugins?: {
    duplicate_check?: {
      enabled?: boolean;
      criteria?: string[];
    };
  };
}

describe("LeadsService", () => {
  let leadsService: LeadsService;
  let mockDynamoDBUtil: any;
  let mockLambdaInvokeUtil: any;
  let mockConstants: any;

  beforeEach(() => {
    const container = getTestContainer();
    container.bind("LeadsService").to(LeadsService);
    leadsService = container.get<LeadsService>("LeadsService");
    mockDynamoDBUtil = getMockDynamoDBUtil();
    mockLambdaInvokeUtil = getMockLambdaInvokeUtil();
    mockConstants = getMockConstants();
  });

  const buildCampaign = (
    status: CampaignStatus,
    affiliateStatus: CampaignParticipantStatus = CampaignParticipantStatus.TEST,
  ): MockCampaign => ({
    id: "CM123",
    status,
    affiliates: [
      {
        affiliate_id: "AF1",
        campaign_key: "KEY123",
        status: affiliateStatus,
      },
    ],
  });

  describe("createLead", () => {
    it("normalises flat external format (no payload wrapper) correctly", async () => {
      // External affiliates post a flat body: { campaign_id, campaign_key, ...leadData }
      // Service must extract lead data into payload and still reject for a missing campaign.
      mockDynamoDBUtil.get.mockResolvedValueOnce(null);

      const result = await leadsService.createLead(
        {
          campaign_id: "CM123",
          campaign_key: "KEY123",
          first_name: "Edgar",
          email: "test@example.com",
          phone: "+15551234567",
        } as any,
        true,
      );

      // Gets through normalisation, reaches "Campaign not found" — not an Invalid fields error
      expect(result.result).toBe(false);
      expect(result.error).toContain("Campaign not found");
      expect(mockDynamoDBUtil.put).not.toHaveBeenCalled();
    });

    it("fails when campaign not found", async () => {
      mockDynamoDBUtil.get.mockResolvedValueOnce(null);

      const result = await leadsService.createLead(
        {
          campaign_id: "CM404",
          campaign_key: "KEY123",
          payload: {},
        },
        true,
      );

      expect(result.result).toBe(false);
      expect(result.error).toContain("Campaign not found");
    });

    it("fails when affiliate key mismatch", async () => {
      mockDynamoDBUtil.get.mockResolvedValueOnce({
        ...buildCampaign(CampaignStatus.TEST, CampaignParticipantStatus.TEST),
        affiliates: [
          {
            affiliate_id: "AF1",
            campaign_key: "OTHER",
            status: CampaignParticipantStatus.TEST,
          },
        ],
      });

      const result = await leadsService.createLead(
        {
          campaign_id: "CM123",
          campaign_key: "KEY123",
          payload: {},
        },
        false,
      );

      expect(result.result).toBe(false);
      expect(result.error).toContain("Invalid campaign_key");
    });
    it("stores test lead when campaign is in TEST", async () => {
      const campaign = buildCampaign(
        CampaignStatus.TEST,
        CampaignParticipantStatus.TEST,
      );
      mockDynamoDBUtil.get.mockResolvedValueOnce(campaign);
      mockDynamoDBUtil.put.mockResolvedValueOnce(undefined);

      const payload: CreateLeadRequest = {
        campaign_id: campaign.id,
        campaign_key: "KEY123",
        payload: { email: "test@example.com" },
      };

      const result = await leadsService.createLead(payload, true);

      expect(result.result).toBe(true);
      expect(result.data?.test).toBe(true);
      expect(result.data?.campaign_id).toBe(campaign.id);
      expect(result.data?.campaign_key).toBe("KEY123");
      expect(mockDynamoDBUtil.put).toHaveBeenCalledTimes(1);
    });

    it("rejects when campaign key does not match", async () => {
      const campaign = buildCampaign(
        CampaignStatus.TEST,
        CampaignParticipantStatus.TEST,
      );
      mockDynamoDBUtil.get.mockResolvedValueOnce(campaign);

      const payload: CreateLeadRequest = {
        campaign_id: campaign.id,
        campaign_key: "BADKEY",
        payload: {},
      };

      const result = await leadsService.createLead(payload, true);

      expect(result.result).toBe(false);
      expect(result.error).toContain("Invalid campaign_key");
      expect(mockDynamoDBUtil.put).not.toHaveBeenCalled();
    });

    it("rejects draft campaigns on either endpoint", async () => {
      const campaign = buildCampaign(
        CampaignStatus.DRAFT,
        CampaignParticipantStatus.TEST,
      );
      mockDynamoDBUtil.get.mockResolvedValueOnce(campaign);

      const payload: CreateLeadRequest = {
        campaign_id: campaign.id,
        campaign_key: "KEY123",
        payload: {},
      };

      const result = await leadsService.createLead(payload, true);

      expect(result.result).toBe(false);
      expect(result.error).toContain("draft");
    });

    it("rejects inactive campaigns", async () => {
      const campaign = buildCampaign(
        CampaignStatus.INACTIVE,
        CampaignParticipantStatus.LIVE,
      );
      mockDynamoDBUtil.get.mockResolvedValueOnce(campaign);

      const result = await leadsService.createLead(
        {
          campaign_id: campaign.id,
          campaign_key: "KEY123",
          payload: {},
        },
        false,
      );

      expect(result.result).toBe(false);
      expect(result.error).toContain("inactive");
    });

    it("rejects live endpoint when campaign is TEST", async () => {
      mockDynamoDBUtil.get.mockResolvedValueOnce(
        buildCampaign(CampaignStatus.TEST, CampaignParticipantStatus.LIVE),
      );

      const payload: CreateLeadRequest = {
        campaign_id: "CM123",
        campaign_key: "KEY123",
        payload: {},
      };

      const result = await leadsService.createLead(payload, false);

      expect(result.result).toBe(false);
      expect(result.error).toContain("send to /lead/test");
    });

    it("rejects test endpoint when campaign is ACTIVE", async () => {
      const campaign = buildCampaign(
        CampaignStatus.ACTIVE,
        CampaignParticipantStatus.TEST,
      );
      mockDynamoDBUtil.get.mockResolvedValueOnce(campaign);

      const payload: CreateLeadRequest = {
        campaign_id: campaign.id,
        campaign_key: "KEY123",
        payload: {},
      };

      const result = await leadsService.createLead(payload, true);

      expect(result.result).toBe(false);
      expect(result.error).toContain("Campaign is live");
    });

    it("stores lead but marks rejected when affiliate is DISABLED", async () => {
      const campaign = buildCampaign(
        CampaignStatus.ACTIVE,
        CampaignParticipantStatus.DISABLED,
      );
      mockDynamoDBUtil.get.mockResolvedValueOnce(campaign);
      mockDynamoDBUtil.put.mockResolvedValueOnce(undefined);

      const payload: CreateLeadRequest = {
        campaign_id: campaign.id,
        campaign_key: "KEY123",
        payload: { name: "Disabled Affiliate Lead" },
      };

      const result = await leadsService.createLead(payload, false);

      expect(result.result).toBe(true);
      expect((result.data as ILead)?.rejected).toBe(true);
      expect((result.data as ILead)?.rejection_reason).toContain("DISABLED");
      expect(mockDynamoDBUtil.put).toHaveBeenCalledTimes(1);
    });

    it("stores lead as rejected when affiliate is DISABLED for the campaign", async () => {
      const campaign = buildCampaign(
        CampaignStatus.ACTIVE,
        CampaignParticipantStatus.DISABLED,
      );
      mockDynamoDBUtil.get.mockResolvedValueOnce(campaign);
      mockDynamoDBUtil.put.mockResolvedValueOnce(undefined);

      const payload: CreateLeadRequest = {
        campaign_id: campaign.id,
        campaign_key: "KEY123",
        payload: { name: "Bob" },
      };

      const result = await leadsService.createLead(payload, false);

      expect(result.result).toBe(true);
      expect((result.data as ILead)?.rejected).toBe(true);
      expect((result.data as ILead)?.rejection_reason).toContain("DISABLED");
      expect(mockDynamoDBUtil.put).toHaveBeenCalledTimes(1);
    });

    it("accepts live lead when campaign is ACTIVE", async () => {
      const campaign = buildCampaign(
        CampaignStatus.ACTIVE,
        CampaignParticipantStatus.LIVE,
      );
      mockDynamoDBUtil.get.mockResolvedValueOnce(campaign);
      mockDynamoDBUtil.put.mockResolvedValueOnce(undefined);

      const payload: CreateLeadRequest = {
        campaign_id: campaign.id,
        campaign_key: "KEY123",
        payload: { name: "Alice" },
      };

      const result = await leadsService.createLead(payload, false);

      expect(result.result).toBe(true);
      expect(result.data?.test).toBe(false);
      expect(mockDynamoDBUtil.put).toHaveBeenCalledTimes(1);
    });

    it("marks lead as rejected when duplicate is detected and duplicate_check is enabled", async () => {
      mockConstants.QA_ORCHESTRATOR_LAMBDA_NAME = "qa-orchestrator";
      const campaign = {
        ...buildCampaign(CampaignStatus.ACTIVE, CampaignParticipantStatus.LIVE),
        plugins: {
          duplicate_check: {
            enabled: true,
            criteria: ["email"],
          },
        },
      };

      mockDynamoDBUtil.get.mockResolvedValueOnce(campaign);
      mockLambdaInvokeUtil.invokeJson.mockResolvedValueOnce({
        duplicate: true,
        duplicate_matches: {
          lead_ids: ["LD-EXISTING-1"],
        },
      });
      mockDynamoDBUtil.put.mockResolvedValueOnce(undefined);

      const result = await leadsService.createLead(
        {
          campaign_id: campaign.id,
          campaign_key: "KEY123",
          payload: { email: "dup@test.com" },
        },
        false,
      );

      expect(result.result).toBe(true);
      expect(result.data?.duplicate).toBe(true);
      expect(result.data?.rejected).toBe(true);
      expect(result.data?.rejection_reason).toContain(
        "Duplicate lead detected",
      );
      expect(result.data?.duplicate_matches?.lead_ids).toEqual([
        "LD-EXISTING-1",
      ]);
      expect(mockLambdaInvokeUtil.invokeJson).toHaveBeenCalledTimes(1);
    });

    it("does not reject for duplicate when duplicate_check is disabled", async () => {
      mockConstants.QA_ORCHESTRATOR_LAMBDA_NAME = "qa-orchestrator";
      const campaign = {
        ...buildCampaign(CampaignStatus.ACTIVE, CampaignParticipantStatus.LIVE),
        plugins: {
          duplicate_check: {
            enabled: false,
            criteria: ["email"],
          },
        },
      };

      mockDynamoDBUtil.get.mockResolvedValueOnce(campaign);
      mockLambdaInvokeUtil.invokeJson.mockResolvedValueOnce({
        duplicate: true,
        duplicate_matches: {
          lead_ids: ["LD-EXISTING-1"],
        },
      });
      mockDynamoDBUtil.put.mockResolvedValueOnce(undefined);

      const result = await leadsService.createLead(
        {
          campaign_id: campaign.id,
          campaign_key: "KEY123",
          payload: { email: "dup@test.com" },
        },
        false,
      );

      expect(result.result).toBe(true);
      expect(result.data?.duplicate).toBe(true);
      expect(result.data?.rejected).toBe(false);
      expect(result.data?.rejection_reason).toBeUndefined();
      expect(mockLambdaInvokeUtil.invokeJson).toHaveBeenCalledTimes(1);
    });

    it("handles persistence failure", async () => {
      mockDynamoDBUtil.get.mockResolvedValueOnce(
        buildCampaign(CampaignStatus.ACTIVE, CampaignParticipantStatus.LIVE),
      );
      mockDynamoDBUtil.put.mockRejectedValueOnce(new Error("dynamo fail"));

      const result = await leadsService.createLead(
        {
          campaign_id: "CM123",
          campaign_key: "KEY123",
          payload: {},
        },
        false,
      );

      expect(result.result).toBe(false);
      expect(result.error).toContain("dynamo fail");
    });
  });
});
