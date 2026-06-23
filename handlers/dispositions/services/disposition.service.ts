import { injectable, inject } from "inversify";
import { randomUUID } from "crypto";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { Logger } from "@shared/services/logger.util";
import {
  CandidateLead,
  Disposition,
  DispositionRow,
  DispositionStatusMappingRule,
  PublicDashboard,
} from "../interfaces/IDisposition.interface";
import { DispositionConstants } from "../constants/disposition.constants";
import {
  CandidateLeadsQuery,
  CreateDispositionRequest,
  ListDispositionsQuery,
  PutDispositionRowsRequest,
  UpdateDispositionRequest,
  UpsertPublicDashboardRequest,
} from "../types/disposition-request.types";
import { ServiceResult } from "../types/common.types";

@injectable()
export class DispositionService {
  constructor(
    @inject("DynamoDBUtil") private readonly dynamoDBUtil: DynamoDBUtil,
    @inject("Logger") private readonly logger: Logger,
    @inject("DispositionConstants")
    private readonly constants: DispositionConstants,
  ) {}

  private canonicalizeSourceKey(sourceKey: string): string {
    return sourceKey.trim().toLowerCase().replace(/\s+/g, "_");
  }

  private canonicalizeSourceKeys(sourceKeys: string[]): string[] {
    return Array.from(
      new Set(
        sourceKeys.map((sourceKey) => this.canonicalizeSourceKey(sourceKey)),
      ),
    ).sort();
  }

  private normalizeStatus(value: unknown): string {
    return String(value ?? "")
      .trim()
      .toUpperCase();
  }

  private isLiveCampaignStatus(value: unknown): boolean {
    const status = this.normalizeStatus(value);
    return status === "ACTIVE" || status === "LIVE";
  }

  private isLiveCampaignSourceStatus(value: unknown): boolean {
    const status = this.normalizeStatus(value);
    return status === "ACTIVE" || status === "LIVE";
  }

  private getLiveCampaignSourceKeys(
    campaign: Record<string, unknown>,
  ): string[] {
    const affiliates = Array.isArray(campaign.affiliates)
      ? (campaign.affiliates as Array<Record<string, unknown>>)
      : [];

    const liveSourceKeys = affiliates
      .filter((affiliate) => this.isLiveCampaignSourceStatus(affiliate.status))
      .map((affiliate) => affiliate.campaign_key)
      .filter(
        (campaignKey): campaignKey is string => typeof campaignKey === "string",
      )
      .map((campaignKey) => this.canonicalizeSourceKey(campaignKey));

    return Array.from(new Set(liveSourceKeys)).sort();
  }

  private async validateLiveCampaignAndSourceScope(
    campaignId: string,
    sourceKeys: string[],
  ): Promise<
    ServiceResult<{
      campaign: Record<string, unknown>;
      liveSourceKeys: string[];
    }>
  > {
    const campaign = await this.dynamoDBUtil.get<Record<string, unknown>>({
      TableName: this.constants.CAMPAIGNS_TABLE_NAME,
      Key: { id: campaignId },
    });

    if (!campaign) {
      return { result: false, error: `campaign_id ${campaignId} not found` };
    }

    if (!this.isLiveCampaignStatus(campaign.status)) {
      return {
        result: false,
        error: `campaign_id ${campaignId} is not LIVE`,
      };
    }

    const liveSourceKeys = this.getLiveCampaignSourceKeys(campaign);
    if (liveSourceKeys.length === 0) {
      return {
        result: false,
        error: `campaign_id ${campaignId} has no LIVE source_keys`,
      };
    }

    const invalidSourceKeys = sourceKeys.filter(
      (sourceKey) => !liveSourceKeys.includes(sourceKey),
    );

    if (invalidSourceKeys.length > 0) {
      return {
        result: false,
        error: `source_keys outside LIVE campaign scope: ${invalidSourceKeys.join(", ")}`,
      };
    }

    return {
      result: true,
      data: {
        campaign,
        liveSourceKeys,
      },
    };
  }

  private readLeadSourceKey(lead: Record<string, unknown>): string | undefined {
    const payload =
      lead.payload && typeof lead.payload === "object"
        ? (lead.payload as Record<string, unknown>)
        : undefined;

    return (
      (lead.source_key as string | undefined) ??
      (lead.source as string | undefined) ??
      (lead.campaign_key as string | undefined) ??
      (lead.original_source as string | undefined) ??
      (lead.marketing_source as string | undefined) ??
      (payload?.source_key as string | undefined) ??
      (payload?.campaign_key as string | undefined) ??
      (payload?.marketing_source as string | undefined)
    );
  }

  private readLeadCampaignId(
    lead: Record<string, unknown>,
  ): string | undefined {
    const payload =
      lead.payload && typeof lead.payload === "object"
        ? (lead.payload as Record<string, unknown>)
        : undefined;

    return (
      (lead.campaign_id as string | undefined) ??
      (payload?.campaign_id as string | undefined)
    );
  }

