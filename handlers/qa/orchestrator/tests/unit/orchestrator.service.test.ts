import { beforeEach, describe, expect, it } from "vitest";
import { OrchestratorService } from "../../services/orchestrator.service";
import { getMockLambdaInvokeUtil, getTestContainer } from "../setup";

describe("OrchestratorService", () => {
  let service: OrchestratorService;
  let mockLambdaInvokeUtil: any;

  beforeEach(() => {
    const container = getTestContainer();
    container.bind("OrchestratorService").to(OrchestratorService);
    service = container.get<OrchestratorService>("OrchestratorService");
    mockLambdaInvokeUtil = getMockLambdaInvokeUtil();
  });

  it("returns default response when duplicate plugin disabled", async () => {
    const result = await service.execute({
      campaign_id: "CM1",
      plugins: {
        duplicate_check: {
          enabled: false,
          criteria: ["email"],
        },
      },
    });

    expect(result.result).toBe(true);
    expect(result.data?.duplicate).toBe(false);
    expect(mockLambdaInvokeUtil.invokeJson).not.toHaveBeenCalled();
  });

  it("invokes duplicate check and returns matched ids", async () => {
    mockLambdaInvokeUtil.invokeJson.mockResolvedValueOnce({
      duplicate: true,
      duplicate_matches: {
        lead_ids: ["LD1"],
      },
    });

    const result = await service.execute({
      campaign_id: "CM1",
      payload: { email: "a@a.com" },
      plugins: {
        duplicate_check: {
          enabled: true,
          criteria: ["email"],
        },
      },
    });

    expect(result.result).toBe(true);
    expect(result.data?.duplicate).toBe(true);
    expect(result.data?.duplicate_matches.lead_ids).toEqual(["LD1"]);
    expect(mockLambdaInvokeUtil.invokeJson).toHaveBeenCalledTimes(1);
  });
});
