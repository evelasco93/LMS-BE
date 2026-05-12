import { describe, it, expect, beforeEach, vi } from "vitest";
import { AffiliateService } from "../../services/affiliate.service";
import { CreateAffiliateRequest } from "../../types/affiliate-request.types";
import { AffiliateStatus } from "../../enums/affiliate-status.enum";
import { getTestContainer, getMockDynamoDBUtil } from "../setup";
import { mockAffiliate } from "../fixtures/affiliate.fixtures";

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
        company: "Test Company",
        notes: "Top performer",
        affiliate_code: "AFF-001",
      };

      mockDynamoDBUtil.put.mockResolvedValueOnce(undefined);

      const result = await affiliateService.createAffiliate(request);

      expect(result.result).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.name).toBe(request.name);
      expect(result.data?.company).toBe(request.company);
      expect(result.data?.notes).toBe(request.notes);
      expect(result.data?.affiliate_code).toBe(request.affiliate_code);
      expect(result.data?.status).toBe(AffiliateStatus.ACTIVE);
      expect(result.data?.id).toMatch(/^AF[A-Z0-9]{8}$/);
      expect(mockDynamoDBUtil.put).toHaveBeenCalledTimes(1);
    });

    it("should return error if persistence fails", async () => {
      const request: CreateAffiliateRequest = {
        name: "Test Affiliate",
        company: "Test Company",
        notes: "Test",
      };

      mockDynamoDBUtil.put.mockRejectedValueOnce(new Error("dynamo fail"));

      const result = await affiliateService.createAffiliate(request);

      expect(result.result).toBe(false);
      expect(result.error).toContain("dynamo fail");
      expect(mockDynamoDBUtil.put).toHaveBeenCalledTimes(1);
    });

    it("rejects extra fields", async () => {
      const result = await affiliateService.createAffiliate({
        name: "Bad Affiliate",
        email: "bad@example.com",
        company: "Bad Co",
        phone: "555",
        extra: "nope",
      } as any);

      expect(result.result).toBe(false);
      expect(result.error).toContain("Invalid fields");
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

    it("returns false result when query throws", async () => {
      mockDynamoDBUtil.query.mockRejectedValueOnce(new Error("boom"));

      const result =
        await affiliateService.getAffiliateByEmail("error@example.com");

      expect(result.result).toBe(false);
      expect(result.error).toContain("boom");
    });
  });

  describe("listAffiliates", () => {
    it("lists by status with pagination token", async () => {
      mockDynamoDBUtil.query.mockResolvedValueOnce({
        items: [mockAffiliate],
        lastEvaluatedKey: { id: "AF1" },
        count: 1,
      });

      const result = await affiliateService.listAffiliates({
        status: AffiliateStatus.ACTIVE,
        limit: 10,
        lastEvaluatedKey: Buffer.from(JSON.stringify({ id: "AF0" })).toString(
          "base64",
        ),
      });

      expect(result.result).toBe(true);
      expect(result.data?.items).toHaveLength(1);
      expect(result.data?.lastEvaluatedKey).toBeTruthy();
      expect(mockDynamoDBUtil.query).toHaveBeenCalled();
    });

    it("scans when no status is provided", async () => {
      mockDynamoDBUtil.scan.mockResolvedValueOnce({
        items: [mockAffiliate],
        lastEvaluatedKey: undefined,
        count: 1,
      });

      const result = await affiliateService.listAffiliates({ limit: 5 });

      expect(result.result).toBe(true);
      expect(result.data?.items).toHaveLength(1);
      expect(mockDynamoDBUtil.scan).toHaveBeenCalled();
    });

    it("handles list errors", async () => {
      mockDynamoDBUtil.scan.mockRejectedValueOnce(new Error("scan fail"));

      const result = await affiliateService.listAffiliates();

      expect(result.result).toBe(false);
      expect(result.error).toContain("scan fail");
    });
  });

  describe("updateAffiliate", () => {
    it("updates affiliate when valid", async () => {
      const spyGet = vi
        .spyOn(affiliateService as any, "getAffiliate")
        .mockResolvedValue({ result: true, data: mockAffiliate });
      mockDynamoDBUtil.put.mockResolvedValueOnce(undefined);

      const result = await affiliateService.updateAffiliate("AF1", {
        name: "Updated",
      });

      expect(result.result).toBe(true);
      expect(result.data?.name).toBe("Updated");
      expect(spyGet).toHaveBeenCalled();
      expect(mockDynamoDBUtil.put).toHaveBeenCalled();
    });

    it("updates affiliate code when provided", async () => {
      vi.spyOn(affiliateService as any, "getAffiliate").mockResolvedValue({
        result: true,
        data: mockAffiliate,
      });
      mockDynamoDBUtil.put.mockResolvedValueOnce(undefined);

      const result = await affiliateService.updateAffiliate("AF1", {
        affiliate_code: "AFF-999",
      });

      expect(result.result).toBe(true);
      expect(result.data?.affiliate_code).toBe("AFF-999");
      expect(mockDynamoDBUtil.put).toHaveBeenCalled();
    });

    it("rejects when affiliate missing", async () => {
      vi.spyOn(affiliateService as any, "getAffiliate").mockResolvedValue({
        result: false,
      });

      const result = await affiliateService.updateAffiliate("AF404", {
        name: "Nope",
      });

      expect(result.result).toBe(false);
      expect(result.error).toContain("not found");
      expect(mockDynamoDBUtil.update).not.toHaveBeenCalled();
    });
  });

  describe("deleteAffiliate", () => {
    it("deletes when found", async () => {
      vi.spyOn(affiliateService as any, "getAffiliate").mockResolvedValue({
        result: true,
        data: mockAffiliate,
      });
      mockDynamoDBUtil.scan.mockResolvedValue({ items: [], count: 0 });
      mockDynamoDBUtil.buildUpdateExpression.mockReturnValue({
        UpdateExpression: "set #is_deleted = :is_deleted",
        ExpressionAttributeNames: { "#is_deleted": "is_deleted" },
        ExpressionAttributeValues: { ":is_deleted": true },
      });
      mockDynamoDBUtil.update.mockResolvedValueOnce(undefined);

      const result = await affiliateService.deleteAffiliate("AF1");

      expect(result.result).toBe(true);
      expect(mockDynamoDBUtil.update).toHaveBeenCalled();
    });

    it("returns error when missing", async () => {
      vi.spyOn(affiliateService as any, "getAffiliate").mockResolvedValue({
        result: false,
      });

      const result = await affiliateService.deleteAffiliate("AF404");

      expect(result.result).toBe(false);
      expect(result.error).toContain("not found");
      expect(mockDynamoDBUtil.update).not.toHaveBeenCalled();
    });
  });
});