  private readLeadStatus(lead: Record<string, unknown>): string {
    const payload =
      lead.payload && typeof lead.payload === "object"
        ? (lead.payload as Record<string, unknown>)
        : undefined;

    if (lead.rejected === true || payload?.rejected === true) {
      return "DNQ";
    }

    if (lead.sold === true || payload?.sold === true) {
      return "Signed";
    }

    return (
      (lead.status as string | undefined) ??
      (lead.intake_status as string | undefined) ??
      (lead.intakeStatus as string | undefined) ??
      (lead["Intake Status"] as string | undefined) ??
      (lead.lead_status as string | undefined) ??
      (lead["Lead Status"] as string | undefined) ??
      (payload?.["Intake Status"] as string | undefined) ??
      (payload?.intakeStatus as string | undefined) ??
      (payload?.intake_status as string | undefined) ??
      (payload?.status as string | undefined) ??
      "unknown"
    );
  }

  private readLeadTransactionId(
    lead: Record<string, unknown>,
    txField?: string,
  ): string | undefined {
    const payload =
      lead.payload && typeof lead.payload === "object"
        ? (lead.payload as Record<string, unknown>)
        : undefined;

    if (txField) {
      if (typeof lead[txField] === "string") {
        return lead[txField] as string;
      }
      if (typeof payload?.[txField] === "string") {
        return payload[txField] as string;
      }
    }

    return (
      (lead.transaction_id as string | undefined) ??
      (payload?.transaction_id as string | undefined)
    );
  }

  private readLeadPubId(lead: Record<string, unknown>): string | undefined {
    let payload: Record<string, unknown> | undefined;
    if (lead.payload && typeof lead.payload === "object") {
      payload = lead.payload as Record<string, unknown>;
    } else if (typeof lead.payload === "string") {
      try {
        const parsed = JSON.parse(lead.payload) as unknown;
        if (parsed && typeof parsed === "object") {
          payload = parsed as Record<string, unknown>;
        }
      } catch {
        payload = undefined;
      }
    }

    const value =
      (payload?.pub_id as string | number | undefined) ??
      (payload?.pubId as string | number | undefined) ??
      (payload?.pubID as string | number | undefined) ??
      (payload?.publisher_id as string | number | undefined) ??
      (payload?.publisherId as string | number | undefined) ??
      (lead.pub_id as string | number | undefined) ??
      (lead.pubId as string | number | undefined) ??
      (lead.pubID as string | number | undefined) ??
      (lead.publisher_id as string | number | undefined) ??
      (lead.publisherId as string | number | undefined);

    if (value === undefined || value === null) {
      return undefined;
    }

    return String(value);
  }

  private readLeadReceivedAt(
    lead: Record<string, unknown>,
  ): string | undefined {
    return (
      (lead.received_at as string | undefined) ??
      (lead.created_at as string | undefined) ??
      (lead.createdAt as string | undefined)
    );
  }

  private readLeadMarketingSource(
    lead: Record<string, unknown>,
    sourceKeyRaw?: string,
  ): string | undefined {
    const payload =
      lead.payload && typeof lead.payload === "object"
        ? (lead.payload as Record<string, unknown>)
        : undefined;

    return (
      (lead.pub_id as string | undefined) ??
      (payload?.pub_id as string | undefined) ??
      (lead.marketing_source as string | undefined) ??
      (lead.original_source as string | undefined) ??
      (payload?.marketing_source as string | undefined) ??
      sourceKeyRaw
    );
  }

  private buildNameKey(name: string): string {
    return name.trim().toLowerCase();
  }

  private toIsoNow(): string {
    return new Date().toISOString();
  }

  private applyStatusMapping(
    incomingStatus: string,
    rules: DispositionStatusMappingRule[],
  ): string {
    const incomingKey = incomingStatus.trim().toLowerCase();
    const hit = rules.find(
      (rule) => rule.from_status.trim().toLowerCase() === incomingKey,
    );
    return hit?.to_status ?? incomingStatus;
  }

  private computeEffectiveStatus(
    derivedStatus: string,
    overrideStatus?: string,
  ): string {
    if (overrideStatus && overrideStatus.trim().length > 0) {
      return overrideStatus;
    }

    return derivedStatus;
  }

  private maskIdentifier(value?: string): string | undefined {
    if (!value || value.length === 0) {
      return undefined;
    }

    const suffix = value.slice(-4);
    return `***${suffix}`;
  }

  private stripPublicPayloadSensitiveFields(
    rows: Array<Record<string, unknown>>,
  ): Array<Record<string, unknown>> {
    return rows.map((row) => {
      const filtered = { ...row };
      delete filtered.transaction_id;
      delete filtered.transaction_id_field;
      return filtered;
    });
  }

  private isLikelyNumericId(value?: string): boolean {
    if (!value) {
      return false;
    }

    return /^\d+$/.test(value.trim());
  }

