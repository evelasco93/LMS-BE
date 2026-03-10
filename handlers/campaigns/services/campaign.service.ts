import { injectable, inject } from "inversify";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { Logger } from "@shared/services/logger.util";
import { IdGenerator } from "@shared/generators/id.generator";
import { validateAllowedFields } from "@shared/utils/payload-validation.util";
import { CampaignConstants } from "../constants/campaign.constants";
import {
  BaseCriteriaDataType,
  IBaseCriteriaField,
  IBaseCriteriaHistoryEntry,
  ICampaign,
  ICampaignAffiliate,
  ICampaignClient,
  ICampaignPlugins,
  ICampaignStatusChange,
  IEditHistoryEntry,
  IFieldOption,
  IIpqsEmailCheckConfig,
  IIpqsIpCheckConfig,
  IIpqsPhoneCheckConfig,
  IIpqsPluginConfig,
  IParticipantHistoryEntry,
  IValueMapping,
} from "../interfaces/ICampaign.interface";
import { CampaignStatus } from "../enums/campaign-status.enum";
import { CampaignParticipantStatus } from "../enums/campaign-participant-status.enum";
import {
  AddCriteriaFieldRequest,
  CreateCampaignRequest,
  LinkAffiliateRequest,
  LinkClientRequest,
  ListCampaignsQuery,
  ReorderCriteriaRequest,
  SetValueMappingsRequest,
  UpdateCampaignPluginsRequest,
  UpdateCampaignRequest,
  UpdateCampaignStatusRequest,
  UpdateCriteriaFieldRequest,
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

      const now = new Date().toISOString();
      const newHistoryEntries: IEditHistoryEntry[] = [];
      if (campaign.name !== name) {
        newHistoryEntries.push({
          field: "name",
          previous_value: campaign.name,
          new_value: name,
          changed_at: now,
          changed_by: actor,
        });
      }

      campaign.name = name;
      campaign.edit_history = [
        ...(campaign.edit_history ?? []),
        ...newHistoryEntries,
      ];
      campaign.updated_at = now;
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
  ): Promise<
    ServiceResult<{
      campaign: ICampaign;
      campaign_key: string;
      submit_url: string;
      submit_url_test: string;
    }>
  > {
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

      const leadsBase = this.constants.LEADS_BASE_URL;
      return {
        result: true,
        data: {
          campaign,
          campaign_key,
          submit_url: leadsBase,
          submit_url_test: `${leadsBase}/test`,
        },
      };
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

        // duplicate_check is essential for every campaign — auto-enable on ACTIVE
        const normalizedPlugins = this.normalizePlugins(campaign.plugins);
        if (!normalizedPlugins.duplicate_check.enabled) {
          campaign.plugins = {
            ...(campaign.plugins ?? {}),
            duplicate_check: {
              ...(campaign.plugins?.duplicate_check ?? {}),
              enabled: true,
            },
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
        ["duplicate_check", "trusted_form", "ipqs"],
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

      const trustedFormRequest =
        (sanitized.trusted_form as Record<string, unknown> | undefined) ??
        undefined;

      if (trustedFormRequest) {
        const tfFields = Object.keys(trustedFormRequest);
        const invalidTfFields = tfFields.filter(
          (f) => !["enabled", "stage", "gate", "claim", "vendor"].includes(f),
        );
        if (invalidTfFields.length > 0) {
          return {
            result: false,
            error: `Invalid trusted_form fields: ${invalidTfFields.join(", ")}`,
          };
        }
        if (
          trustedFormRequest.enabled !== undefined &&
          typeof trustedFormRequest.enabled !== "boolean"
        ) {
          return {
            result: false,
            error: "trusted_form.enabled must be a boolean",
          };
        }
        if (trustedFormRequest.stage !== undefined) {
          const s = Number(trustedFormRequest.stage);
          if (!Number.isInteger(s) || s < 2) {
            return {
              result: false,
              error:
                "trusted_form.stage must be an integer >= 2 (stage 1 is reserved for duplicate_check)",
            };
          }
        }
        if (
          trustedFormRequest.gate !== undefined &&
          typeof trustedFormRequest.gate !== "boolean"
        ) {
          return {
            result: false,
            error: "trusted_form.gate must be a boolean",
          };
        }
        if (
          trustedFormRequest.claim !== undefined &&
          typeof trustedFormRequest.claim !== "boolean"
        ) {
          return {
            result: false,
            error: "trusted_form.claim must be a boolean",
          };
        }
      }

      // ── IPQS validation ───────────────────────────────────────────────────────
      const ipqsRequest =
        (sanitized.ipqs as Record<string, unknown> | undefined) ?? undefined;

      if (ipqsRequest) {
        const ipqsFields = Object.keys(ipqsRequest);
        const invalidIpqsFields = ipqsFields.filter(
          (f) =>
            !["enabled", "stage", "gate", "phone", "email", "ip"].includes(f),
        );
        if (invalidIpqsFields.length > 0) {
          return {
            result: false,
            error: `Invalid ipqs fields: ${invalidIpqsFields.join(", ")}`,
          };
        }
        if (
          ipqsRequest.enabled !== undefined &&
          typeof ipqsRequest.enabled !== "boolean"
        ) {
          return { result: false, error: "ipqs.enabled must be a boolean" };
        }
        if (ipqsRequest.stage !== undefined) {
          const s = Number(ipqsRequest.stage);
          if (!Number.isInteger(s) || s < 2) {
            return {
              result: false,
              error:
                "ipqs.stage must be an integer >= 2 (stage 1 is reserved for duplicate_check)",
            };
          }
        }
        if (
          ipqsRequest.gate !== undefined &&
          typeof ipqsRequest.gate !== "boolean"
        ) {
          return { result: false, error: "ipqs.gate must be a boolean" };
        }
        for (const check of ["phone", "email", "ip"] as const) {
          const checkReq = ipqsRequest[check] as
            | Record<string, unknown>
            | undefined;
          if (
            checkReq?.enabled !== undefined &&
            typeof checkReq.enabled !== "boolean"
          ) {
            return {
              result: false,
              error: `ipqs.${check}.enabled must be a boolean`,
            };
          }
        }
      }

      const defaults = this.getDefaultPlugins();

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
        trusted_form: {
          enabled:
            trustedFormRequest?.enabled !== undefined
              ? (trustedFormRequest.enabled as boolean)
              : currentPlugins.trusted_form.enabled,
          stage:
            trustedFormRequest?.stage !== undefined
              ? Number(trustedFormRequest.stage)
              : currentPlugins.trusted_form.stage,
          gate:
            trustedFormRequest?.gate !== undefined
              ? (trustedFormRequest.gate as boolean)
              : currentPlugins.trusted_form.gate,
          claim:
            trustedFormRequest?.claim !== undefined
              ? (trustedFormRequest.claim as boolean)
              : currentPlugins.trusted_form.claim,
          ...(trustedFormRequest?.vendor !== undefined
            ? { vendor: trustedFormRequest.vendor as string }
            : currentPlugins.trusted_form.vendor !== undefined
              ? { vendor: currentPlugins.trusted_form.vendor }
              : {}),
        },
        ipqs: this.mergeIpqsConfig(
          currentPlugins.ipqs,
          ipqsRequest,
          defaults.ipqs,
        ),
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

      // ── Tenant-level guard: block re-enabling a globally-disabled plugin ──
      // Only fires when the request *explicitly* sets enabled: true so we never
      // block requests that aren't changing the enabled state, and we don't burn
      // unnecessary DynamoDB reads on every plugin update.
      if (duplicateCheck?.enabled === true) {
        const tenantAllows =
          await this.isTenantPluginEnabled("duplicate_check");
        if (!tenantAllows) {
          return {
            result: false,
            error:
              "Cannot enable duplicate_check: this plugin is disabled at the tenant level. Enable it via PUT /tenant-config/plugin-settings/{schemaId} first.",
          };
        }
      }

      if (trustedFormRequest?.enabled === true) {
        const tenantAllows = await this.isTenantPluginEnabled("trusted_form");
        if (!tenantAllows) {
          return {
            result: false,
            error:
              "Cannot enable trusted_form: this plugin is disabled at the tenant level. Enable it via PUT /tenant-config/plugin-settings/{schemaId} first.",
          };
        }
      }

      if (ipqsRequest?.enabled === true) {
        const tenantAllows = await this.isTenantPluginEnabled("ipqs");
        if (!tenantAllows) {
          return {
            result: false,
            error:
              "Cannot enable ipqs: this plugin is disabled at the tenant level. Enable it via PUT /tenant-config/plugin-settings/{schemaId} first.",
          };
        }
      }

      campaign.plugins = nextPlugins;
      campaign.updated_at = new Date().toISOString();
      campaign.updated_by = actor;

      // ── Record plugin history (diff current vs next) ──────────────────────
      const now = new Date().toISOString();
      const pluginHistoryEntries: IEditHistoryEntry[] = [];
      const diffFields = <T extends object>(
        prefix: string,
        before: T,
        after: T,
        keys: (keyof T)[],
      ) => {
        for (const key of keys) {
          if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
            pluginHistoryEntries.push({
              field: `${prefix}.${String(key)}`,
              previous_value: before[key],
              new_value: after[key],
              changed_at: now,
              changed_by: actor,
            });
          }
        }
      };
      diffFields(
        "duplicate_check",
        currentPlugins.duplicate_check,
        nextPlugins.duplicate_check,
        ["enabled", "criteria"],
      );
      diffFields(
        "trusted_form",
        currentPlugins.trusted_form,
        nextPlugins.trusted_form,
        ["enabled", "stage", "gate", "claim", "vendor"],
      );
      diffFields("ipqs", currentPlugins.ipqs, nextPlugins.ipqs, [
        "enabled",
        "stage",
        "gate",
      ]);
      if (pluginHistoryEntries.length > 0) {
        campaign.plugins.plugin_history = [
          ...(campaign.plugins.plugin_history ?? []),
          ...pluginHistoryEntries,
        ];
      }

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
  ): Promise<
    ServiceResult<{
      campaign: ICampaign;
      campaign_key: string;
      submit_url: string;
      submit_url_test: string;
    }>
  > {
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

      const leadsBase = this.constants.LEADS_BASE_URL;
      return {
        result: true,
        data: {
          campaign,
          campaign_key,
          submit_url: leadsBase,
          submit_url_test: `${leadsBase}/test`,
        },
      };
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
  ): Promise<
    ServiceResult<{
      campaign: ICampaign;
      submit_url: string;
      submit_url_test: string;
    }>
  > {
    const result = await this.mutateAffiliate(
      campaignId,
      affiliateId,
      (a) => {
        a.status = request.status;
      },
      actor,
      { recordRemoval: false },
    );
    if (!result.result) return { result: false, error: result.error };
    const leadsBase = this.constants.LEADS_BASE_URL;
    return {
      result: true,
      data: {
        campaign: result.data!,
        submit_url: leadsBase,
        submit_url_test: `${leadsBase}/test`,
      },
    };
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
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign) {
        return { result: false, error: `Campaign ${campaignId} not found` };
      }
      const normalized = this.normalizeParticipants(campaign);
      Object.assign(campaign, normalized);

      // Use the persisted flag — avoids an unreliable cross-table scan
      if (campaign.has_received_leads && options.recordRemoval) {
        return {
          result: false,
          error:
            "Cannot remove affiliate because the campaign has leads; disable the affiliate instead",
        };
      }

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
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign) {
        return { result: false, error: `Campaign ${campaignId} not found` };
      }
      const normalized = this.normalizeParticipants(campaign);
      Object.assign(campaign, normalized);

      // Use the persisted flag — avoids an unreliable cross-table scan
      if (campaign.has_received_leads && options.recordRemoval) {
        return {
          result: false,
          error:
            "Cannot remove client because the campaign has leads; disable the client instead",
        };
      }

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

  async getCampaign(id: string): Promise<
    ServiceResult<{
      campaign: ICampaign;
      submit_url: string;
      submit_url_test: string;
    }>
  > {
    try {
      const campaign = await this.getCampaignById(id);
      if (!campaign || campaign.is_deleted) {
        return { result: false, error: `Campaign with id ${id} not found` };
      }
      const leadsBase = this.constants.LEADS_BASE_URL;
      return {
        result: true,
        data: {
          campaign: this.normalizeParticipants(campaign),
          submit_url: leadsBase,
          submit_url_test: `${leadsBase}/test`,
        },
      };
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
      // Use the persisted flag — avoids an unreliable cross-table scan with Limit:1
      const hasLeads = existing.has_received_leads === true;
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

  // ── Base Criteria ─────────────────────────────────────────────────────────

  private static readonly VALID_DATA_TYPES: BaseCriteriaDataType[] = [
    "List",
    "US State",
    "Text",
    "Number",
    "Date",
    "Boolean",
  ];

  async getCriteria(
    campaignId: string,
  ): Promise<ServiceResult<IBaseCriteriaField[]>> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted) {
        return { result: false, error: `Campaign ${campaignId} not found` };
      }
      return { result: true, data: campaign.base_criteria ?? [] };
    } catch (error: any) {
      this.logger.error("Failed to get campaign criteria", error);
      return {
        result: false,
        error: error.message || "Failed to get criteria",
      };
    }
  }

  async addCriteriaField(
    campaignId: string,
    request: AddCriteriaFieldRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<IBaseCriteriaField[]>> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted) {
        return { result: false, error: `Campaign ${campaignId} not found` };
      }

      const fieldLabel = (request.field_label ?? "").trim();
      const fieldName = (request.field_name ?? "").trim();
      if (!fieldLabel) {
        return { result: false, error: "field_label is required" };
      }
      if (!fieldName) {
        return { result: false, error: "field_name is required" };
      }
      if (!/^[a-z][a-z0-9_]*$/.test(fieldName)) {
        return {
          result: false,
          error:
            "field_name must be snake_case (lowercase letters, digits, underscores; must start with a letter)",
        };
      }
      if (!CampaignService.VALID_DATA_TYPES.includes(request.data_type)) {
        return {
          result: false,
          error: `Invalid data_type. Must be one of: ${CampaignService.VALID_DATA_TYPES.join(", ")}`,
        };
      }

      const existing = campaign.base_criteria ?? [];
      if (existing.some((f) => f.field_name === fieldName)) {
        return {
          result: false,
          error: `A criteria field with field_name "${fieldName}" already exists`,
        };
      }

      if (request.options !== undefined) {
        const optionsError = this.validateFieldOptions(request.options);
        if (optionsError) return { result: false, error: optionsError };
      }

      if (request.value_mappings !== undefined) {
        const mappingsError = this.validateValueMappings(
          request.value_mappings,
        );
        if (mappingsError) return { result: false, error: mappingsError };
      }

      const now = new Date().toISOString();
      const newField: IBaseCriteriaField = {
        id: IdGenerator.generate("CF"),
        order: existing.length + 1,
        field_label: fieldLabel,
        field_name: fieldName,
        data_type: request.data_type,
        required: request.required ?? false,
        ...(request.description !== undefined
          ? { description: request.description }
          : {}),
        ...(request.options !== undefined ? { options: request.options } : {}),
        ...(request.value_mappings?.length
          ? { value_mappings: request.value_mappings }
          : {}),
        ...(request.state_mapping
          ? { state_mapping: request.state_mapping }
          : {}),
        client_override: request.client_override ?? false,
        affiliate_override: request.affiliate_override ?? false,
        created_at: now,
        updated_at: now,
        created_by: actor,
        updated_by: actor,
      };

      const updatedCriteria = [...existing, newField];
      const historyEntry: IBaseCriteriaHistoryEntry = {
        event: "field_added",
        field_id: newField.id,
        field_name: newField.field_name,
        changed_at: now,
        changed_by: actor,
      };

      campaign.base_criteria = updatedCriteria;
      campaign.base_criteria_history = [
        ...(campaign.base_criteria_history ?? []),
        historyEntry,
      ];
      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });

      this.logger.info("Criteria field added", {
        campaignId,
        fieldId: newField.id,
        fieldName,
      });

      return { result: true, data: updatedCriteria };
    } catch (error: any) {
      this.logger.error("Failed to add criteria field", error);
      return {
        result: false,
        error: error.message || "Failed to add criteria field",
      };
    }
  }

  async updateCriteriaField(
    campaignId: string,
    fieldId: string,
    request: UpdateCriteriaFieldRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<IBaseCriteriaField[]>> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted) {
        return { result: false, error: `Campaign ${campaignId} not found` };
      }

      const existing = campaign.base_criteria ?? [];
      const fieldIndex = existing.findIndex((f) => f.id === fieldId);
      if (fieldIndex === -1) {
        return { result: false, error: `Criteria field ${fieldId} not found` };
      }

      const field = { ...existing[fieldIndex] };
      const changes: IEditHistoryEntry[] = [];
      const now = new Date().toISOString();

      if (
        request.field_name !== undefined &&
        request.field_name.trim() !== field.field_name
      ) {
        const newName = request.field_name.trim();
        if (!/^[a-z][a-z0-9_]*$/.test(newName)) {
          return {
            result: false,
            error:
              "field_name must be snake_case (lowercase letters, digits, underscores; must start with a letter)",
          };
        }
        if (
          existing.some((f) => f.id !== fieldId && f.field_name === newName)
        ) {
          return {
            result: false,
            error: `A criteria field with field_name "${newName}" already exists`,
          };
        }
        changes.push({
          field: "field_name",
          previous_value: field.field_name,
          new_value: newName,
          changed_at: now,
          changed_by: actor,
        });
        field.field_name = newName;
      }

      if (
        request.field_label !== undefined &&
        request.field_label.trim() !== field.field_label
      ) {
        const newLabel = request.field_label.trim();
        if (!newLabel) {
          return { result: false, error: "field_label cannot be empty" };
        }
        changes.push({
          field: "field_label",
          previous_value: field.field_label,
          new_value: newLabel,
          changed_at: now,
          changed_by: actor,
        });
        field.field_label = newLabel;
      }

      if (
        request.data_type !== undefined &&
        request.data_type !== field.data_type
      ) {
        if (!CampaignService.VALID_DATA_TYPES.includes(request.data_type)) {
          return {
            result: false,
            error: `Invalid data_type. Must be one of: ${CampaignService.VALID_DATA_TYPES.join(", ")}`,
          };
        }
        changes.push({
          field: "data_type",
          previous_value: field.data_type,
          new_value: request.data_type,
          changed_at: now,
          changed_by: actor,
        });
        field.data_type = request.data_type;
      }

      if (
        request.required !== undefined &&
        request.required !== field.required
      ) {
        changes.push({
          field: "required",
          previous_value: field.required,
          new_value: request.required,
          changed_at: now,
          changed_by: actor,
        });
        field.required = request.required;
      }

      if (request.description !== undefined) {
        const newDesc = request.description || undefined;
        if (newDesc !== field.description) {
          changes.push({
            field: "description",
            previous_value: field.description,
            new_value: newDesc,
            changed_at: now,
            changed_by: actor,
          });
          field.description = newDesc;
        }
      }

      if (request.options !== undefined) {
        const optionsError = this.validateFieldOptions(request.options);
        if (optionsError) return { result: false, error: optionsError };
        if (
          JSON.stringify(request.options) !==
          JSON.stringify(field.options ?? [])
        ) {
          changes.push({
            field: "options",
            previous_value: field.options,
            new_value: request.options,
            changed_at: now,
            changed_by: actor,
          });
          field.options =
            request.options.length > 0 ? request.options : undefined;
        }
      }

      if (
        request.client_override !== undefined &&
        request.client_override !== field.client_override
      ) {
        changes.push({
          field: "client_override",
          previous_value: field.client_override,
          new_value: request.client_override,
          changed_at: now,
          changed_by: actor,
        });
        field.client_override = request.client_override;
      }

      if (
        request.affiliate_override !== undefined &&
        request.affiliate_override !== field.affiliate_override
      ) {
        changes.push({
          field: "affiliate_override",
          previous_value: field.affiliate_override,
          new_value: request.affiliate_override,
          changed_at: now,
          changed_by: actor,
        });
        field.affiliate_override = request.affiliate_override;
      }

      if (request.value_mappings !== undefined) {
        const mappingsError = this.validateValueMappings(
          request.value_mappings,
        );
        if (mappingsError) return { result: false, error: mappingsError };
        if (
          JSON.stringify(request.value_mappings) !==
          JSON.stringify(field.value_mappings ?? [])
        ) {
          changes.push({
            field: "value_mappings",
            previous_value: field.value_mappings,
            new_value: request.value_mappings,
            changed_at: now,
            changed_by: actor,
          });
          field.value_mappings =
            request.value_mappings.length > 0
              ? request.value_mappings
              : undefined;
        }
      }

      if (
        request.state_mapping !== undefined &&
        (request.state_mapping || null) !== (field.state_mapping ?? null)
      ) {
        changes.push({
          field: "state_mapping",
          previous_value: field.state_mapping ?? null,
          new_value: request.state_mapping || null,
          changed_at: now,
          changed_by: actor,
        });
        field.state_mapping = request.state_mapping || undefined;
      }

      if (changes.length === 0) {
        return { result: true, data: existing };
      }

      field.updated_at = now;
      field.updated_by = actor;

      const updatedCriteria = [...existing];
      updatedCriteria[fieldIndex] = field;

      const historyEntry: IBaseCriteriaHistoryEntry = {
        event: "field_updated",
        field_id: field.id,
        field_name: field.field_name,
        changes,
        changed_at: now,
        changed_by: actor,
      };

      campaign.base_criteria = updatedCriteria;
      campaign.base_criteria_history = [
        ...(campaign.base_criteria_history ?? []),
        historyEntry,
      ];
      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });

      this.logger.info("Criteria field updated", { campaignId, fieldId });

      return { result: true, data: updatedCriteria };
    } catch (error: any) {
      this.logger.error("Failed to update criteria field", error);
      return {
        result: false,
        error: error.message || "Failed to update criteria field",
      };
    }
  }

  async deleteCriteriaField(
    campaignId: string,
    fieldId: string,
    actor?: RequestActor,
  ): Promise<ServiceResult<IBaseCriteriaField[]>> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted) {
        return { result: false, error: `Campaign ${campaignId} not found` };
      }

      const existing = campaign.base_criteria ?? [];
      const fieldIndex = existing.findIndex((f) => f.id === fieldId);
      if (fieldIndex === -1) {
        return { result: false, error: `Criteria field ${fieldId} not found` };
      }

      const removed = existing[fieldIndex];
      const updatedCriteria = existing
        .filter((f) => f.id !== fieldId)
        .map((f, i) => ({ ...f, order: i + 1 }));

      const now = new Date().toISOString();
      const historyEntry: IBaseCriteriaHistoryEntry = {
        event: "field_removed",
        field_id: removed.id,
        field_name: removed.field_name,
        changed_at: now,
        changed_by: actor,
      };

      campaign.base_criteria = updatedCriteria;
      campaign.base_criteria_history = [
        ...(campaign.base_criteria_history ?? []),
        historyEntry,
      ];
      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });

      this.logger.info("Criteria field removed", { campaignId, fieldId });

      return { result: true, data: updatedCriteria };
    } catch (error: any) {
      this.logger.error("Failed to delete criteria field", error);
      return {
        result: false,
        error: error.message || "Failed to delete criteria field",
      };
    }
  }

  async reorderCriteriaFields(
    campaignId: string,
    request: ReorderCriteriaRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<IBaseCriteriaField[]>> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted) {
        return { result: false, error: `Campaign ${campaignId} not found` };
      }

      const existing = campaign.base_criteria ?? [];
      const providedIds = request.order;

      if (providedIds.length !== existing.length) {
        return {
          result: false,
          error: `order array must contain exactly ${existing.length} field IDs`,
        };
      }

      const existingIds = new Set(existing.map((f) => f.id));
      const invalid = providedIds.filter((id) => !existingIds.has(id));
      if (invalid.length > 0) {
        return {
          result: false,
          error: `Unknown field IDs in order: ${invalid.join(", ")}`,
        };
      }

      const fieldMap = new Map(existing.map((f) => [f.id, f]));
      const updatedCriteria = providedIds.map((id, i) => ({
        ...fieldMap.get(id)!,
        order: i + 1,
      }));

      const now = new Date().toISOString();
      const historyEntry: IBaseCriteriaHistoryEntry = {
        event: "fields_reordered",
        changed_at: now,
        changed_by: actor,
      };

      campaign.base_criteria = updatedCriteria;
      campaign.base_criteria_history = [
        ...(campaign.base_criteria_history ?? []),
        historyEntry,
      ];
      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });

      this.logger.info("Criteria fields reordered", { campaignId });

      return { result: true, data: updatedCriteria };
    } catch (error: any) {
      this.logger.error("Failed to reorder criteria fields", error);
      return {
        result: false,
        error: error.message || "Failed to reorder criteria fields",
      };
    }
  }

  async getCriteriaHistory(
    campaignId: string,
  ): Promise<ServiceResult<IBaseCriteriaHistoryEntry[]>> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted) {
        return { result: false, error: `Campaign ${campaignId} not found` };
      }
      return { result: true, data: campaign.base_criteria_history ?? [] };
    } catch (error: any) {
      this.logger.error("Failed to get criteria history", error);
      return {
        result: false,
        error: error.message || "Failed to get criteria history",
      };
    }
  }

  async setValueMappings(
    campaignId: string,
    fieldId: string,
    request: SetValueMappingsRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<IBaseCriteriaField[]>> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted) {
        return { result: false, error: `Campaign ${campaignId} not found` };
      }

      const existing = campaign.base_criteria ?? [];
      const fieldIndex = existing.findIndex((f) => f.id === fieldId);
      if (fieldIndex === -1) {
        return { result: false, error: `Criteria field ${fieldId} not found` };
      }

      const mappingsError = this.validateValueMappings(request.value_mappings);
      if (mappingsError) return { result: false, error: mappingsError };

      const field = { ...existing[fieldIndex] };
      const now = new Date().toISOString();

      const previousMappings = field.value_mappings;
      field.value_mappings =
        request.value_mappings.length > 0 ? request.value_mappings : undefined;
      field.updated_at = now;
      field.updated_by = actor;

      const updatedCriteria = [...existing];
      updatedCriteria[fieldIndex] = field;

      const historyEntry: IBaseCriteriaHistoryEntry = {
        event: "field_updated",
        field_id: field.id,
        field_name: field.field_name,
        changes: [
          {
            field: "value_mappings",
            previous_value: previousMappings,
            new_value: field.value_mappings,
            changed_at: now,
            changed_by: actor,
          },
        ],
        changed_at: now,
        changed_by: actor,
      };

      campaign.base_criteria = updatedCriteria;
      campaign.base_criteria_history = [
        ...(campaign.base_criteria_history ?? []),
        historyEntry,
      ];
      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });

      this.logger.info("Value mappings updated", { campaignId, fieldId });

      return { result: true, data: updatedCriteria };
    } catch (error: any) {
      this.logger.error("Failed to set value mappings", error);
      return {
        result: false,
        error: error.message || "Failed to set value mappings",
      };
    }
  }

  private validateFieldOptions(options: IFieldOption[]): string | null {
    if (!Array.isArray(options)) {
      return "options must be an array";
    }
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      if (typeof opt !== "object" || opt === null) {
        return `options[${i}] must be an object with value and label`;
      }
      if (
        typeof (opt as IFieldOption).value !== "string" ||
        !(opt as IFieldOption).value.trim()
      ) {
        return `options[${i}].value must be a non-empty string`;
      }
      if (
        typeof (opt as IFieldOption).label !== "string" ||
        !(opt as IFieldOption).label.trim()
      ) {
        return `options[${i}].label must be a non-empty string`;
      }
    }
    return null;
  }

  private validateValueMappings(mappings: IValueMapping[]): string | null {
    if (!Array.isArray(mappings)) {
      return "value_mappings must be an array";
    }
    for (let i = 0; i < mappings.length; i++) {
      const m = mappings[i];
      if (typeof m !== "object" || m === null) {
        return `value_mappings[${i}] must be an object with from and to`;
      }
      if (
        !Array.isArray(m.from) ||
        m.from.length === 0 ||
        m.from.some((v: unknown) => typeof v !== "string" || !v.trim())
      ) {
        return `value_mappings[${i}].from must be a non-empty array of strings`;
      }
      if (typeof m.to !== "string" || !m.to.trim()) {
        return `value_mappings[${i}].to must be a non-empty string`;
      }
    }
    return null;
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
      trusted_form: {
        enabled:
          typeof plugins?.trusted_form?.enabled === "boolean"
            ? plugins.trusted_form.enabled
            : defaults.trusted_form.enabled,
        stage:
          typeof plugins?.trusted_form?.stage === "number"
            ? plugins.trusted_form.stage
            : defaults.trusted_form.stage,
        gate:
          typeof plugins?.trusted_form?.gate === "boolean"
            ? plugins.trusted_form.gate
            : defaults.trusted_form.gate,
        claim:
          typeof plugins?.trusted_form?.claim === "boolean"
            ? plugins.trusted_form.claim
            : defaults.trusted_form.claim,
        ...(plugins?.trusted_form?.vendor !== undefined
          ? { vendor: plugins.trusted_form.vendor }
          : {}),
      },
      ipqs: this.mergeIpqsConfig(plugins?.ipqs, undefined, defaults.ipqs),
    };
  }

  /** Deep-merge an incoming ipqs patch over currentConfig, falling back to defaults. */
  private mergeIpqsConfig(
    current: IIpqsPluginConfig | undefined,
    patch: Record<string, unknown> | undefined,
    defaults: IIpqsPluginConfig,
  ): IIpqsPluginConfig {
    const base: IIpqsPluginConfig = current ?? defaults;

    if (!patch) {
      return {
        ...base,
        stage: base.stage ?? defaults.stage,
        gate: typeof base.gate === "boolean" ? base.gate : defaults.gate,
      };
    }

    const patchPhone = patch.phone as
      | Partial<IIpqsPhoneCheckConfig>
      | undefined;
    const patchEmail = patch.email as
      | Partial<IIpqsEmailCheckConfig>
      | undefined;
    const patchIp = patch.ip as Partial<IIpqsIpCheckConfig> | undefined;

    return {
      enabled:
        typeof patch.enabled === "boolean" ? patch.enabled : base.enabled,
      stage:
        typeof patch.stage === "number"
          ? patch.stage
          : (base.stage ?? defaults.stage),
      gate:
        typeof patch.gate === "boolean"
          ? patch.gate
          : typeof base.gate === "boolean"
            ? base.gate
            : defaults.gate,
      phone: patchPhone ? { ...base.phone, ...patchPhone } : base.phone,
      email: patchEmail ? { ...base.email, ...patchEmail } : base.email,
      ip: patchIp ? { ...base.ip, ...patchIp } : base.ip,
    };
  }

  /**
   * Checks whether the globally configured plugin setting for the given provider
   * is enabled in the tenant-settings table.
   *
   * Returns `true` (permissive) if TENANT_SETTINGS_TABLE_NAME is not configured,
   * so the guard is a no-op in environments where tenant-config is not wired up.
   */
  private async isTenantPluginEnabled(provider: string): Promise<boolean> {
    if (!this.constants.TENANT_SETTINGS_TABLE_NAME) return true;

    const typeProviderIndex = `${this.constants.TENANT_SETTINGS_TABLE_NAME}-type-provider-index`;
    const schemaIdIndex = `${this.constants.TENANT_SETTINGS_TABLE_NAME}-schema-id-index`;

    // Step 1: find the credential_schema record for this provider
    const schemas = await this.dynamoDBUtil.queryAll<{
      id: string;
      is_deleted?: boolean;
    }>({
      TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
      IndexName: typeProviderIndex,
      KeyConditionExpression: "#t = :type AND #p = :provider",
      ExpressionAttributeNames: { "#t": "type", "#p": "provider" },
      ExpressionAttributeValues: {
        ":type": "credential_schema",
        ":provider": provider,
      },
    });

    const schema = schemas.find((s) => !s.is_deleted);
    // Not configured at tenant level → permissive (no global rule = allow)
    if (!schema) return true;

    // Step 2: find the matching plugin_setting and check enabled
    const settings = await this.dynamoDBUtil.queryAll<{
      enabled: boolean;
      is_deleted?: boolean;
    }>({
      TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
      IndexName: schemaIdIndex,
      KeyConditionExpression: "#s = :schemaId",
      ExpressionAttributeNames: { "#s": "schema_id" },
      ExpressionAttributeValues: { ":schemaId": schema.id },
    });

    const setting = settings.find((s) => !s.is_deleted);
    if (!setting) return false; // no active plugin setting → treated as disabled

    return setting.enabled === true;
  }

  private getDefaultPlugins(): ICampaignPlugins {
    return {
      duplicate_check: {
        // Always on by default — essential for every campaign
        enabled: true,
        criteria: ["phone", "email"],
      },
      trusted_form: {
        enabled: false,
        stage: 3,
        gate: true,
        claim: false,
      },
      ipqs: {
        enabled: false,
        stage: 2,
        gate: true,
        phone: {
          enabled: false,
          criteria: {
            valid: { enabled: true, required: true },
            fraud_score: { enabled: true, operator: "lte", value: 75 },
            country: { enabled: false, allowed: [] },
          },
        },
        email: {
          enabled: false,
          criteria: {
            valid: { enabled: true, required: true },
            fraud_score: { enabled: true, operator: "lte", value: 75 },
          },
        },
        ip: {
          enabled: false,
          criteria: {
            fraud_score: { enabled: true, operator: "lte", value: 75 },
            country_code: { enabled: false, allowed: [] },
            proxy: { enabled: false, allowed: false },
            vpn: { enabled: false, allowed: false },
          },
        },
      },
    };
  }
}
