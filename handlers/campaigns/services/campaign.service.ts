import { injectable, inject } from "inversify";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { Logger } from "@shared/services/logger.util";
import { IdGenerator } from "@shared/generators/id.generator";
import { validateAllowedFields } from "@shared/utils/payload-validation.util";
import { CampaignConstants } from "../constants/campaign.constants";
import {
  ICampaign,
  ICampaignAffiliate,
  ICampaignClient,
  ICampaignPlugins,
  ICampaignStatusChange,
  IParticipantHistoryEntry,
} from "../interfaces/ICampaign.interface";
import { CampaignStatus } from "../enums/campaign-status.enum";
import { CampaignParticipantStatus } from "../enums/campaign-participant-status.enum";
import {
  CreateCampaignRequest,
  LinkAffiliateRequest,
  LinkClientRequest,
  ListCampaignsQuery,
  UpdateCampaignRequest,
  UpdateCampaignStatusRequest,
  UpdateCampaignPluginsRequest,
  UpdateParticipantStatusRequest,
} from "../types/campaign-request.types";
import { ServiceResult } from "../types/common.types";
import { RequestActor } from "@shared/utils/request-audit.util";

@injectable()
export class CampaignService {
  constructor(
    @inject("DynamoDBUtil") private readonly dynamoDBUtil: DynamoDBUtil,
    @inject("Logger") private readonly logger: Logger,
    @inject("CampaignConstants") private readonly constants: CampaignConstants,
  ) {}