  private async buildSourceLabelMap(
    campaign: Record<string, unknown> | undefined,
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const affiliates = Array.isArray(campaign?.affiliates)
      ? (campaign?.affiliates as Array<Record<string, unknown>>)
      : [];

    const affiliateIds = Array.from(
      new Set(
        affiliates
          .map((affiliate) =>
            typeof affiliate.affiliate_id === "string"
              ? affiliate.affiliate_id.trim()
              : "",
          )
          .filter((affiliateId) => affiliateId.length > 0),
      ),
    );

    const affiliateNameById = new Map<string, string>();
    await Promise.all(
      affiliateIds.map(async (affiliateId) => {
        const affiliateRecord = await this.dynamoDBUtil.get<
          Record<string, unknown>
        >({
          TableName: this.constants.AFFILIATES_TABLE_NAME,
          Key: { id: affiliateId },
        });

        const affiliateNameRaw =
          typeof affiliateRecord?.name === "string"
            ? affiliateRecord.name.trim()
            : "";

        if (affiliateNameRaw) {
          affiliateNameById.set(affiliateId, affiliateNameRaw);
        }
      }),
    );

    for (const affiliate of affiliates) {
      const keyRaw =
        (affiliate.campaign_key as string | undefined) ??
        (affiliate.source_key as string | undefined);
      if (!keyRaw) {
        continue;
      }

      const key = this.canonicalizeSourceKey(keyRaw);
      const affiliateId =
        typeof affiliate.affiliate_id === "string"
          ? affiliate.affiliate_id.trim()
          : "";
      const label =
        affiliateNameById.get(affiliateId) ??
        (affiliate.affiliate_name as string | undefined) ??
        (affiliate.name as string | undefined) ??
        (affiliate.display_name as string | undefined) ??
        keyRaw;

      map.set(key, String(label));
    }

    return map;
  }

  private rowSort(a: DispositionRow, b: DispositionRow): number {
    return a.lead_id.localeCompare(b.lead_id);
  }

  private candidateSort(a: CandidateLead, b: CandidateLead): number {
    return a.lead_id.localeCompare(b.lead_id);
  }

  async listDispositions(
    query: ListDispositionsQuery = {},
  ): Promise<ServiceResult<Disposition[]>> {
    try {
      const includeDeleted = query.includeDeleted ?? false;
      const requestedSourceKey = query.source_key
        ? this.canonicalizeSourceKey(query.source_key)
        : undefined;

      const scanResult = await this.dynamoDBUtil.scan<Disposition>({
        TableName: this.constants.DISPOSITIONS_TABLE_NAME,
      });

      const items = scanResult.items.filter((item) => {
        if (!includeDeleted && item.is_deleted) {
          return false;
        }

        if (requestedSourceKey) {
          return item.source_keys.includes(requestedSourceKey);
        }

        return true;
      });

      return {
        result: true,
        data: items.sort((a, b) => a.name.localeCompare(b.name)),
      };
    } catch (error) {
      this.logger.error("Failed to list dispositions", error);
      return { result: false, error: "Failed to list dispositions" };
    }
  }

  async createDisposition(
    request: CreateDispositionRequest,
  ): Promise<ServiceResult<Disposition>> {
    try {
      const name = request.name?.trim();
      const campaignId = request.campaign_id?.trim();
      if (!name) {
        return { result: false, error: "name is required" };
      }

      if (!campaignId) {
        return { result: false, error: "campaign_id is required" };
      }

      if (
        !Array.isArray(request.source_keys) ||
        request.source_keys.length === 0
      ) {
        return { result: false, error: "source_keys is required" };
      }

      const sourceKeys = this.canonicalizeSourceKeys(request.source_keys);
      const scopeValidation = await this.validateLiveCampaignAndSourceScope(
        campaignId,
        sourceKeys,
      );
      if (!scopeValidation.result) {
        return { result: false, error: scopeValidation.error };
      }
      const nameKey = this.buildNameKey(name);

      const existingScan = await this.dynamoDBUtil.scan<Disposition>({
        TableName: this.constants.DISPOSITIONS_TABLE_NAME,
      });

      const sourceScopedCollision = existingScan.items.find((item) => {
        if (item.is_deleted) {
          return false;
        }

        if (item.name_key !== nameKey) {
          return false;
        }

        if ((item.campaign_id ?? "") !== campaignId) {
          return false;
        }

        return item.source_keys.some((sourceKey) =>
          sourceKeys.includes(sourceKey),
        );
      });

      if (sourceScopedCollision) {
        return {
          result: false,
          error: "Disposition name already exists for one or more source_keys",
        };
      }

      const now = this.toIsoNow();
      const item: Disposition = {
        id: `DP-${randomUUID()}`,
        name,
        name_key: nameKey,
        dispo_type: request.dispo_type,
        campaign_id: campaignId,
        source_keys: sourceKeys,
        status_mapping: request.status_mapping ?? [],
        transaction_id_field: request.transaction_id_field,
        spend_inputs: request.spend_inputs,
        live_updates: request.live_updates ?? false,
        created_at: now,
        updated_at: now,
        is_deleted: false,
      };

      await this.dynamoDBUtil.put({
        TableName: this.constants.DISPOSITIONS_TABLE_NAME,
        Item: item,
      });

      return { result: true, data: item };
    } catch (error) {
      this.logger.error("Failed to create disposition", error);
      return { result: false, error: "Failed to create disposition" };
    }
  }

  async getDispositionById(id: string): Promise<ServiceResult<Disposition>> {
    try {
      const item = await this.dynamoDBUtil.get<Disposition>({
        TableName: this.constants.DISPOSITIONS_TABLE_NAME,
        Key: { id },
      });

      if (!item || item.is_deleted) {
        return { result: false, error: `Disposition ${id} not found` };
      }

      return { result: true, data: item };
    } catch (error) {
      this.logger.error("Failed to get disposition", error);
      return { result: false, error: "Failed to get disposition" };
    }
  }

