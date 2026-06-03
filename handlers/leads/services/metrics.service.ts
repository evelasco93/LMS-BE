import { injectable, inject } from "inversify";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  TransactWriteCommand,
} from "@aws-sdk/lib-dynamodb";
import { Logger } from "@shared/services/logger.util";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { LeadsConstants } from "../constants/leads.constants";
import { CampaignStatus } from "../../campaigns/enums/campaign-status.enum";
import { CampaignParticipantStatus } from "../../campaigns/enums/campaign-participant-status.enum";
import { ICampaign } from "../../campaigns/interfaces/ICampaign.interface";
import { ILead } from "../interfaces/ILead.interface";
import {
  buildCherryPickEvent,
  buildLeadOutcomeEvent,
} from "./lead-outcome-event.builder";
import type { LeadOutcomeEvent } from "../types/lead-outcome-event.types";
import {
  DayNightBucket,
  MetricsDashboardData,
  IpqsCheckRollup,
  IpqsRollup,
  MetricsBreakdownData,
  MetricsBreakdownEntry,
  MetricsContractsData,
  MetricsCounterItem,
  MetricsCounters,
  MetricsCountersWithSplits,
  MetricsHealthData,
  MetricsHourlyData,
  MetricsQuery,
  MetricsSummaryData,
  MetricsTimeseriesBySourceData,
  MetricsTimeseriesData,
  MetricsTimePoint,
  QualityRollup,
  RejectionSplits,
} from "../types/metrics.types";

@injectable()
export class MetricsService {
  private static readonly MAX_QUERY_RANGE_DAYS = 366;

  private readonly docClient: DynamoDBDocumentClient;

