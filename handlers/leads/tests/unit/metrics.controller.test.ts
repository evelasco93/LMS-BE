import { describe, it, expect, beforeEach, vi } from "vitest";
import { MetricsController } from "../../controllers/metrics.controller";

describe("MetricsController", () => {
  let service: any;
  let controller: MetricsController;
  let statusSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = {
      getMetricsDashboard: vi.fn(async () => ({
        result: true,
        data: {
          summary: {
            totals: {},
            peak_lead_window: {
              start: "2026-05-01T14:00:00.000Z",
              end: "2026-05-01T15:00:00.000Z",
              label: "14:00-15:00 UTC",
              received: 8,
              total_received: 16,
              share_percent: 50,
            },
          },
        },
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

  it("returns success envelope for dashboard", async () => {
    const response = await controller.dashboard("2026-05-01", "2026-05-02");

    expect(response).toEqual(
      expect.objectContaining({
        success: true,
        message: "Metrics dashboard retrieved successfully",
        correlation_id: "corr-metrics-1",
      }),
    );
    expect(response.data).toBeDefined();
    expect(response.data.summary.peak_lead_window?.label).toBe(
      "14:00-15:00 UTC",
    );
  });

  it("returns failure envelope when service fails", async () => {
    service.getMetricsDashboard = async () => ({
      result: false,
      error: "from_date and to_date are required (YYYY-MM-DD)",
    });

    const response = await controller.dashboard(undefined, undefined);

    expect(response).toEqual(
      expect.objectContaining({
        success: false,
        message: "Failed to retrieve metrics dashboard",
        correlation_id: "corr-metrics-1",
      }),
    );
    expect(statusSpy).toHaveBeenCalledWith(400);
    expect(response.error).toContain("from_date and to_date are required");
  });

  it("passes filters to dashboard service", async () => {
    await controller.dashboard(
      "2026-05-01",
      "2026-05-02",
      undefined,
      "CM123",
      "KEY123",
      "AF123",
    );

    expect(service.getMetricsDashboard).toHaveBeenCalledWith({
      from_date: "2026-05-01",
      to_date: "2026-05-02",
      time_preset: undefined,
      campaign_id: "CM123",
      campaign_key: "KEY123",
      affiliate_id: "AF123",
    });
  });

  it("passes preset-only dashboard requests to service", async () => {
    await controller.dashboard(undefined, undefined, "year_to_date");

    expect(service.getMetricsDashboard).toHaveBeenCalledWith({
      from_date: undefined,
      to_date: undefined,
      time_preset: "year_to_date",
      campaign_id: undefined,
      campaign_key: undefined,
      affiliate_id: undefined,
    });
  });
});