  async updateDisposition(
    id: string,
    request: UpdateDispositionRequest,
  ): Promise<ServiceResult<Disposition>> {
    try {
      const current = await this.getDispositionById(id);
      if (!current.result || !current.data) {
        return { result: false, error: `Disposition ${id} not found` };
      }

      const updated: Disposition = {
        ...current.data,
        ...request,
        source_keys: request.source_keys
          ? this.canonicalizeSourceKeys(request.source_keys)
          : current.data.source_keys,
        name: request.name?.trim() || current.data.name,
        updated_at: this.toIsoNow(),
      };
      updated.name_key = this.buildNameKey(updated.name);

      if (!updated.campaign_id?.trim()) {
        return { result: false, error: "campaign_id is required" };
      }

      const scopeValidation = await this.validateLiveCampaignAndSourceScope(
        updated.campaign_id,
        updated.source_keys,
      );
      if (!scopeValidation.result) {
        return { result: false, error: scopeValidation.error };
      }

      const all = await this.dynamoDBUtil.scan<Disposition>({
        TableName: this.constants.DISPOSITIONS_TABLE_NAME,
      });

      const collision = all.items.find((item) => {
        if (item.id === id || item.is_deleted) {
          return false;
        }

        if (item.name_key !== updated.name_key) {
          return false;
        }

        if ((item.campaign_id ?? "") !== (updated.campaign_id ?? "")) {
          return false;
        }

        return item.source_keys.some((sourceKey) =>
          updated.source_keys.includes(sourceKey),
        );
      });

      if (collision) {
        return {
          result: false,
          error: "Disposition name already exists for one or more source_keys",
        };
      }

      await this.dynamoDBUtil.put({
        TableName: this.constants.DISPOSITIONS_TABLE_NAME,
        Item: updated,
      });

      return { result: true, data: updated };
    } catch (error) {
      this.logger.error("Failed to update disposition", error);
      return { result: false, error: "Failed to update disposition" };
    }
  }

  async deleteDisposition(id: string): Promise<ServiceResult> {
    try {
      const current = await this.getDispositionById(id);
      if (!current.result || !current.data) {
        return { result: false, error: `Disposition ${id} not found` };
      }

      await this.dynamoDBUtil.put({
        TableName: this.constants.DISPOSITIONS_TABLE_NAME,
        Item: {
          ...current.data,
          is_deleted: true,
          updated_at: this.toIsoNow(),
        } as Disposition,
      });

      return { result: true };
    } catch (error) {
      this.logger.error("Failed to delete disposition", error);
      return { result: false, error: "Failed to delete disposition" };
    }
  }

  async getIncomingStatuses(
    dispositionId: string,
  ): Promise<ServiceResult<string[]>> {
    try {
      const dispositionResult = await this.getDispositionById(dispositionId);
      if (!dispositionResult.result || !dispositionResult.data) {
        return {
          result: false,
          error: `Disposition ${dispositionId} not found`,
        };
      }

      if (!dispositionResult.data.campaign_id) {
        return {
          result: false,
          error: `Disposition ${dispositionId} is missing campaign scope`,
        };
      }

      const scopeValidation = await this.validateLiveCampaignAndSourceScope(
        dispositionResult.data.campaign_id,
        dispositionResult.data.source_keys,
      );
      if (!scopeValidation.result) {
        return { result: false, error: scopeValidation.error };
      }
      const allowedLiveSourceKeySet = new Set(
        scopeValidation.data?.liveSourceKeys ?? [],
      );

      const leadsScan = await this.dynamoDBUtil.scan<Record<string, unknown>>({
        TableName: this.constants.LEADS_TABLE_NAME,
      });

      const unique = new Set<string>();
      for (const lead of leadsScan.items) {
        const sourceKeyRaw = this.readLeadSourceKey(lead);
        if (!sourceKeyRaw) {
          continue;
        }
        const sourceKey = this.canonicalizeSourceKey(sourceKeyRaw);
        if (!dispositionResult.data.source_keys.includes(sourceKey)) {
          continue;
        }

        if (!allowedLiveSourceKeySet.has(sourceKey)) {
          continue;
        }

        if (dispositionResult.data.campaign_id) {
          const leadCampaignId = this.readLeadCampaignId(lead);
          if (
            !leadCampaignId ||
            leadCampaignId !== dispositionResult.data.campaign_id
          ) {
            continue;
          }
        }

        const status = this.readLeadStatus(lead);

        unique.add(status);
      }

      return {
        result: true,
        data: Array.from(unique).sort((a, b) => a.localeCompare(b)),
      };
    } catch (error) {
      this.logger.error("Failed to load incoming statuses", error);
      return { result: false, error: "Failed to load incoming statuses" };
    }
  }

  private async getRowsByDispositionId(
    dispositionId: string,
  ): Promise<DispositionRow[]> {
    const scanResult = await this.dynamoDBUtil.scan<DispositionRow>({
      TableName: this.constants.DISPOSITION_ROWS_TABLE_NAME,
    });

    return scanResult.items
      .filter((row) => row.disposition_id === dispositionId)
      .map((row) => ({
        ...row,
        effective_status: this.computeEffectiveStatus(
          row.derived_status,
          row.override_status,
        ),
      }))
      .sort((a, b) => this.rowSort(a, b));
  }

