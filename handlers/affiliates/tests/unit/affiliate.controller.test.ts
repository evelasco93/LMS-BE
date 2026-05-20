import { beforeEach, describe, expect, it, vi } from "vitest";
import { AffiliateController } from "../../controllers/affiliate.controller";

describe("AffiliateController status mapping", () => {
  let service: {
    createAffiliate: ReturnType<typeof vi.fn>;
    getAffiliate: ReturnType<typeof vi.fn>;
    listAffiliates: ReturnType<typeof vi.fn>;
    updateAffiliate: ReturnType<typeof vi.fn>;
    deleteAffiliate: ReturnType<typeof vi.fn>;
  };
  let controller: AffiliateController;
  let statusSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = {
      createAffiliate: vi.fn(),
      getAffiliate: vi.fn(),
      listAffiliates: vi.fn(),
      updateAffiliate: vi.fn(),
      deleteAffiliate: vi.fn(),
    };

    controller = new AffiliateController(service as never);
    statusSpy = vi.fn();

    (controller as any).request = {
      headers: {
        "x-correlation-id": "corr-affiliates-1",
      },
    };
    (controller as any).response = { status: statusSpy };
  });

  it("sets 201 when create succeeds", async () => {
    service.createAffiliate.mockResolvedValue({
      result: true,
      data: { id: "AFF123" },
    });

    const result = await controller.createAffiliate({} as never);

    expect(statusSpy).toHaveBeenCalledWith(201);
    expect(result.success).toBe(true);
    expect(result.correlation_id).toBe("corr-affiliates-1");
  });

  it("sets 404 when get returns not found", async () => {
    service.getAffiliate.mockResolvedValue({
      result: false,
      error: "Affiliate with id AFF999 not found",
    });

    const result = await controller.getAffiliate("AFF999");

    expect(statusSpy).toHaveBeenCalledWith(404);
    expect(result.success).toBe(false);
    expect(result.message).toBe("Affiliate not found");
    expect(result.correlation_id).toBe("corr-affiliates-1");
  });

  it("sets 409 on delete conflict errors", async () => {
    service.deleteAffiliate.mockResolvedValue({
      result: false,
      error: "Cannot hard delete affiliate while linked to campaigns",
    });

    const result = await controller.deleteAffiliate("AFF100", "true");

    expect(statusSpy).toHaveBeenCalledWith(409);
    expect(result.success).toBe(false);
    expect(result.message).toBe("Failed to delete affiliate");
    expect(result.correlation_id).toBe("corr-affiliates-1");
  });

  it("uses 500 fallback for list failures", async () => {
    service.listAffiliates.mockResolvedValue({
      result: false,
      error: "Unexpected storage issue",
    });

    const result = await controller.listAffiliates();

    expect(statusSpy).toHaveBeenCalledWith(500);
    expect(result.success).toBe(false);
    expect(result.correlation_id).toBe("corr-affiliates-1");
  });
});
