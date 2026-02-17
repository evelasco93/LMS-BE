import { describe, it, expect, beforeEach } from "vitest";
import { AffiliateService } from "../../services/affiliate.service";
import { CreateAffiliateRequest } from "../../types/affiliate-request.types";
import { AffiliateStatus } from "../../enums/affiliate-status.enum";
import { getTestContainer, getMockDynamoDBUtil } from "../setup";
import {
  mockAffiliate,
  mockExistingAffiliate,
} from "../fixtures/affiliate.fixtures";

describe("AffiliateService", () => {
  let affiliateService: AffiliateService;
  let mockDynamoDBUtil: any;

  beforeEach(() => {
    const container = getTestContainer();
    container.bind("AffiliateService").to(AffiliateService);
    affiliateService = container.get<AffiliateService>("AffiliateService");
    mockDynamoDBUtil = getMockDynamoDBUtil();
  });

  describe("createAffiliate", () => {
    it("should create a new affiliate successfully", async () => {
      const request: CreateAffiliateRequest = {
        name: "Test Affiliate",
        email: "test@affiliate.com",
        company: "Test Company",
        phone: "555-0000",
      };

      mockDynamoDBUtil.query.mockResolvedValueOnce({
        items: [],
        count: 0,
      });

      mockDynamoDBUtil.put.mockResolvedValueOnce(undefined);

      const result = await affiliateService.createAffiliate(request);

      expect(result.result).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.name).toBe(request.name);
      expect(result.data?.email).toBe(request.email);
      expect(result.data?.company).toBe(request.company);
      expect(result.data?.status).toBe(AffiliateStatus.TEST);
      expect(result.data?.id).toMatch(/^AF[A-Z0-9]{8}$/);
      expect(mockDynamoDBUtil.put).toHaveBeenCalledTimes(1);
    });

    it("should return error if email already exists", async () => {
      const request: CreateAffiliateRequest = {
        name: "Test Affiliate",
        email: "existing@affiliate.com",
        company: "Test Company",
        phone: "555-0000",
      };

      mockDynamoDBUtil.query.mockResolvedValueOnce({
        items: [mockExistingAffiliate],
        count: 1,
      });

      const result = await affiliateService.createAffiliate(request);

      expect(result.result).toBe(false);
      expect(result.error).toContain("already exists");
      expect(mockDynamoDBUtil.put).not.toHaveBeenCalled();
    });
  });

  describe("getAffiliate", () => {
    it("should retrieve an affiliate by ID", async () => {
      mockDynamoDBUtil.get.mockResolvedValueOnce(mockAffiliate);

      const result = await affiliateService.getAffiliate("AFABCDEFGHIJ");

      expect(result.result).toBe(true);
      expect(result.data).toEqual(mockAffiliate);
      expect(mockDynamoDBUtil.get).toHaveBeenCalledWith({
        TableName: "test-affiliates-table",
        Key: { id: "AFABCDEFGHIJ" },
      });
    });

    it("should return error result if affiliate not found", async () => {
      mockDynamoDBUtil.get.mockResolvedValueOnce(null);

      const result = await affiliateService.getAffiliate("AFZZZZZZZZZZ");

      expect(result.result).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("getAffiliateByEmail", () => {
    it("should retrieve an affiliate by email", async () => {
      mockDynamoDBUtil.query.mockResolvedValueOnce({
        items: [mockAffiliate],
        count: 1,
      });

      const result =
        await affiliateService.getAffiliateByEmail("test@affiliate.com");

      expect(result.result).toBe(true);
      expect(result.data).toEqual(mockAffiliate);
    });

    it("should return error if affiliate email not found", async () => {
      mockDynamoDBUtil.query.mockResolvedValueOnce({
        items: [],
        count: 0,
      });

      const result = await affiliateService.getAffiliateByEmail(
        "nonexistent@affiliate.com",
      );

      expect(result.result).toBe(false);
      expect(result.data).toBeUndefined();
    });
  });
});