  async getCandidateLeads(
    dispositionId: string,
    query: CandidateLeadsQuery = {},
  ): Promise<ServiceResult<{ items: CandidateLead[]; count: number }>> {
    try {
      const dispositionResult = await this.getDispositionById(dispositionId);
      if (!dispositionResult.result || !dispositionResult.data) {
        return {
          result: false,
          error: `Disposition ${dispositionId} not found`,
        };
      }

      let rows = await this.getRowsByDispositionId(dispositionId);
      if (rows.length === 0) {
        const refreshed = await this.refreshDisposition(dispositionId);
        if (refreshed.result) {
          rows = await this.getRowsByDispositionId(dispositionId);
        }
      }

      let items = rows.map((row) => ({
        lead_id: row.lead_id,
        source_key: row.source_key,
        incoming_status: row.incoming_status ?? row.derived_status,
        derived_status: row.derived_status,
        override_status: row.override_status,
        effective_status: this.computeEffectiveStatus(
          row.derived_status,
          row.override_status,
        ),
        included: row.included,
        pub_id: row.pub_id,
        marketing_source: row.marketing_source,
        received_at: row.received_at,
        transaction_id: row.transaction_id,
        transaction_id_masked:
          row.transaction_id_masked ?? this.maskIdentifier(row.transaction_id),
      }));

      if (query.included !== undefined) {
        items = items.filter((item) => item.included === query.included);
      }

      const limit = query.limit && query.limit > 0 ? query.limit : 50;
      const limitedItems = items
        .sort((a, b) => this.candidateSort(a, b))
        .slice(0, limit);

      return {
        result: true,
        data: { items: limitedItems, count: limitedItems.length },
      };
    } catch (error) {
      this.logger.error("Failed to list candidate leads", error);
      return { result: false, error: "Failed to list candidate leads" };
    }
  }

  async putRows(
    dispositionId: string,
    request: PutDispositionRowsRequest,
  ): Promise<ServiceResult<{ count: number }>> {
    try {
      const dispositionResult = await this.getDispositionById(dispositionId);
      if (!dispositionResult.result || !dispositionResult.data) {
        return {
          result: false,
          error: `Disposition ${dispositionId} not found`,
        };
      }

      const now = this.toIsoNow();
      let count = 0;
      const existingRows = await this.getRowsByDispositionId(dispositionId);
      const existingByLeadId = new Map(
        existingRows.map((row) => [row.lead_id, row]),
      );

      for (const row of request.rows) {
        const existing = existingByLeadId.get(row.lead_id);
        let leadRecord: Record<string, unknown> | undefined;

        if (!existing && (!row.source_key || !row.derived_status)) {
          leadRecord = await this.dynamoDBUtil.get<Record<string, unknown>>({
            TableName: this.constants.LEADS_TABLE_NAME,
            Key: { id: row.lead_id },
          });
        }

        const sourceKeyRaw =
          row.source_key ??
          existing?.source_key ??
          (leadRecord ? this.readLeadSourceKey(leadRecord) : undefined);

        if (!sourceKeyRaw) {
          return {
            result: false,
            error: `source_key is required for lead ${row.lead_id}`,
          };
        }

        const sourceKey = this.canonicalizeSourceKey(sourceKeyRaw);
        if (!dispositionResult.data.source_keys.includes(sourceKey)) {
          return {
            result: false,
            error: `lead ${row.lead_id} source_key is outside disposition scope`,
          };
        }

        if (dispositionResult.data.campaign_id) {
          const leadCampaignId =
            existing?.source_key && !leadRecord
              ? dispositionResult.data.campaign_id
              : leadRecord
                ? this.readLeadCampaignId(leadRecord)
                : undefined;

          if (
            leadCampaignId &&
            leadCampaignId !== dispositionResult.data.campaign_id
          ) {
            return {
              result: false,
              error: `lead ${row.lead_id} campaign_id is outside disposition scope`,
            };
          }
        }

        const incomingStatusRaw =
          row.derived_status ??
          existing?.incoming_status ??
          existing?.derived_status ??
          (leadRecord ? this.readLeadStatus(leadRecord) : undefined) ??
          "unknown";

        const derivedStatus = this.applyStatusMapping(
          incomingStatusRaw,
          dispositionResult.data.status_mapping,
        );
        const effectiveStatus = this.computeEffectiveStatus(
          derivedStatus,
          row.override_status,
        );

        const transactionId =
          row.transaction_id ??
          existing?.transaction_id ??
          (leadRecord
            ? this.readLeadTransactionId(
                leadRecord,
                dispositionResult.data.transaction_id_field,
              )
            : undefined);

        const pubId =
          row.pub_id ??
          existing?.pub_id ??
          (leadRecord ? this.readLeadPubId(leadRecord) : undefined);

        const receivedAt =
          row.received_at ??
          existing?.received_at ??
          (leadRecord ? this.readLeadReceivedAt(leadRecord) : undefined);

        const marketingSource =
          row.marketing_source ??
          existing?.marketing_source ??
          (leadRecord
            ? this.readLeadMarketingSource(leadRecord, sourceKeyRaw)
            : sourceKeyRaw);

        const item: DispositionRow = {
          disposition_id: dispositionId,
          lead_id: row.lead_id,
          source_key: sourceKey,
          included: row.included,
          incoming_status: incomingStatusRaw,
          derived_status: derivedStatus,
          override_status: row.override_status,
          effective_status: effectiveStatus,
          transaction_id: transactionId,
          transaction_id_masked: this.maskIdentifier(transactionId),
          pub_id: pubId,
          marketing_source: marketingSource,
          received_at: receivedAt,
          updated_at: now,
        };

        await this.dynamoDBUtil.put({
          TableName: this.constants.DISPOSITION_ROWS_TABLE_NAME,
          Item: item,
        });

        count += 1;
      }

      return { result: true, data: { count } };
    } catch (error) {
      this.logger.error("Failed to put rows", error);
      return { result: false, error: "Failed to put rows" };
    }
  }

