import { beforeEach, describe, expect, it, vi } from "vitest";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { MetricsService } from "../../services/metrics.service";
import { CampaignStatus } from "../../../campaigns/enums/campaign-status.enum";
import { CampaignParticipantStatus } from "../../../campaigns/enums/campaign-participant-status.enum";
import type { ILead } from "../../interfaces/ILead.interface";

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

  it("returns peak_lead_window in summary using hourly counters", async () => {
    dynamoDBUtil.queryAll
      .mockResolvedValueOnce([
        {
          bucket_start: "2026-05-01",
          received: 10,
          accepted: 7,
          sold: 4,
          accepted_not_sold: 3,
          rejected: 3,
        },
      ])
      .mockResolvedValueOnce([
        {
          bucket_start: "2026-05-01T14:00:00.000Z",
          received: 4,
          accepted: 3,
          sold: 2,
          accepted_not_sold: 1,
          rejected: 1,
        },
        {
          bucket_start: "2026-05-01T09:00:00.000Z",
          received: 5,
          accepted: 3,
          sold: 2,
          accepted_not_sold: 1,
          rejected: 2,
        },
      ]);

    const result = await service.getSummary({
      from_date: "2026-05-01",
      to_date: "2026-05-01",
    });

    expect(result.totals.received).toBe(10);
    expect(result.peak_lead_window).toEqual({
      start: "2026-05-01T09:00:00.000Z",
      end: "2026-05-01T10:00:00.000Z",
      label: "09:00-10:00 UTC",
      received: 5,
      total_received: 10,
      share_percent: 50,
    });
  });

  it("picks earliest hourly bucket when peak received ties", async () => {
    dynamoDBUtil.queryAll
      .mockResolvedValueOnce([
        {
          bucket_start: "2026-05-02",
          received: 8,
          accepted: 5,
          sold: 2,
          accepted_not_sold: 3,
          rejected: 3,
        },
      ])
      .mockResolvedValueOnce([
        {
          bucket_start: "2026-05-02T15:00:00.000Z",
          received: 4,
        },
        {
          bucket_start: "2026-05-02T10:00:00.000Z",
          received: 4,
        },
      ]);

    const result = await service.getSummary({
      from_date: "2026-05-02",
      to_date: "2026-05-02",
    });

    expect(result.peak_lead_window).toEqual({
      start: "2026-05-02T10:00:00.000Z",
      end: "2026-05-02T11:00:00.000Z",
      label: "10:00-11:00 UTC",
      received: 4,
      total_received: 8,
      share_percent: 50,
    });
  });

  it("returns null peak_lead_window when there is no data", async () => {
    dynamoDBUtil.queryAll.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const result = await service.getSummary({
      from_date: "2026-05-03",
      to_date: "2026-05-03",
    });

    expect(result.totals).toEqual({
      received: 0,
      accepted: 0,
      sold: 0,
      accepted_not_sold: 0,
      rejected: 0,
      cherry_picked: 0,
      rejected_dnq: 0,
      rejected_spam: 0,
      rejected_duplicates: 0,
    });
    expect(result.peak_lead_window).toBeNull();
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
    expect(result.sources).toMatchObject([
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
    expect(result.campaigns).toMatchObject([
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
    expect(result.campaign_summary).toMatchObject({
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

    expect(result.sources).toMatchObject([
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
    expect(result.campaign_summary).toMatchObject({
      campaign_id: "CM1",
      counters: {
        received: 10,
        accepted: 7,
        sold: 4,
        accepted_not_sold: 3,
        rejected: 3,
      },
    });
    expect(result.campaigns).toMatchObject([
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

    expect(result.sources).toMatchObject([
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
    expect(result.filters).toEqual({
      campaign_id: "CM1",
      campaign_key: "KEY_B",
    });
  });

  it("populates ipqs and quality on breakdown entries and campaign_summary when source items carry extended attrs", async () => {
    dynamoDBUtil.get.mockResolvedValue({
      id: "CM1",
      status: CampaignStatus.ACTIVE,
      affiliates: [
        {
          affiliate_id: "AF1",
          campaign_key: "KEY_A",
          status: CampaignParticipantStatus.LIVE,
        },
      ],
    });

    dynamoDBUtil.queryAll.mockResolvedValue([
      {
        campaign_id: "CM1",
        source: "KEY_A",
        received: 10,
        accepted: 8,
        sold: 5,
        accepted_not_sold: 3,
        rejected: 2,
        ipqs_phone_pass: 7,
        ipqs_phone_fail: 1,
        ipqs_phone_score_sum: 35,
        ipqs_phone_score_count: 8,
        ipqs_email_pass: 6,
        ipqs_email_fail: 2,
        ipqs_ip_pass: 5,
        ipqs_ip_fail: 3,
        dup_count: 2,
        rej_duplicate: 2,
        rej_validation: 0,
        rej_logic_rules: 0,
        rej_trusted_form: 0,
        rej_ipqs_phone: 0,
        rej_ipqs_email: 0,
        rej_ipqs_ip: 0,
        rej_affiliate_disabled: 0,
        rej_other: 0,
      },
    ]);

    const result = await service.getBreakdown({
      from_date: "2026-05-01",
      to_date: "2026-05-10",
      campaign_id: "CM1",
    });

    const sourceEntry = result.sources[0];
    expect(sourceEntry.key).toBe("KEY_A");
    expect(sourceEntry.ipqs).toBeDefined();
    expect(sourceEntry.ipqs!.trusted_score_pct).not.toBeNull();
    // (7 + 6 + 5) / (7+1 + 6+2 + 5+3) = 18 / 24 = 75
    expect(sourceEntry.ipqs!.trusted_score_pct).toBeCloseTo(75, 5);
    expect(sourceEntry.ipqs!.phone.avg_fraud_score).toBeCloseTo(35 / 8, 5);

    expect(sourceEntry.quality).toBeDefined();
    expect(sourceEntry.quality!.duplicate_count).toBe(2);
    expect(sourceEntry.quality!.rejection_buckets.duplicate).toBe(2);
    // received=10, duplicate_count=2 → denom=8; accepted=8 → 100
    expect(sourceEntry.quality!.source_quality_score).toBeCloseTo(100, 5);
    // duplicate_pct = 2/10*100 = 20
    expect(sourceEntry.quality!.duplicate_pct).toBeCloseTo(20, 5);

    expect(result.campaign_summary.ipqs).toBeDefined();
    expect(result.campaign_summary.ipqs!.trusted_score_pct).toBeCloseTo(75, 5);
    expect(result.campaign_summary.quality).toBeDefined();
    expect(result.campaign_summary.quality!.duplicate_count).toBe(2);
    expect(result.campaign_summary.quality!.duplicate_pct).toBeCloseTo(20, 5);

    // The single-campaign row should also carry the rollups.
    const campaignEntry = result.campaigns[0];
    expect(campaignEntry.ipqs!.trusted_score_pct).toBeCloseTo(75, 5);
    expect(campaignEntry.quality!.duplicate_count).toBe(2);
  });
});

describe("MetricsService getTimeseriesBySource (no campaign)", () => {
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
    logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
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

  it("emits one padded series per registered affiliate with dedup across buckets", async () => {
    dynamoDBUtil.queryAll.mockResolvedValueOnce([
      // AF1 across two days, dedup across multiple items on same day
      {
        item_type: "counter#day#affiliate",
        affiliate_id: "AF1",
        bucket_start: "2026-05-01",
        received: 3,
      },
      {
        item_type: "counter#day#affiliate",
        affiliate_id: "AF1",
        bucket_start: "2026-05-01",
        received: 2,
      },
      {
        item_type: "counter#day#affiliate",
        affiliate_id: "AF1",
        bucket_start: "2026-05-03",
        received: 4,
      },
      // AF2 single day
      {
        item_type: "counter#day#affiliate",
        affiliate_id: "AF2",
        bucket_start: "2026-05-02",
        received: 7,
      },
    ]);

    const result = await service.getTimeseriesBySource({
      from_date: "2026-05-01",
      to_date: "2026-05-03",
    });

    expect(result.range).toEqual({
      from_date: "2026-05-01",
      to_date: "2026-05-03",
    });
    expect(result.filters).toEqual({});
    expect(result.series).toHaveLength(2);

    const af1 = result.series.find((s) => s.affiliate_id === "AF1")!;
    const af2 = result.series.find((s) => s.affiliate_id === "AF2")!;

    expect(af1.affiliate_name).toBe("AF1");
    expect(af1.points).toEqual([
      { bucket_start: "2026-05-01", received: 5 },
      { bucket_start: "2026-05-02", received: 0 },
      { bucket_start: "2026-05-03", received: 4 },
    ]);

    expect(af2.affiliate_name).toBe("AF2");
    expect(af2.points).toEqual([
      { bucket_start: "2026-05-01", received: 0 },
      { bucket_start: "2026-05-02", received: 7 },
      { bucket_start: "2026-05-03", received: 0 },
    ]);
  });

  it("restricts to a single series when affiliate_id is provided", async () => {
    dynamoDBUtil.queryAll.mockResolvedValueOnce([
      {
        item_type: "counter#day#affiliate",
        affiliate_id: "AF1",
        bucket_start: "2026-05-01",
        received: 5,
      },
      {
        item_type: "counter#day#affiliate",
        affiliate_id: "AF2",
        bucket_start: "2026-05-01",
        received: 9,
      },
    ]);

    const result = await service.getTimeseriesBySource({
      from_date: "2026-05-01",
      to_date: "2026-05-02",
      affiliate_id: "AF1",
    });

    expect(result.filters).toEqual({ affiliate_id: "AF1" });
    expect(result.series).toHaveLength(1);
    expect(result.series[0].affiliate_id).toBe("AF1");
    expect(result.series[0].points).toEqual([
      { bucket_start: "2026-05-01", received: 5 },
      { bucket_start: "2026-05-02", received: 0 },
    ]);
  });
});

describe("MetricsService.recordLeadCherryPick", () => {
  let dynamoDBUtil: any;
  let logger: any;
  let constants: any;
  let sendMock: ReturnType<typeof vi.fn>;
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

    sendMock = vi.fn().mockResolvedValue({});
    vi.spyOn(DynamoDBDocumentClient, "from").mockReturnValue({
      send: sendMock,
    } as any);

    service = new MetricsService(dynamoDBUtil, logger, constants);
  });

  it("fans out cherry_picked across global, campaign, source, and affiliate counters with a dedicated idempotency key", async () => {
    const lead = {
      id: "L-CP-1",
      campaign_id: "CM1",
      campaign_key: "K1",
      affiliate_id: "AF1",
      created_at: "2026-05-01T12:00:00.000Z",
    } as ILead;

    await service.recordLeadCherryPick(lead, "2026-05-10T09:30:00.000Z");

    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0][0];
    const items: any[] = command.input.TransactItems;

    // Idempotency item uses `cherry_pick:<lead_id>` so it does not collide
    // with the original `lead_outcome:<lead_id>` write.
    const idempotency = items.find(
      (i) => i.Put && i.Put.Item.idempotency_key === "cherry_pick:L-CP-1",
    );
    expect(idempotency).toBeDefined();
    expect(idempotency.Put.Item.pk).toBe("idempotency#cherry_pick:L-CP-1");

    // Filter to counter#* items only — the affiliate registry update
    // (`affiliate_keys#…`) is a sibling write that does not carry counter
    // attributes and would otherwise pollute the per-counter assertions.
    const updates = items.filter(
      (i) =>
        i.Update &&
        typeof i.Update.ExpressionAttributeValues[":item_type"] === "string" &&
        i.Update.ExpressionAttributeValues[":item_type"].startsWith("counter#"),
    );
    const itemTypes = updates.map(
      (u) => u.Update.ExpressionAttributeValues[":item_type"],
    );
    // Cherry-pick must hit the same fanout shape as recordLeadOutcome for the
    // dimensions covered by the cherry-pick event (no contract_id).
    expect(itemTypes).toEqual(
      expect.arrayContaining([
        "counter#day#global",
        "counter#day#campaign",
        "counter#day#source",
        "counter#day#campaign_source",
        "counter#day#affiliate",
        "counter#day#campaign_affiliate",
        "counter#hour#global",
        "counter#hour#campaign",
      ]),
    );

    // Every counter Update must bump cherry_picked by 1 and leave the
    // received/accepted/sold/rejected axis untouched (delta = 0).
    for (const update of updates) {
      const vals = update.Update.ExpressionAttributeValues;
      expect(vals[":cherry_picked"]).toBe(1);
      expect(vals[":received"]).toBe(0);
      expect(vals[":accepted"]).toBe(0);
      expect(vals[":sold"]).toBe(0);
      expect(vals[":accepted_not_sold"]).toBe(0);
      expect(vals[":rejected"]).toBe(0);
      expect(update.Update.UpdateExpression).toContain(
        "#cherry_picked :cherry_picked",
      );
    }

    // Day items are bucketed by executedAt, not by the original lead.created_at.
    const dayGlobal = updates.find(
      (u) =>
        u.Update.ExpressionAttributeValues[":item_type"] ===
        "counter#day#global",
    );
    expect(dayGlobal.Update.ExpressionAttributeValues[":bucket_start"]).toBe(
      "2026-05-10",
    );
  });
});

describe("MetricsService counter aggregation for cherry_picked", () => {
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

  // `cherry_picked` is a regular counter field; it must default to 0 when an
  // item omits it (back-compat with rows written before the field existed)
  // and must sum across items in any aggregate path (summary, breakdown,
  // campaign-summary). This test drives the breakdown read path so we cover
  // `toItemCounters` (empty default), `addCounters` (sum), and `emptyCounters`
  // (seed) end-to-end without depending on private methods.
  it("aggregates cherry_picked across counter items and surfaces it on MetricsBreakdownEntry.counters", async () => {
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
        ],
      },
    ]);

    dynamoDBUtil.queryAll.mockResolvedValue([
      // Cherry-pick day item: only `cherry_picked` is non-zero.
      {
        campaign_id: "CM1",
        source: "KEY_A",
        received: 0,
        accepted: 0,
        sold: 0,
        accepted_not_sold: 0,
        rejected: 0,
        cherry_picked: 3,
      },
      // Original outcome day item: `cherry_picked` omitted → defaults to 0.
      {
        campaign_id: "CM1",
        source: "KEY_A",
        received: 10,
        accepted: 8,
        sold: 4,
        accepted_not_sold: 4,
        rejected: 2,
      },
      // Second cherry-pick day item: addCounters must sum across all three.
      {
        campaign_id: "CM1",
        source: "KEY_A",
        received: 0,
        accepted: 0,
        sold: 0,
        accepted_not_sold: 0,
        rejected: 0,
        cherry_picked: 1,
      },
    ]);

    const result = await service.getBreakdown({
      from_date: "2026-05-01",
      to_date: "2026-05-10",
    });

    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].counters).toMatchObject({
      received: 10,
      accepted: 8,
      sold: 4,
      accepted_not_sold: 4,
      rejected: 2,
      cherry_picked: 4,
    });
    expect(result.campaigns[0].counters.cherry_picked).toBe(4);
    expect(result.campaign_summary.counters.cherry_picked).toBe(4);
  });
});

describe("MetricsService query validation bounds", () => {
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

  it("rejects future to_date", async () => {
    const tomorrow = new Date();
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    const tomorrowIso = tomorrow.toISOString().slice(0, 10);

    await expect(
      service.getSummary({
        from_date: "2026-01-01",
        to_date: tomorrowIso,
      }),
    ).rejects.toThrow("to_date cannot be in the future");
  });

  it("rejects invalid calendar dates", async () => {
    await expect(
      service.getSummary({
        from_date: "2026-02-30",
        to_date: "2026-03-01",
      }),
    ).rejects.toThrow("from_date and to_date must be YYYY-MM-DD");
  });

  it("rejects range larger than configured max window", async () => {
    await expect(
      service.getSummary({
        from_date: "2024-01-01",
        to_date: "2026-01-01",
      }),
    ).rejects.toThrow("date range exceeds maximum window");
  });
});
