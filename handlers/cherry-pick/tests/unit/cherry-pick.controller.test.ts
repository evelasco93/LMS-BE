import { beforeEach, describe, expect, it, vi } from "vitest";
import { CherryPickController } from "../../controllers/cherry-pick.controller";

describe("CherryPickController status mapping", () => {
  let service: {
    listEligibleContracts: ReturnType<typeof vi.fn>;
    updatePickability: ReturnType<typeof vi.fn>;
    executeCherryPick: ReturnType<typeof vi.fn>;
  };
  let controller: CherryPickController;
  let statusSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = {
      listEligibleContracts: vi.fn(),
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

  it("listEligibleContracts returns 400 when lead_id is missing", async () => {
    const result = await controller.listEligibleContracts(undefined);
    expect(statusSpy).toHaveBeenCalledWith(400);
    expect(result.success).toBe(false);
    expect(service.listEligibleContracts).not.toHaveBeenCalled();
  });

  it("listEligibleContracts forwards the lead_id and returns service data on success", async () => {
    service.listEligibleContracts.mockResolvedValue({
      result: true,
      data: { contracts: [] },
    });

    const result = await controller.listEligibleContracts("LD-XC-1");

    expect(service.listEligibleContracts).toHaveBeenCalledWith("LD-XC-1");
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ contracts: [] });
  });

  it("executeCherryPick accepts target_contract_id and returns 400 when neither id is provided", async () => {
    const result = await controller.executeCherryPick("LD1", {} as never);
    expect(statusSpy).toHaveBeenCalledWith(400);
    expect(result.success).toBe(false);

    service.executeCherryPick.mockResolvedValue({
      result: true,
      data: { target_contract_id: "CT1" },
    });
    const ok = await controller.executeCherryPick("LD1", {
      target_contract_id: "CT1",
    });
    expect(ok.success).toBe(true);
    expect(service.executeCherryPick).toHaveBeenCalledWith(
      "LD1",
      { target_contract_id: "CT1" },
      undefined,
    );
  });
});