  async refreshDisposition(
    dispositionId: string,
  ): Promise<ServiceResult<{ count: number }>> {
    try {
      const dispositionResult = await this.getDispositionById(dispositionId);
      if (!dispositionResult.result || !dispositionResult.data) {
        return {
          result: false,
          error: `Disposition ${dispositionId} not found`,
        };
      }

      if (!dispositionResult.data.campaign_id) {
        return {
          result: false,
          error: `Disposition ${dispositionId} is missing campaign scope`,
        };
      }

      const scopeValidation = await this.validateLiveCampaignAndSourceScope(
        dispositionResult.data.campaign_id,
        dispositionResult.data.source_keys,
      );
      if (!scopeValidation.result) {
        return { result: false, error: scopeValidation.error };
      }
      const allowedLiveSourceKeySet = new Set(
        scopeValidation.data?.liveSourceKeys ?? [],
      );

      const leads = await this.dynamoDBUtil.scan<Record<string, unknown>>({
        TableName: this.constants.LEADS_TABLE_NAME,
      });

      const candidateRows: PutDispositionRowsRequest["rows"] = [];
      for (const lead of leads.items) {
        const leadId = lead.id as string | undefined;
        const sourceKeyRaw = this.readLeadSourceKey(lead);

        if (!leadId || !sourceKeyRaw) {
          continue;
        }

        const sourceKey = this.canonicalizeSourceKey(sourceKeyRaw);
        if (!dispositionResult.data.source_keys.includes(sourceKey)) {
          continue;
        }

        if (!allowedLiveSourceKeySet.has(sourceKey)) {
          continue;
        }

        if (dispositionResult.data.campaign_id) {
          const leadCampaignId = this.readLeadCampaignId(lead);
          if (
            !leadCampaignId ||
            leadCampaignId !== dispositionResult.data.campaign_id
          ) {
            continue;
          }
        }

        const incomingStatus = this.readLeadStatus(lead);
        const transactionId = this.readLeadTransactionId(
          lead,
          dispositionResult.data.transaction_id_field,
        );

        candidateRows.push({
          lead_id: leadId,
          source_key: sourceKey,
          included: true,
          derived_status: incomingStatus,
          transaction_id: transactionId,
          pub_id: this.readLeadPubId(lead),
          marketing_source: this.readLeadMarketingSource(lead, sourceKeyRaw),
          received_at: this.readLeadReceivedAt(lead),
        });
      }

      return this.putRows(dispositionId, { rows: candidateRows });
    } catch (error) {
      this.logger.error("Failed to refresh disposition", error);
      return { result: false, error: "Failed to refresh disposition" };
    }
  }

  async getSummary(dispositionId: string): Promise<
    ServiceResult<{
      status_counts: Record<string, number>;
      total: number;
      signed: number;
      conversion_percent: number;
      total_spend: number;
      cost_per_signed: number;
      cost_per_lead: number;
    }>
  > {
    try {
      const dispositionResult = await this.getDispositionById(dispositionId);
      if (!dispositionResult.result || !dispositionResult.data) {
        return {
          result: false,
          error: `Disposition ${dispositionId} not found`,
        };
      }

      const rows = (await this.getRowsByDispositionId(dispositionId)).filter(
        (row) => row.included,
      );

      const counts: Record<string, number> = {};
      for (const row of rows) {
        const key = this.computeEffectiveStatus(
          row.derived_status,
          row.override_status,
        )
          .trim()
          .toLowerCase();
        counts[key] = (counts[key] ?? 0) + 1;
      }

      const total = rows.length;
      const signed = counts.signed ?? 0;
      const conversionPercent = total > 0 ? (signed / total) * 100 : 0;

      const disposition = dispositionResult.data;
      const spendBySource = Object.values(
        disposition.spend_inputs?.by_source_key ?? {},
      ).reduce((acc, value) => acc + value, 0);
      const totalSpend = (disposition.spend_inputs?.total ?? 0) + spendBySource;

      const costPerSigned = signed > 0 ? totalSpend / signed : 0;
      const costPerLead = total > 0 ? totalSpend / total : 0;

      return {
        result: true,
        data: {
          status_counts: counts,
          total,
          signed,
          conversion_percent: conversionPercent,
          total_spend: totalSpend,
          cost_per_signed: costPerSigned,
          cost_per_lead: costPerLead,
        },
      };
    } catch (error) {
      this.logger.error("Failed to summarize disposition", error);
      return { result: false, error: "Failed to summarize disposition" };
    }
  }

