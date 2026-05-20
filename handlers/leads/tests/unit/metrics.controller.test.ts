import { describe, it, expect, beforeEach, vi } from "vitest";
import { MetricsController } from "../../controllers/metrics.controller";

describe("MetricsController", () => {
  let service: any;
  let controller: MetricsController;
  let statusSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = {
      getMetricsSummary: vi.fn(async () => ({
        result: true,
        data: { totals: {} },
      })),
      getMetricsTimeseries: vi.fn(async () => ({
        result: true,
        data: { points: [] },
      })),
      getMetricsBreakdown: vi.fn(async () => ({
        result: true,
        data: { campaigns: [], sources: [] },
      })),
      getMetricsContracts: vi.fn(async () => ({
        result: true,
        data: { contracts: [] },
      })),
      getMetricsHealth: vi.fn(async () => ({
        result: true,
        data: { status: "ok" },
      })),
    };
    controller = new MetricsController(service);
    statusSpy = vi.fn();

    (controller as any).request = {
      headers: {
        "x-correlation-id": "corr-metrics-1",
      },
    };
    (controller as any).response = { status: statusSpy };
  });

  it("returns success envelope for summary", async () => {
    const response = await controller.summary("2026-05-01", "2026-05-02");

    expect(response).toEqual(
      expect.objectContaining({
        success: true,
        message: "Metrics summary retrieved successfully",
        correlation_id: "corr-metrics-1",
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
        correlation_id: "corr-metrics-1",
      }),
    );
    expect(statusSpy).toHaveBeenCalledWith(400);
    expect(response.error).toContain("from_date and to_date are required");
  });

  it("passes campaign_key to breakdown service", async () => {
    await controller.breakdown("2026-05-01", "2026-05-02", "CM123", "KEY123");

    expect(service.getMetricsBreakdown).toHaveBeenCalledWith({
      from_date: "2026-05-01",
      to_date: "2026-05-02",
      campaign_id: "CM123",
      campaign_key: "KEY123",
    });
  });
});
