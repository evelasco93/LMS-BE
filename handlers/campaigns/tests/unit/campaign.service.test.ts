import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { CampaignService } from "../../services/campaign.service";
import { CampaignStatus } from "../../enums/campaign-status.enum";
import { CampaignParticipantStatus } from "../../enums/campaign-participant-status.enum";
import {
  CreateCampaignRequest,
  LinkAffiliateRequest,
  LinkClientRequest,
  UpdateCampaignStatusRequest,
  UpdateParticipantStatusRequest,
} from "../../types/campaign-request.types";
import { getTestContainer, getMockDynamoDBUtil } from "../setup";
import {
  mockCampaign,
  emptyCampaign,
  campaignWithAffiliate,
} from "../fixtures/campaign.fixtures";
import { IdGenerator } from "@shared/generators/id.generator";

describe("CampaignService", () => {
  let campaignService: CampaignService;
  let mockDynamoDBUtil: any;

  beforeEach(() => {
    const container = getTestContainer();
    container.bind("CampaignService").to(CampaignService);
    campaignService = container.get<CampaignService>("CampaignService");
    mockDynamoDBUtil = getMockDynamoDBUtil();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("createCampaign", () => {
    it("creates a campaign with default DRAFT status and history", async () => {
      mockDynamoDBUtil.put.mockResolvedValueOnce(undefined);

      const request: CreateCampaignRequest = { name: "New Campaign" };

      const result = await campaignService.createCampaign(request);

      expect(result.result).toBe(true);
      expect(result.data?.name).toBe(request.name);
      expect(result.data?.status).toBe(CampaignStatus.DRAFT);
      expect(result.data?.id).toMatch(/^CM[A-Z0-9]{8}$/);
      expect(result.data?.status_history).toHaveLength(1);
      expect(result.data?.status_history[0]).toMatchObject({
        from: null,
        to: CampaignStatus.DRAFT,
      });
      expect(mockDynamoDBUtil.put).toHaveBeenCalledTimes(1);
    });

    it("rejects payloads with extra fields", async () => {
      const request = {
        name: "New Campaign",
        extra: "oops",
      } as unknown as CreateCampaignRequest;

      const result = await campaignService.createCampaign(request);

      expect(result.result).toBe(false);
      expect(result.error).toContain("Invalid fields");
      expect(mockDynamoDBUtil.put).not.toHaveBeenCalled();
    });
  });

  describe("linkClient", () => {
    it("adds a client when not already linked and defaults status to TEST", async () => {
      const campaign = { ...emptyCampaign, clients: [], affiliates: [] };

      mockDynamoDBUtil.get.mockResolvedValueOnce(campaign);
      mockDynamoDBUtil.put.mockResolvedValueOnce(undefined);

      const payload: LinkClientRequest = { client_id: "CL999" };
      const result = await campaignService.linkClient(campaign.id, payload);

      expect(result.result).toBe(true);
      expect(result.data?.clients).toContainEqual({
        client_id: "CL999",
        status: CampaignParticipantStatus.TEST,
        added_at: expect.any(String),
      });
      expect(mockDynamoDBUtil.put).toHaveBeenCalledTimes(1);
    });

    it("updates status when client already linked", async () => {
      const campaign = {
        ...mockCampaign,
        clients: [
          { client_id: "CL123", status: CampaignParticipantStatus.TEST },
        ],
      };

      mockDynamoDBUtil.get.mockResolvedValueOnce(campaign);
      mockDynamoDBUtil.put.mockResolvedValueOnce(undefined);

      const payload: LinkClientRequest = {
        client_id: "CL123",
      };
      const result = await campaignService.linkClient(campaign.id, payload);

      expect(result.result).toBe(true);
      expect(result.data?.clients).toEqual([
        {
          client_id: "CL123",
          status: CampaignParticipantStatus.TEST,
          added_at: expect.any(String),
        },
      ]);
      expect(mockDynamoDBUtil.put).toHaveBeenCalledTimes(1);
    });
  });

  describe("linkAffiliate", () => {
    it("generates a campaign key and defaults status to TEST", async () => {
      const campaign = { ...emptyCampaign, affiliates: [], clients: [] };

      mockDynamoDBUtil.get.mockResolvedValueOnce(campaign);
      mockDynamoDBUtil.put.mockResolvedValueOnce(undefined);
      vi.spyOn(IdGenerator, "generateCampaignKey").mockReturnValue(
        "123456789012",
      );

      const payload: LinkAffiliateRequest = { affiliate_id: "AF555" };
      const result = await campaignService.linkAffiliate(campaign.id, payload);

      expect(result.result).toBe(true);
      expect(result.data?.campaign.affiliates).toContainEqual({
        affiliate_id: "AF555",
        campaign_key: "123456789012",
        status: CampaignParticipantStatus.TEST,
        added_at: expect.any(String),
      });
      expect(result.data?.campaign_key).toBe("123456789012");
      expect(mockDynamoDBUtil.put).toHaveBeenCalledTimes(1);
    });

    it("updates status when affiliate already linked", async () => {
      const campaign = {
        ...campaignWithAffiliate,
        affiliates: [
          {
            affiliate_id: "AF777",
            campaign_key: "777777777777",
            status: CampaignParticipantStatus.TEST,
          },
        ],
      };

      mockDynamoDBUtil.get.mockResolvedValueOnce(campaign);
      mockDynamoDBUtil.put.mockResolvedValueOnce(undefined);

      const payload: LinkAffiliateRequest = {
        affiliate_id: "AF777",
      };
      const result = await campaignService.linkAffiliate(campaign.id, payload);

      expect(result.result).toBe(true);
      expect(result.data?.campaign.affiliates).toContainEqual({
        affiliate_id: "AF777",
        campaign_key: "777777777777",
        status: CampaignParticipantStatus.TEST,
        added_at: expect.any(String),
      });
      expect(mockDynamoDBUtil.put).toHaveBeenCalledTimes(1);
    });
  });

  describe("update/delete participants", () => {
    it("updates affiliate status", async () => {
      mockDynamoDBUtil.get.mockResolvedValueOnce({
        ...mockCampaign,
        affiliates: [
          {
            affiliate_id: "AF123",
            campaign_key: "CK",
            status: CampaignParticipantStatus.TEST,
            added_at: "t0",
          },
        ],
      });
      mockDynamoDBUtil.put.mockResolvedValueOnce(undefined);

      const payload: UpdateParticipantStatusRequest = {
        status: CampaignParticipantStatus.LIVE,
      };

      const result = await campaignService.updateAffiliateStatus(
        mockCampaign.id,
        "AF123",
        payload,
      );

      expect(result.result).toBe(true);
      expect(result.data?.affiliates[0].status).toBe(
        CampaignParticipantStatus.LIVE,
      );
      expect(result.data?.affiliates[0].added_at).toBe("t0");
    });

    it("deletes client from campaign", async () => {
      mockDynamoDBUtil.get.mockResolvedValueOnce({
        ...mockCampaign,
        clients: [
          { client_id: "CL1", status: CampaignParticipantStatus.LIVE },
          { client_id: "CL2", status: CampaignParticipantStatus.LIVE },
        ],
      });
      mockDynamoDBUtil.put.mockResolvedValueOnce(undefined);

      const result = await campaignService.deleteClient(mockCampaign.id, "CL1");

      expect(result.result).toBe(true);
      expect(result.data?.clients).toEqual([
        {
          client_id: "CL2",
          status: CampaignParticipantStatus.LIVE,
          added_at: expect.any(String),
        },
      ]);
    });
  });

  describe("updatePlugins", () => {
    it("updates duplicate_check config", async () => {
      mockDynamoDBUtil.get.mockResolvedValueOnce({
        ...emptyCampaign,
      });
      mockDynamoDBUtil.put.mockResolvedValueOnce(undefined);

      const result = await campaignService.updatePlugins(emptyCampaign.id, {
        duplicate_check: {
          enabled: false,
          criteria: ["email"],
        },
      });

      expect(result.result).toBe(true);
      expect(result.data?.plugins.duplicate_check.enabled).toBe(false);
      expect(result.data?.plugins.duplicate_check.criteria).toEqual(["email"]);
      expect(mockDynamoDBUtil.put).toHaveBeenCalledTimes(1);
    });

    it("rejects unsupported duplicate criteria", async () => {
      mockDynamoDBUtil.get.mockResolvedValueOnce({
        ...emptyCampaign,
      });

      const result = await campaignService.updatePlugins(emptyCampaign.id, {
        duplicate_check: {
          criteria: ["name"] as any,
        },
      });

      expect(result.result).toBe(false);
      expect(result.error).toContain("Invalid duplicate_check.criteria");
      expect(mockDynamoDBUtil.put).not.toHaveBeenCalled();
    });

    it("rejects enabling duplicate_check with no criteria selected", async () => {
      mockDynamoDBUtil.get.mockResolvedValueOnce({
        ...emptyCampaign,
      });

      const result = await campaignService.updatePlugins(emptyCampaign.id, {
        duplicate_check: {
          enabled: true,
          criteria: [] as any,
        },
      });

      expect(result.result).toBe(false);
      expect(result.error).toContain(
        "duplicate_check.criteria must be a non-empty array of strings",
      );
      expect(mockDynamoDBUtil.put).not.toHaveBeenCalled();
    });
  });

  describe("updateStatus", () => {
    it("requires both a client and affiliate before moving to TEST", async () => {
      const campaign = { ...emptyCampaign, clients: [], affiliates: [] };
      mockDynamoDBUtil.get.mockResolvedValueOnce(campaign);

      const payload: UpdateCampaignStatusRequest = {
        status: CampaignStatus.TEST,
      };

      const result = await campaignService.updateStatus(campaign.id, payload);

      expect(result.result).toBe(false);
      expect(result.error).toContain("Add at least one client and affiliate");
      expect(mockDynamoDBUtil.put).not.toHaveBeenCalled();
    });

    it("blocks ACTIVE when participants remain TEST", async () => {
      const campaign = {
        ...mockCampaign,
        status: CampaignStatus.TEST,
        clients: [
          { client_id: "CL123", status: CampaignParticipantStatus.TEST },
        ],
        affiliates: [
          {
            affiliate_id: "AF123",
            campaign_key: "111111111111",
            status: CampaignParticipantStatus.TEST,
          },
        ],
      };
      mockDynamoDBUtil.get.mockResolvedValueOnce(campaign);

      const payload: UpdateCampaignStatusRequest = {
        status: CampaignStatus.ACTIVE,
      };

      const result = await campaignService.updateStatus(campaign.id, payload);

      expect(result.result).toBe(false);
      expect(result.error).toContain("LIVE");
      expect(mockDynamoDBUtil.put).not.toHaveBeenCalled();
    });

    it("requires at least one LIVE client and affiliate before going ACTIVE", async () => {
      const campaign = {
        ...mockCampaign,
        status: CampaignStatus.TEST,
        clients: [
          {
            client_id: "CL123",
            status: CampaignParticipantStatus.DISABLED,
          },
        ],
        affiliates: [
          {
            affiliate_id: "AF123",
            campaign_key: "111111111111",
            status: CampaignParticipantStatus.DISABLED,
          },
        ],
      };
      mockDynamoDBUtil.get.mockResolvedValueOnce(campaign);

      const payload: UpdateCampaignStatusRequest = {
        status: CampaignStatus.ACTIVE,
      };

      const result = await campaignService.updateStatus(campaign.id, payload);

      expect(result.result).toBe(false);
      expect(result.error).toContain(
        "At least one LIVE client and one LIVE affiliate",
      );
      expect(mockDynamoDBUtil.put).not.toHaveBeenCalled();
    });

    it("updates status with history when valid", async () => {
      const campaign = {
        ...mockCampaign,
        status: CampaignStatus.TEST,
        clients: [
          { client_id: "CL123", status: CampaignParticipantStatus.LIVE },
        ],
        affiliates: [
          {
            affiliate_id: "AF123",
            campaign_key: "111111111111",
            status: CampaignParticipantStatus.LIVE,
          },
        ],
        status_history: [
          { from: null, to: CampaignStatus.DRAFT, changed_at: "t0" },
          {
            from: CampaignStatus.DRAFT,
            to: CampaignStatus.TEST,
            changed_at: "t1",
          },
        ],
      };
      mockDynamoDBUtil.get.mockResolvedValueOnce(campaign);
      mockDynamoDBUtil.put.mockResolvedValueOnce(undefined);

      const payload: UpdateCampaignStatusRequest = {
        status: CampaignStatus.ACTIVE,
      };

      const result = await campaignService.updateStatus(campaign.id, payload);

      expect(result.result).toBe(true);
      expect(result.data?.status).toBe(CampaignStatus.ACTIVE);
      expect(result.data?.status_history).toHaveLength(3);
      expect(result.data?.status_history[2]).toMatchObject({
        from: CampaignStatus.TEST,
        to: CampaignStatus.ACTIVE,
      });
      expect(mockDynamoDBUtil.put).toHaveBeenCalledTimes(1);
    });
  });
});
