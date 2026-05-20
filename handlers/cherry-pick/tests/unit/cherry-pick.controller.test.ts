import { beforeEach, describe, expect, it, vi } from "vitest";
import { CherryPickController } from "../../controllers/cherry-pick.controller";

describe("CherryPickController status mapping", () => {
  let service: {
    listEligibleClients: ReturnType<typeof vi.fn>;
    updatePickability: ReturnType<typeof vi.fn>;
    executeCherryPick: ReturnType<typeof vi.fn>;
  };
  let controller: CherryPickController;
  let statusSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = {
      listEligibleClients: vi.fn(),
      updatePickability: vi.fn(),
      executeCherryPick: vi.fn(),
    };

    controller = new CherryPickController(service as never);
    statusSpy = vi.fn();

    (controller as any).request = {
      headers: {
        "x-correlation-id": "corr-cherry-1",
      },
    };
    (controller as any).response = { status: statusSpy };
  });

  it("returns 400 when lead_id is missing", async () => {
    const result = await controller.listEligibleClients(undefined);

    expect(statusSpy).toHaveBeenCalledWith(400);
    expect(result.success).toBe(false);
    expect(result.correlation_id).toBe("corr-cherry-1");
  });

  it("maps not-found service errors to 404", async () => {
    service.listEligibleClients.mockResolvedValue({
      result: false,
      error: "Lead LD404 not found",
    });

    const result = await controller.listEligibleClients("LD404");

    expect(statusSpy).toHaveBeenCalledWith(404);
    expect(result.success).toBe(false);
    expect(result.correlation_id).toBe("corr-cherry-1");
  });

  it("returns 400 when execute payload is invalid", async () => {
    const result = await controller.executeCherryPick("LD1", {} as never);

    expect(statusSpy).toHaveBeenCalledWith(400);
    expect(result.success).toBe(false);
    expect(result.correlation_id).toBe("corr-cherry-1");
  });

  it("maps duplicate cherry-pick to 409", async () => {
    service.executeCherryPick.mockResolvedValue({
      result: false,
      error: "Lead LD1 has already been cherry-picked",
    });

    const result = await controller.executeCherryPick("LD1", {
      target_client_id: "CLT1",
    });

    expect(statusSpy).toHaveBeenCalledWith(409);
    expect(result.success).toBe(false);
    expect(result.correlation_id).toBe("corr-cherry-1");
  });
});
