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
  getMockMetricsService,
  getMockMetricsDlqClient,
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
  let mockMetricsService: any;
  let mockMetricsDlqClient: any;
  let mockConstants: any;

  beforeEach(() => {
    const container = getTestContainer();
    container.bind("LeadsService").to(LeadsService);
    leadsService = container.get<LeadsService>("LeadsService");
    mockDynamoDBUtil = getMockDynamoDBUtil();
    mockLambdaInvokeUtil = getMockLambdaInvokeUtil();
    mockLeadDeliveryService = getMockLeadDeliveryService();
    mockMetricsService = getMockMetricsService();
    mockMetricsDlqClient = getMockMetricsDlqClient();
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
      expect(result.message?.toLowerCase()).toContain("test lead accepted");
      expect(mockLeadDeliveryService.deliverLead).not.toHaveBeenCalled();
      expect(mockMetricsService.recordLeadOutcome).not.toHaveBeenCalled();
    });

    it("does not emit metrics for criteria-rejected test leads", async () => {
      mockConstants.CRITERIA_VALIDATION_LAMBDA_NAME = "criteria-validation";
      const campaign = buildCampaign(
        CampaignStatus.ACTIVE,
        CampaignParticipantStatus.LIVE,
      );

      mockDynamoDBUtil.get.mockResolvedValueOnce(campaign);
      mockLambdaInvokeUtil.invokeJson.mockResolvedValueOnce({
        valid: false,
        missing_fields: ["email"],
      });
      mockDynamoDBUtil.put.mockResolvedValueOnce(undefined);

      const result = await leadsService.createLead({
        campaign_id: campaign.id,
        campaign_key: "KEY123",
        payload: { first_name: "Test" },
      });

      expect(result.result).toBe("failed");
      expect(mockMetricsService.recordLeadOutcome).not.toHaveBeenCalled();
      expect(mockMetricsDlqClient.enqueue).not.toHaveBeenCalled();
    });

    it("emits metrics for criteria-rejected live leads", async () => {
      mockConstants.CRITERIA_VALIDATION_LAMBDA_NAME = "criteria-validation";
      const campaign = buildCampaign(
        CampaignStatus.ACTIVE,
        CampaignParticipantStatus.LIVE,
      );

      mockDynamoDBUtil.get.mockResolvedValueOnce(campaign);
      mockLambdaInvokeUtil.invokeJson.mockResolvedValueOnce({
        valid: false,
        missing_fields: ["email"],
      });
      mockDynamoDBUtil.put.mockResolvedValueOnce(undefined);

      const result = await leadsService.createLead({
        campaign_id: campaign.id,
        campaign_key: "KEY123",
        payload: { first_name: "Real" },
      });

      expect(result.result).toBe("failed");
      expect(mockMetricsService.recordLeadOutcome).toHaveBeenCalledTimes(1);
      expect(mockMetricsDlqClient.enqueue).not.toHaveBeenCalled();
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
      expect(result.errors?.[0]?.toLowerCase()).toContain(
        "contact your account manager",
      );
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
      expect(result.errors?.[0]?.toLowerCase()).toContain(
        "contact your account manager",
      );
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
      expect(result.errors?.[0]?.toLowerCase()).toContain(
        "a matching lead has already been received",
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

    it("forwards numeric phone to QA orchestrator as a stringified value", async () => {
      mockConstants.QA_ORCHESTRATOR_LAMBDA_NAME = "qa-orchestrator";
      const campaign = buildCampaign(
        CampaignStatus.ACTIVE,
        CampaignParticipantStatus.LIVE,
      );
      mockDynamoDBUtil.get.mockResolvedValueOnce(campaign);
      mockLambdaInvokeUtil.invokeJson.mockResolvedValueOnce({
        duplicate: false,
        duplicate_matches: { lead_ids: [] },
      });
      mockDynamoDBUtil.put.mockResolvedValueOnce(undefined);

      await leadsService.createLead({
        campaign_id: campaign.id,
        campaign_key: "KEY123",
        payload: { email: "ok@real.com", phone: 19014222433 },
      } as any);

      expect(mockLambdaInvokeUtil.invokeJson).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            phone: "19014222433",
          }),
        }),
      );
    });

    it("forwards numeric trusted_form_cert_id to QA orchestrator as a stringified cert_id", async () => {
      mockConstants.QA_ORCHESTRATOR_LAMBDA_NAME = "qa-orchestrator";
      const campaign = buildCampaign(
        CampaignStatus.ACTIVE,
        CampaignParticipantStatus.LIVE,
      );
      mockDynamoDBUtil.get.mockResolvedValueOnce(campaign);
      mockLambdaInvokeUtil.invokeJson.mockResolvedValueOnce({
        duplicate: false,
        duplicate_matches: { lead_ids: [] },
      });
      mockDynamoDBUtil.put.mockResolvedValueOnce(undefined);

      await leadsService.createLead({
        campaign_id: campaign.id,
        campaign_key: "KEY123",
        payload: {
          email: "ok@real.com",
          trusted_form_cert_id: 1234567890,
        },
      } as any);

      expect(mockLambdaInvokeUtil.invokeJson).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            cert_id: "1234567890",
          }),
        }),
      );
    });

    it("omits phone from QA orchestrator payload when phone is empty or whitespace", async () => {
      mockConstants.QA_ORCHESTRATOR_LAMBDA_NAME = "qa-orchestrator";

      const runWithPhone = async (phone: unknown) => {
        const campaign = buildCampaign(
          CampaignStatus.ACTIVE,
          CampaignParticipantStatus.LIVE,
        );
        mockDynamoDBUtil.get.mockResolvedValueOnce(campaign);
        mockLambdaInvokeUtil.invokeJson.mockResolvedValueOnce({
          duplicate: false,
          duplicate_matches: { lead_ids: [] },
        });
        mockDynamoDBUtil.put.mockResolvedValueOnce(undefined);

        await leadsService.createLead({
          campaign_id: campaign.id,
          campaign_key: "KEY123",
          payload: { email: "ok@real.com", phone },
        } as any);
      };

      await runWithPhone("");
      await runWithPhone("   ");

      const calls = mockLambdaInvokeUtil.invokeJson.mock.calls;
      expect(calls.length).toBe(2);
      for (const [arg] of calls) {
        expect(arg.payload).not.toHaveProperty("phone");
      }
    });

    it("omits phone from QA orchestrator payload when phone is null or a non-primitive object", async () => {
      mockConstants.QA_ORCHESTRATOR_LAMBDA_NAME = "qa-orchestrator";

      const runWithPhone = async (phone: unknown) => {
        const campaign = buildCampaign(
          CampaignStatus.ACTIVE,
          CampaignParticipantStatus.LIVE,
        );
        mockDynamoDBUtil.get.mockResolvedValueOnce(campaign);
        mockLambdaInvokeUtil.invokeJson.mockResolvedValueOnce({
          duplicate: false,
          duplicate_matches: { lead_ids: [] },
        });
        mockDynamoDBUtil.put.mockResolvedValueOnce(undefined);

        await leadsService.createLead({
          campaign_id: campaign.id,
          campaign_key: "KEY123",
          payload: { email: "ok@real.com", phone },
        } as any);
      };

      await runWithPhone(null);
      await runWithPhone({ foo: 1 });

      const calls = mockLambdaInvokeUtil.invokeJson.mock.calls;
      expect(calls.length).toBe(2);
      for (const [arg] of calls) {
        expect(arg.payload).not.toHaveProperty("phone");
      }
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
      expect(mockMetricsService.recordLeadOutcome).toHaveBeenCalledTimes(1);
      expect(mockMetricsService.recordLeadOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          rejected: true,
          sold: false,
        }),
      );
    });

    it("records accepted_not_sold transition when sold criteria fails", async () => {
      const campaign = {
        ...buildCampaign(CampaignStatus.ACTIVE, CampaignParticipantStatus.LIVE),
        affiliates: [
          {
            affiliate_id: "AF1",
            campaign_key: "KEY123",
            status: CampaignParticipantStatus.LIVE,
            sold_criteria: [
              {
                field: "state",
                operator: "is",
                value: "CA",
                action: "passed",
                enabled: true,
              },
            ],
          },
        ],
      };

      mockDynamoDBUtil.get.mockResolvedValueOnce(campaign);
      mockDynamoDBUtil.put.mockResolvedValueOnce(undefined);
      mockLeadDeliveryService.deliverLead.mockImplementationOnce(
        async (lead: any) => {
          lead.sold = true;
          lead.rejected = false;
        },
      );
      mockLeadDeliveryService.passesLogicRules.mockReturnValueOnce(false);

      const result = await leadsService.createLead({
        campaign_id: campaign.id,
        campaign_key: "KEY123",
        payload: { email: "lead@accepted-not-sold.com", state: "NY" },
      });

      expect(result.result).toBe("passed");
      expect(mockMetricsService.recordLeadOutcome).toHaveBeenCalledTimes(1);
      expect(mockMetricsService.recordLeadOutcome).toHaveBeenCalledWith(
        expect.objectContaining({
          rejected: false,
          sold: false,
        }),
      );
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

  describe("listLeads", () => {
    it("uses global created_at index path for unscoped list and returns exact total", async () => {
      mockDynamoDBUtil.query
        .mockResolvedValueOnce({
          items: [
            {
              id: "LD-3",
              created_at: "2026-05-03T00:00:00.000Z",
              campaign_id: "CM-3",
              payload: {},
            },
            {
              id: "LD-2",
              created_at: "2026-05-02T00:00:00.000Z",
              campaign_id: "CM-2",
              payload: {},
            },
          ],
          count: 2,
          lastEvaluatedKey: { id: "LD-2" },
        })
        .mockResolvedValueOnce({
          items: [],
          count: 3,
          lastEvaluatedKey: undefined,
        });

      const result = await leadsService.listLeads({ limit: 2 });

      expect(result.result).toBe(true);
      expect(mockDynamoDBUtil.query).toHaveBeenCalledWith(
        expect.objectContaining({
          IndexName: mockConstants.LEADS_GLOBAL_CREATED_AT_INDEX_NAME,
          KeyConditionExpression: "#entity_type = :entity_type",
          ScanIndexForward: false,
        }),
      );

      const firstCall = mockDynamoDBUtil.query.mock.calls[0][0];
      expect(firstCall.FilterExpression ?? "").not.toContain("#test = :test");
      expect(result.data?.items.map((item) => item.id)).toEqual([
        "LD-3",
        "LD-2",
      ]);
      expect(result.data?.count).toBe(2);
      expect(result.data?.nextToken).toBe(result.data?.lastEvaluatedKey);
      expect(result.data?.lastEvaluatedKey).toBeDefined();
      expect(result.data?.pagination).toEqual(
        expect.objectContaining({
          total: 3,
          totalCount: 3,
          totalKnown: true,
          sortField: "created_at",
          sortDirection: "desc",
          orderScope: "global",
        }),
      );
    });

    it("includes test leads by default and hides them when include_test=false", async () => {
      mockDynamoDBUtil.query
        .mockResolvedValueOnce({
          items: [
            {
              id: "LD-LIVE",
              test: false,
              created_at: "2026-05-10T00:00:00.000Z",
              campaign_id: "CM-1",
              payload: {},
            },
            {
              id: "LD-TEST",
              test: true,
              created_at: "2026-05-09T00:00:00.000Z",
              campaign_id: "CM-1",
              payload: {},
            },
          ],
          count: 2,
          lastEvaluatedKey: undefined,
        })
        .mockResolvedValueOnce({
          items: [],
          count: 2,
          lastEvaluatedKey: undefined,
        })
        .mockResolvedValueOnce({
          items: [
            {
              id: "LD-LIVE",
              test: false,
              created_at: "2026-05-10T00:00:00.000Z",
              campaign_id: "CM-1",
              payload: {},
            },
          ],
          count: 1,
          lastEvaluatedKey: undefined,
        })
        .mockResolvedValueOnce({
          items: [],
          count: 1,
          lastEvaluatedKey: undefined,
        });

      const defaultList = await leadsService.listLeads({ limit: 10 });
      const noTestList = await leadsService.listLeads({
        limit: 10,
        include_test: false,
      });

      expect(defaultList.result).toBe(true);
      expect(defaultList.data?.items.map((item) => item.id)).toEqual([
        "LD-LIVE",
        "LD-TEST",
      ]);

      expect(noTestList.result).toBe(true);
      expect(noTestList.data?.items.map((item) => item.id)).toEqual([
        "LD-LIVE",
      ]);

      const firstCall = mockDynamoDBUtil.query.mock.calls[0][0];
      const thirdCall = mockDynamoDBUtil.query.mock.calls[2][0];
      expect(firstCall.FilterExpression ?? "").not.toContain("#test = :test");
      expect(thirdCall.FilterExpression ?? "").toContain("#test = :test");
    });

    it("allows test-inclusive listing when include_test=true", async () => {
      mockDynamoDBUtil.query
        .mockResolvedValueOnce({
          items: [
            {
              id: "LD-9",
              created_at: "2026-05-09T00:00:00.000Z",
              campaign_id: "CM-9",
              payload: {},
            },
          ],
          count: 1,
          lastEvaluatedKey: undefined,
        })
        .mockResolvedValueOnce({
          items: [],
          count: 1,
          lastEvaluatedKey: undefined,
        });

      const result = await leadsService.listLeads({
        limit: 10,
        include_test: true,
      });

      expect(result.result).toBe(true);
      const firstCall = mockDynamoDBUtil.query.mock.calls[0][0];
      expect(firstCall.FilterExpression ?? "").not.toContain("#test = :test");
    });

    it("applies explicit non-test filter when include_test=false", async () => {
      mockDynamoDBUtil.query
        .mockResolvedValueOnce({
          items: [],
          count: 0,
          lastEvaluatedKey: undefined,
        })
        .mockResolvedValueOnce({
          items: [],
          count: 0,
          lastEvaluatedKey: undefined,
        });

      const result = await leadsService.listLeads({
        limit: 10,
        include_test: false,
      });

      expect(result.result).toBe(true);
      const firstCall = mockDynamoDBUtil.query.mock.calls[0][0];
      expect(firstCall.FilterExpression ?? "").toContain("#test = :test");
      expect(firstCall.ExpressionAttributeValues[":test"]).toBe(false);
    });

    it("uses legacy offset continuation token for backward compatibility", async () => {
      mockDynamoDBUtil.scanAll.mockResolvedValueOnce([
        {
          id: "LD-1",
          created_at: "2026-05-01T00:00:00.000Z",
          campaign_id: "CM-1",
          payload: {},
        },
        {
          id: "LD-3",
          created_at: "2026-05-03T00:00:00.000Z",
          campaign_id: "CM-3",
          payload: {},
        },
        {
          id: "LD-2",
          created_at: "2026-05-02T00:00:00.000Z",
          campaign_id: "CM-2",
          payload: {},
        },
      ]);

      const legacyToken = Buffer.from(
        JSON.stringify({ __kind: "offset", offset: 2 }),
      ).toString("base64");

      const pageTwo = await leadsService.listLeads({
        limit: 2,
        lastEvaluatedKey: legacyToken,
      });

      expect(pageTwo.result).toBe(true);
      expect(pageTwo.data?.items.map((item) => item.id)).toEqual(["LD-1"]);
      expect(pageTwo.data?.lastEvaluatedKey).toBeUndefined();
      expect(pageTwo.data?.pagination).toEqual(
        expect.objectContaining({
          orderScope: "global",
        }),
      );
    });

    it("keeps cursor traversal stable across different page sizes", async () => {
      mockDynamoDBUtil.query
        .mockResolvedValueOnce({
          items: [
            {
              id: "LD-4",
              created_at: "2026-05-04T00:00:00.000Z",
              campaign_id: "CM-4",
              payload: {},
            },
            {
              id: "LD-3",
              created_at: "2026-05-03T00:00:00.000Z",
              campaign_id: "CM-3",
              payload: {},
            },
          ],
          count: 2,
          lastEvaluatedKey: { id: "LD-3" },
        })
        .mockResolvedValueOnce({
          items: [],
          count: 4,
          lastEvaluatedKey: undefined,
        })
        .mockResolvedValueOnce({
          items: [
            {
              id: "LD-2",
              created_at: "2026-05-02T00:00:00.000Z",
              campaign_id: "CM-2",
              payload: {},
            },
          ],
          count: 1,
          lastEvaluatedKey: { id: "LD-2" },
        })
        .mockResolvedValueOnce({
          items: [],
          count: 4,
          lastEvaluatedKey: undefined,
        });

      const firstPage = await leadsService.listLeads({ limit: 2 });
      const secondPage = await leadsService.listLeads({
        limit: 1,
        lastEvaluatedKey: firstPage.data?.lastEvaluatedKey,
      });

      expect(firstPage.result).toBe(true);
      expect(firstPage.data?.items.map((item) => item.id)).toEqual([
        "LD-4",
        "LD-3",
      ]);
      expect(secondPage.result).toBe(true);
      expect(secondPage.data?.items.map((item) => item.id)).toEqual(["LD-2"]);
      const pageTwoReadCall = mockDynamoDBUtil.query.mock.calls[2][0];
      expect(pageTwoReadCall.ExclusiveStartKey).toEqual({ id: "LD-3" });
    });

    it("fails listLeads when global created_at index query is unavailable", async () => {
      mockDynamoDBUtil.query.mockRejectedValueOnce(
        new Error("missing global index"),
      );

      const result = await leadsService.listLeads({ limit: 1 });

      expect(result.result).toBe(false);
      expect(result.error).toContain("missing global index");
      expect(mockDynamoDBUtil.scan).not.toHaveBeenCalled();
    });

    it("uses campaign created_at index path and marks ordering scope as global", async () => {
      mockDynamoDBUtil.query
        .mockResolvedValueOnce({
          items: [
            {
              id: "LD-2",
              created_at: "2026-05-02T00:00:00.000Z",
              campaign_id: "CM-1",
              payload: {},
            },
            {
              id: "LD-1",
              created_at: "2026-05-01T00:00:00.000Z",
              campaign_id: "CM-1",
              payload: {},
            },
          ],
          count: 2,
          lastEvaluatedKey: undefined,
        })
        .mockResolvedValueOnce({
          items: [],
          count: 2,
          lastEvaluatedKey: undefined,
        });

      const result = await leadsService.listLeads({
        campaign_id: "CM-1",
        limit: 20,
      });

      expect(result.result).toBe(true);
      expect(mockDynamoDBUtil.query).toHaveBeenCalledWith(
        expect.objectContaining({
          IndexName: mockConstants.LEADS_CAMPAIGN_CREATED_AT_INDEX_NAME,
          ScanIndexForward: false,
        }),
      );
      expect(result.data?.pagination).toEqual(
        expect.objectContaining({
          total: 2,
          totalKnown: true,
          sortField: "created_at",
          sortDirection: "desc",
          orderScope: "global",
        }),
      );
    });
  });

  describe("listIntakeLogs", () => {
    it("defaults status=all to live-only (non-test) filter and exact total", async () => {
      mockConstants.LEAD_INTAKE_LOGS_TABLE_NAME = "test-intake-logs";

      mockDynamoDBUtil.query
        .mockResolvedValueOnce({
          items: [
            {
              id: "LG-2",
              campaign_id: "CM-1",
              received_at: "2026-05-02T00:00:00.000Z",
              status: "accepted",
            },
            {
              id: "LG-1",
              campaign_id: "CM-1",
              received_at: "2026-05-01T00:00:00.000Z",
              status: "rejected",
            },
          ],
          count: 2,
          lastEvaluatedKey: undefined,
        })
        .mockResolvedValueOnce({
          items: [],
          count: 4,
          lastEvaluatedKey: undefined,
        });

      const result = await leadsService.listIntakeLogs({
        campaign_id: "CM-1",
        status: "all",
        limit: 2,
      });

      expect(result.result).toBe(true);
      expect(result.data?.count).toBe(2);
      expect(result.data?.total).toBe(4);
      expect(result.data?.items.some((item) => item.status === "test")).toBe(
        false,
      );
      expect(result.data?.pagination).toEqual(
        expect.objectContaining({
          total: 4,
          totalKnown: true,
          orderScope: "global",
        }),
      );

      const countCall = mockDynamoDBUtil.query.mock.calls[1][0];
      expect(countCall.Select).toBe("COUNT");
      expect(countCall.FilterExpression).toContain("#is_test = :is_test");
    });

    it("includes test traffic when include_test=true", async () => {
      mockConstants.LEAD_INTAKE_LOGS_TABLE_NAME = "test-intake-logs";

      mockDynamoDBUtil.query
        .mockResolvedValueOnce({
          items: [
            {
              id: "LG-3",
              campaign_id: "CM-1",
              received_at: "2026-05-03T00:00:00.000Z",
              status: "test",
            },
          ],
          count: 1,
          lastEvaluatedKey: undefined,
        })
        .mockResolvedValueOnce({
          items: [],
          count: 3,
          lastEvaluatedKey: undefined,
        });

      const result = await leadsService.listIntakeLogs({
        campaign_id: "CM-1",
        status: "all",
        include_test: true,
        limit: 1,
      });

      expect(result.result).toBe(true);
      const countCall = mockDynamoDBUtil.query.mock.calls[1][0];
      expect(countCall.FilterExpression ?? "").not.toContain(
        "#is_test = :is_test",
      );
    });

    it("returns exact total for unscoped scan with filters", async () => {
      mockConstants.LEAD_INTAKE_LOGS_TABLE_NAME = "test-intake-logs";

      mockDynamoDBUtil.scan
        .mockResolvedValueOnce({
          items: [
            {
              id: "LG-2",
              received_at: "2026-05-02T00:00:00.000Z",
              status: "accepted",
            },
            {
              id: "LG-1",
              received_at: "2026-05-01T00:00:00.000Z",
              status: "accepted",
            },
          ],
          count: 2,
          lastEvaluatedKey: undefined,
        })
        .mockResolvedValueOnce({
          items: [],
          count: 5,
          lastEvaluatedKey: undefined,
        });

      const result = await leadsService.listIntakeLogs({
        status: "accepted",
        from_date: "2026-05-01T00:00:00.000Z",
        to_date: "2026-05-31T23:59:59.999Z",
        limit: 2,
      });

      expect(result.result).toBe(true);
      expect(result.data?.count).toBe(2);
      expect(result.data?.total).toBe(5);
      expect(result.data?.pagination).toEqual(
        expect.objectContaining({
          total: 5,
          totalKnown: true,
        }),
      );
      expect(mockDynamoDBUtil.scan).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          Select: "COUNT",
        }),
      );
    });
  });

  describe("metrics query methods", () => {
    it("returns validation error when date range is missing", async () => {
      const summary = await leadsService.getMetricsSummary({} as any);

      expect(summary.result).toBe(false);
      expect(summary.error).toContain("from_date and to_date are required");
    });

    it("returns summary shape from metrics service", async () => {
      mockMetricsService.getSummary.mockResolvedValueOnce({
        range: { from_date: "2026-05-01", to_date: "2026-05-02" },
        filters: {},
        totals: {
          received: 3,
          accepted: 2,
          sold: 1,
          accepted_not_sold: 1,
          rejected: 1,
        },
        peak_lead_window: {
          start: "2026-05-01T14:00:00.000Z",
          end: "2026-05-01T15:00:00.000Z",
          label: "14:00-15:00 UTC",
          received: 2,
          total_received: 3,
          share_percent: 67,
        },
      });

      const result = await leadsService.getMetricsSummary({
        from_date: "2026-05-01",
        to_date: "2026-05-02",
      });

      expect(result.result).toBe(true);
      expect(result.data?.totals.received).toBe(3);
    });

    it("resolves dashboard preset-only query server-side", async () => {
      mockMetricsService.getDashboard.mockResolvedValueOnce({
        range: { from_date: "2026-01-01", to_date: "2026-06-01" },
        filters: {},
        summary: {
          range: { from_date: "2026-01-01", to_date: "2026-06-01" },
          filters: {},
          totals: {
            received: 0,
            accepted: 0,
            sold: 0,
            accepted_not_sold: 0,
            rejected: 0,
            cherry_picked: 0,
            rejected_dnq: 0,
            rejected_spam: 0,
            rejected_duplicates: 0,
          },
          peak_lead_window: null,
        },
      });

      const result = await leadsService.getMetricsDashboard({
        time_preset: "year_to_date",
      });

      expect(result.result).toBe(true);
      expect(mockMetricsService.getDashboard).toHaveBeenCalledTimes(1);
      expect(mockMetricsService.getDashboard).toHaveBeenCalledWith(
        expect.objectContaining({
          from_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
          to_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        }),
      );
    });

    it("uses explicit from/to over preset when both are provided", async () => {
      mockMetricsService.getDashboard.mockResolvedValueOnce({
        range: { from_date: "2026-05-01", to_date: "2026-05-02" },
        filters: {},
        summary: {
          range: { from_date: "2026-05-01", to_date: "2026-05-02" },
          filters: {},
          totals: {
            received: 0,
            accepted: 0,
            sold: 0,
            accepted_not_sold: 0,
            rejected: 0,
            cherry_picked: 0,
            rejected_dnq: 0,
            rejected_spam: 0,
            rejected_duplicates: 0,
          },
          peak_lead_window: null,
        },
      });

      const result = await leadsService.getMetricsDashboard({
        from_date: "2026-05-01",
        to_date: "2026-05-02",
        time_preset: "last_30_days",
      });

      expect(result.result).toBe(true);
      expect(mockMetricsService.getDashboard).toHaveBeenCalledWith(
        expect.objectContaining({
          from_date: "2026-05-01",
          to_date: "2026-05-02",
        }),
      );
    });

    it("returns dashboard totals from metrics service unchanged", async () => {
      mockMetricsService.getDashboard.mockResolvedValueOnce({
        range: { from_date: "2026-05-01", to_date: "2026-05-02" },
        filters: {},
        summary: {
          range: { from_date: "2026-05-01", to_date: "2026-05-02" },
          filters: {},
          totals: {
            received: 10,
            accepted: 7,
            sold: 4,
            accepted_not_sold: 3,
            rejected: 3,
            cherry_picked: 1,
            rejected_dnq: 0,
            rejected_spam: 0,
            rejected_duplicates: 0,
          },
          peak_lead_window: null,
        },
      });

      const result = await leadsService.getMetricsDashboard({
        from_date: "2026-05-01",
        to_date: "2026-05-02",
      });

      expect(result.result).toBe(true);
      expect(result.data?.summary.totals).toEqual(
        expect.objectContaining({
          received: 10,
          accepted: 7,
          sold: 4,
          accepted_not_sold: 3,
          rejected: 3,
          cherry_picked: 1,
        }),
      );
      expect(mockDynamoDBUtil.scan).not.toHaveBeenCalled();
      expect(mockDynamoDBUtil.scanAll).not.toHaveBeenCalled();
    });

    it("keeps metrics service totals when scan-based totals would differ", async () => {
      mockMetricsService.getDashboard.mockResolvedValueOnce({
        range: { from_date: "2026-05-01", to_date: "2026-05-02" },
        filters: {},
        summary: {
          range: { from_date: "2026-05-01", to_date: "2026-05-02" },
          filters: {},
          totals: {
            received: 10,
            accepted: 7,
            sold: 4,
            accepted_not_sold: 3,
            rejected: 3,
            cherry_picked: 1,
            rejected_dnq: 0,
            rejected_spam: 0,
            rejected_duplicates: 0,
          },
          peak_lead_window: null,
        },
      });

      mockDynamoDBUtil.scanAll.mockResolvedValueOnce([
        {
          id: "LD-1",
          created_at: "2026-05-01T08:00:00.000Z",
          campaign_id: "CM-1",
          campaign_key: "KEY1",
          rejected: false,
          sold: false,
          test: false,
          payload: {},
        },
      ]);

      const result = await leadsService.getMetricsDashboard({
        from_date: "2026-05-01",
        to_date: "2026-05-02",
      });

      expect(result.result).toBe(true);
      expect(result.data?.summary.totals).toEqual(
        expect.objectContaining({
          received: 10,
          accepted: 7,
          sold: 4,
          accepted_not_sold: 3,
          rejected: 3,
          cherry_picked: 1,
        }),
      );
      expect(mockDynamoDBUtil.scanAll).not.toHaveBeenCalled();
    });

    it("returns clear validation error when dashboard omits both date range and preset", async () => {
      const result = await leadsService.getMetricsDashboard({});

      expect(result.result).toBe(false);
      expect(result.error).toContain("from_date and to_date are required");
      expect(mockMetricsService.getDashboard).not.toHaveBeenCalled();
    });
  });
});
