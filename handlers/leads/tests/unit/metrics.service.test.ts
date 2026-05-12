import { beforeEach, describe, expect, it, vi } from "vitest";
import { MetricsService } from "../../services/metrics.service";
import { CampaignStatus } from "../../../campaigns/enums/campaign-status.enum";
import { CampaignParticipantStatus } from "../../../campaigns/enums/campaign-participant-status.enum";

describe("MetricsService breakdown cutover", () => {
  let dynamoDBUtil: any;
  let logger: any;
  let constants: any;
  let service: MetricsService;

  beforeEach(() => {
    dynamoDBUtil = {
      get: vi.fn(),
      queryAll: vi.fn(),
      scanAll: vi.fn(),
    };
    logger = {
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    };
    constants = {
      METRICS_TABLE_NAME: "metrics-table",
      METRICS_TABLE_PARTITION_KEY: "pk",
      METRICS_TABLE_SORT_KEY: "sk",
      METRICS_TABLE_ITEM_TYPE_ATTRIBUTE: "item_type",
      METRICS_TABLE_BUCKET_START_ATTRIBUTE: "bucket_start",
      METRICS_ITEM_TYPE_BUCKET_START_INDEX_NAME: "metrics-item-type-index",
      METRICS_ITEM_TYPE_BUCKET_START_INDEX_PARTITION_KEY: "item_type",
      METRICS_ITEM_TYPE_BUCKET_START_INDEX_SORT_KEY: "bucket_start",
      CAMPAIGNS_TABLE_NAME: "campaigns-table",
    };

    service = new MetricsService(dynamoDBUtil, logger, constants);
  });

  it("returns all-campaign breakdown using ACTIVE campaigns and LIVE sources", async () => {
    dynamoDBUtil.scanAll.mockResolvedValue([
      {
        id: "CM1",
        status: CampaignStatus.ACTIVE,
        affiliates: [
          {
            affiliate_id: "AF1",
            campaign_key: "KEY_A",
            status: CampaignParticipantStatus.LIVE,
          },
          {
            affiliate_id: "AF2",
            campaign_key: "KEY_A_TEST",
            status: CampaignParticipantStatus.TEST,
          },
        ],
      },
      {
        id: "CM2",
        status: CampaignStatus.ACTIVE,
        affiliates: [
          {
            affiliate_id: "AF3",
            campaign_key: "KEY_B",
            status: CampaignParticipantStatus.LIVE,
          },
        ],
      },
      {
        id: "CM3",
        status: CampaignStatus.ACTIVE,
        affiliates: [
          {
            affiliate_id: "AF4",
            campaign_key: "KEY_C",
            status: CampaignParticipantStatus.PAUSED,
          },
        ],
      },
    ]);

    dynamoDBUtil.queryAll.mockResolvedValue([
      {
        campaign_id: "CM1",
        source: "KEY_A",
        received: 10,
        accepted: 8,
        sold: 5,
        accepted_not_sold: 3,
        rejected: 2,
      },
      {
        campaign_id: "CM1",
        source: "KEY_A_TEST",
        received: 4,
        accepted: 2,
        sold: 1,
        accepted_not_sold: 1,
        rejected: 2,
      },
      {
        campaign_id: "CM2",
        source: "KEY_B",
        received: 6,
        accepted: 5,
        sold: 2,
        accepted_not_sold: 3,
        rejected: 1,
      },
      {
        campaign_id: "CM9",
        source: "KEY_A",
        received: 100,
        accepted: 100,
        sold: 100,
        accepted_not_sold: 0,
        rejected: 0,
      },
    ]);

    const result = await service.getBreakdown({
      from_date: "2026-05-01",
      to_date: "2026-05-10",
    });

    expect(result.filters).toEqual({});
    expect(result.sources).toEqual([
      {
        key: "KEY_A",
        counters: {
          received: 10,
          accepted: 8,
          sold: 5,
          accepted_not_sold: 3,
          rejected: 2,
        },
      },
      {
        key: "KEY_B",
        counters: {
          received: 6,
          accepted: 5,
          sold: 2,
          accepted_not_sold: 3,
          rejected: 1,
        },
      },
    ]);
    expect(result.campaigns).toEqual([
      {
        key: "CM1",
        counters: {
          received: 10,
          accepted: 8,
          sold: 5,
          accepted_not_sold: 3,
          rejected: 2,
        },
      },
      {
        key: "CM2",
        counters: {
          received: 6,
          accepted: 5,
          sold: 2,
          accepted_not_sold: 3,
          rejected: 1,
        },
      },
    ]);
    expect(result.campaign_summary).toEqual({
      campaign_id: "",
      counters: {
        received: 16,
        accepted: 13,
        sold: 7,
        accepted_not_sold: 6,
        rejected: 3,
      },
    });
    expect(dynamoDBUtil.scanAll).toHaveBeenCalledOnce();
    expect(dynamoDBUtil.get).not.toHaveBeenCalled();
  });

  it("does not throw when campaign_id is missing", async () => {
    dynamoDBUtil.scanAll.mockResolvedValue([]);

    await expect(
      service.getBreakdown({
        from_date: "2026-05-01",
        to_date: "2026-05-10",
      }),
    ).resolves.toBeDefined();
  });

  it("returns empty data when campaign is not LIVE/ACTIVE", async () => {
    dynamoDBUtil.get.mockResolvedValue({
      id: "CM1",
      status: CampaignStatus.TEST,
      affiliates: [
        {
          affiliate_id: "AF1",
          campaign_key: "KEY_LIVE",
          status: CampaignParticipantStatus.LIVE,
        },
      ],
    });

    const result = await service.getBreakdown({
      from_date: "2026-05-01",
      to_date: "2026-05-10",
      campaign_id: "CM1",
    });

    expect(result.sources).toEqual([]);
    expect(result.campaign_summary.campaign_id).toBe("CM1");
    expect(result.campaign_summary.counters.received).toBe(0);
    expect(dynamoDBUtil.queryAll).not.toHaveBeenCalled();
  });

  it("includes only LIVE sources by campaign_key for the selected LIVE campaign", async () => {
    dynamoDBUtil.get.mockResolvedValue({
      id: "CM1",
      status: CampaignStatus.ACTIVE,
      affiliates: [
        {
          affiliate_id: "AF1",
          campaign_key: "KEY_LIVE",
          status: CampaignParticipantStatus.LIVE,
        },
        {
          affiliate_id: "AF2",
          campaign_key: "KEY_TEST",
          status: CampaignParticipantStatus.TEST,
        },
      ],
    });

    dynamoDBUtil.queryAll.mockResolvedValue([
      {
        campaign_id: "CM1",
        source: "KEY_LIVE",
        received: 10,
        accepted: 7,
        sold: 4,
        accepted_not_sold: 3,
        rejected: 3,
      },
      {
        campaign_id: "CM1",
        source: "KEY_TEST",
        received: 9,
        accepted: 9,
        sold: 8,
        accepted_not_sold: 1,
        rejected: 0,
      },
      {
        campaign_id: "CM2",
        source: "KEY_LIVE",
        received: 99,
        accepted: 99,
        sold: 99,
        accepted_not_sold: 0,
        rejected: 0,
      },
    ]);

    const result = await service.getBreakdown({
      from_date: "2026-05-01",
      to_date: "2026-05-10",
      campaign_id: "CM1",
    });

    expect(result.sources).toEqual([
      {
        key: "KEY_LIVE",
        counters: {
          received: 10,
          accepted: 7,
          sold: 4,
          accepted_not_sold: 3,
          rejected: 3,
        },
      },
    ]);
    expect(result.campaign_summary).toEqual({
      campaign_id: "CM1",
      counters: {
        received: 10,
        accepted: 7,
        sold: 4,
        accepted_not_sold: 3,
        rejected: 3,
      },
    });
    expect(result.campaigns).toEqual([
      {
        key: "CM1",
        counters: {
          received: 10,
          accepted: 7,
          sold: 4,
          accepted_not_sold: 3,
          rejected: 3,
        },
      },
    ]);
  });

  it("filters by campaign_key when provided", async () => {
    dynamoDBUtil.get.mockResolvedValue({
      id: "CM1",
      status: CampaignStatus.ACTIVE,
      affiliates: [
        {
          affiliate_id: "AF1",
          campaign_key: "KEY_A",
          status: CampaignParticipantStatus.LIVE,
        },
        {
          affiliate_id: "AF2",
          campaign_key: "KEY_B",
          status: CampaignParticipantStatus.LIVE,
        },
      ],
    });

    dynamoDBUtil.queryAll.mockResolvedValue([
      {
        campaign_id: "CM1",
        source: "KEY_A",
        received: 5,
        accepted: 4,
        sold: 2,
        accepted_not_sold: 2,
        rejected: 1,
      },
      {
        campaign_id: "CM1",
        source: "KEY_B",
        received: 7,
        accepted: 6,
        sold: 5,
        accepted_not_sold: 1,
        rejected: 1,
      },
    ]);

    const result = await service.getBreakdown({
      from_date: "2026-05-01",
      to_date: "2026-05-10",
      campaign_id: "CM1",
      campaign_key: "KEY_B",
    });

    expect(result.sources).toEqual([
      {
        key: "KEY_B",
        counters: {
          received: 7,
          accepted: 6,
          sold: 5,
          accepted_not_sold: 1,
          rejected: 1,
        },
      },
    ]);
    expect(result.filters).toEqual({ campaign_id: "CM1", campaign_key: "KEY_B" });
  });
});
