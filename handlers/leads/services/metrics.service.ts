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
import {
  MetricsBreakdownData,
  MetricsContractsData,
  MetricsCounters,
  MetricsHealthData,
  MetricsLeadSnapshot,
  MetricsQuery,
  MetricsSummaryData,
  MetricsTimeseriesData,
  MetricsTimePoint,
} from "../types/metrics.types";

type MetricsCounterItem = {
  item_type?: string;
  bucket_start?: string;
  campaign_id?: string;
  source?: string;
  contract_id?: string;
  received?: number;
  accepted?: number;
  sold?: number;
  accepted_not_sold?: number;
  rejected?: number;
};

type CounterIncrements = MetricsCounters;

@injectable()
export class MetricsService {
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

  async recordLeadOutcome(lead: MetricsLeadSnapshot): Promise<void> {
    const bucketStart = this.toBucketStart(lead.created_at);
    const source = this.normalizeCampaignKey(lead.campaign_key);
    const counters = this.toCounters(lead);
    const idempotencyKey = `lead_outcome:${lead.id}`;
    const now = new Date().toISOString();

    const updates = [
      this.buildCounterUpdate({
        pk: this.pkGlobal(),
        sk: this.skBucket(bucketStart),
        itemType: "counter#day#global",
        bucketStart,
        counters,
        now,
      }),
      this.buildCounterUpdate({
        pk: this.pkCampaign(lead.campaign_id),
        sk: this.skBucket(bucketStart),
        itemType: "counter#day#campaign",
        bucketStart,
        campaignId: lead.campaign_id,
        counters,
        now,
      }),
    ];

    if (source) {
      updates.push(
        this.buildCounterUpdate({
          pk: this.pkSource(source),
          sk: this.skBucket(bucketStart),
          itemType: "counter#day#source",
          bucketStart,
          source,
          counters,
          now,
        }),
      );

      updates.push(
        this.buildCounterUpdate({
          pk: this.pkCampaignSource(lead.campaign_id, source),
          sk: this.skBucket(bucketStart),
          itemType: "counter#day#campaign_source",
          bucketStart,
          campaignId: lead.campaign_id,
          source,
          counters,
          now,
        }),
      );
    }

    if (lead.sold_to_contract_id) {
      updates.push(
        this.buildCounterUpdate({
          pk: this.pkContract(lead.sold_to_contract_id),
          sk: this.skBucket(bucketStart),
          itemType: "counter#day#contract",
          bucketStart,
          campaignId: lead.campaign_id,
          source,
          contractId: lead.sold_to_contract_id,
          counters,
          now,
        }),
      );
      updates.push(
        this.buildCounterUpdate({
          pk: this.pkContractCampaign(lead.sold_to_contract_id, lead.campaign_id),
          sk: this.skBucket(bucketStart),
          itemType: "counter#day#contract_campaign",
          bucketStart,
          campaignId: lead.campaign_id,
          source,
          contractId: lead.sold_to_contract_id,
          counters,
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
      [bucketStartName]: bucketStart,
      idempotency_key: idempotencyKey,
      lead_id: lead.id,
      created_at: now,
    };

    try {
      await this.docClient.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: this.constants.METRICS_TABLE_NAME,
                Item: idempotencyItem,
                ConditionExpression: "attribute_not_exists(#pk)",
                ExpressionAttributeNames: {
                  "#pk": pkName,
                },
              },
            },
            ...updates,
          ],
        }),
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
        leadId: lead.id,
        error: error?.message,
      });
      throw error;
    }
  }

  async getSummary(query: MetricsQuery): Promise<MetricsSummaryData> {
    this.validateQuery(query);

    const points = await this.getPointsForSummary(query);
    const totals = this.sumPoints(points);

    return {
      range: {
        from_date: query.from_date,
        to_date: query.to_date,
      },
      filters: {
        ...(query.campaign_id ? { campaign_id: query.campaign_id } : {}),
        ...(query.campaign_key ? { campaign_key: query.campaign_key } : {}),
      },
      totals,
    };
  }

  async getTimeseries(query: MetricsQuery): Promise<MetricsTimeseriesData> {
    this.validateQuery(query);

    const points = await this.getPointsForSummary(query);
    const pointMap = new Map<string, MetricsCounters>(
      points.map((p) => [p.bucket_start, p.counters]),
    );

    const normalized: MetricsTimePoint[] = this.eachDate(
      query.from_date,
      query.to_date,
    ).map((bucketStart) => ({
      bucket_start: bucketStart,
      counters: pointMap.get(bucketStart) ?? this.emptyCounters(),
    }));

    return {
      range: {
        from_date: query.from_date,
        to_date: query.to_date,
      },
      filters: {
        ...(query.campaign_id ? { campaign_id: query.campaign_id } : {}),
        ...(query.campaign_key ? { campaign_key: query.campaign_key } : {}),
      },
      points: normalized,
    };
  }

  async getBreakdown(query: MetricsQuery): Promise<MetricsBreakdownData> {
    this.validateQuery(query);

    if (!query.campaign_id) {
      throw new Error("campaign_id is required for metrics breakdown");
    }

    const campaign = await this.getCampaign(query.campaign_id);
    if (!campaign || campaign.status !== CampaignStatus.ACTIVE) {
      return this.emptyBreakdown(query);
    }

    const liveSourceKeys = this.getLiveCampaignSourceKeys(campaign);
    if (liveSourceKeys.size === 0) {
      return this.emptyBreakdown(query);
    }

    const requestedCampaignKey = this.normalizeCampaignKey(query.campaign_key);
    const scopedSourceKeys = requestedCampaignKey
      ? new Set(
          liveSourceKeys.has(requestedCampaignKey) ? [requestedCampaignKey] : [],
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
    const campaignSummary = this.sumItems(sourceItems);

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
        counters: campaignSummary,
      },
      campaigns: [{ key: query.campaign_id, counters: campaignSummary }],
      sources,
    };
  }

  async getContracts(query: MetricsQuery): Promise<MetricsContractsData> {
    this.validateQuery(query);

    const itemType = query.campaign_id
      ? "counter#day#contract_campaign"
      : "counter#day#contract";

    const items = await this.queryByItemTypeRange(
      itemType,
      query.from_date,
      query.to_date,
    );

    const filtered = query.campaign_id
      ? items.filter((item) => item.campaign_id === query.campaign_id)
      : items;

    const grouped = new Map<string, MetricsCounters>();
    for (const item of filtered) {
      const contractId = item.contract_id;
      if (!contractId) continue;
      const existing = grouped.get(contractId) ?? this.emptyCounters();
      grouped.set(contractId, this.addCounters(existing, this.toItemCounters(item)));
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

  private validateQuery(query: MetricsQuery): void {
    const isDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);

    if (!query.from_date || !query.to_date) {
      throw new Error("from_date and to_date are required (YYYY-MM-DD)");
    }
    if (!isDate(query.from_date) || !isDate(query.to_date)) {
      throw new Error("from_date and to_date must be YYYY-MM-DD");
    }
    if (query.from_date > query.to_date) {
      throw new Error("from_date must be less than or equal to to_date");
    }
  }

  private toBucketStart(isoTimestamp: string): string {
    if (/^\d{4}-\d{2}-\d{2}$/.test(isoTimestamp)) {
      return isoTimestamp;
    }
    return new Date(isoTimestamp).toISOString().slice(0, 10);
  }

  private normalizeCampaignKey(source?: string): string | undefined {
    if (!source) return undefined;
    const trimmed = source.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  private toCounters(lead: MetricsLeadSnapshot): CounterIncrements {
    const accepted = lead.rejected ? 0 : 1;
    const sold = lead.sold ? 1 : 0;
    const acceptedNotSold = accepted === 1 && sold === 0 ? 1 : 0;
    const rejected = lead.rejected ? 1 : 0;

    return {
      received: 1,
      accepted,
      sold,
      accepted_not_sold: acceptedNotSold,
      rejected,
    };
  }

  private pkGlobal(): string {
    return "counter#day#global";
  }

  private pkCampaign(campaignId: string): string {
    return `counter#day#campaign#${campaignId}`;
  }

  private pkSource(source: string): string {
    return `counter#day#source#${source}`;
  }

  private pkCampaignSource(campaignId: string, source: string): string {
    return `counter#day#campaign_source#${campaignId}#${source}`;
  }

  private pkContract(contractId: string): string {
    return `counter#day#contract#${contractId}`;
  }

  private pkContractCampaign(contractId: string, campaignId: string): string {
    return `counter#day#contract_campaign#${contractId}#${campaignId}`;
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
    counters: CounterIncrements;
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
    };

    if (args.campaignId) {
      names["#campaign_id"] = "campaign_id";
      values[":campaign_id"] = args.campaignId;
      setSegments.push("#campaign_id = if_not_exists(#campaign_id, :campaign_id)");
    }
    if (args.source) {
      names["#source"] = "source";
      values[":source"] = args.source;
      setSegments.push("#source = if_not_exists(#source, :source)");
    }
    if (args.contractId) {
      names["#contract_id"] = "contract_id";
      values[":contract_id"] = args.contractId;
      setSegments.push("#contract_id = if_not_exists(#contract_id, :contract_id)");
    }

    return {
      Update: {
        TableName: this.constants.METRICS_TABLE_NAME,
        Key: {
          [pkName]: args.pk,
          [skName]: args.sk,
        },
        UpdateExpression:
          `SET ${setSegments.join(", ")} ` +
          "ADD #received :received, #accepted :accepted, #sold :sold, #accepted_not_sold :accepted_not_sold, #rejected :rejected",
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      },
    };
  }

  private async getPointsForSummary(query: MetricsQuery): Promise<
    Array<{ bucket_start: string; counters: MetricsCounters }>
  > {
    const source = this.normalizeCampaignKey(query.campaign_key);
    const pk = query.campaign_id
      ? source
        ? this.pkCampaignSource(query.campaign_id, source)
        : this.pkCampaign(query.campaign_id)
      : source
        ? this.pkSource(source)
        : this.pkGlobal();

    const items = await this.queryByPartition(pk, query.from_date, query.to_date);

    return items
      .map((item) => ({
        bucket_start: item.bucket_start ?? "",
        counters: this.toItemCounters(item),
      }))
      .filter((point) => point.bucket_start);
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
    const itemTypePk = this.constants.METRICS_ITEM_TYPE_BUCKET_START_INDEX_PARTITION_KEY;
    const bucketSk = this.constants.METRICS_ITEM_TYPE_BUCKET_START_INDEX_SORT_KEY;

    const result = await this.dynamoDBUtil.queryAll<MetricsCounterItem>({
      TableName: this.constants.METRICS_TABLE_NAME,
      IndexName: indexName,
      KeyConditionExpression: "#item_type = :item_type AND #bucket_start BETWEEN :from_date AND :to_date",
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
    keyField: "campaign_id" | "source",
  ): Array<{ key: string; counters: MetricsCounters }> {
    const grouped = new Map<string, MetricsCounters>();

    for (const item of items) {
      const key = item[keyField];
      if (!key) continue;
      const existing = grouped.get(key) ?? this.emptyCounters();
      grouped.set(key, this.addCounters(existing, this.toItemCounters(item)));
    }

    return Array.from(grouped.entries())
      .map(([key, counters]) => ({ key, counters }))
      .sort((a, b) => b.counters.received - a.counters.received);
  }

  private toItemCounters(item: MetricsCounterItem): MetricsCounters {
    return {
      received: item.received ?? 0,
      accepted: item.accepted ?? 0,
      sold: item.sold ?? 0,
      accepted_not_sold: item.accepted_not_sold ?? 0,
      rejected: item.rejected ?? 0,
    };
  }

  private emptyCounters(): MetricsCounters {
    return {
      received: 0,
      accepted: 0,
      sold: 0,
      accepted_not_sold: 0,
      rejected: 0,
    };
  }

  private addCounters(a: MetricsCounters, b: MetricsCounters): MetricsCounters {
    return {
      received: a.received + b.received,
      accepted: a.accepted + b.accepted,
      sold: a.sold + b.sold,
      accepted_not_sold: a.accepted_not_sold + b.accepted_not_sold,
      rejected: a.rejected + b.rejected,
    };
  }

  private sumItems(items: MetricsCounterItem[]): MetricsCounters {
    return items.reduce(
      (acc, item) => this.addCounters(acc, this.toItemCounters(item)),
      this.emptyCounters(),
    );
  }

  private sumPoints(points: Array<{ counters: MetricsCounters }>): MetricsCounters {
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

  private getLiveCampaignSourceKeys(campaign: ICampaign): Set<string> {
    return new Set(
      (campaign.affiliates ?? [])
        .filter((affiliate) => affiliate.status === CampaignParticipantStatus.LIVE)
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
        counters: this.emptyCounters(),
      },
      campaigns: [],
      sources: [],
    };
  }
}
