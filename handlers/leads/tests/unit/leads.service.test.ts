import { describe, it, expect, beforeEach, vi } from "vitest";
import { LeadsService } from "../../services/leads.service";
import { CreateLeadRequest } from "../../types/lead-request.types";
import { CampaignStatus } from "../../enums/campaign-status.enum";
import { CampaignParticipantStatus } from "../../../campaigns/enums/campaign-participant-status.enum";
import {
  getTestContainer,
  getMockDynamoDBUtil,
  getMockLambdaInvokeUtil,
  getMockLeadDeliveryService,
  getMockConstants,
} from "../setup";

interface MockCampaign {
  id: string;
  status: CampaignStatus;
  validation_bypass?: {
    trusted_form_claim?: boolean;
    duplicate_check?: boolean;
    ipqs_phone?: boolean;
    ipqs_email?: boolean;
    ipqs_ip?: boolean;
    all?: boolean;
  };
  affiliate_overrides?: Record<
    string,
    {
      validation_bypass?: {
        trusted_form_claim?: boolean;
        duplicate_check?: boolean;
        ipqs_phone?: boolean;
        ipqs_email?: boolean;
        ipqs_ip?: boolean;
        all?: boolean;
      };
    }
  >;
  affiliates: {
    affiliate_id: string;
    campaign_key: string;
    status?: CampaignParticipantStatus;
    validation_bypass?: {
      trusted_form_claim?: boolean;
      duplicate_check?: boolean;
      ipqs_phone?: boolean;
      ipqs_email?: boolean;
      ipqs_ip?: boolean;
      all?: boolean;
    };
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
  let mockLeadDeliveryService: any;
  let mockConstants: any;

  beforeEach(() => {
    const container = getTestContainer();
    container.bind("LeadsService").to(LeadsService);
    leadsService = container.get<LeadsService>("LeadsService");
    mockDynamoDBUtil = getMockDynamoDBUtil();
    mockLambdaInvokeUtil = getMockLambdaInvokeUtil();
    mockLeadDeliveryService = getMockLeadDeliveryService();
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
      mockDynamoDBUtil.get.mockResolvedValueOnce(null);

      const result = await leadsService.createLead({
        campaign_id: "CM123",
        campaign_key: "KEY123",
        first_name: "Edgar",
        email: "test@example.com",
        phone: "+15551234567",
      } as any);

      expect(result.result).toBe("failed");
      expect(result.error).toContain("Campaign not found");
      expect(mockDynamoDBUtil.put).not.toHaveBeenCalled();
    });

    it("fails when campaign not found", async () => {
      mockDynamoDBUtil.get.mockResolvedValueOnce(null);

      const result = await leadsService.createLead({
        campaign_id: "CM404",
        campaign_key: "KEY123",
        payload: {},
      });

      expect(result.result).toBe("failed");
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

      const result = await leadsService.createLead({
        campaign_id: "CM123",
        campaign_key: "KEY123",
        payload: {},
      });

      expect(result.result).toBe("failed");
      expect(result.error).toContain("Invalid campaign_key");
    });

    it("stores test lead when affiliate is TEST", async () => {
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

      const result = await leadsService.createLead(payload);

      expect(result.result).toBe("passed");
      expect(result.data?.lead_id).toBeDefined();
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

      const result = await leadsService.createLead(payload);

      expect(result.result).toBe("failed");
      expect(result.error).toContain("Invalid campaign_key");
      expect(mockDynamoDBUtil.put).not.toHaveBeenCalled();
    });

    it("rejects draft campaigns for TEST affiliates", async () => {
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

      const result = await leadsService.createLead(payload);

      expect(result.result).toBe("failed");
      expect(result.error).toContain("draft");
    });

    it("rejects inactive campaigns", async () => {
      const campaign = buildCampaign(
        CampaignStatus.INACTIVE,
        CampaignParticipantStatus.LIVE,
      );
      mockDynamoDBUtil.get.mockResolvedValueOnce(campaign);

      const result = await leadsService.createLead({
        campaign_id: campaign.id,
        campaign_key: "KEY123",
        payload: {},
      });

      expect(result.result).toBe("failed");
      expect(result.error).toContain("inactive");
    });

    it("rejects LIVE affiliate when campaign is TEST", async () => {
      mockDynamoDBUtil.get.mockResolvedValueOnce(
        buildCampaign(CampaignStatus.TEST, CampaignParticipantStatus.LIVE),
      );

      const result = await leadsService.createLead({
        campaign_id: "CM123",
        campaign_key: "KEY123",
        payload: {},
      });

      expect(result.result).toBe("failed");
      expect(result.error).toContain("test mode");
    });

    it("allows TEST affiliate on ACTIVE campaign", async () => {
      const campaign = buildCampaign(
        CampaignStatus.ACTIVE,
        CampaignParticipantStatus.TEST,
      );
      mockDynamoDBUtil.get.mockResolvedValueOnce(campaign);
      mockDynamoDBUtil.put.mockResolvedValueOnce(undefined);

      const payload: CreateLeadRequest = {
        campaign_id: campaign.id,
        campaign_key: "KEY123",
        payload: { email: "test@example.com" },
      };

      const result = await leadsService.createLead(payload);

      expect(result.result).toBe("passed");
      expect(result.data?.lead_id).toBeDefined();
      expect(mockDynamoDBUtil.put).toHaveBeenCalledTimes(1);
    });

    it("auto-detects test from payload field value", async () => {
      const campaign = buildCampaign(
        CampaignStatus.ACTIVE,
        CampaignParticipantStatus.LIVE,
      );
      mockDynamoDBUtil.get.mockResolvedValueOnce(campaign);
      mockDynamoDBUtil.put.mockResolvedValueOnce(undefined);

      const result = await leadsService.createLead({
        campaign_id: campaign.id,
        campaign_key: "KEY123",
        payload: { first_name: "Test", email: "guy@example.com" },
      });

      // Auto-detected as test: accepted but no delivery
      expect(result.result).toBe("passed");
      expect(result.message).toContain("Test lead accepted");
      expect(mockLeadDeliveryService.deliverLead).not.toHaveBeenCalled();
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

      const result = await leadsService.createLead(payload);

      expect(result.result).toBe("failed");
      expect(result.lead_id).toBeDefined();
      expect(result.errors?.[0]).toContain("contact your account manager");
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

      const result = await leadsService.createLead(payload);

      expect(result.result).toBe("failed");
      expect(result.lead_id).toBeDefined();
      expect(result.errors?.[0]).toContain("contact your account manager");
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

      const result = await leadsService.createLead(payload);

      expect(result.result).toBe("passed");
      expect(result.data?.lead_id).toBeDefined();
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

      const result = await leadsService.createLead({
        campaign_id: campaign.id,
        campaign_key: "KEY123",
        payload: { email: "dup@real.com" },
      });

      expect(result.result).toBe("failed");
      expect(result.lead_id).toBeDefined();
      expect(result.errors?.[0]).toContain(
        "A matching lead has already been received",
      );
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

      const result = await leadsService.createLead({
        campaign_id: campaign.id,
        campaign_key: "KEY123",
        payload: { email: "dup@real.com" },
      });

      expect(result.result).toBe("passed");
      expect(result.data?.lead_id).toBeDefined();
      expect(mockLambdaInvokeUtil.invokeJson).toHaveBeenCalledTimes(1);
    });

    it("applies campaign-level bypass when affiliate has no bypass", async () => {
      mockConstants.QA_ORCHESTRATOR_LAMBDA_NAME = "qa-orchestrator";
      const campaign = {
        ...buildCampaign(CampaignStatus.ACTIVE, CampaignParticipantStatus.LIVE),
        validation_bypass: {
          duplicate_check: true,
          ipqs_phone: true,
        },
      };

      mockDynamoDBUtil.get.mockResolvedValueOnce(campaign);
      mockLambdaInvokeUtil.invokeJson.mockResolvedValueOnce({
        duplicate: false,
        duplicate_matches: { lead_ids: [] },
      });
      mockDynamoDBUtil.put.mockResolvedValueOnce(undefined);

      const result = await leadsService.createLead({
        campaign_id: campaign.id,
        campaign_key: "KEY123",
        payload: { email: "ok@real.com", phone: "5551112222" },
      });

      expect(result.result).toBe("passed");
      expect(mockLambdaInvokeUtil.invokeJson).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            bypass: {
              duplicate_check: true,
              ipqs_phone: true,
            },
          }),
        }),
      );
    });

    it("lets affiliate bypass values override campaign-level defaults", async () => {
      mockConstants.QA_ORCHESTRATOR_LAMBDA_NAME = "qa-orchestrator";
      const campaign = {
        ...buildCampaign(CampaignStatus.ACTIVE, CampaignParticipantStatus.LIVE),
        validation_bypass: {
          duplicate_check: true,
          ipqs_phone: true,
        },
        affiliates: [
          {
            affiliate_id: "AF1",
            campaign_key: "KEY123",
            status: CampaignParticipantStatus.LIVE,
            validation_bypass: {
              duplicate_check: false,
            },
          },
        ],
      };

      mockDynamoDBUtil.get.mockResolvedValueOnce(campaign);
      mockLambdaInvokeUtil.invokeJson.mockResolvedValueOnce({
        duplicate: false,
        duplicate_matches: { lead_ids: [] },
      });
      mockDynamoDBUtil.put.mockResolvedValueOnce(undefined);

      const result = await leadsService.createLead({
        campaign_id: campaign.id,
        campaign_key: "KEY123",
        payload: { email: "ok@real.com", phone: "5551112222" },
      });

      expect(result.result).toBe("passed");
      expect(mockLambdaInvokeUtil.invokeJson).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            bypass: {
              duplicate_check: false,
              ipqs_phone: true,
            },
          }),
        }),
      );
    });

    it("rejects live lead when delivery is not accepted", async () => {
      const campaign = buildCampaign(
        CampaignStatus.ACTIVE,
        CampaignParticipantStatus.LIVE,
      );
      mockDynamoDBUtil.get.mockResolvedValueOnce(campaign);
      mockDynamoDBUtil.put.mockResolvedValueOnce(undefined);
      mockLeadDeliveryService.deliverLead.mockImplementationOnce(
        async (lead: any) => {
          lead.sold = false;
          lead.rejected = true;
          lead.rejection_reason =
            "No eligible LIVE client available for delivery";
          lead.rejection_errors = [
            "No eligible LIVE client available for delivery",
          ];
        },
      );

      const result = await leadsService.createLead({
        campaign_id: campaign.id,
        campaign_key: "KEY123",
        payload: { email: "lead@undelivered.com" },
      });

      expect(result.result).toBe("failed");
      expect(result.lead_id).toBeDefined();
      expect(result.errors?.[0]).toContain("No eligible LIVE client");
      expect(mockLeadDeliveryService.deliverLead).toHaveBeenCalledTimes(1);
    });

    it("handles persistence failure", async () => {
      mockDynamoDBUtil.get.mockResolvedValueOnce(
        buildCampaign(CampaignStatus.ACTIVE, CampaignParticipantStatus.LIVE),
      );
      mockDynamoDBUtil.put.mockRejectedValueOnce(new Error("dynamo fail"));

      const result = await leadsService.createLead({
        campaign_id: "CM123",
        campaign_key: "KEY123",
        payload: {},
      });

      expect(result.result).toBe("failed");
      expect(result.error).toContain("dynamo fail");
    });
  });
});