  async createCampaign(
    request: CreateCampaignRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<ICampaign>> {
    try {
      const { ok, extras, sanitized } = validateAllowedFields(
        request as Record<string, unknown>,
        ["name"],
      );

      if (!ok) {
        return { result: false, error: `Invalid fields: ${extras.join(", ")}` };
      }

      if (!sanitized.name) {
        return { result: false, error: "name is required" };
      }

      const now = new Date().toISOString();
      const campaign: ICampaign = {
        id: IdGenerator.generateCampaignId(),
        name: (sanitized.name as string) || request.name,
        status: CampaignStatus.DRAFT,
        clients: [],
        affiliates: [],
        plugins: this.getDefaultPlugins(),
        status_history: [
          {
            from: null,
            to: CampaignStatus.DRAFT,
            changed_at: now,
          } satisfies ICampaignStatusChange,
        ],
        created_at: now,
        updated_at: now,
        created_by: actor,
        updated_by: actor,
        is_deleted: false,
        active: true,
      };

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });

      this.logger.info("Campaign created", { campaignId: campaign.id });
      return { result: true, data: campaign };
    } catch (error: any) {
      this.logger.error("Failed to create campaign", error);
      return {
        result: false,
        error: error.message || "Failed to create campaign",
      };
    }
  }

  async listCampaigns(query: ListCampaignsQuery = {}): Promise<
    ServiceResult<{
      items: ICampaign[];
      count: number;
      lastEvaluatedKey?: string;
    }>
  > {
    try {
      const {
        status,
        limit = 20,
        lastEvaluatedKey,
        includeDeleted = false,
      } = query;

      const exclusiveStartKey = lastEvaluatedKey
        ? JSON.parse(Buffer.from(lastEvaluatedKey, "base64").toString())
        : undefined;

      // Build filter expression combining status and soft-delete filters
      const filterParts: string[] = [];
      const filterNames: Record<string, string> = {};
      const filterValues: Record<string, unknown> = {};

      if (status) {
        filterParts.push("#status = :status");
        filterNames["#status"] = "status";
        filterValues[":status"] = status;
      }

      if (!includeDeleted) {
        filterParts.push(
          "(attribute_not_exists(is_deleted) OR is_deleted = :is_deleted_false)",
        );
        filterValues[":is_deleted_false"] = false;
      }

      const scanResult = await this.dynamoDBUtil.scan<ICampaign>({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
        ...(filterParts.length > 0
          ? {
              FilterExpression: filterParts.join(" AND "),
              ExpressionAttributeValues: filterValues,
              ...(Object.keys(filterNames).length > 0
                ? { ExpressionAttributeNames: filterNames }
                : {}),
            }
          : {}),
      });

      return {
        result: true,
        data: {
          items: scanResult.items,
          count: scanResult.items.length,
          lastEvaluatedKey: scanResult.lastEvaluatedKey
            ? Buffer.from(JSON.stringify(scanResult.lastEvaluatedKey)).toString(
                "base64",
              )
            : undefined,
        },
      };
    } catch (error: any) {
      this.logger.error("Failed to list campaigns", error);
      return {
        result: false,
        error: error.message || "Failed to list campaigns",
      };
    }
  }

  async updateCampaign(
    campaignId: string,
    request: UpdateCampaignRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<ICampaign>> {
    try {
      const { ok, extras, sanitized } = validateAllowedFields(
        request as Record<string, unknown>,
        ["name"],
      );

      if (!ok) {
        return { result: false, error: `Invalid fields: ${extras.join(", ")}` };
      }

      const name = (sanitized.name as string | undefined)?.trim();
      if (!name) {
        return { result: false, error: "name is required" };
      }

      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted) {
        return { result: false, error: `Campaign ${campaignId} not found` };
      }

      const normalized = this.normalizeParticipants(campaign);
      Object.assign(campaign, normalized);

      campaign.name = name;
      campaign.updated_at = new Date().toISOString();
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });

      this.logger.info("Campaign updated", { campaignId: campaign.id, actor });

      return { result: true, data: campaign };
    } catch (error: any) {
      this.logger.error("Failed to update campaign", error);
      return {
        result: false,
        error: error.message || "Failed to update campaign",
      };
    }
  }

  async linkClient(
    campaignId: string,
    request: LinkClientRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<ICampaign>> {
    try {
      const { ok, extras, sanitized } = validateAllowedFields(
        request as Record<string, unknown>,
        ["client_id"],
      );
      if (!ok) {
        return { result: false, error: `Invalid fields: ${extras.join(", ")}` };
      }

      const clientId = sanitized.client_id as string;
      if (!clientId) {
        return { result: false, error: "client_id is required" };
      }
      const campaignStatus = CampaignParticipantStatus.TEST;

      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted) {
        return { result: false, error: `Campaign ${campaignId} not found` };
      }
      const normalized = this.normalizeParticipants(campaign);
      Object.assign(campaign, normalized);

      const existingClient = campaign.clients.find(
        (c) => c.client_id === clientId,
      );
      const now = new Date().toISOString();

      const linkedEntry: IParticipantHistoryEntry = {
        event: "linked",
        field: "status",
        from: existingClient?.status ?? undefined,
        to: campaignStatus,
        changed_at: now,
        changed_by: actor,
      };

      if (existingClient) {
        existingClient.status = campaignStatus;
        existingClient.added_at = existingClient.added_at ?? now;
        existingClient.history = [
          ...(existingClient.history ?? []),
          linkedEntry,
        ];
      } else {
        const newClient: ICampaignClient = {
          client_id: clientId,
          added_at: now,
          status: campaignStatus,
          history: [linkedEntry],
        };
        campaign.clients = [...campaign.clients, newClient];
      }

      campaign.ever_linked_participants = true;

      campaign.updated_at = new Date().toISOString();
      campaign.updated_by = actor;
      campaign.ever_linked_participants = true;

      this.logger.info("Client linked to campaign", {
        campaignId,
        clientId,
        campaignStatus,
        addedAt: existingClient?.added_at ?? now,
      });

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });

      return { result: true, data: campaign };
    } catch (error: any) {
      this.logger.error("Failed to link client to campaign", error);
      return {
        result: false,
        error: error.message || "Failed to link client",
      };
    }
  }

  async linkAffiliate(
    campaignId: string,
    request: LinkAffiliateRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<{ campaign: ICampaign; campaign_key: string }>> {
    try {
      const { ok, extras, sanitized } = validateAllowedFields(
        request as Record<string, unknown>,
        ["affiliate_id"],
      );
      if (!ok) {
        return { result: false, error: `Invalid fields: ${extras.join(", ")}` };
      }

      const affiliateId = sanitized.affiliate_id as string;
      if (!affiliateId) {
        return { result: false, error: "affiliate_id is required" };
      }
      const campaignStatus = CampaignParticipantStatus.TEST;

      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted) {
        return { result: false, error: `Campaign ${campaignId} not found` };
      }
      const normalized = this.normalizeParticipants(campaign);
      Object.assign(campaign, normalized);

      const existing = campaign.affiliates.find(
        (a) => a.affiliate_id === affiliateId,
      );
      const now = new Date().toISOString();
      const campaign_key =
        existing?.campaign_key ?? IdGenerator.generateCampaignKey(12);

      const affLinkedEntry: IParticipantHistoryEntry = {
        event: "linked",
        field: "status",
        from: existing?.status ?? undefined,
        to: campaignStatus,
        changed_at: now,
        changed_by: actor,
      };

      if (existing) {
        existing.status = campaignStatus;
        existing.added_at = existing.added_at ?? now;
        existing.history = [...(existing.history ?? []), affLinkedEntry];
      } else {
        const newAffiliate: ICampaignAffiliate = {
          affiliate_id: affiliateId,
          campaign_key,
          added_at: now,
          status: campaignStatus,
          history: [affLinkedEntry],
        };
        campaign.affiliates = [...campaign.affiliates, newAffiliate];
      }

      campaign.updated_at = new Date().toISOString();
      campaign.updated_by = actor;
      campaign.ever_linked_participants = true;

      this.logger.info("Affiliate linked to campaign", {
        campaignId,
        affiliateId,
        campaignStatus,
        campaignKey: campaign_key,
        addedAt: existing?.added_at ?? now,
      });

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });

      return { result: true, data: { campaign, campaign_key } };
    } catch (error: any) {
      this.logger.error("Failed to link affiliate to campaign", error);
      return {
        result: false,
        error: error.message || "Failed to link affiliate",
      };
    }
  }

  async updateStatus(
    campaignId: string,
    request: UpdateCampaignStatusRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<ICampaign>> {
    try {
      const { ok, extras, sanitized } = validateAllowedFields(
        request as Record<string, unknown>,
        ["status"],
      );

      if (!ok) {
        return { result: false, error: `Invalid fields: ${extras.join(", ")}` };
      }

      const status = sanitized.status as CampaignStatus;
      if (!status) {
        return { result: false, error: "status is required" };
      }

      if (!Object.values(CampaignStatus).includes(status)) {
        return { result: false, error: `Invalid status: ${status}` };
      }

      const campaign = await this.getCampaignById(campaignId);
      if (!campaign) {
        return { result: false, error: `Campaign ${campaignId} not found` };
      }
      const normalized = this.normalizeParticipants(campaign);
      Object.assign(campaign, normalized);
      const previousStatus = campaign.status;
      const hasClients = (campaign.clients?.length ?? 0) > 0;
      const hasAffiliates = (campaign.affiliates?.length ?? 0) > 0;

      if (status === CampaignStatus.TEST && (!hasClients || !hasAffiliates)) {
        return {
          result: false,
          error: "Add at least one client and affiliate before moving to TEST",
        };
      }

      if (status !== CampaignStatus.DRAFT && !hasClients && !hasAffiliates) {
        return {
          result: false,
          error: "Add at least one client and affiliate before changing status",
        };
      }

      if (status === CampaignStatus.ACTIVE && (!hasClients || !hasAffiliates)) {
        return {
          result: false,
          error:
            "Add at least one client and affiliate before moving to ACTIVE",
        };
      }

      if (
        status === CampaignStatus.ACTIVE &&
        previousStatus !== CampaignStatus.TEST
      ) {
        return {
          result: false,
          error: "Campaign must be TEST before moving to ACTIVE",
        };
      }

      if (status === CampaignStatus.ACTIVE) {
        const hasLiveAffiliates = (campaign.affiliates ?? []).some(
          (a) => a.status === CampaignParticipantStatus.LIVE,
        );
        const hasLiveClients = (campaign.clients ?? []).some(
          (c) => c.status === CampaignParticipantStatus.LIVE,
        );
        if (
          (campaign.affiliates ?? []).some(
            (a) => a.status === CampaignParticipantStatus.TEST,
          )
        ) {
          return {
            result: false,
            error: "All affiliates must be LIVE for campaign to go ACTIVE",
          };
        }

        if (
          (campaign.clients ?? []).some(
            (c) => c.status === CampaignParticipantStatus.TEST,
          )
        ) {
          return {
            result: false,
            error: "All clients must be LIVE for campaign to go ACTIVE",
          };
        }

        if (!hasLiveAffiliates || !hasLiveClients) {
          return {
            result: false,
            error:
              "At least one LIVE client and one LIVE affiliate are required for campaign to go ACTIVE",
          };
        }
      }

      if (status === previousStatus) {
        return { result: false, error: "Campaign already in that status" };
      }

      const now = new Date().toISOString();
      campaign.status_history = [
        ...(campaign.status_history ?? []),
        {
          from: previousStatus,
          to: status,
          changed_at: now,
        },
      ];
      campaign.status = status;
      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });

      return { result: true, data: campaign };
    } catch (error: any) {
      this.logger.error("Failed to update campaign status", error);
      return {
        result: false,
        error: error.message || "Failed to update campaign status",
      };
    }
  }

  async updatePlugins(
    campaignId: string,
    request: UpdateCampaignPluginsRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<ICampaign>> {
    try {
      const { ok, extras, sanitized } = validateAllowedFields(
        request as Record<string, unknown>,
        ["duplicate_check"],
      );

      if (!ok) {
        return { result: false, error: `Invalid fields: ${extras.join(", ")}` };
      }

      const campaign = await this.getCampaignById(campaignId);
      if (!campaign) {
        return { result: false, error: `Campaign ${campaignId} not found` };
      }

      const normalizedCampaign = this.normalizeParticipants(campaign);
      Object.assign(campaign, normalizedCampaign);

      const currentPlugins = this.normalizePlugins(campaign.plugins);
      const duplicateCheck =
        (sanitized.duplicate_check as Record<string, unknown> | undefined) ??
        undefined;

      if (duplicateCheck) {
        const duplicateFields = Object.keys(duplicateCheck);
        const invalidDuplicateFields = duplicateFields.filter(
          (field) => !["enabled", "criteria"].includes(field),
        );

        if (invalidDuplicateFields.length > 0) {
          return {
            result: false,
            error: `Invalid duplicate_check fields: ${invalidDuplicateFields.join(", ")}`,
          };
        }
      }

      const enabledValue = duplicateCheck?.enabled;
      if (enabledValue !== undefined && typeof enabledValue !== "boolean") {
        return {
          result: false,
          error: "duplicate_check.enabled must be a boolean",
        };
      }

      const criteriaValue = duplicateCheck?.criteria;
      let normalizedRequestedCriteria: ("phone" | "email")[] | undefined;
      if (criteriaValue !== undefined) {
        if (
          !Array.isArray(criteriaValue) ||
          criteriaValue.length === 0 ||
          criteriaValue.some((criterion) => typeof criterion !== "string")
        ) {
          return {
            result: false,
            error:
              "duplicate_check.criteria must be a non-empty array of strings",
          };
        }

        const invalidCriteria = criteriaValue.filter(
          (criterion) => !["phone", "email"].includes(criterion),
        );
        if (invalidCriteria.length > 0) {
          return {
            result: false,
            error: `Invalid duplicate_check.criteria values: ${invalidCriteria.join(", ")}`,
          };
        }

        normalizedRequestedCriteria = Array.from(
          new Set(
            criteriaValue.map((value) => value.trim() as "phone" | "email"),
          ),
        );

        if (enabledValue === true && normalizedRequestedCriteria.length === 0) {
          return {
            result: false,
            error:
              "duplicate_check.enabled=true requires at least one criteria: phone or email",
          };
        }
      }

      const nextPlugins: ICampaignPlugins = {
        duplicate_check: {
          enabled:
            typeof enabledValue === "boolean"
              ? enabledValue
              : currentPlugins.duplicate_check.enabled,
          criteria:
            Array.isArray(normalizedRequestedCriteria) &&
            normalizedRequestedCriteria.length > 0
              ? normalizedRequestedCriteria
              : currentPlugins.duplicate_check.criteria,
        },
      };

      if (
        nextPlugins.duplicate_check.enabled &&
        nextPlugins.duplicate_check.criteria.length === 0
      ) {
        return {
          result: false,
          error:
            "duplicate_check.enabled=true requires at least one criteria: phone or email",
        };
      }

      campaign.plugins = nextPlugins;
      campaign.updated_at = new Date().toISOString();
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });

      this.logger.info("Campaign plugins updated", {
        campaignId,
        plugins: nextPlugins,
      });

      return { result: true, data: campaign };
    } catch (error: any) {
      this.logger.error("Failed to update campaign plugins", error);
      return {
        result: false,
        error: error.message || "Failed to update campaign plugins",
      };
    }
  }

  async rotateAffiliateKey(
    campaignId: string,
    affiliateId: string,
    actor?: RequestActor,
  ): Promise<ServiceResult<{ campaign: ICampaign; campaign_key: string }>> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign) {
        return { result: false, error: `Campaign ${campaignId} not found` };
      }

      const normalized = this.normalizeParticipants(campaign);
      Object.assign(campaign, normalized);

      const affiliate = (campaign.affiliates ?? []).find(
        (a) => a.affiliate_id === affiliateId,
      );
      if (!affiliate) {
        return {
          result: false,
          error: `Affiliate ${affiliateId} not linked to campaign`,
        };
      }

      const now = new Date().toISOString();
      const oldKey = affiliate.campaign_key;
      const campaign_key = IdGenerator.generateCampaignKey(12);
      affiliate.campaign_key = campaign_key;
      affiliate.history = [
        ...(affiliate.history ?? []),
        {
          event: "key_rotated",
          field: "campaign_key",
          from: oldKey,
          to: campaign_key,
          changed_at: now,
          changed_by: actor,
        } satisfies IParticipantHistoryEntry,
      ];

      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });

      this.logger.info("Affiliate campaign_key rotated", {
        campaignId,
        affiliateId,
      });

      return { result: true, data: { campaign, campaign_key } };
    } catch (error: any) {
      this.logger.error("Failed to rotate affiliate key", error);
      return {
        result: false,
        error: error.message || "Failed to rotate affiliate key",
      };
    }
  }

  async updateAffiliateStatus(
    campaignId: string,
    affiliateId: string,
    request: UpdateParticipantStatusRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<ICampaign>> {
    return this.mutateAffiliate(
      campaignId,
      affiliateId,
      (a) => {
        a.status = request.status;
      },
      actor,
      { recordRemoval: false },
    );
  }

  async deleteAffiliate(
    campaignId: string,
    affiliateId: string,
    actor?: RequestActor,
  ): Promise<ServiceResult<ICampaign>> {
    return this.mutateAffiliate(
      campaignId,
      affiliateId,
      (a, campaign) => {
        campaign.affiliates = (campaign.affiliates ?? []).filter(
          (x) => x.affiliate_id !== affiliateId,
        );
      },
      actor,
      { recordRemoval: true },
    );
  }

  async updateClientStatus(
    campaignId: string,
    clientId: string,
    request: UpdateParticipantStatusRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<ICampaign>> {
    return this.mutateClient(
      campaignId,
      clientId,
      (c) => {
        c.status = request.status;
      },
      actor,
      { recordRemoval: false },
    );
  }

  async deleteClient(
    campaignId: string,
    clientId: string,
    actor?: RequestActor,
  ): Promise<ServiceResult<ICampaign>> {
    return this.mutateClient(
      campaignId,
      clientId,
      (c, campaign) => {
        campaign.clients = (campaign.clients ?? []).filter(
          (x) => x.client_id !== clientId,
        );
      },
      actor,
      { recordRemoval: true },
    );
  }

  private async campaignHasLeads(campaignId: string): Promise<boolean> {
    const scanResult = await this.dynamoDBUtil.scan<{ id: string } | any>({
      TableName: this.constants.LEADS_TABLE_NAME,
      Limit: 1,
      FilterExpression: "#campaign_id = :campaign_id",
      ExpressionAttributeNames: { "#campaign_id": "campaign_id" },
      ExpressionAttributeValues: { ":campaign_id": campaignId },
    });

    return (scanResult.items?.length ?? 0) > 0;
  }

  private async mutateAffiliate(
    campaignId: string,
    affiliateId: string,
    mutate: (a: ICampaignAffiliate, campaign: ICampaign) => void,
    actor?: RequestActor,
    options: { recordRemoval?: boolean } = {},
  ): Promise<ServiceResult<ICampaign>> {
    try {
      const hasLeads = await this.campaignHasLeads(campaignId);
      if (hasLeads && options.recordRemoval) {
        return {
          result: false,
          error:
            "Cannot remove affiliate because the campaign has leads; disable the affiliate instead",
        };
      }

      const campaign = await this.getCampaignById(campaignId);
      if (!campaign) {
        return { result: false, error: `Campaign ${campaignId} not found` };
      }
      const normalized = this.normalizeParticipants(campaign);
      Object.assign(campaign, normalized);
      const affiliate = (campaign.affiliates ?? []).find(
        (a) => a.affiliate_id === affiliateId,
      );
      if (!affiliate) {
        return {
          result: false,
          error: `Affiliate ${affiliateId} not linked to campaign`,
        };
      }

      const now = new Date().toISOString();
      const prevAffStatus = affiliate.status;

      if (options.recordRemoval) {
        campaign.removed_affiliates = [
          ...(campaign.removed_affiliates ?? []),
          {
            affiliate_id: affiliate.affiliate_id,
            campaign_key: affiliate.campaign_key,
            added_at: affiliate.added_at,
            status_at_removal: affiliate.status,
            removed_at: now,
            removed_by: actor,
          },
        ];
      }

      mutate(affiliate, campaign);

      if (!options.recordRemoval) {
        // The affiliate object was mutated in-place — record what changed
        const historyEntries: IParticipantHistoryEntry[] = [];
        if (affiliate.status !== prevAffStatus) {
          historyEntries.push({
            event: "status_changed",
            field: "status",
            from: prevAffStatus,
            to: affiliate.status,
            changed_at: now,
            changed_by: actor,
          });
        }
        if (historyEntries.length > 0) {
          affiliate.history = [...(affiliate.history ?? []), ...historyEntries];
        }
      }

      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });

      this.logger.info("Campaign affiliate mutated", {
        campaignId,
        affiliateId,
        status: affiliate.status,
        addedAt: affiliate.added_at,
      });

      return { result: true, data: campaign };
    } catch (error: any) {
      this.logger.error("Failed to mutate affiliate", error);
      return {
        result: false,
        error: error.message || "Failed to update affiliate",
      };
    }
  }

  private async mutateClient(
    campaignId: string,
    clientId: string,
    mutate: (c: ICampaignClient, campaign: ICampaign) => void,
    actor?: RequestActor,
    options: { recordRemoval?: boolean } = {},
  ): Promise<ServiceResult<ICampaign>> {
    try {
      const hasLeads = await this.campaignHasLeads(campaignId);
      if (hasLeads && options.recordRemoval) {
        return {
          result: false,
          error:
            "Cannot remove client because the campaign has leads; disable the client instead",
        };
      }

      const campaign = await this.getCampaignById(campaignId);
      if (!campaign) {
        return { result: false, error: `Campaign ${campaignId} not found` };
      }
      const normalized = this.normalizeParticipants(campaign);
      Object.assign(campaign, normalized);
      const client = (campaign.clients ?? []).find(
        (c) => c.client_id === clientId,
      );
      if (!client) {
        return {
          result: false,
          error: `Client ${clientId} not linked to campaign`,
        };
      }

      const now = new Date().toISOString();
      const prevClientStatus = client.status;

      if (options.recordRemoval) {
        campaign.removed_clients = [
          ...(campaign.removed_clients ?? []),
          {
            client_id: client.client_id,
            added_at: client.added_at,
            status_at_removal: client.status,
            removed_at: now,
            removed_by: actor,
          },
        ];
      }

      mutate(client, campaign);

      if (!options.recordRemoval) {
        const historyEntries: IParticipantHistoryEntry[] = [];
        if (client.status !== prevClientStatus) {
          historyEntries.push({
            event: "status_changed",
            field: "status",
            from: prevClientStatus,
            to: client.status,
            changed_at: now,
            changed_by: actor,
          });
        }
        if (historyEntries.length > 0) {
          client.history = [...(client.history ?? []), ...historyEntries];
        }
      }

      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });

      this.logger.info("Campaign client mutated", {
        campaignId,
        clientId,
        status: client.status,
        addedAt: client.added_at,
      });

      return { result: true, data: campaign };
    } catch (error: any) {
      this.logger.error("Failed to mutate client", error);
      return {
        result: false,
        error: error.message || "Failed to update client",
      };
    }
  }

  private async getCampaignById(id: string): Promise<ICampaign | null> {
    const campaign = await this.dynamoDBUtil.get<ICampaign>({
      TableName: this.constants.CAMPAIGNS_TABLE_NAME,
      Key: { id },
    });

    return campaign ?? null;
  }

  async getCampaign(id: string): Promise<ServiceResult<ICampaign>> {
    try {
      const campaign = await this.getCampaignById(id);
      if (!campaign || campaign.is_deleted) {
        return { result: false, error: `Campaign with id ${id} not found` };
      }
      return { result: true, data: this.normalizeParticipants(campaign) };
    } catch (error: any) {
      this.logger.error("Failed to get campaign", error);
      return {
        result: false,
        error: error.message || "Failed to get campaign",
      };
    }
  }

  async deleteCampaign(
    id: string,
    options: { permanent?: boolean } = {},
    actor?: RequestActor,
  ): Promise<ServiceResult<{ id: string; permanent: boolean }>> {
    try {
      const existing = await this.getCampaignById(id);
      if (!existing) {
        return { result: false, error: `Campaign with id ${id} not found` };
      }

      const normalized = this.normalizeParticipants(existing);
      Object.assign(existing, normalized);

      const hasClients = (existing.clients?.length ?? 0) > 0;
      const hasAffiliates = (existing.affiliates?.length ?? 0) > 0;
      const hasLeads = await this.campaignHasLeads(id);
      const statusAllowsDelete =
        existing.status === CampaignStatus.DRAFT ||
        existing.status === CampaignStatus.TEST;

      if (!statusAllowsDelete) {
        return {
          result: false,
          error: "Campaign can be deleted only in DRAFT or TEST status",
        };
      }

      if (hasClients || hasAffiliates) {
        return {
          result: false,
          error:
            "Remove or disable all linked clients and affiliates before deleting the campaign",
        };
      }

      if (hasLeads) {
        return {
          result: false,
          error: "Campaign with leads cannot be deleted",
        };
      }

      const hasParticipantHistory =
        existing.ever_linked_participants === true ||
        (existing.removed_affiliates?.length ?? 0) > 0 ||
        (existing.removed_clients?.length ?? 0) > 0;
      const hasLeadHistory = existing.has_received_leads === true;

      if (options.permanent) {
        if (hasParticipantHistory || hasLeadHistory) {
          return {
            result: false,
            error:
              "Hard delete allowed only for campaigns that never had participants or leads",
          };
        }

        await this.dynamoDBUtil.delete({
          TableName: this.constants.CAMPAIGNS_TABLE_NAME,
          Key: { id },
        });
        this.logger.info("Campaign permanently deleted", {
          campaignId: id,
          actor,
        });
      } else {
        const now = new Date().toISOString();
        const expression = this.dynamoDBUtil.buildUpdateExpression({
          is_deleted: true,
          active: false,
          deleted_at: now,
          deleted_by: actor,
          updated_at: now,
          updated_by: actor,
        });

        await this.dynamoDBUtil.update({
          TableName: this.constants.CAMPAIGNS_TABLE_NAME,
          Key: { id },
          ...expression,
        });
        this.logger.info("Campaign soft-deleted", { campaignId: id, actor });
      }

      return { result: true, data: { id, permanent: !!options.permanent } };
    } catch (error: any) {
      this.logger.error("Failed to delete campaign", error);
      return {
        result: false,
        error: error.message || "Failed to delete campaign",
      };
    }
  }

  private normalizeParticipants(campaign: ICampaign): ICampaign {
    const normalizeClients = (campaign.clients ?? []).map((c: any) =>
      typeof c === "string"
        ? {
            client_id: c,
            status: CampaignParticipantStatus.LIVE,
            added_at: new Date().toISOString(),
            history: [] as IParticipantHistoryEntry[],
          }
        : {
            client_id: c.client_id,
            added_at: c.added_at ?? new Date().toISOString(),
            status: c.status ?? CampaignParticipantStatus.LIVE,
            history: (c.history ?? []) as IParticipantHistoryEntry[],
          },
    );

    const normalizeAffiliates = (campaign.affiliates ?? []).map((a: any) =>
      typeof a === "string"
        ? {
            affiliate_id: a,
            campaign_key: IdGenerator.generateCampaignKey(12),
            added_at: new Date().toISOString(),
            status: CampaignParticipantStatus.LIVE,
            history: [] as IParticipantHistoryEntry[],
          }
        : {
            affiliate_id: a.affiliate_id,
            campaign_key: a.campaign_key,
            added_at: a.added_at ?? new Date().toISOString(),
            status: a.status ?? CampaignParticipantStatus.LIVE,
            history: (a.history ?? []) as IParticipantHistoryEntry[],
          },
    );

    return {
      ...campaign,
      clients: normalizeClients,
      affiliates: normalizeAffiliates,
      plugins: this.normalizePlugins(campaign.plugins),
      removed_clients: campaign.removed_clients ?? [],
      removed_affiliates: campaign.removed_affiliates ?? [],
      ever_linked_participants:
        campaign.ever_linked_participants === true ||
        normalizeClients.length > 0 ||
        normalizeAffiliates.length > 0,
      has_received_leads: campaign.has_received_leads ?? false,
    };
  }

  private normalizePlugins(
    plugins?: Partial<ICampaignPlugins>,
  ): ICampaignPlugins {
    const defaults = this.getDefaultPlugins();
    const criteria = plugins?.duplicate_check?.criteria;
    const normalizedCriteria = Array.isArray(criteria)
      ? Array.from(
          new Set(
            criteria
              .map((item) => (typeof item === "string" ? item.trim() : ""))
              .filter((item): item is "phone" | "email" =>
                ["phone", "email"].includes(item),
              ),
          ),
        )
      : defaults.duplicate_check.criteria;

    return {
      duplicate_check: {
        enabled:
          typeof plugins?.duplicate_check?.enabled === "boolean"
            ? plugins.duplicate_check.enabled
            : defaults.duplicate_check.enabled,
        criteria:
          normalizedCriteria.length > 0
            ? normalizedCriteria
            : defaults.duplicate_check.criteria,
      },
    };
  }

  private getDefaultPlugins(): ICampaignPlugins {
    return {
      duplicate_check: {
        enabled: true,
        criteria: ["phone", "email"],
      },
    };
  }
}