  async getPublicDashboard(
    dispositionId: string,
  ): Promise<ServiceResult<PublicDashboard>> {
    try {
      const dashboard = await this.dynamoDBUtil.get<PublicDashboard>({
        TableName: this.constants.PUBLIC_DASHBOARDS_TABLE_NAME,
        Key: { disposition_id: dispositionId },
      });

      if (!dashboard) {
        return {
          result: false,
          error: `Public dashboard ${dispositionId} not found`,
        };
      }

      return { result: true, data: dashboard };
    } catch (error) {
      this.logger.error("Failed to get public dashboard", error);
      return { result: false, error: "Failed to get public dashboard" };
    }
  }

  async upsertPublicDashboard(
    dispositionId: string,
    request: UpsertPublicDashboardRequest,
  ): Promise<ServiceResult<PublicDashboard>> {
    try {
      const now = this.toIsoNow();
      const existing = await this.dynamoDBUtil.get<PublicDashboard>({
        TableName: this.constants.PUBLIC_DASHBOARDS_TABLE_NAME,
        Key: { disposition_id: dispositionId },
      });

      const item: PublicDashboard = {
        disposition_id: dispositionId,
        uuid: existing?.uuid,
        is_published: existing?.is_published ?? false,
        revoked_at: existing?.revoked_at,
        published_at: existing?.published_at,
        layout: request.layout,
        updated_at: now,
      };

      await this.dynamoDBUtil.put({
        TableName: this.constants.PUBLIC_DASHBOARDS_TABLE_NAME,
        Item: item,
      });

      return { result: true, data: item };
    } catch (error) {
      this.logger.error("Failed to upsert public dashboard", error);
      return { result: false, error: "Failed to upsert public dashboard" };
    }
  }

  async publishDisposition(
    dispositionId: string,
  ): Promise<ServiceResult<PublicDashboard>> {
    try {
      const current = await this.dynamoDBUtil.get<PublicDashboard>({
        TableName: this.constants.PUBLIC_DASHBOARDS_TABLE_NAME,
        Key: { disposition_id: dispositionId },
      });

      const now = this.toIsoNow();
      const published: PublicDashboard = {
        disposition_id: dispositionId,
        layout: current?.layout ?? {
          tabs: [
            { id: "dashboard", label: "Dashboard", widgets: [] },
            { id: "webforms", label: "Webforms", widgets: [] },
            { id: "signed", label: "Signed", widgets: [] },
          ],
        },
        uuid: randomUUID(),
        is_published: true,
        revoked_at: undefined,
        published_at: now,
        updated_at: now,
      };

      await this.dynamoDBUtil.put({
        TableName: this.constants.PUBLIC_DASHBOARDS_TABLE_NAME,
        Item: published,
      });

      return { result: true, data: published };
    } catch (error) {
      this.logger.error("Failed to publish disposition", error);
      return { result: false, error: "Failed to publish disposition" };
    }
  }

  async unpublishDisposition(
    dispositionId: string,
  ): Promise<ServiceResult<PublicDashboard>> {
    try {
      const now = this.toIsoNow();
      const current = await this.dynamoDBUtil.get<PublicDashboard>({
        TableName: this.constants.PUBLIC_DASHBOARDS_TABLE_NAME,
        Key: { disposition_id: dispositionId },
      });

      const next: PublicDashboard = {
        disposition_id: dispositionId,
        uuid: current?.uuid,
        is_published: false,
        revoked_at: current?.is_published ? now : (current?.revoked_at ?? now),
        layout: current?.layout ?? { tabs: [] },
        published_at: current?.published_at,
        updated_at: now,
      };

      await this.dynamoDBUtil.put({
        TableName: this.constants.PUBLIC_DASHBOARDS_TABLE_NAME,
        Item: next,
      });

      return { result: true, data: next };
    } catch (error) {
      this.logger.error("Failed to unpublish disposition", error);
      return { result: false, error: "Failed to unpublish disposition" };
    }
  }

