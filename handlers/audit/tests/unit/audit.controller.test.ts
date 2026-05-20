import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuditController } from "../../controllers/audit.controller";

describe("AuditController status and correlation", () => {
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let controller: AuditController;
  let statusSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = {
      getAllRecords: vi.fn(),
      getActivityFeed: vi.fn(),
      getEntityHistory: vi.fn(),
      exportToS3: vi.fn(),
    };

    controller = new AuditController(service as never);
    statusSpy = vi.fn();

    (controller as any).request = {
      headers: {
        "x-correlation-id": "corr-audit-1",
      },
    };
    (controller as any).response = { status: statusSpy };
  });

  it("maps not-found history errors to 404", async () => {
    service.getEntityHistory.mockResolvedValue({
      result: false,
      error: "Audit entity not found",
    });

    const result = await controller.getEntityHistory("missing");

    expect(statusSpy).toHaveBeenCalledWith(404);
    expect(result.success).toBe(false);
    expect(result.correlation_id).toBe("corr-audit-1");
  });

  it("returns 400 for invalid export date", async () => {
    const result = await controller.triggerExport({
      date: "2026/05/01",
    } as never);

    expect(statusSpy).toHaveBeenCalledWith(400);
    expect(result.success).toBe(false);
    expect(result.error).toContain("YYYY-MM-DD");
    expect(result.correlation_id).toBe("corr-audit-1");
  });

  it("includes correlation_id on successful retrieval", async () => {
    service.getAllRecords.mockResolvedValue({
      result: true,
      data: { items: [], count: 0 },
    });

    const result = await controller.getAllRecords();

    expect(result.success).toBe(true);
    expect(result.correlation_id).toBe("corr-audit-1");
  });
});
