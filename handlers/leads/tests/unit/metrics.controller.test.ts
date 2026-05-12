import { describe, it, expect, beforeEach } from "vitest";
import { MetricsController } from "../../controllers/metrics.controller";

describe("MetricsController", () => {
  let service: any;
  let controller: MetricsController;

  beforeEach(() => {
    service = {
      getMetricsSummary: async () => ({ result: true, data: { totals: {} } }),
      getMetricsTimeseries: async () => ({ result: true, data: { points: [] } }),
      getMetricsBreakdown: async () => ({
        result: true,
        data: { campaigns: [], sources: [] },
      }),
      getMetricsContracts: async () => ({ result: true, data: { contracts: [] } }),
      getMetricsHealth: async () => ({ result: true, data: { status: "ok" } }),
    };
    controller = new MetricsController(service);
  });

  it("returns success envelope for summary", async () => {
    const response = await controller.summary("2026-05-01", "2026-05-02");

    expect(response).toEqual(
      expect.objectContaining({
        success: true,
        message: "Metrics summary retrieved successfully",
      }),
    );
    expect(response.data).toBeDefined();
  });

  it("returns failure envelope when service fails", async () => {
    service.getMetricsHealth = async () => ({
      result: false,
      error: "from_date and to_date are required (YYYY-MM-DD)",
    });

    const response = await controller.health(undefined, undefined);

    expect(response).toEqual(
      expect.objectContaining({
        success: false,
        message: "Failed to retrieve metrics health",
      }),
    );
    expect(response.error).toContain("from_date and to_date are required");
  });
});