  constructor(
    @inject("DynamoDBUtil") private readonly dynamoDBUtil: DynamoDBUtil,
    @inject("Logger") private readonly logger: Logger,
    @inject("LeadsConstants") private readonly constants: LeadsConstants,
  ) {
    const client = new DynamoDBClient({});
    this.docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: {
        removeUndefinedValues: true,
        convertClassInstanceToMap: true,
      },
      unmarshallOptions: {
        wrapNumbers: false,
      },
    });
  }

  async recordLeadOutcome(lead: ILead): Promise<void> {
    const event = buildLeadOutcomeEvent(lead);
    return this.emitLeadOutcomeEvent(event);
  }

  /**
   * Cherry-pick fanout: increments only `cherry_picked` across the global /
   * campaign / source / affiliate dimensions (same transactional pattern as
   * `recordLeadOutcome`). Bucketing uses the cherry-pick action time (defaults
   * to "now") so a date-range view of "Cherry Picked" reflects when the action
   * was taken, not when the underlying lead was received. Idempotency uses
   * `cherry_pick:<lead_id>` so it does not collide with the original
   * `lead_outcome:<lead_id>` write done at ingest time.
   *
   * Cherry-pick is orthogonal to the received/accepted/sold/rejected axis —
   * those counters are zero on this emission and never double-count the
   * original outcome.
   */
  async recordLeadCherryPick(lead: ILead, executedAt?: string): Promise<void> {
    const event = buildCherryPickEvent(
      lead,
      executedAt ?? new Date().toISOString(),
    );
    return this.emitLeadOutcomeEvent(event);
  }

  /**
   * Same write path as `recordLeadOutcome`, but called directly from the DLQ
   * retry consumer Lambda with a pre-built event (no `ILead` round-trip).
   * Idempotency is preserved via the same `lead_outcome:${lead_id}` key, so
   * replays are safe.
   */
  async recordLeadOutcomeFromEvent(event: LeadOutcomeEvent): Promise<void> {
    return this.emitLeadOutcomeEvent(event);
  }

  /**
   * Emit fanout: 1 idempotency + up to 16 counter updates + up to 1 affiliate
   * registry write = worst-case 18 TransactWrite items. Stays well below the
   * DynamoDB TransactWrite cap (100) and the project ceiling of 90.
   */
  private async emitLeadOutcomeEvent(event: LeadOutcomeEvent): Promise<void> {
    const dayBucketStart = this.toDayBucketStart(event.created_at);
    const hourBucketStart = this.toHourBucketStart(event.created_at);
    const source = this.normalizeCampaignKey(event.campaign_key);
    const counters: MetricsCounters = {
      received: event.received,
      accepted: event.accepted,
      sold: event.sold,
      accepted_not_sold: event.accepted_not_sold,
      rejected: event.rejected,
      cherry_picked: event.cherry_picked,
    };
    // Cherry-pick emissions are bucketed independently from the original
    // lead-outcome emit (different created_at, only `cherry_picked` is
    // non-zero) and therefore need a distinct idempotency key so they do not
    // collide with the `lead_outcome:<lead_id>` write done at ingest time.
    const idempotencyKey =
      event.cherry_picked === 1
        ? `cherry_pick:${event.lead_id}`
        : `lead_outcome:${event.lead_id}`;
    const now = new Date().toISOString();

    const updates: ReturnType<MetricsService["buildCounterUpdate"]>[] = [
      this.buildCounterUpdate({
        pk: this.pkGlobal(),
        sk: this.skBucket(dayBucketStart),
        itemType: "counter#day#global",
        bucketStart: dayBucketStart,
        counters,
        event,
        extended: true,
        now,
      }),
      this.buildCounterUpdate({
        pk: this.pkCampaign(event.campaign_id),
        sk: this.skBucket(dayBucketStart),
        itemType: "counter#day#campaign",
        bucketStart: dayBucketStart,
        campaignId: event.campaign_id,
        counters,
        event,
        extended: true,
        now,
      }),
      this.buildCounterUpdate({
        pk: this.pkGlobal("hour"),
        sk: this.skBucket(hourBucketStart),
        itemType: "counter#hour#global",
        bucketStart: hourBucketStart,
        counters,
        event,
        extended: false,
        now,
      }),
      this.buildCounterUpdate({
        pk: this.pkCampaign(event.campaign_id, "hour"),
        sk: this.skBucket(hourBucketStart),
        itemType: "counter#hour#campaign",
        bucketStart: hourBucketStart,
        campaignId: event.campaign_id,
        counters,
        event,
        extended: false,
        now,
      }),
    ];

    if (source) {
      updates.push(
        this.buildCounterUpdate({
          pk: this.pkSource(source),
          sk: this.skBucket(dayBucketStart),
          itemType: "counter#day#source",
          bucketStart: dayBucketStart,
          source,
          counters,
          event,
          extended: true,
          now,
        }),
      );

      updates.push(
        this.buildCounterUpdate({
          pk: this.pkCampaignSource(event.campaign_id, source),
          sk: this.skBucket(dayBucketStart),
          itemType: "counter#day#campaign_source",
          bucketStart: dayBucketStart,
          campaignId: event.campaign_id,
          source,
          counters,
          event,
          extended: true,
          now,
        }),
      );

      updates.push(
        this.buildCounterUpdate({
          pk: this.pkSource(source, "hour"),
          sk: this.skBucket(hourBucketStart),
          itemType: "counter#hour#source",
          bucketStart: hourBucketStart,
          source,
          counters,
          event,
          extended: false,
          now,
        }),
      );

      updates.push(
        this.buildCounterUpdate({
          pk: this.pkCampaignSource(event.campaign_id, source, "hour"),
          sk: this.skBucket(hourBucketStart),
          itemType: "counter#hour#campaign_source",
          bucketStart: hourBucketStart,
          campaignId: event.campaign_id,
          source,
          counters,
          event,
          extended: false,
          now,
        }),
      );
    }

    if (event.contract_id) {
      updates.push(
        this.buildCounterUpdate({
          pk: this.pkContract(event.contract_id),
          sk: this.skBucket(dayBucketStart),
          itemType: "counter#day#contract",
          bucketStart: dayBucketStart,
          campaignId: event.campaign_id,
          source,
          contractId: event.contract_id,
          counters,
          event,
          extended: true,
          now,
        }),
      );
      updates.push(
        this.buildCounterUpdate({
          pk: this.pkContractCampaign(event.contract_id, event.campaign_id),
          sk: this.skBucket(dayBucketStart),
          itemType: "counter#day#contract_campaign",
          bucketStart: dayBucketStart,
          campaignId: event.campaign_id,
          source,
          contractId: event.contract_id,
          counters,
          event,
          extended: true,
          now,
        }),
      );

      updates.push(
        this.buildCounterUpdate({
          pk: this.pkContract(event.contract_id, "hour"),
          sk: this.skBucket(hourBucketStart),
          itemType: "counter#hour#contract",
          bucketStart: hourBucketStart,
          campaignId: event.campaign_id,
          source,
          contractId: event.contract_id,
          counters,
          event,
          extended: false,
          now,
        }),
      );

      updates.push(
        this.buildCounterUpdate({
          pk: this.pkContractCampaign(
            event.contract_id,
            event.campaign_id,
            "hour",
          ),
          sk: this.skBucket(hourBucketStart),
          itemType: "counter#hour#contract_campaign",
          bucketStart: hourBucketStart,
          campaignId: event.campaign_id,
          source,
          contractId: event.contract_id,
          counters,
          event,
          extended: false,
          now,
        }),
      );

      // ── Contract × affiliate items (sparse on affiliate_id) ────────────
      // Adds at most 2 day items per emit (contract_affiliate,
      // contract_campaign_affiliate). Used by `/metrics/contracts?affiliate_id=…`
      // to scope contract roll-ups to a single affiliate without scanning the
      // full contract partition. Hour granularity is intentionally omitted —
      // no current consumer needs hourly per-affiliate contracts.
      if (event.affiliate_id) {
        const contractAffiliateId = event.affiliate_id;
        updates.push(
          this.buildCounterUpdate({
            pk: this.pkContractAffiliate(
              event.contract_id,
              contractAffiliateId,
            ),
            sk: this.skBucket(dayBucketStart),
            itemType: "counter#day#contract_affiliate",
            bucketStart: dayBucketStart,
            campaignId: event.campaign_id,
            source,
            contractId: event.contract_id,
            affiliateId: contractAffiliateId,
            counters,
            event,
            extended: true,
            now,
          }),
        );
        updates.push(
          this.buildCounterUpdate({
            pk: this.pkContractCampaignAffiliate(
              event.contract_id,
              event.campaign_id,
              contractAffiliateId,
            ),
            sk: this.skBucket(dayBucketStart),
            itemType: "counter#day#contract_campaign_affiliate",
            bucketStart: dayBucketStart,
            campaignId: event.campaign_id,
            source,
            contractId: event.contract_id,
            affiliateId: contractAffiliateId,
            counters,
            event,
            extended: true,
            now,
          }),
        );
      }
    }

    // ── Affiliate-dimensional items (sparse on affiliate_id) ────────────────
    // Skipped when affiliate_id is absent (e.g., legacy leads pre-denorm).
    if (event.affiliate_id) {
      const affiliateId = event.affiliate_id;
      updates.push(
        this.buildCounterUpdate({
          pk: this.pkAffiliate(affiliateId),
          sk: this.skBucket(dayBucketStart),
          itemType: "counter#day#affiliate",
          bucketStart: dayBucketStart,
          affiliateId,
          counters,
          event,
          extended: true,
          now,
        }),
      );
      updates.push(
        this.buildCounterUpdate({
          pk: this.pkAffiliate(affiliateId, "hour"),
          sk: this.skBucket(hourBucketStart),
          itemType: "counter#hour#affiliate",
          bucketStart: hourBucketStart,
          affiliateId,
          counters,
          event,
          extended: false,
          now,
        }),
      );
      updates.push(
        this.buildCounterUpdate({
          pk: this.pkCampaignAffiliate(event.campaign_id, affiliateId),
          sk: this.skBucket(dayBucketStart),
          itemType: "counter#day#campaign_affiliate",
          bucketStart: dayBucketStart,
          campaignId: event.campaign_id,
          affiliateId,
          counters,
          event,
          extended: true,
          now,
        }),
      );
      updates.push(
        this.buildCounterUpdate({
          pk: this.pkCampaignAffiliate(event.campaign_id, affiliateId, "hour"),
          sk: this.skBucket(hourBucketStart),
          itemType: "counter#hour#campaign_affiliate",
          bucketStart: hourBucketStart,
          campaignId: event.campaign_id,
          affiliateId,
          counters,
          event,
          extended: false,
          now,
        }),
      );
    }

    const pkName = this.constants.METRICS_TABLE_PARTITION_KEY;
    const skName = this.constants.METRICS_TABLE_SORT_KEY;
    const itemTypeName = this.constants.METRICS_TABLE_ITEM_TYPE_ATTRIBUTE;
    const bucketStartName = this.constants.METRICS_TABLE_BUCKET_START_ATTRIBUTE;

    const idempotencyPk = `idempotency#${idempotencyKey}`;
    const idempotencySk = `idempotency#${idempotencyKey}`;

    const idempotencyItem: Record<string, unknown> = {
      [pkName]: idempotencyPk,
      [skName]: idempotencySk,
      [itemTypeName]: "idempotency",
      [bucketStartName]: hourBucketStart,
      idempotency_key: idempotencyKey,
      lead_id: event.lead_id,
      created_at: now,
    };

    // ── Affiliate registry (sparse on affiliate_id) ─────────────────────────
    // ADD-semantics on a string set dedupes campaign_keys naturally; no
    // conditional check needed. Skipped when affiliate_id is absent OR when
    // campaign_key is absent (nothing to register).
    const registryUpdate =
      event.affiliate_id && source
        ? this.buildAffiliateRegistryUpdate(event.affiliate_id, source, now)
        : null;

    // ── TransactWrite item-count audit ──────────────────────────────────────
    // Worst case = 1 idempotency
    //            + 4 base (global+campaign × day+hour)
    //            + 4 source (source+campaign_source × day+hour)
    //            + 4 contract (contract+contract_campaign × day+hour)
    //            + 4 affiliate (affiliate+campaign_affiliate × day+hour)
    //            + 1 affiliate registry
    //            = 18 items. Cap = 90 (project), 100 (DDB hard).
    const transactItems = [
      {
        Put: {
          TableName: this.constants.METRICS_TABLE_NAME,
          Item: idempotencyItem,
          ConditionExpression: "attribute_not_exists(#pk)",
          ExpressionAttributeNames: { "#pk": pkName },
        },
      },
      ...updates,
      ...(registryUpdate ? [registryUpdate] : []),
    ];

    try {
      await this.docClient.send(
        new TransactWriteCommand({ TransactItems: transactItems }),
      );
    } catch (error: any) {
      const reasons = error?.CancellationReasons as
        | Array<{ Code?: string }>
        | undefined;
      const duplicate =
        error?.name === "TransactionCanceledException" &&
        Array.isArray(reasons) &&
        reasons.some((reason) => reason?.Code === "ConditionalCheckFailed");

      if (duplicate) {
        return;
      }

      this.logger.error("Failed to record metrics outcome", {
        leadId: event.lead_id,
        error: error?.message,
      });
      throw error;
    }
  }

  async getSummary(query: MetricsQuery): Promise<MetricsSummaryData> {
    this.validateQuery(query);

    const points = await this.getPointsForSummary(query);
    const totals = this.sumPoints(points);
    const splits = this.sumSplitsFromItems(points.map((p) => p.raw));
    const hourlyPoints = await this.getHourlyPointsForSummary(query);
    const peakLeadWindow = this.pickPeakLeadWindow(
      hourlyPoints,
      totals.received,
    );

    const ipqsRollup = this.finalizeIpqs(
      points.reduce((acc, p) => this.addIpqs(acc, p.ipqs), this.emptyIpqs()),
    );
    const qualityRollup = this.finalizeQuality(
      points.reduce(
        (acc, p) => this.addQuality(acc, p.quality),
        this.emptyQuality(),
      ),
      totals,
    );

    return {
      range: {
        from_date: query.from_date,
        to_date: query.to_date,
      },
      filters: {
        ...(query.campaign_id ? { campaign_id: query.campaign_id } : {}),
        ...(query.campaign_key ? { campaign_key: query.campaign_key } : {}),
        ...(query.affiliate_id ? { affiliate_id: query.affiliate_id } : {}),
      },
      totals: this.withSplits(totals, splits),
      peak_lead_window: peakLeadWindow,
      ipqs: ipqsRollup,
      quality: qualityRollup,
    };
  }

  async getTimeseries(query: MetricsQuery): Promise<MetricsTimeseriesData> {
    this.validateQuery(query);

    const points = await this.getPointsForSummary(query);
    const pointMap = new Map<
      string,
      { counters: MetricsCounters; ipqs: IpqsRollup; quality: QualityRollup }
    >(
      points.map((p) => [
        p.bucket_start,
        { counters: p.counters, ipqs: p.ipqs, quality: p.quality },
      ]),
    );

    const normalized: MetricsTimePoint[] = this.eachDate(
      query.from_date,
      query.to_date,
    ).map((bucketStart) => {
      const slot = pointMap.get(bucketStart);
      const counters = slot?.counters ?? this.emptyCounters();
      return {
        bucket_start: bucketStart,
        counters,
        ipqs: this.finalizeIpqs(slot?.ipqs ?? this.emptyIpqs()),
        quality: this.finalizeQuality(
          slot?.quality ?? this.emptyQuality(),
          counters,
        ),
      };
    });

    return {
      range: {
        from_date: query.from_date,
        to_date: query.to_date,
      },
      filters: {
        ...(query.campaign_id ? { campaign_id: query.campaign_id } : {}),
        ...(query.campaign_key ? { campaign_key: query.campaign_key } : {}),
        ...(query.affiliate_id ? { affiliate_id: query.affiliate_id } : {}),
      },
      points: normalized,
    };
  }

  async getBreakdown(query: MetricsQuery): Promise<MetricsBreakdownData> {
    this.validateQuery(query);

    const requestedCampaignKey = this.normalizeCampaignKey(query.campaign_key);

    if (!query.campaign_id) {
      return this.getAllCampaignBreakdown(query, requestedCampaignKey);
    }

    return this.getSingleCampaignBreakdown(query, requestedCampaignKey);
  }

  private async getSingleCampaignBreakdown(
    query: MetricsQuery,
    requestedCampaignKey?: string,
  ): Promise<MetricsBreakdownData> {
    if (!query.campaign_id) {
      return this.emptyBreakdown(query);
    }

    const campaign = await this.getCampaign(query.campaign_id);
    if (!campaign || campaign.status !== CampaignStatus.ACTIVE) {
      return this.emptyBreakdown(query);
    }

    const liveSourceKeys = this.getLiveCampaignSourceKeys(campaign);
    if (liveSourceKeys.size === 0) {
      return this.emptyBreakdown(query);
    }

    const scopedSourceKeys = requestedCampaignKey
      ? new Set(
          liveSourceKeys.has(requestedCampaignKey)
            ? [requestedCampaignKey]
            : [],
        )
      : liveSourceKeys;

    if (scopedSourceKeys.size === 0) {
      return this.emptyBreakdown(query);
    }

    const byCampaignSource = await this.queryByItemTypeRange(
      "counter#day#campaign_source",
      query.from_date,
      query.to_date,
    );

    const sourceItems = byCampaignSource.filter(
      (item) =>
        item.campaign_id === query.campaign_id &&
        !!item.source &&
        scopedSourceKeys.has(item.source),
    );

    const sources = this.aggregateBreakdown(sourceItems, "source");
    const summary = this.summarizeItems(sourceItems);

    return {
      range: {
        from_date: query.from_date,
        to_date: query.to_date,
      },
      filters: {
        campaign_id: query.campaign_id,
        ...(requestedCampaignKey ? { campaign_key: requestedCampaignKey } : {}),
      },
      campaign_summary: {
        campaign_id: query.campaign_id,
        counters: summary.counters,
        ipqs: summary.ipqs,
        quality: summary.quality,
      },
      campaigns: [
        {
          key: query.campaign_id,
          counters: summary.counters,
          ipqs: summary.ipqs,
          quality: summary.quality,
        },
      ],
      sources,
    };
  }

  private async getAllCampaignBreakdown(
    query: MetricsQuery,
    requestedCampaignKey?: string,
  ): Promise<MetricsBreakdownData> {
    const activeCampaigns = await this.getActiveCampaigns();
    if (activeCampaigns.length === 0) {
      return this.emptyBreakdown(query);
    }

    const campaignSourceKeys = new Map<string, Set<string>>();
    for (const campaign of activeCampaigns) {
      const liveSourceKeys = this.getLiveCampaignSourceKeys(campaign);
      const scopedLiveSourceKeys = requestedCampaignKey
        ? new Set(
            liveSourceKeys.has(requestedCampaignKey)
              ? [requestedCampaignKey]
              : [],
          )
        : liveSourceKeys;

      if (scopedLiveSourceKeys.size > 0) {
        campaignSourceKeys.set(campaign.id, scopedLiveSourceKeys);
      }
    }

    if (campaignSourceKeys.size === 0) {
      return this.emptyBreakdown(query);
    }

    const byCampaignSource = await this.queryByItemTypeRange(
      "counter#day#campaign_source",
      query.from_date,
      query.to_date,
    );

    const sourceItems = byCampaignSource.filter((item) => {
      if (!item.campaign_id || !item.source) {
        return false;
      }

      const allowedSourceKeys = campaignSourceKeys.get(item.campaign_id);
      if (!allowedSourceKeys) {
        return false;
      }

      return allowedSourceKeys.has(item.source);
    });

    const sources = this.aggregateBreakdown(sourceItems, "source");
    const summary = this.summarizeItems(sourceItems);
    const campaigns = this.aggregateCampaignsForIds(
      Array.from(campaignSourceKeys.keys()),
      sourceItems,
    );

    return {
      range: {
        from_date: query.from_date,
        to_date: query.to_date,
      },
      filters: {
        ...(requestedCampaignKey ? { campaign_key: requestedCampaignKey } : {}),
      },
      campaign_summary: {
        campaign_id: "",
        counters: summary.counters,
        ipqs: summary.ipqs,
        quality: summary.quality,
      },
      campaigns,
      sources,
    };
  }

  async getContracts(query: MetricsQuery): Promise<MetricsContractsData> {
    this.validateQuery(query);

    // Item-type routing matrix:
    //   no campaign + no affiliate   → counter#day#contract
    //   campaign only                → counter#day#contract_campaign
    //   affiliate only               → counter#day#contract_affiliate
    //   campaign + affiliate         → counter#day#contract_campaign_affiliate
    const itemType =
      query.campaign_id && query.affiliate_id
        ? "counter#day#contract_campaign_affiliate"
        : query.campaign_id
          ? "counter#day#contract_campaign"
          : query.affiliate_id
            ? "counter#day#contract_affiliate"
            : "counter#day#contract";

    const items = await this.queryByItemTypeRange(
      itemType,
      query.from_date,
      query.to_date,
    );

    const filtered = items.filter((item) => {
      if (query.campaign_id && item.campaign_id !== query.campaign_id) {
        return false;
      }
      if (query.affiliate_id && item.affiliate_id !== query.affiliate_id) {
        return false;
      }
      return true;
    });

    const grouped = new Map<string, MetricsCounters>();
    for (const item of filtered) {
      const contractId = item.contract_id;
      if (!contractId) continue;
      const existing = grouped.get(contractId) ?? this.emptyCounters();
      grouped.set(
        contractId,
        this.addCounters(existing, this.toItemCounters(item)),
      );
    }

    const contracts = Array.from(grouped.entries())
      .map(([contract_id, counters]) => ({ contract_id, counters }))
      .sort((a, b) => b.counters.sold - a.counters.sold);

    return {
      range: {
        from_date: query.from_date,
        to_date: query.to_date,
      },
      filters: {
        ...(query.campaign_id ? { campaign_id: query.campaign_id } : {}),
        ...(query.affiliate_id ? { affiliate_id: query.affiliate_id } : {}),
      },
      contracts,
    };
  }

  async getHealth(query: MetricsQuery): Promise<MetricsHealthData> {
    const summary = await this.getSummary(query);
    const totals = summary.totals;

    const checkReceived = totals.received === totals.accepted + totals.rejected;
    const checkAccepted =
      totals.accepted === totals.sold + totals.accepted_not_sold;

    const issues: string[] = [];
    if (!checkReceived) {
      issues.push("received does not equal accepted + rejected");
    }
    if (!checkAccepted) {
      issues.push("accepted does not equal sold + accepted_not_sold");
    }

    return {
      status: issues.length === 0 ? "ok" : "degraded",
      range: summary.range,
      totals,
      checks: {
        received_equals_accepted_plus_rejected: checkReceived,
        accepted_equals_sold_plus_accepted_not_sold: checkAccepted,
      },
      issues,
    };
  }

  // ── CR-001 affiliate-dimensional read endpoints ────────────────────────────
  // All four use the same GSI/PK as the write path, so no extra index
  // round-trips are needed beyond what `getSummary` / `queryByItemTypeRange`
  // already do.

  /**
   * Per-affiliate summary. Delegates to `getSummary`, which routes to
   * `counter#day#affiliate` (or `counter#day#campaign_affiliate` when
   * `campaign_id` is also set) via the existing partition-key routing matrix.
   */
  async getByAffiliate(query: MetricsQuery): Promise<MetricsSummaryData> {
    if (!query.affiliate_id) {
      throw new Error("affiliate_id is required");
    }
    return this.getSummary(query);
  }

  /**
   * Per-affiliate, per-campaign breakdown. Reads via GSI2
   * (PK = affiliate_id, SK = bucket_start_composite) and filters to the
   * `counter#day#campaign_affiliate` item type.
   */
  async getByAffiliateCampaigns(
    query: MetricsQuery,
  ): Promise<MetricsBreakdownData> {
    this.validateQuery(query);
    if (!query.affiliate_id) {
      throw new Error("affiliate_id is required");
    }

    const items = await this.queryByAffiliateGsi2(
      query.affiliate_id,
      "counter#day#campaign_affiliate",
      query.from_date,
      query.to_date,
    );

    const campaigns = this.aggregateBreakdown(items, "campaign_id");
    const summary = this.summarizeItems(items);

    return {
      range: { from_date: query.from_date, to_date: query.to_date },
      filters: { affiliate_id: query.affiliate_id },
      campaign_summary: {
        campaign_id: "",
        counters: summary.counters,
        ipqs: summary.ipqs,
        quality: summary.quality,
      },
      campaigns,
      sources: [],
    };
  }

  /**
   * List the affiliate's owned `campaign_key`s (from the registry item) and
   * fan out a parallel per-key summary by querying `counter#day#source`. Only
   * keys that are still LIVE on at least one ACTIVE campaign are returned —
   * the registry can carry historical keys that have since been delisted.
   */
  async getByAffiliateKeys(query: MetricsQuery): Promise<{
    range: { from_date: string; to_date: string };
    filters: { affiliate_id: string };
    keys: Array<{ campaign_key: string; counters: MetricsCounters }>;
  }> {
    this.validateQuery(query);
    if (!query.affiliate_id) {
      throw new Error("affiliate_id is required");
    }

    const pkName = this.constants.METRICS_TABLE_PARTITION_KEY;
    const skName = this.constants.METRICS_TABLE_SORT_KEY;
    const registryPk = `affiliate_keys#${query.affiliate_id}`;

    const registry = await this.dynamoDBUtil.get<{
      keys?: Set<string> | string[];
    }>({
      TableName: this.constants.METRICS_TABLE_NAME,
      Key: { [pkName]: registryPk, [skName]: registryPk },
    });

    const registryKeys = this.extractRegistryKeys(registry?.keys);
    if (registryKeys.length === 0) {
      return {
        range: { from_date: query.from_date, to_date: query.to_date },
        filters: { affiliate_id: query.affiliate_id },
        keys: [],
      };
    }

    // LIVE-only enforcement: drop any registry entry whose campaign_key is
    // not currently LIVE on at least one ACTIVE campaign.
    const liveKeys = new Set(await this.getAllLiveSourceKeys());
    const filteredKeys = registryKeys.filter((k) => liveKeys.has(k));

    const perKey = await Promise.all(
      filteredKeys.map(async (campaignKey) => {
        const items = await this.queryByPartition(
          this.pkSource(campaignKey),
          query.from_date,
          query.to_date,
        );
        return { campaign_key: campaignKey, counters: this.sumItems(items) };
      }),
    );

    return {
      range: { from_date: query.from_date, to_date: query.to_date },
      filters: { affiliate_id: query.affiliate_id },
      keys: perKey.sort((a, b) => b.counters.received - a.counters.received),
    };
  }

  /**
   * Per-campaign affiliate breakdown. Queries the item_type GSI for
   * `counter#day#campaign_affiliate`, filters to the requested campaign, and
   * groups by `affiliate_id`.
   */
  async getByCampaignAffiliates(
    campaignId: string,
    query: MetricsQuery,
  ): Promise<MetricsBreakdownData> {
    this.validateQuery(query);
    if (!campaignId) {
      throw new Error("campaign_id is required");
    }

    const items = await this.queryByItemTypeRange(
      "counter#day#campaign_affiliate",
      query.from_date,
      query.to_date,
    );

    const filtered = items.filter(
      (item) => item.campaign_id === campaignId && !!item.affiliate_id,
    );

    const affiliates = this.aggregateBreakdown(filtered, "affiliate_id");
    const summary = this.summarizeItems(filtered);

    return {
      range: { from_date: query.from_date, to_date: query.to_date },
      filters: { campaign_id: campaignId },
      campaign_summary: {
        campaign_id: campaignId,
        counters: summary.counters,
        ipqs: summary.ipqs,
        quality: summary.quality,
      },
      campaigns: [
        {
          key: campaignId,
          counters: summary.counters,
          ipqs: summary.ipqs,
          quality: summary.quality,
        },
      ],
      sources: affiliates,
    };
  }

  /**
   * Lightweight slice — IPQS block only. Same filter set as `/summary`.
   */
  async getIpqs(query: MetricsQuery): Promise<{
    range: { from_date: string; to_date: string };
    filters: MetricsSummaryData["filters"];
    ipqs: IpqsRollup;
  }> {
    const summary = await this.getSummary(query);
    return {
      range: summary.range,
      filters: summary.filters,
      ipqs: summary.ipqs ?? this.finalizeIpqs(this.emptyIpqs()),
    };
  }

  /**
   * Lightweight slice — quality block only. Same filter set as `/summary`.
   */
  async getQuality(query: MetricsQuery): Promise<{
    range: { from_date: string; to_date: string };
    filters: MetricsSummaryData["filters"];
    quality: QualityRollup;
  }> {
    const summary = await this.getSummary(query);
    return {
      range: summary.range,
      filters: summary.filters,
      quality:
        summary.quality ??
        this.finalizeQuality(this.emptyQuality(), summary.totals),
    };
  }

  async getDashboard(query: MetricsQuery): Promise<MetricsDashboardData> {
    this.validateQuery(query);

    const [
      summary,
      timeseries,
      campaignBySource,
      contracts,
      timeseriesBySource,
      hourly,
      ipqs,
      quality,
    ] = await Promise.all([
      this.getSummary(query),
      this.getTimeseries(query),
      this.getBreakdown(query),
      this.getContracts(query),
      this.getTimeseriesBySource(query),
      this.getHourly(query),
      this.getIpqs(query),
      this.getQuality(query),
    ]);

    return {
      range: {
        from_date: query.from_date,
        to_date: query.to_date,
      },
      filters: {
        ...(query.campaign_id ? { campaign_id: query.campaign_id } : {}),
        ...(query.campaign_key ? { campaign_key: query.campaign_key } : {}),
        ...(query.affiliate_id ? { affiliate_id: query.affiliate_id } : {}),
      },
      summary,
      timeseries,
      campaign_by_source: campaignBySource,
      contracts,
      timeseries_by_source: timeseriesBySource,
      hourly,
      ipqs,
      quality,
    };
  }

  /**
   * Multi-line per-affiliate timeseries (item 3). Two modes:
   *   - `campaign_id` provided: one series per LIVE `(affiliate_id,
   *     campaign_key)` on the campaign, sourced from
   *     `counter#day#campaign_source` partitions.
   *   - `campaign_id` absent: aggregate per-affiliate across ALL affiliates
   *     observed in the date range, sourced from the `counter#day#affiliate`
   *     item-type GSI; if `affiliate_id` is provided, restrict to that one
   *     affiliate.
   * Every series carries a fully padded `points[]` over the requested date
   * range (zero-filled missing buckets). `affiliate_name` falls back to
   * `affiliate_id` (no name client is injected here).
   */
  async getTimeseriesBySource(
    query: MetricsQuery,
  ): Promise<MetricsTimeseriesBySourceData> {
    this.validateQuery(query);

    const dates = this.eachDate(query.from_date, query.to_date);
    const filters: { campaign_id?: string; affiliate_id?: string } = {};
    if (query.campaign_id) filters.campaign_id = query.campaign_id;
    if (query.affiliate_id) filters.affiliate_id = query.affiliate_id;

    if (query.campaign_id) {
      const campaign = await this.getCampaign(query.campaign_id);
      if (!campaign || campaign.status !== CampaignStatus.ACTIVE) {
        return {
          range: { from_date: query.from_date, to_date: query.to_date },
          filters,
          series: [],
        };
      }

      const liveAffiliates = (campaign.affiliates ?? []).filter(
        (a) =>
          a.status === CampaignParticipantStatus.LIVE &&
          !!this.normalizeCampaignKey(a.campaign_key) &&
          !!a.affiliate_id &&
          (!query.affiliate_id || a.affiliate_id === query.affiliate_id),
      );
      if (liveAffiliates.length === 0) {
        return {
          range: { from_date: query.from_date, to_date: query.to_date },
          filters,
          series: [],
        };
      }

      const series = await Promise.all(
        liveAffiliates.map(async (affiliate) => {
          const key = this.normalizeCampaignKey(
            affiliate.campaign_key,
          ) as string;
          const items = await this.queryByPartition(
            this.pkCampaignSource(query.campaign_id as string, key),
            query.from_date,
            query.to_date,
          );
          const byBucket = new Map<string, number>();
          for (const item of items) {
            if (!item.bucket_start) continue;
            byBucket.set(item.bucket_start, item.received ?? 0);
          }
          const points = dates.map((bucket_start) => ({
            bucket_start,
            received: byBucket.get(bucket_start) ?? 0,
          }));
          const affiliateId = affiliate.affiliate_id as string;
          return {
            affiliate_id: affiliateId,
            affiliate_name: affiliateId,
            points,
          };
        }),
      );

      return {
        range: { from_date: query.from_date, to_date: query.to_date },
        filters,
        series,
      };
    }

    // No campaign filter: enumerate affiliates via the item_type GSI for
    // `counter#day#affiliate` over the range and aggregate per affiliate.
    const items = await this.queryByItemTypeRange(
      "counter#day#affiliate",
      query.from_date,
      query.to_date,
    );

    const buckets = new Map<string, Map<string, number>>();
    for (const item of items) {
      const affiliateId = item.affiliate_id;
      const bucket = item.bucket_start;
      if (!affiliateId || !bucket) continue;
      if (query.affiliate_id && affiliateId !== query.affiliate_id) continue;
      let byBucket = buckets.get(affiliateId);
      if (!byBucket) {
        byBucket = new Map<string, number>();
        buckets.set(affiliateId, byBucket);
      }
      byBucket.set(bucket, (byBucket.get(bucket) ?? 0) + (item.received ?? 0));
    }

    const series = Array.from(buckets.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([affiliateId, byBucket]) => ({
        affiliate_id: affiliateId,
        affiliate_name: affiliateId,
        points: dates.map((bucket_start) => ({
          bucket_start,
          received: byBucket.get(bucket_start) ?? 0,
        })),
      }));

    return {
      range: { from_date: query.from_date, to_date: query.to_date },
      filters,
      series,
    };
  }

  /**
   * Hourly + weekday/weekend rollup (item 4). Sources the existing
   * `counter#hour#*` items written by `emitLeadOutcomeEvent`. All time math is
   * done in UTC for parity with `bucket_start` storage; see
   * `MetricsHourlyData` for the day/night and weekday/weekend partitioning.
   */
  async getHourly(query: MetricsQuery): Promise<MetricsHourlyData> {
    this.validateQuery(query);

    const items = await this.getHourlyItems(query);

    const byHour = new Map<
      string,
      { date: string; hour: number; weekday: number; counters: MetricsCounters }
    >();

    for (const item of items) {
      if (!item.bucket_start) continue;
      const date = new Date(item.bucket_start);
      if (Number.isNaN(date.getTime())) continue;
      const dateKey = date.toISOString().slice(0, 10);
      const hour = date.getUTCHours();
      const weekday = date.getUTCDay();
      const key = `${dateKey}|${hour}`;
      const counters = this.toItemCounters(item);
      const existing = byHour.get(key);
      if (existing) {
        existing.counters = this.addCounters(existing.counters, counters);
      } else {
        byHour.set(key, { date: dateKey, hour, weekday, counters });
      }
    }

    const points = Array.from(byHour.values()).sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return a.hour - b.hour;
    });

    const filters: { campaign_id?: string; affiliate_id?: string } = {};
    if (query.campaign_id) filters.campaign_id = query.campaign_id;
    if (query.affiliate_id) filters.affiliate_id = query.affiliate_id;

    return {
      range: { from_date: query.from_date, to_date: query.to_date },
      filters,
      points,
    };
  }

  /**
   * Pick the hour partition matching the requested filter combination. This
   * mirrors the routing used by `getHourlyPointsForSummary` but exposes the
   * raw `MetricsCounterItem` list for downstream rollup logic.
   */
  private async getHourlyItems(
    query: MetricsQuery,
  ): Promise<MetricsCounterItem[]> {
    const source = this.normalizeCampaignKey(query.campaign_key);
    const affiliateId = query.affiliate_id;
    const pk = affiliateId
      ? query.campaign_id
        ? this.pkCampaignAffiliate(query.campaign_id, affiliateId, "hour")
        : this.pkAffiliate(affiliateId, "hour")
      : query.campaign_id
        ? source
          ? this.pkCampaignSource(query.campaign_id, source, "hour")
          : this.pkCampaign(query.campaign_id, "hour")
        : source
          ? this.pkSource(source, "hour")
          : this.pkGlobal("hour");

    const fromHour = `${query.from_date}T00:00:00.000Z`;
    const toHour = `${query.to_date}T23:59:59.999Z`;
    return this.queryByPartition(pk, fromHour, toHour);
  }

  /**
   * Classify a UTC timestamp into one of the four day/night × weekday/weekend
   * buckets. day = 06:00–17:59 UTC, night = 18:00–05:59 UTC.
   * weekday = Mon–Fri, weekend = Sat/Sun (UTC day-of-week).
   */
  private dayNightBucket(date: Date): DayNightBucket {
    const hour = date.getUTCHours();
    const dow = date.getUTCDay(); // 0 = Sunday, 6 = Saturday
    const isWeekend = dow === 0 || dow === 6;
    const isDay = hour >= 6 && hour < 18;
    if (isWeekend) return isDay ? "weekend_day" : "weekend_night";
    return isDay ? "weekday_day" : "weekday_night";
  }

  /**
   * GSI2 query: PK = affiliate_id, SK = bucket_start_composite. We range over
   * `{from_date}#{itemTypePrefix}` → `{to_date}#{itemTypePrefix}~` so the
   * key condition itself filters by item_type without a Scan or filter
   * expression. `~` sorts after any URL-safe character so the upper bound is
   * inclusive of all composites for the upper date.
   */
  private async queryByAffiliateGsi2(
    affiliateId: string,
    itemType: string,
    fromDate: string,
    toDate: string,
  ): Promise<MetricsCounterItem[]> {
    const indexName =
      this.constants.METRICS_AFFILIATE_ID_BUCKET_START_COMPOSITE_INDEX_NAME;
    const pkName =
      this.constants
        .METRICS_AFFILIATE_ID_BUCKET_START_COMPOSITE_INDEX_PARTITION_KEY;
    const skName =
      this.constants.METRICS_AFFILIATE_ID_BUCKET_START_COMPOSITE_INDEX_SORT_KEY;

    const result = await this.dynamoDBUtil.queryAll<MetricsCounterItem>({
      TableName: this.constants.METRICS_TABLE_NAME,
      IndexName: indexName,
      KeyConditionExpression: "#pk = :pk AND #sk BETWEEN :from AND :to",
      FilterExpression: "#item_type = :item_type",
      ExpressionAttributeNames: {
        "#pk": pkName,
        "#sk": skName,
        "#item_type": this.constants.METRICS_TABLE_ITEM_TYPE_ATTRIBUTE,
      },
      ExpressionAttributeValues: {
        ":pk": affiliateId,
        ":from": `${fromDate}#`,
        ":to": `${toDate}#~`,
        ":item_type": itemType,
      },
      ScanIndexForward: true,
    });

    return result;
  }

  private extractRegistryKeys(
    raw: Set<string> | string[] | undefined,
  ): string[] {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.filter((k): k is string => !!k);
    return Array.from(raw).filter((k): k is string => !!k);
  }

  private async getAllLiveSourceKeys(): Promise<Set<string>> {
    const campaigns = await this.getActiveCampaigns();
    const union = new Set<string>();
    for (const c of campaigns) {
      for (const k of this.getLiveCampaignSourceKeys(c)) union.add(k);
    }
    return union;
  }

  private validateQuery(query: MetricsQuery): void {
    const isDate = (value: string) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const parsed = new Date(`${value}T00:00:00.000Z`);
      if (Number.isNaN(parsed.getTime())) return false;
      return parsed.toISOString().slice(0, 10) === value;
    };

    if (!query.from_date || !query.to_date) {
      throw new Error("from_date and to_date are required (YYYY-MM-DD)");
    }
    if (!isDate(query.from_date) || !isDate(query.to_date)) {
      throw new Error("from_date and to_date must be YYYY-MM-DD");
    }
    if (query.from_date > query.to_date) {
      throw new Error("from_date must be less than or equal to to_date");
    }

    const today = new Date().toISOString().slice(0, 10);
    if (query.to_date > today) {
      throw new Error("to_date cannot be in the future");
    }

    const fromDate = new Date(`${query.from_date}T00:00:00.000Z`);
    const toDate = new Date(`${query.to_date}T00:00:00.000Z`);
    const diffDays =
      Math.floor((toDate.getTime() - fromDate.getTime()) / 86_400_000) + 1;
    if (diffDays > MetricsService.MAX_QUERY_RANGE_DAYS) {
      throw new Error(
        `date range exceeds maximum window of ${MetricsService.MAX_QUERY_RANGE_DAYS} days`,
      );
    }

    if (query.affiliate_id && query.campaign_key) {
      // Mutual exclusion: affiliate_id is the per-affiliate pivot, campaign_key
      // is the per-link pivot; combining them is ambiguous (per CR-001 §20).
      throw new Error(
        "affiliate_id and campaign_key cannot be combined; use one or the other",
      );
    }
  }

  private toDayBucketStart(isoTimestamp: string): string {
    if (/^\d{4}-\d{2}-\d{2}$/.test(isoTimestamp)) {
      return isoTimestamp;
    }
    return new Date(isoTimestamp).toISOString().slice(0, 10);
  }

  private toHourBucketStart(isoTimestamp: string): string {
    const date = new Date(isoTimestamp);
    date.setUTCMinutes(0, 0, 0);
    return date.toISOString();
  }

  private normalizeCampaignKey(source?: string): string | undefined {
    if (!source) return undefined;
    const trimmed = source.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private pkGlobal(granularity: "day" | "hour" = "day"): string {
    return `counter#${granularity}#global`;
  }

  private pkCampaign(
    campaignId: string,
    granularity: "day" | "hour" = "day",
  ): string {
    return `counter#${granularity}#campaign#${campaignId}`;
  }

  private pkSource(
    source: string,
    granularity: "day" | "hour" = "day",
  ): string {
    return `counter#${granularity}#source#${source}`;
  }

  private pkCampaignSource(
    campaignId: string,
    source: string,
    granularity: "day" | "hour" = "day",
  ): string {
    return `counter#${granularity}#campaign_source#${campaignId}#${source}`;
  }

  private pkContract(
    contractId: string,
    granularity: "day" | "hour" = "day",
  ): string {
    return `counter#${granularity}#contract#${contractId}`;
  }

  private pkContractCampaign(
    contractId: string,
    campaignId: string,
    granularity: "day" | "hour" = "day",
  ): string {
    return `counter#${granularity}#contract_campaign#${contractId}#${campaignId}`;
  }

  private pkContractAffiliate(
    contractId: string,
    affiliateId: string,
    granularity: "day" | "hour" = "day",
  ): string {
    return `counter#${granularity}#contract_affiliate#${contractId}#${affiliateId}`;
  }

  private pkContractCampaignAffiliate(
    contractId: string,
    campaignId: string,
    affiliateId: string,
    granularity: "day" | "hour" = "day",
  ): string {
    return `counter#${granularity}#contract_campaign_affiliate#${contractId}#${campaignId}#${affiliateId}`;
  }

  private pkAffiliate(
    affiliateId: string,
    granularity: "day" | "hour" = "day",
  ): string {
    return `counter#${granularity}#affiliate#${affiliateId}`;
  }

  private pkCampaignAffiliate(
    campaignId: string,
    affiliateId: string,
    granularity: "day" | "hour" = "day",
  ): string {
    return `counter#${granularity}#campaign_affiliate#${campaignId}#${affiliateId}`;
  }

  private skBucket(bucketStart: string): string {
    return `bucket#${bucketStart}`;
  }

  private buildCounterUpdate(args: {
    pk: string;
    sk: string;
    itemType: string;
    bucketStart: string;
    campaignId?: string;
    source?: string;
    contractId?: string;
    affiliateId?: string;
    counters: MetricsCounters;
    event: LeadOutcomeEvent;
    /** When true, ADD the IPQS / duplicate / rejection-bucket counters. Day items only. */
    extended: boolean;
    now: string;
  }): {
    Update: {
      TableName: string;
      Key: Record<string, unknown>;
      UpdateExpression: string;
      ExpressionAttributeNames: Record<string, string>;
      ExpressionAttributeValues: Record<string, unknown>;
    };
  } {
    const pkName = this.constants.METRICS_TABLE_PARTITION_KEY;
    const skName = this.constants.METRICS_TABLE_SORT_KEY;
    const itemTypeName = this.constants.METRICS_TABLE_ITEM_TYPE_ATTRIBUTE;
    const bucketStartName = this.constants.METRICS_TABLE_BUCKET_START_ATTRIBUTE;

    const setSegments = [
      "#item_type = if_not_exists(#item_type, :item_type)",
      "#bucket_start = if_not_exists(#bucket_start, :bucket_start)",
      "#updated_at = :updated_at",
    ];

    const names: Record<string, string> = {
      "#item_type": itemTypeName,
      "#bucket_start": bucketStartName,
      "#updated_at": "updated_at",
      "#received": "received",
      "#accepted": "accepted",
      "#sold": "sold",
      "#accepted_not_sold": "accepted_not_sold",
      "#rejected": "rejected",
      "#cherry_picked": "cherry_picked",
    };

    const values: Record<string, unknown> = {
      ":item_type": args.itemType,
      ":bucket_start": args.bucketStart,
      ":updated_at": args.now,
      ":received": args.counters.received,
      ":accepted": args.counters.accepted,
      ":sold": args.counters.sold,
      ":accepted_not_sold": args.counters.accepted_not_sold,
      ":rejected": args.counters.rejected,
      ":cherry_picked": args.counters.cherry_picked,
    };

    const addSegments: string[] = [
      "#received :received",
      "#accepted :accepted",
      "#sold :sold",
      "#accepted_not_sold :accepted_not_sold",
      "#rejected :rejected",
      "#cherry_picked :cherry_picked",
    ];

    if (args.campaignId) {
      names["#campaign_id"] = "campaign_id";
      values[":campaign_id"] = args.campaignId;
      setSegments.push(
        "#campaign_id = if_not_exists(#campaign_id, :campaign_id)",
      );
    }
    if (args.source) {
      names["#source"] = "source";
      values[":source"] = args.source;
      setSegments.push("#source = if_not_exists(#source, :source)");
    }
    if (args.contractId) {
      names["#contract_id"] = "contract_id";
      values[":contract_id"] = args.contractId;
      setSegments.push(
        "#contract_id = if_not_exists(#contract_id, :contract_id)",
      );
    }

    // ── GSI2 projection requirements ────────────────────────────────────────
    // Every affiliate-dimensional item carries `affiliate_id` (PK on GSI2)
    // and `bucket_start_composite` (SK on GSI2). The composite encodes
    // bucket_start#item_type#campaign_id_or_underscore so per-affiliate range
    // queries can be sliced by item_type prefix.
    if (args.affiliateId) {
      names["#affiliate_id"] = "affiliate_id";
      values[":affiliate_id"] = args.affiliateId;
      setSegments.push(
        "#affiliate_id = if_not_exists(#affiliate_id, :affiliate_id)",
      );
      const composite = `${args.bucketStart}#${args.itemType}#${
        args.campaignId ?? "_"
      }`;
      names["#bucket_start_composite"] = "bucket_start_composite";
      values[":bucket_start_composite"] = composite;
      setSegments.push(
        "#bucket_start_composite = if_not_exists(#bucket_start_composite, :bucket_start_composite)",
      );
    }

    // ── Extended attributes (day items only) ────────────────────────────────
    // Per CR-001 §3: IPQS pass/fail ×3, fraud_score sum/count ×3, dup_count,
    // and 9 rejection-bucket counters live on `counter#day#*` items only.
    if (args.extended) {
      const ext = this.computeExtendedAttrs(args.event);
      for (const [attr, val] of Object.entries(ext)) {
        const placeholder = `#${attr}`;
        const valPlaceholder = `:${attr}`;
        names[placeholder] = attr;
        values[valPlaceholder] = val;
        addSegments.push(`${placeholder} ${valPlaceholder}`);
      }
    }

    return {
      Update: {
        TableName: this.constants.METRICS_TABLE_NAME,
        Key: {
          [pkName]: args.pk,
          [skName]: args.sk,
        },
        UpdateExpression:
          `SET ${setSegments.join(", ")} ` + `ADD ${addSegments.join(", ")}`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      },
    };
  }

  /**
   * Compute the per-emit increments for IPQS pass/fail, fraud-score sum/count,
   * dup_count, and the 9 rejection-bucket counters. Only attrs with non-zero
   * deltas are returned — keeps the UpdateExpression compact.
   */
  private computeExtendedAttrs(
    event: LeadOutcomeEvent,
  ): Record<string, number> {
    const out: Record<string, number> = {};

    // Per-check pass/fail (only when the check ran).
    for (const channel of ["phone", "email", "ip"] as const) {
      const check = event.ipqs[channel];
      if (!check.ran) continue;
      if (check.pass === true) out[`ipqs_${channel}_pass`] = 1;
      else if (check.pass === false) out[`ipqs_${channel}_fail`] = 1;
      if (
        typeof check.fraud_score === "number" &&
        Number.isFinite(check.fraud_score)
      ) {
        out[`ipqs_${channel}_score_sum`] = check.fraud_score;
        out[`ipqs_${channel}_score_count`] = 1;
      }
    }

    if (event.duplicate) {
      out.dup_count = 1;
    }

    // Rejection buckets — one ADD per entry. Multi-bucket (e.g., ipqs phone+ip)
    // is supported because rejection_buckets is an array.
    for (const bucket of event.rejection_buckets) {
      const attr = `rej_${bucket}`;
      out[attr] = (out[attr] ?? 0) + 1;
    }

    // Primary-classification split (item 5). Each rejected event increments
    // exactly ONE of duplicates/spam/dnq so that the read-side invariant
    //   rejected_dnq + rejected_spam + rejected_duplicates === rejected
    // holds across any aggregation window.
    if (event.rejected === 1 && event.rejection_buckets.length > 0) {
      const split = this.classifyRejectionSplit(event.rejection_buckets);
      out[`rej_split_${split}`] = 1;
    }

    return out;
  }

  /**
   * Reduce the per-event rejection bucket list down to a single primary
   * classification. Order of precedence is fixed so a lead that fails both
   * IPQS and is also a duplicate is counted as a duplicate (the cheaper,
   * upstream cause).
   */
  private classifyRejectionSplit(
    buckets: ReadonlyArray<string>,
  ): "duplicates" | "spam" | "dnq" {
    if (buckets.includes("duplicate")) return "duplicates";
    if (
      buckets.includes("trusted_form") ||
      buckets.includes("ipqs_phone") ||
      buckets.includes("ipqs_email") ||
      buckets.includes("ipqs_ip")
    ) {
      return "spam";
    }
    return "dnq";
  }

  /**
   * Affiliate registry item: `affiliate_keys#{affiliate_id}` carries a string
   * set `keys` containing every `campaign_key` the affiliate has emitted under.
   * Set semantics dedupe naturally; no conditional check needed.
   */
  private buildAffiliateRegistryUpdate(
    affiliateId: string,
    campaignKey: string,
    now: string,
  ): {
    Update: {
      TableName: string;
      Key: Record<string, unknown>;
      UpdateExpression: string;
      ExpressionAttributeNames: Record<string, string>;
      ExpressionAttributeValues: Record<string, unknown>;
    };
  } {
    const pkName = this.constants.METRICS_TABLE_PARTITION_KEY;
    const skName = this.constants.METRICS_TABLE_SORT_KEY;
    const itemTypeName = this.constants.METRICS_TABLE_ITEM_TYPE_ATTRIBUTE;

    const pk = `affiliate_keys#${affiliateId}`;
    return {
      Update: {
        TableName: this.constants.METRICS_TABLE_NAME,
        Key: {
          [pkName]: pk,
          [skName]: pk,
        },
        UpdateExpression:
          "SET #item_type = if_not_exists(#item_type, :item_type), " +
          "#affiliate_id = if_not_exists(#affiliate_id, :affiliate_id), " +
          "#updated_at = :updated_at " +
          "ADD #keys :ks",
        ExpressionAttributeNames: {
          "#item_type": itemTypeName,
          "#affiliate_id": "affiliate_id",
          "#updated_at": "updated_at",
          "#keys": "keys",
        },
        ExpressionAttributeValues: {
          ":item_type": "affiliate_keys",
          ":affiliate_id": affiliateId,
          ":updated_at": now,
          ":ks": new Set([campaignKey]),
        },
      },
    };
  }

  private async getPointsForSummary(query: MetricsQuery): Promise<
    Array<{
      bucket_start: string;
      counters: MetricsCounters;
      ipqs: IpqsRollup;
      quality: QualityRollup;
      raw: MetricsCounterItem;
    }>
  > {
    const source = this.normalizeCampaignKey(query.campaign_key);
    const affiliateId = query.affiliate_id;
    // ── Routing matrix (CR-001 §16):
    //   no filter                          → day#global
    //   campaign_id only                   → day#campaign
    //   campaign_key only                  → day#source (== day#campaign_key)
    //   affiliate_id only                  → day#affiliate
    //   campaign_id + campaign_key         → day#campaign_source
    //   campaign_id + affiliate_id         → day#campaign_affiliate
    // `campaign_key` + `affiliate_id` is rejected upstream by validateQuery.
    const pk = affiliateId
      ? query.campaign_id
        ? this.pkCampaignAffiliate(query.campaign_id, affiliateId)
        : this.pkAffiliate(affiliateId)
      : query.campaign_id
        ? source
          ? this.pkCampaignSource(query.campaign_id, source)
          : this.pkCampaign(query.campaign_id)
        : source
          ? this.pkSource(source)
          : this.pkGlobal();

    const items = await this.queryByPartition(
      pk,
      query.from_date,
      query.to_date,
    );

    return items
      .map((item) => ({
        bucket_start: item.bucket_start ?? "",
        counters: this.toItemCounters(item),
        ipqs: this.toItemIpqs(item),
        quality: this.toItemQuality(item),
        raw: item,
      }))
      .filter((point) => point.bucket_start);
  }

  private async getHourlyPointsForSummary(
    query: MetricsQuery,
  ): Promise<Array<{ bucket_start: string; counters: MetricsCounters }>> {
    const source = this.normalizeCampaignKey(query.campaign_key);
    const affiliateId = query.affiliate_id;
    const pk = affiliateId
      ? query.campaign_id
        ? this.pkCampaignAffiliate(query.campaign_id, affiliateId, "hour")
        : this.pkAffiliate(affiliateId, "hour")
      : query.campaign_id
        ? source
          ? this.pkCampaignSource(query.campaign_id, source, "hour")
          : this.pkCampaign(query.campaign_id, "hour")
        : source
          ? this.pkSource(source, "hour")
          : this.pkGlobal("hour");

    const fromHour = `${query.from_date}T00:00:00.000Z`;
    const toHour = `${query.to_date}T23:59:59.999Z`;

    const items = await this.queryByPartition(pk, fromHour, toHour);

    return items
      .map((item) => ({
        bucket_start: item.bucket_start ?? "",
        counters: this.toItemCounters(item),
      }))
      .filter((point) => point.bucket_start);
  }

  private pickPeakLeadWindow(
    points: Array<{ bucket_start: string; counters: MetricsCounters }>,
    totalReceived: number,
  ): MetricsSummaryData["peak_lead_window"] {
    if (points.length === 0 || totalReceived <= 0) {
      return null;
    }

    const peak = [...points].sort((a, b) => {
      if (b.counters.received !== a.counters.received) {
        return b.counters.received - a.counters.received;
      }
      return a.bucket_start.localeCompare(b.bucket_start);
    })[0];

    if (!peak || peak.counters.received <= 0) {
      return null;
    }

    const startDate = new Date(peak.bucket_start);
    const endDate = new Date(startDate.getTime() + 60 * 60 * 1000);
    const startHour = startDate.getUTCHours().toString().padStart(2, "0");
    const endHour = endDate.getUTCHours().toString().padStart(2, "0");

    return {
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      label: `${startHour}:00-${endHour}:00 UTC`,
      received: peak.counters.received,
      total_received: totalReceived,
      share_percent: Math.round((peak.counters.received / totalReceived) * 100),
    };
  }

  private async queryByPartition(
    pk: string,
    fromDate: string,
    toDate: string,
  ): Promise<MetricsCounterItem[]> {
    const pkName = this.constants.METRICS_TABLE_PARTITION_KEY;
    const skName = this.constants.METRICS_TABLE_SORT_KEY;

    const result = await this.dynamoDBUtil.queryAll<MetricsCounterItem>({
      TableName: this.constants.METRICS_TABLE_NAME,
      KeyConditionExpression: "#pk = :pk AND #sk BETWEEN :from_sk AND :to_sk",
      ExpressionAttributeNames: {
        "#pk": pkName,
        "#sk": skName,
      },
      ExpressionAttributeValues: {
        ":pk": pk,
        ":from_sk": this.skBucket(fromDate),
        ":to_sk": this.skBucket(toDate),
      },
      ScanIndexForward: true,
    });

    return result;
  }

  private async queryByItemTypeRange(
    itemType: string,
    fromDate: string,
    toDate: string,
  ): Promise<MetricsCounterItem[]> {
    const indexName = this.constants.METRICS_ITEM_TYPE_BUCKET_START_INDEX_NAME;
    const itemTypePk =
      this.constants.METRICS_ITEM_TYPE_BUCKET_START_INDEX_PARTITION_KEY;
    const bucketSk =
      this.constants.METRICS_ITEM_TYPE_BUCKET_START_INDEX_SORT_KEY;

    const result = await this.dynamoDBUtil.queryAll<MetricsCounterItem>({
      TableName: this.constants.METRICS_TABLE_NAME,
      IndexName: indexName,
      KeyConditionExpression:
        "#item_type = :item_type AND #bucket_start BETWEEN :from_date AND :to_date",
      ExpressionAttributeNames: {
        "#item_type": itemTypePk,
        "#bucket_start": bucketSk,
      },
      ExpressionAttributeValues: {
        ":item_type": itemType,
        ":from_date": fromDate,
        ":to_date": toDate,
      },
      ScanIndexForward: true,
    });

    return result;
  }

  private aggregateBreakdown(
    items: MetricsCounterItem[],
    keyField: "campaign_id" | "source" | "affiliate_id",
  ): MetricsBreakdownEntry[] {
    type Bucket = {
      counters: MetricsCounters;
      splits: RejectionSplits;
      ipqs: IpqsRollup;
      quality: QualityRollup;
    };
    const grouped = new Map<string, Bucket>();

    for (const item of items) {
      const key = item[keyField];
      if (!key) continue;
      const existing =
        grouped.get(key) ??
        ({
          counters: this.emptyCounters(),
          splits: this.emptySplits(),
          ipqs: this.emptyIpqs(),
          quality: this.emptyQuality(),
        } as Bucket);
      grouped.set(key, {
        counters: this.addCounters(
          existing.counters,
          this.toItemCounters(item),
        ),
        splits: this.addSplits(existing.splits, this.toItemSplits(item)),
        ipqs: this.addIpqs(existing.ipqs, this.toItemIpqs(item)),
        quality: this.addQuality(existing.quality, this.toItemQuality(item)),
      });
    }

    return Array.from(grouped.entries())
      .map(([key, b]) => ({
        key,
        counters: this.withSplits(b.counters, b.splits),
        ipqs: this.finalizeIpqs(b.ipqs),
        quality: this.finalizeQuality(b.quality, b.counters),
      }))
      .sort((a, b) => b.counters.received - a.counters.received);
  }

  private aggregateCampaignsForIds(
    campaignIds: string[],
    items: MetricsCounterItem[],
  ): MetricsBreakdownEntry[] {
    type Bucket = {
      counters: MetricsCounters;
      splits: RejectionSplits;
      ipqs: IpqsRollup;
      quality: QualityRollup;
    };
    const grouped = new Map<string, Bucket>();

    for (const campaignId of campaignIds) {
      grouped.set(campaignId, {
        counters: this.emptyCounters(),
        splits: this.emptySplits(),
        ipqs: this.emptyIpqs(),
        quality: this.emptyQuality(),
      });
    }

    for (const item of items) {
      if (!item.campaign_id || !grouped.has(item.campaign_id)) {
        continue;
      }

      const existing = grouped.get(item.campaign_id) as Bucket;
      grouped.set(item.campaign_id, {
        counters: this.addCounters(
          existing.counters,
          this.toItemCounters(item),
        ),
        splits: this.addSplits(existing.splits, this.toItemSplits(item)),
        ipqs: this.addIpqs(existing.ipqs, this.toItemIpqs(item)),
        quality: this.addQuality(existing.quality, this.toItemQuality(item)),
      });
    }

    return Array.from(grouped.entries())
      .map(([key, b]) => ({
        key,
        counters: this.withSplits(b.counters, b.splits),
        ipqs: this.finalizeIpqs(b.ipqs),
        quality: this.finalizeQuality(b.quality, b.counters),
      }))
      .sort((a, b) => b.counters.received - a.counters.received);
  }

  /**
   * Summarize a flat list of counter items into finalized counters + IPQS +
   * quality rollups. Used to populate `campaign_summary` on breakdown
   * responses so callers see the same per-entry rollups in aggregate form.
   */
  private summarizeItems(items: MetricsCounterItem[]): {
    counters: MetricsCountersWithSplits;
    ipqs: IpqsRollup;
    quality: QualityRollup;
  } {
    const counters = this.sumItems(items);
    const splits = this.sumSplitsFromItems(items);
    const ipqs = this.finalizeIpqs(
      items.reduce(
        (acc, item) => this.addIpqs(acc, this.toItemIpqs(item)),
        this.emptyIpqs(),
      ),
    );
    const quality = this.finalizeQuality(
      items.reduce(
        (acc, item) => this.addQuality(acc, this.toItemQuality(item)),
        this.emptyQuality(),
      ),
      counters,
    );
    return { counters: this.withSplits(counters, splits), ipqs, quality };
  }

  private toItemCounters(item: MetricsCounterItem): MetricsCounters {
    return {
      received: item.received ?? 0,
      accepted: item.accepted ?? 0,
      sold: item.sold ?? 0,
      accepted_not_sold: item.accepted_not_sold ?? 0,
      rejected: item.rejected ?? 0,
      cherry_picked: item.cherry_picked ?? 0,
    };
  }

  private emptyCounters(): MetricsCounters {
    return {
      received: 0,
      accepted: 0,
      sold: 0,
      accepted_not_sold: 0,
      rejected: 0,
      cherry_picked: 0,
    };
  }

  private addCounters(a: MetricsCounters, b: MetricsCounters): MetricsCounters {
    return {
      received: a.received + b.received,
      accepted: a.accepted + b.accepted,
      sold: a.sold + b.sold,
      accepted_not_sold: a.accepted_not_sold + b.accepted_not_sold,
      rejected: a.rejected + b.rejected,
      cherry_picked: a.cherry_picked + b.cherry_picked,
    };
  }

  private sumItems(items: MetricsCounterItem[]): MetricsCounters {
    return items.reduce(
      (acc, item) => this.addCounters(acc, this.toItemCounters(item)),
      this.emptyCounters(),
    );
  }

  // ── Rejection-cause splits (item 5) ────────────────────────────────────────

  private emptySplits(): RejectionSplits {
    return { rejected_dnq: 0, rejected_spam: 0, rejected_duplicates: 0 };
  }

  private toItemSplits(item: MetricsCounterItem): RejectionSplits {
    return {
      rejected_dnq: item.rej_split_dnq ?? 0,
      rejected_spam: item.rej_split_spam ?? 0,
      rejected_duplicates: item.rej_split_duplicates ?? 0,
    };
  }

  private addSplits(a: RejectionSplits, b: RejectionSplits): RejectionSplits {
    return {
      rejected_dnq: a.rejected_dnq + b.rejected_dnq,
      rejected_spam: a.rejected_spam + b.rejected_spam,
      rejected_duplicates: a.rejected_duplicates + b.rejected_duplicates,
    };
  }

  private sumSplitsFromItems(items: MetricsCounterItem[]): RejectionSplits {
    return items.reduce(
      (acc, item) => this.addSplits(acc, this.toItemSplits(item)),
      this.emptySplits(),
    );
  }

  private withSplits(
    counters: MetricsCounters,
    splits: RejectionSplits,
  ): MetricsCountersWithSplits {
    return { ...counters, ...splits };
  }

  // ── Extended-attribute helpers ─────────────────────────────────────────────
  // IPQS rollup: pass/fail counts and a running fraud_score sum/count per
  // channel. avg_fraud_score is materialized lazily by `finalizeIpqs`.

  private emptyIpqsCheck(): IpqsCheckRollup {
    return {
      pass: 0,
      fail: 0,
      score_sum: 0,
      score_count: 0,
      avg_fraud_score: null,
    };
  }

  private emptyIpqs(): IpqsRollup {
    return {
      phone: this.emptyIpqsCheck(),
      email: this.emptyIpqsCheck(),
      ip: this.emptyIpqsCheck(),
      trusted_score_pct: null,
    };
  }

  private toItemIpqs(item: MetricsCounterItem): IpqsRollup {
    return {
      phone: {
        pass: item.ipqs_phone_pass ?? 0,
        fail: item.ipqs_phone_fail ?? 0,
        score_sum: item.ipqs_phone_score_sum ?? 0,
        score_count: item.ipqs_phone_score_count ?? 0,
        avg_fraud_score: null,
      },
      email: {
        pass: item.ipqs_email_pass ?? 0,
        fail: item.ipqs_email_fail ?? 0,
        score_sum: item.ipqs_email_score_sum ?? 0,
        score_count: item.ipqs_email_score_count ?? 0,
        avg_fraud_score: null,
      },
      ip: {
        pass: item.ipqs_ip_pass ?? 0,
        fail: item.ipqs_ip_fail ?? 0,
        score_sum: item.ipqs_ip_score_sum ?? 0,
        score_count: item.ipqs_ip_score_count ?? 0,
        avg_fraud_score: null,
      },
      trusted_score_pct: null,
    };
  }

  private addIpqsCheck(
    a: IpqsCheckRollup,
    b: IpqsCheckRollup,
  ): IpqsCheckRollup {
    return {
      pass: a.pass + b.pass,
      fail: a.fail + b.fail,
      score_sum: a.score_sum + b.score_sum,
      score_count: a.score_count + b.score_count,
      avg_fraud_score: null,
    };
  }

  private addIpqs(a: IpqsRollup, b: IpqsRollup): IpqsRollup {
    return {
      phone: this.addIpqsCheck(a.phone, b.phone),
      email: this.addIpqsCheck(a.email, b.email),
      ip: this.addIpqsCheck(a.ip, b.ip),
      trusted_score_pct: null,
    };
  }

  private finalizeIpqsCheck(rollup: IpqsCheckRollup): IpqsCheckRollup {
    return {
      ...rollup,
      avg_fraud_score:
        rollup.score_count > 0 ? rollup.score_sum / rollup.score_count : null,
    };
  }

  private finalizeIpqs(rollup: IpqsRollup): IpqsRollup {
    const phone = this.finalizeIpqsCheck(rollup.phone);
    const email = this.finalizeIpqsCheck(rollup.email);
    const ip = this.finalizeIpqsCheck(rollup.ip);
    const totalPass = phone.pass + email.pass + ip.pass;
    const totalChecks =
      phone.pass + phone.fail + email.pass + email.fail + ip.pass + ip.fail;
    const trustedScorePct =
      totalChecks > 0 ? (totalPass / totalChecks) * 100 : null;
    return {
      phone,
      email,
      ip,
      trusted_score_pct: trustedScorePct,
    };
  }

  private emptyQuality(): QualityRollup {
    return {
      duplicate_count: 0,
      rejection_buckets: {
        duplicate: 0,
        validation: 0,
        logic_rules: 0,
        trusted_form: 0,
        ipqs_phone: 0,
        ipqs_email: 0,
        ipqs_ip: 0,
        affiliate_disabled: 0,
        other: 0,
      },
      source_quality_score: null,
      duplicate_pct: null,
    };
  }

  private toItemQuality(item: MetricsCounterItem): QualityRollup {
    return {
      duplicate_count: item.dup_count ?? 0,
      rejection_buckets: {
        duplicate: item.rej_duplicate ?? 0,
        validation: item.rej_validation ?? 0,
        logic_rules: item.rej_logic_rules ?? 0,
        trusted_form: item.rej_trusted_form ?? 0,
        ipqs_phone: item.rej_ipqs_phone ?? 0,
        ipqs_email: item.rej_ipqs_email ?? 0,
        ipqs_ip: item.rej_ipqs_ip ?? 0,
        affiliate_disabled: item.rej_affiliate_disabled ?? 0,
        other: item.rej_other ?? 0,
      },
      source_quality_score: null,
      duplicate_pct: null,
    };
  }

  private addQuality(a: QualityRollup, b: QualityRollup): QualityRollup {
    const add = (k: keyof QualityRollup["rejection_buckets"]) =>
      a.rejection_buckets[k] + b.rejection_buckets[k];
    return {
      duplicate_count: a.duplicate_count + b.duplicate_count,
      rejection_buckets: {
        duplicate: add("duplicate"),
        validation: add("validation"),
        logic_rules: add("logic_rules"),
        trusted_form: add("trusted_form"),
        ipqs_phone: add("ipqs_phone"),
        ipqs_email: add("ipqs_email"),
        ipqs_ip: add("ipqs_ip"),
        affiliate_disabled: add("affiliate_disabled"),
        other: add("other"),
      },
      source_quality_score: null,
      duplicate_pct: null,
    };
  }

  private finalizeQuality(
    rollup: QualityRollup,
    counters: MetricsCounters,
  ): QualityRollup {
    const denom = counters.received - rollup.duplicate_count;
    const sourceQualityScore =
      denom > 0 ? Number(((counters.accepted / denom) * 100).toFixed(2)) : null;
    const duplicatePct =
      counters.received > 0
        ? Number(
            ((rollup.duplicate_count / counters.received) * 100).toFixed(2),
          )
        : null;
    return {
      ...rollup,
      source_quality_score: sourceQualityScore,
      duplicate_pct: duplicatePct,
    };
  }

  private sumPoints(
    points: Array<{ counters: MetricsCounters }>,
  ): MetricsCounters {
    return points.reduce(
      (acc, point) => this.addCounters(acc, point.counters),
      this.emptyCounters(),
    );
  }

  private eachDate(fromDate: string, toDate: string): string[] {
    const output: string[] = [];
    const current = new Date(`${fromDate}T00:00:00.000Z`);
    const end = new Date(`${toDate}T00:00:00.000Z`);

    while (current <= end) {
      output.push(current.toISOString().slice(0, 10));
      current.setUTCDate(current.getUTCDate() + 1);
    }

    return output;
  }

  private async getCampaign(id: string): Promise<ICampaign | null> {
    const campaign = await this.dynamoDBUtil.get<ICampaign>({
      TableName: this.constants.CAMPAIGNS_TABLE_NAME,
      Key: { id },
    });

    return campaign ?? null;
  }

  private async getActiveCampaigns(): Promise<ICampaign[]> {
    const campaigns = await this.dynamoDBUtil.scanAll<ICampaign>({
      TableName: this.constants.CAMPAIGNS_TABLE_NAME,
      FilterExpression: "#status = :status",
      ExpressionAttributeNames: {
        "#status": "status",
      },
      ExpressionAttributeValues: {
        ":status": CampaignStatus.ACTIVE,
      },
    });

    return (campaigns ?? []).filter((campaign) => !!campaign?.id);
  }

  private getLiveCampaignSourceKeys(campaign: ICampaign): Set<string> {
    return new Set(
      (campaign.affiliates ?? [])
        .filter(
          (affiliate) => affiliate.status === CampaignParticipantStatus.LIVE,
        )
        .map((affiliate) => this.normalizeCampaignKey(affiliate.campaign_key))
        .filter((key): key is string => !!key),
    );
  }

  private emptyBreakdown(query: MetricsQuery): MetricsBreakdownData {
    return {
      range: {
        from_date: query.from_date,
        to_date: query.to_date,
      },
      filters: {
        ...(query.campaign_id ? { campaign_id: query.campaign_id } : {}),
        ...(query.campaign_key ? { campaign_key: query.campaign_key } : {}),
      },
      campaign_summary: {
        campaign_id: query.campaign_id ?? "",
        counters: this.withSplits(this.emptyCounters(), this.emptySplits()),
      },
      campaigns: [],
      sources: [],
    };
  }
}
