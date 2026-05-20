import { beforeEach, describe, expect, it, vi } from "vitest";
import { LeadsController } from "../../controllers/leads.controller";

describe("LeadsController status and correlation", () => {
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let controller: LeadsController;
  let statusSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = {
      listLeads: vi.fn(),
      getLead: vi.fn(),
      listIntakeLogs: vi.fn(),
      createLead: vi.fn(),
      updateLead: vi.fn(),
      deleteLead: vi.fn(),
    };

    controller = new LeadsController(service as never);
    statusSpy = vi.fn();

    (controller as any).request = {
      headers: {
        authorization: "Bearer header.payload.signature",
        "x-correlation-id": "corr-leads-1",
      },
    };
    (controller as any).response = { status: statusSpy };
  });

  it("maps lead-not-found to 404", async () => {
    service.getLead.mockResolvedValue({
      result: false,
      error: "Lead not found",
    });

    const result = await controller.getLead("LD-404");

    expect(statusSpy).toHaveBeenCalledWith(404);
    expect(result.success).toBe(false);
    expect(result.correlation_id).toBe("corr-leads-1");
  });

  it("returns 400 when listLeads fails validation", async () => {
    service.listLeads.mockResolvedValue({
      result: false,
      error: "from_date is required",
    });

    const result = await controller.listLeads();

    expect(statusSpy).toHaveBeenCalledWith(400);
    expect(result.success).toBe(false);
    expect(result.correlation_id).toBe("corr-leads-1");
  });

  it("attaches correlation_id to createLead service envelope", async () => {
    service.createLead.mockResolvedValue({
      result: "passed",
      message: "Lead accepted",
      data: { lead_id: "LD-1" },
    });

    const result = await controller.createLead({} as never);

    expect(result.correlation_id).toBe("corr-leads-1");
    expect(result.result).toBe("passed");
  });
});