  async getPublicDispositionByUuid(uuid: string): Promise<
    ServiceResult<{
      id: string;
      name: string;
      dispo_type: Disposition["dispo_type"];
      tabs: Array<{ key: "dashboard" | "webforms" | "signed"; title: string }>;
      summary: {
        status_counts: Record<string, number>;
        total: number;
        signed: number;
        conversion_percent: number;
        total_spend: number;
        cost_per_signed: number;
        cost_per_lead: number;
      };
      webforms: Array<Record<string, unknown>>;
      signed: Array<Record<string, unknown>>;
    }>
  > {
    try {
      const dashboardsScan = await this.dynamoDBUtil.scan<PublicDashboard>({
        TableName: this.constants.PUBLIC_DASHBOARDS_TABLE_NAME,
      });

      const dashboard = dashboardsScan.items.find((item) => item.uuid === uuid);
      if (!dashboard || !dashboard.is_published || dashboard.revoked_at) {
        return { result: false, error: "Public disposition not found" };
      }

      const disposition = await this.getDispositionById(
        dashboard.disposition_id,
      );
      if (!disposition.result || !disposition.data) {
        return { result: false, error: "Public disposition not found" };
      }

      // Always refresh from leads so public view reflects latest DNQ/signed states.
      await this.refreshDisposition(dashboard.disposition_id);

      const summary = await this.getSummary(dashboard.disposition_id);
      if (!summary.result || !summary.data) {
        return { result: false, error: "Public disposition not found" };
      }

      const rows = await this.getRowsByDispositionId(dashboard.disposition_id);
      const leadsScan = await this.dynamoDBUtil.scan<Record<string, unknown>>({
        TableName: this.constants.LEADS_TABLE_NAME,
      });
      const leadLookup = new Map<string, Record<string, unknown>>();
      for (const lead of leadsScan.items) {
        const idValue =
          typeof lead.id === "string" && lead.id.trim().length > 0
            ? lead.id.trim()
            : undefined;
        const leadIdValue =
          typeof lead.lead_id === "string" && lead.lead_id.trim().length > 0
            ? lead.lead_id.trim()
            : undefined;

        if (idValue) {
          leadLookup.set(idValue, lead);
        }
        if (leadIdValue) {
          leadLookup.set(leadIdValue, lead);
        }
      }

      const campaign = await this.dynamoDBUtil.get<Record<string, unknown>>({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Key: { id: disposition.data.campaign_id },
      });
      const sourceLabelMap = await this.buildSourceLabelMap(
        campaign ?? undefined,
      );
      const sourceKeySet = new Set(disposition.data.source_keys);

      const publicRowsRaw = await Promise.all(
        rows
          .filter((row) => row.included)
          .map(async (row) => {
            let effectiveStatus = this.computeEffectiveStatus(
              row.derived_status,
              row.override_status,
            );

            if (
              !effectiveStatus ||
              effectiveStatus.trim().toLowerCase() === "unknown"
            ) {
              const lead = leadLookup.get(row.lead_id);

              if (lead) {
                const incomingStatus = this.readLeadStatus(lead);
                effectiveStatus = this.applyStatusMapping(
                  incomingStatus,
                  disposition.data.status_mapping ?? [],
                );
              }
            }

            let date: string | undefined;
            let time: string | undefined;
            if (row.received_at) {
              const parsed = new Date(row.received_at);
              if (!Number.isNaN(parsed.getTime())) {
                date = parsed.toLocaleDateString("en-US");
                time = parsed.toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                });
              }
            }

            let pubId = row.pub_id;
            let marketingSource = row.marketing_source ?? row.source_key;
            const lead = leadLookup.get(row.lead_id);
            if (lead) {
              marketingSource =
                this.readLeadMarketingSource(lead, row.source_key) ??
                marketingSource;
              pubId = this.readLeadPubId(lead) ?? pubId;
            }
            const leadSourceKey =
              typeof lead?.campaign_key === "string"
                ? lead.campaign_key
                : typeof (lead as Record<string, unknown> | undefined)?.[
                      "source_key"
                    ] === "string"
                  ? ((lead as Record<string, unknown>)["source_key"] as string)
                  : row.source_key;
            const normalizedSourceKey =
              this.canonicalizeSourceKey(leadSourceKey);

            // In some datasets pub_id/source fields are swapped; correct that here.
            if (
              typeof pubId === "string" &&
              sourceKeySet.has(this.canonicalizeSourceKey(pubId)) &&
              typeof marketingSource === "string" &&
              this.isLikelyNumericId(marketingSource)
            ) {
              const swapped = marketingSource;
              marketingSource = pubId;
              pubId = swapped;
            }

            const sourceLabel =
              sourceLabelMap.get(normalizedSourceKey) ??
              sourceLabelMap.get(this.canonicalizeSourceKey(marketingSource)) ??
              (typeof marketingSource === "string" &&
              this.isLikelyNumericId(marketingSource)
                ? row.source_key
                : (marketingSource ?? row.source_key));

            const finalMarketingSource = sourceLabel;

            return {
              lead_id: row.lead_id,
              date,
              time,
              pub_id: pubId,
              marketing_source: finalMarketingSource,
              status: effectiveStatus,
              source_key: row.source_key,
              transaction_id: row.transaction_id,
              transaction_id_masked:
                row.transaction_id_masked ??
                this.maskIdentifier(row.transaction_id),
            };
          }),
      );

      const publicRows = this.stripPublicPayloadSensitiveFields(publicRowsRaw);
      const signedRows = publicRows.filter(
        (row) =>
          String((row.status as string | undefined) ?? "")
            .trim()
            .toLowerCase() === "signed",
      );

      const tabs = dashboard.layout?.tabs
        ?.map((tab) => {
          const key = String(tab.id ?? "")
            .trim()
            .toLowerCase();
          if (key !== "dashboard" && key !== "webforms" && key !== "signed") {
            return undefined;
          }
          return {
            key,
            title: tab.label || key,
          };
        })
        .filter(
          (
            tab,
          ): tab is {
            key: "dashboard" | "webforms" | "signed";
            title: string;
          } => Boolean(tab),
        ) ?? [
        { key: "dashboard", title: "Dashboard" },
        { key: "webforms", title: "Webforms" },
        { key: "signed", title: "Signed" },
      ];

      return {
        result: true,
        data: {
          id: dashboard.disposition_id,
          name: disposition.data.name,
          dispo_type: disposition.data.dispo_type,
          tabs,
          summary: summary.data,
          webforms: publicRows,
          signed: signedRows,
        },
      };
    } catch (error) {
      this.logger.error("Failed to get public disposition", error);
      return { result: false, error: "Public disposition not found" };
    }
  }
}
