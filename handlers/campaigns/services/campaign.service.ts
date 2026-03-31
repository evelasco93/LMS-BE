import { injectable, inject } from "inversify";
import {
  APIGatewayClient,
  GetRestApisCommand,
} from "@aws-sdk/client-api-gateway";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { Logger } from "@shared/services/logger.util";
import { AuditWriterService } from "@shared/services";
import { AuditAction, AuditChange, AuditLogItem } from "@shared/interfaces";
import { IdGenerator } from "@shared/generators/id.generator";
import { validateAllowedFields } from "@shared/utils/payload-validation.util";
import {
  BASE_CRITERIA_FIELDS,
  CampaignConstants,
  IBaseCriteriaFieldDef,
} from "../constants/campaign.constants";
import {
  BaseCriteriaDataType,
  IBaseCriteriaField,
  ICampaign,
  ICampaignAffiliate,
  ICampaignClient,
  ICampaignPlugins,
  IEditHistoryEntry,
  IFieldOption,
  IIpqsEmailCheckConfig,
  IIpqsEmailCriteria,
  IIpqsIpCheckConfig,
  IIpqsIpCriteria,
  IIpqsPhoneCheckConfig,
  IIpqsPhoneCriteria,
  IIpqsPluginConfig,
  ILogicRule,
  ILogicRuleCondition,
  ILogicRuleGroup,
  ICampaignValidationBypassConfig,
  IValueMapping,
} from "../interfaces/ICampaign.interface";
import {
  IClientDeliveryConfig,
  ILeadDistributionConfig,
} from "../interfaces/IClientDelivery.interface";
import { CampaignStatus } from "../enums/campaign-status.enum";
import { CampaignParticipantStatus } from "../enums/campaign-participant-status.enum";
import {
  AddCriteriaFieldRequest,
  CreateCampaignRequest,
  CreateLogicRuleRequest,
  GeneratePostingInstructionsRequest,
  LinkAffiliateRequest,
  LinkClientRequest,
  ListCampaignsQuery,
  PostingInstructionsResult,
  ReorderCriteriaRequest,
  SetAffiliateCapRequest,
  SetAffiliateValidationBypassRequest,
  SetAffiliateSoldPixelRequest,
  SetCampaignTagsRequest,
  SetClientDeliveryRequest,
  SetDistributionRequest,
  SetValueMappingsRequest,
  UpdateCampaignPluginsRequest,
  UpdateCampaignRequest,
  UpdateCampaignStatusRequest,
  UpdateCriteriaFieldRequest,
  UpdateLogicRuleRequest,
  UpdateParticipantStatusRequest,
  CreateCriteriaCatalogRequest,
  UpdateCriteriaCatalogRequest,
  ApplyCriteriaCatalogRequest,
} from "../types/campaign-request.types";
import {
  ICriteriaCatalogSet,
  ICriteriaCatalogVersion,
  ILogicCatalogSet,
  ILogicCatalogVersion,
  CreateLogicCatalogRequest,
  UpdateLogicCatalogRequest,
  ApplyLogicCatalogRequest,
} from "../interfaces/ICriteriaCatalog.interface";
import { ServiceResult } from "../types/common.types";
import { RequestActor } from "@shared/utils/request-audit.util";
import { ITagDefinitionRecord } from "../../tenant-config/interfaces/ITenantConfig.interface";

@injectable()
export class CampaignService {
  private leadsBaseUrlCache?: string;

  constructor(
    @inject("DynamoDBUtil") private readonly dynamoDBUtil: DynamoDBUtil,
    @inject("Logger") private readonly logger: Logger,
    @inject("CampaignConstants") private readonly constants: CampaignConstants,
    @inject("AuditWriterService")
    private readonly auditWriterService: AuditWriterService,
  ) {}

  async createCampaign(
    request: CreateCampaignRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<ICampaign>> {
    try {
      const { ok, extras, sanitized } = validateAllowedFields(
        request as Record<string, unknown>,
        ["name", "tags"],
      );

      if (!ok) {
        return { result: false, error: `Invalid fields: ${extras.join(", ")}` };
      }

      if (!sanitized.name) {
        return { result: false, error: "name is required" };
      }

      // Optionally validate tags on creation
      if (request.tags) {
        if (!Array.isArray(request.tags)) {
          return { result: false, error: "tags must be an array of strings" };
        }
        const validationError = await this.validateCampaignTags(request.tags);
        if (validationError) return { result: false, error: validationError };
      }

      const now = new Date().toISOString();
      const campaign: ICampaign = {
        id: IdGenerator.generateCampaignId(),
        name: (sanitized.name as string) || request.name,
        status: CampaignStatus.DRAFT,
        clients: [],
        affiliates: [],
        plugins: this.getDefaultPlugins(),
        created_at: now,
        updated_at: now,
        created_by: actor,
        updated_by: actor,
        is_deleted: false,
        active: true,
        ...(request.tags ? { tags: request.tags } : {}),
      };

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });

      await this.auditWriterService.writeAuditEvent({
        entity_id: campaign.id,
        entity_type: "campaign",
        action: "created",
        changes: [],
        actor,
        changed_at: now,
      });

      this.logger.info("Campaign created", { campaignId: campaign.id });
      return { result: true, data: this.enrichCampaignForResponse(campaign) };
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
          items: scanResult.items.map((item) =>
            this.enrichCampaignForResponse(item),
          ),
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
        ["name", "default_cherry_pickable"],
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
      const changes: AuditChange[] = [];
      if (campaign.name !== name) {
        changes.push({ field: "name", from: campaign.name, to: name });
      }

      const newPickable = sanitized.default_cherry_pickable as
        | boolean
        | undefined;
      if (
        newPickable !== undefined &&
        campaign.default_cherry_pickable !== newPickable
      ) {
        changes.push({
          field: "default_cherry_pickable",
          from: campaign.default_cherry_pickable,
          to: newPickable,
        });
        campaign.default_cherry_pickable = newPickable;
      }

      campaign.name = name;
      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });

      await this.auditWriterService.writeAuditEvent({
        entity_id: campaign.id,
        entity_type: "campaign",
        action: "updated",
        changes,
        actor,
        changed_at: now,
      });

      this.logger.info("Campaign updated", { campaignId: campaign.id, actor });

      return { result: true, data: this.enrichCampaignForResponse(campaign) };
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

      // Guard: campaign must have criteria and logic before linking
      const hasCriteria =
        (campaign.base_criteria ?? []).length > 0 || !!campaign.criteria_set_id;
      const hasLogic =
        (campaign.logic_rules ?? []).length > 0 || !!campaign.logic_set_id;
      if (!hasCriteria || !hasLogic) {
        return {
          result: false,
          error:
            "Campaign must have criteria and logic configured before linking participants",
        };
      }

      const normalized = this.normalizeParticipants(campaign);
      Object.assign(campaign, normalized);

      const existingClient = campaign.clients.find(
        (c) => c.client_id === clientId,
      );
      const now = new Date().toISOString();

      if (existingClient) {
        existingClient.status = campaignStatus;
        existingClient.added_at = existingClient.added_at ?? now;
      } else {
        const newClient: ICampaignClient = {
          client_id: clientId,
          added_at: now,
          status: campaignStatus,
        };
        campaign.clients = [...campaign.clients, newClient];
      }

      const existingClientOverride = (campaign.client_overrides ?? {})[
        clientId
      ];
      if (!existingClientOverride) {
        const overrides = { ...(campaign.client_overrides ?? {}) };
        overrides[clientId] = { logic_mode: "inherit_campaign" };
        campaign.client_overrides = overrides;
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

      await this.auditWriterService.writeAuditEvent({
        entity_id: campaignId,
        entity_type: "campaign",
        action: "client_linked",
        changes: [
          {
            field: `clients.${clientId}.client_id`,
            from: null,
            to: clientId,
          },
          {
            field: `clients.${clientId}.status`,
            from: null,
            to: campaignStatus,
          },
        ],
        actor,
        changed_at: now,
      });

      return { result: true, data: this.enrichCampaignForResponse(campaign) };
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

      // Guard: campaign must have criteria and logic before linking
      const hasCriteria =
        (campaign.base_criteria ?? []).length > 0 || !!campaign.criteria_set_id;
      const hasLogic =
        (campaign.logic_rules ?? []).length > 0 || !!campaign.logic_set_id;
      if (!hasCriteria || !hasLogic) {
        return {
          result: false,
          error:
            "Campaign must have criteria and logic configured before linking participants",
        };
      }

      const normalized = this.normalizeParticipants(campaign);
      Object.assign(campaign, normalized);

      const existing = campaign.affiliates.find(
        (a) => a.affiliate_id === affiliateId,
      );
      const now = new Date().toISOString();
      const campaign_key =
        existing?.campaign_key ?? IdGenerator.generateCampaignKey(12);

      if (existing) {
        existing.status = campaignStatus;
        existing.added_at = existing.added_at ?? now;
      } else {
        const newAffiliate: ICampaignAffiliate = {
          affiliate_id: affiliateId,
          campaign_key,
          added_at: now,
          status: campaignStatus,
        };
        campaign.affiliates = [...campaign.affiliates, newAffiliate];
      }

      const existingAffiliateOverride = (campaign.affiliate_overrides ?? {})[
        affiliateId
      ];
      if (!existingAffiliateOverride) {
        const overrides = { ...(campaign.affiliate_overrides ?? {}) };
        overrides[affiliateId] = { logic_mode: "inherit_campaign" };
        campaign.affiliate_overrides = overrides;
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

      await this.auditWriterService.writeAuditEvent({
        entity_id: campaignId,
        entity_type: "campaign",
        action: "affiliate_linked",
        changes: [
          {
            field: `affiliates.${affiliateId}.affiliate_id`,
            from: null,
            to: affiliateId,
          },
          {
            field: `affiliates.${affiliateId}.status`,
            from: null,
            to: campaignStatus,
          },
        ],
        actor,
        changed_at: now,
      });

      const leadsBase = await this.resolveLeadsBaseUrl();
      return {
        result: true,
        data: {
          campaign: this.enrichCampaignForResponse(campaign),
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
      campaign.status = status;
      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });

      return { result: true, data: this.enrichCampaignForResponse(campaign) };
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
          (f) => !["enabled", "stage", "gate", "vendor"].includes(f),
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

      // Deep structural equality — order-independent, handles nested objects and
      // arrays. JSON.stringify is order-sensitive and would produce false positives
      // when the same object is reconstructed with different key insertion order.
      const deepEqual = (a: unknown, b: unknown): boolean => {
        if (a === b) return true;
        if (a === null || b === null) return a === b;
        if (typeof a !== "object" || typeof b !== "object") return a === b;
        if (Array.isArray(a) !== Array.isArray(b)) return false;
        if (Array.isArray(a)) {
          const arrA = a as unknown[];
          const arrB = b as unknown[];
          if (arrA.length !== arrB.length) return false;
          return arrA.every((v, i) => deepEqual(v, arrB[i]));
        }
        const objA = a as Record<string, unknown>;
        const objB = b as Record<string, unknown>;
        const keysA = Object.keys(objA);
        const keysB = Object.keys(objB);
        if (keysA.length !== keysB.length) return false;
        return keysA.every(
          (key) =>
            Object.prototype.hasOwnProperty.call(objB, key) &&
            deepEqual(objA[key], objB[key]),
        );
      };

      const diffFields = <T extends object>(
        prefix: string,
        before: T,
        after: T,
        keys: (keyof T)[],
      ) => {
        for (const key of keys) {
          if (!deepEqual(before[key], after[key])) {
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
        ["enabled", "stage", "gate", "vendor"],
      );
      diffFields("ipqs", currentPlugins.ipqs, nextPlugins.ipqs, [
        "enabled",
        "stage",
        "gate",
      ]);

      // Diff nested IPQS sub-checks (phone / email / ip)
      for (const sub of ["phone", "email", "ip"] as const) {
        const before = currentPlugins.ipqs[sub] as unknown as Record<
          string,
          unknown
        >;
        const after = nextPlugins.ipqs[sub] as unknown as Record<
          string,
          unknown
        >;
        if (!before || !after) continue;

        // Top-level enabled toggle for the sub-check
        if (before.enabled !== after.enabled) {
          pluginHistoryEntries.push({
            field: `ipqs.${sub}.enabled`,
            previous_value: before.enabled,
            new_value: after.enabled,
            changed_at: now,
            changed_by: actor,
          });
        }

        // Criteria sub-fields (one level deep — e.g. fraud_score, country, valid, proxy, vpn)
        const beforeCriteria = (before.criteria ?? {}) as Record<
          string,
          unknown
        >;
        const afterCriteria = (after.criteria ?? {}) as Record<string, unknown>;
        for (const criteriaKey of new Set([
          ...Object.keys(beforeCriteria),
          ...Object.keys(afterCriteria),
        ])) {
          if (
            !deepEqual(
              beforeCriteria[criteriaKey] ?? null,
              afterCriteria[criteriaKey] ?? null,
            )
          ) {
            pluginHistoryEntries.push({
              field: `ipqs.${sub}.criteria.${criteriaKey}`,
              previous_value: beforeCriteria[criteriaKey] ?? null,
              new_value: afterCriteria[criteriaKey] ?? null,
              changed_at: now,
              changed_by: actor,
            });
          }
        }
      }

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });

      if (pluginHistoryEntries.length > 0) {
        await this.auditWriterService.writeAuditEvent({
          entity_id: campaignId,
          entity_type: "campaign",
          action: "plugins_updated",
          changes: pluginHistoryEntries.map((e) => ({
            field: e.field,
            from: e.previous_value,
            to: e.new_value,
          })),
          actor,
          changed_at: now,
        });
      }

      this.logger.info("Campaign plugins updated", {
        campaignId,
        plugins: nextPlugins,
      });

      return { result: true, data: this.enrichCampaignForResponse(campaign) };
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

      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });

      await this.auditWriterService.writeAuditEvent({
        entity_id: campaignId,
        entity_type: "campaign",
        action: "affiliate_key_rotated",
        changes: [
          {
            field: `affiliates.${affiliateId}.campaign_key`,
            from: oldKey,
            to: campaign_key,
          },
        ],
        actor,
        changed_at: now,
      });

      this.logger.info("Affiliate campaign_key rotated", {
        campaignId,
        affiliateId,
      });

      const leadsBase = await this.resolveLeadsBaseUrl();
      return {
        result: true,
        data: {
          campaign: this.enrichCampaignForResponse(campaign),
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
      {
        action: "affiliate_status_updated",
        changes: (before) => [
          {
            field: `affiliates.${affiliateId}.status`,
            from: before.status ?? null,
            to: request.status,
          },
        ],
      },
    );
    if (!result.result) return { result: false, error: result.error };
    const leadsBase = await this.resolveLeadsBaseUrl();
    return {
      result: true,
      data: {
        campaign: this.enrichCampaignForResponse(result.data!),
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
      {
        action: "affiliate_deleted",
        changes: (before) => [
          {
            field: `affiliates.${affiliateId}.status`,
            from: before.status ?? null,
            to: null,
          },
          {
            field: `affiliates.${affiliateId}.affiliate_id`,
            from: before.affiliate_id,
            to: null,
          },
        ],
      },
    );
  }

  async updateClientStatus(
    campaignId: string,
    clientId: string,
    request: UpdateParticipantStatusRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<ICampaign>> {
    // Guard: a client may only be set to LIVE if delivery config is complete
    if (request.status === CampaignParticipantStatus.LIVE) {
      // We need to peek at the client's current delivery_config before mutating.
      // Load campaign first, then validate, then delegate to mutateClient.
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign) {
        return { result: false, error: `Campaign ${campaignId} not found` };
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
      const dc = client.delivery_config;
      if (
        !dc ||
        !dc.url?.trim() ||
        !dc.method ||
        !dc.payload_mapping?.length ||
        !dc.acceptance_rules?.length
      ) {
        return {
          result: false,
          error:
            "Client cannot be set to LIVE without a complete delivery configuration. " +
            "Configure a webhook URL, HTTP method, at least one payload mapping, " +
            "and at least one acceptance rule " +
            "via PUT /campaigns/{id}/clients/{clientId}/delivery first.",
        };
      }
    }

    return this.mutateClient(
      campaignId,
      clientId,
      (c) => {
        c.status = request.status;
      },
      actor,
      { recordRemoval: false },
      {
        action: "client_status_updated",
        changes: (before) => [
          {
            field: `clients.${clientId}.status`,
            from: before.status ?? null,
            to: request.status,
          },
        ],
      },
    );
  }

  async setClientDelivery(
    campaignId: string,
    clientId: string,
    request: SetClientDeliveryRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<ICampaign>> {
    // Validate
    if (!request.url?.trim()) {
      return { result: false, error: "delivery_config.url is required" };
    }
    try {
      new URL(request.url);
    } catch {
      return {
        result: false,
        error: "delivery_config.url must be a valid URL",
      };
    }
    const allowedMethods = ["POST", "GET", "PUT", "PATCH"] as const;
    if (!allowedMethods.includes(request.method as any)) {
      return {
        result: false,
        error: `delivery_config.method must be one of: ${allowedMethods.join(", ")}`,
      };
    }
    if (
      !Array.isArray(request.payload_mapping) ||
      request.payload_mapping.length === 0
    ) {
      return {
        result: false,
        error: "delivery_config.payload_mapping must have at least one entry",
      };
    }
    for (const mapping of request.payload_mapping) {
      if (!mapping.key?.trim()) {
        return {
          result: false,
          error: "Each payload_mapping entry must have a non-empty key",
        };
      }
      if (
        mapping.parameter_target !== undefined &&
        mapping.parameter_target !== "query" &&
        mapping.parameter_target !== "body"
      ) {
        return {
          result: false,
          error: `payload_mapping key "${mapping.key}": parameter_target must be "query" or "body"`,
        };
      }
      if (mapping.value_source === "field" && !mapping.field_name?.trim()) {
        return {
          result: false,
          error: `payload_mapping key "${mapping.key}": field_name is required when value_source is "field"`,
        };
      }
      if (
        mapping.value_source === "static" &&
        mapping.static_value === undefined
      ) {
        return {
          result: false,
          error: `payload_mapping key "${mapping.key}": static_value is required when value_source is "static"`,
        };
      }
    }
    if (
      !Array.isArray(request.acceptance_rules) ||
      request.acceptance_rules.length === 0
    ) {
      return {
        result: false,
        error: "delivery_config.acceptance_rules must have at least one entry",
      };
    }
    for (const rule of request.acceptance_rules) {
      if (!rule.match_value?.trim()) {
        return {
          result: false,
          error: "Each acceptance_rule must have a non-empty match_value",
        };
      }
      if (rule.action !== "passed" && rule.action !== "failed") {
        return {
          result: false,
          error: `acceptance_rule match_value "${rule.match_value}": action must be "passed" or "failed"`,
        };
      }
    }

    if (
      request.require_successful_claim !== undefined &&
      typeof request.require_successful_claim !== "boolean"
    ) {
      return {
        result: false,
        error: "delivery_config.require_successful_claim must be a boolean",
      };
    }

    if (
      request.weight !== undefined &&
      (typeof request.weight !== "number" ||
        !Number.isInteger(request.weight) ||
        request.weight < 1)
    ) {
      return {
        result: false,
        error: "weight must be a positive integer",
      };
    }

    const deliveryConfig: IClientDeliveryConfig = {
      url: request.url.trim(),
      method: request.method,
      ...(request.headers && Object.keys(request.headers).length > 0
        ? { headers: request.headers }
        : {}),
      payload_mapping: request.payload_mapping,
      acceptance_rules: request.acceptance_rules,
      claim_trusted_form: true,
      ...(request.require_successful_claim !== undefined
        ? { require_successful_claim: request.require_successful_claim }
        : {}),
    };

    try {
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted) {
        return { result: false, error: `Campaign ${campaignId} not found` };
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

      const prev = client.delivery_config ?? null;
      const prevWeight = client.weight;
      client.delivery_config = deliveryConfig;
      if (request.weight !== undefined) {
        client.weight = request.weight;
      }

      const now = new Date().toISOString();
      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });

      await this.auditWriterService.writeAuditEvent({
        entity_id: campaignId,
        entity_type: "campaign",
        action: "delivery_config_updated",
        changes: [
          {
            field: `clients.${clientId}.delivery_config`,
            from: prev,
            to: deliveryConfig,
          },
          ...(request.weight !== undefined
            ? [
                {
                  field: `clients.${clientId}.weight`,
                  from: prevWeight ?? null,
                  to: request.weight,
                },
              ]
            : []),
        ],
        actor,
        changed_at: now,
      });

      return { result: true, data: this.enrichCampaignForResponse(campaign) };
    } catch (error: any) {
      this.logger.error("Failed to set client delivery config", error);
      return {
        result: false,
        error: error.message || "Failed to set client delivery config",
      };
    }
  }

  async setDistribution(
    campaignId: string,
    request: SetDistributionRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<ICampaign>> {
    const allowedModes = ["round_robin", "weighted"] as const;
    if (!allowedModes.includes(request.mode as any)) {
      return {
        result: false,
        error: `distribution.mode must be one of: ${allowedModes.join(", ")}`,
      };
    }
    if (typeof request.enabled !== "boolean") {
      return { result: false, error: "distribution.enabled must be a boolean" };
    }

    try {
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted) {
        return { result: false, error: `Campaign ${campaignId} not found` };
      }

      const prev = campaign.distribution ?? null;
      const next: ILeadDistributionConfig = {
        mode: request.mode,
        enabled: request.enabled,
      };

      campaign.distribution = next;
      const now = new Date().toISOString();
      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });

      await this.auditWriterService.writeAuditEvent({
        entity_id: campaignId,
        entity_type: "campaign",
        action: "distribution_updated",
        changes: [{ field: "distribution", from: prev, to: next }],
        actor,
        changed_at: now,
      });

      return { result: true, data: this.enrichCampaignForResponse(campaign) };
    } catch (error: any) {
      this.logger.error("Failed to set campaign distribution", error);
      return {
        result: false,
        error: error.message || "Failed to set distribution",
      };
    }
  }

  async setCampaignTags(
    campaignId: string,
    request: SetCampaignTagsRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<ICampaign>> {
    try {
      if (!request || !Array.isArray(request.tags)) {
        return { result: false, error: "tags must be an array of strings" };
      }

      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted) {
        return { result: false, error: `Campaign ${campaignId} not found` };
      }

      const tags = [
        ...new Set(
          request.tags
            .map((t) => (typeof t === "string" ? t.trim() : ""))
            .filter(Boolean),
        ),
      ];

      const validationError = await this.validateCampaignTags(tags);
      if (validationError) {
        return { result: false, error: validationError };
      }

      const prev = campaign.tags ?? null;
      campaign.tags = tags;
      const now = new Date().toISOString();
      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });

      await this.auditWriterService.writeAuditEvent({
        entity_id: campaignId,
        entity_type: "campaign",
        action: "campaign_tags_updated",
        changes: [{ field: "tags", from: prev, to: tags }],
        actor,
        changed_at: now,
      });

      // Propagate tags to linked catalog sets (union merge)
      await this.propagateTagsToCatalogs(campaign, tags);

      return { result: true, data: this.enrichCampaignForResponse(campaign) };
    } catch (error: any) {
      this.logger.error("Failed to set campaign tags", error);
      return {
        result: false,
        error: error.message || "Failed to set campaign tags",
      };
    }
  }

  private async propagateTagsToCatalogs(
    campaign: ICampaign,
    tags: string[],
  ): Promise<void> {
    if (tags.length === 0) return;

    const catalogIds: { id: string; table: string }[] = [];
    if (campaign.criteria_set_id) {
      catalogIds.push({
        id: campaign.criteria_set_id,
        table: this.constants.CRITERIA_CATALOG_TABLE_NAME,
      });
    }
    if (campaign.logic_set_id) {
      catalogIds.push({
        id: campaign.logic_set_id,
        table: this.constants.CRITERIA_CATALOG_TABLE_NAME,
      });
    }

    for (const { id, table } of catalogIds) {
      try {
        const set = await this.dynamoDBUtil.get<
          ICriteriaCatalogSet | ILogicCatalogSet
        >({
          TableName: table,
          Key: { id },
        });
        if (!set) continue;

        const merged = [...new Set([...(set.tags ?? []), ...tags])];
        set.tags = merged;
        set.updated_at = new Date().toISOString();

        await this.dynamoDBUtil.put({ TableName: table, Item: set });
      } catch (err: any) {
        this.logger.warn(`Failed to propagate tags to catalog ${id}`, err);
      }
    }
  }

  async setAffiliateValidationBypass(
    campaignId: string,
    affiliateId: string,
    request: SetAffiliateValidationBypassRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<ICampaign>> {
    try {
      const bypass = request?.validation_bypass;
      if (!bypass || typeof bypass !== "object" || Array.isArray(bypass)) {
        return {
          result: false,
          error: "validation_bypass must be an object",
        };
      }

      const keys: Array<keyof ICampaignValidationBypassConfig> = [
        "trusted_form_claim",
        "duplicate_check",
        "ipqs_phone",
        "ipqs_email",
        "ipqs_ip",
        "all",
      ];

      const normalizedBypass: ICampaignValidationBypassConfig = {};
      for (const key of keys) {
        const value = bypass[key];
        if (value === undefined) continue;
        if (typeof value !== "boolean") {
          return {
            result: false,
            error: `validation_bypass.${key} must be a boolean`,
          };
        }
        normalizedBypass[key] = value;
      }

      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted) {
        return { result: false, error: `Campaign ${campaignId} not found` };
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

      const prev = affiliate.validation_bypass ?? null;
      const hasValues = Object.keys(normalizedBypass).length > 0;
      if (hasValues) {
        affiliate.validation_bypass = normalizedBypass;
      } else {
        delete affiliate.validation_bypass;
      }

      const now = new Date().toISOString();
      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });

      await this.auditWriterService.writeAuditEvent({
        entity_id: campaignId,
        entity_type: "campaign",
        action: "affiliate_validation_bypass_updated",
        changes: [
          {
            field: `affiliates.${affiliateId}.validation_bypass`,
            from: prev,
            to: hasValues ? normalizedBypass : null,
          },
        ],
        actor,
        changed_at: now,
      });

      return { result: true, data: this.enrichCampaignForResponse(campaign) };
    } catch (error: any) {
      this.logger.error("Failed to set affiliate validation bypass", error);
      return {
        result: false,
        error: error.message || "Failed to set affiliate validation bypass",
      };
    }
  }

  async setAffiliateCap(
    campaignId: string,
    affiliateId: string,
    request: SetAffiliateCapRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<ICampaign>> {
    if (
      request.lead_cap !== null &&
      (typeof request.lead_cap !== "number" ||
        !Number.isInteger(request.lead_cap) ||
        request.lead_cap < 1)
    ) {
      return {
        result: false,
        error: "lead_cap must be a positive integer, or null to remove the cap",
      };
    }

    try {
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted) {
        return { result: false, error: `Campaign ${campaignId} not found` };
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

      const prev = affiliate.lead_cap ?? null;

      if (request.lead_cap === null) {
        delete affiliate.lead_cap;
      } else {
        affiliate.lead_cap = request.lead_cap;
      }

      const now = new Date().toISOString();
      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });

      await this.auditWriterService.writeAuditEvent({
        entity_id: campaignId,
        entity_type: "campaign",
        action: "lead_cap_updated",
        changes: [
          {
            field: `affiliates.${affiliateId}.lead_cap`,
            from: prev,
            to: request.lead_cap ?? null,
          },
        ],
        actor,
        changed_at: now,
      });

      return { result: true, data: this.enrichCampaignForResponse(campaign) };
    } catch (error: any) {
      this.logger.error("Failed to set affiliate lead cap", error);
      return {
        result: false,
        error: error.message || "Failed to set affiliate lead cap",
      };
    }
  }

  async setAffiliateSoldPixel(
    campaignId: string,
    affiliateId: string,
    request: SetAffiliateSoldPixelRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<ICampaign>> {
    if (typeof request.enabled !== "boolean") {
      return {
        result: false,
        error: "sold_pixel_config.enabled must be a boolean",
      };
    }

    if (!request.url?.trim()) {
      return { result: false, error: "sold_pixel_config.url is required" };
    }
    try {
      new URL(request.url);
    } catch {
      return {
        result: false,
        error: "sold_pixel_config.url must be a valid URL",
      };
    }

    const allowedMethods = ["POST", "GET", "PUT", "PATCH"] as const;
    if (!allowedMethods.includes(request.method as any)) {
      return {
        result: false,
        error: `sold_pixel_config.method must be one of: ${allowedMethods.join(", ")}`,
      };
    }

    const allowedParameterModes = ["query", "body"] as const;
    const normalizedParameterModeRaw =
      typeof request.parameter_mode === "string"
        ? request.parameter_mode.trim().toLowerCase()
        : undefined;
    const normalizedParameterMode =
      normalizedParameterModeRaw === "query" ||
      normalizedParameterModeRaw === "body"
        ? normalizedParameterModeRaw
        : undefined;
    if (
      normalizedParameterModeRaw !== undefined &&
      !allowedParameterModes.includes(normalizedParameterModeRaw as any)
    ) {
      return {
        result: false,
        error: `sold_pixel_config.parameter_mode must be one of: ${allowedParameterModes.join(", ")}`,
      };
    }

    if (
      !Array.isArray(request.payload_mapping) ||
      request.payload_mapping.length === 0
    ) {
      return {
        result: false,
        error: "sold_pixel_config.payload_mapping must have at least one entry",
      };
    }

    for (const mapping of request.payload_mapping) {
      const normalizedParameterTargetRaw =
        typeof mapping.parameter_target === "string"
          ? mapping.parameter_target.trim().toLowerCase()
          : undefined;
      const normalizedParameterTarget =
        normalizedParameterTargetRaw === "query" ||
        normalizedParameterTargetRaw === "body"
          ? normalizedParameterTargetRaw
          : undefined;
      if (!mapping.key?.trim()) {
        return {
          result: false,
          error:
            "Each sold_pixel_config.payload_mapping entry must have a non-empty key",
        };
      }
      if (
        normalizedParameterTarget === undefined &&
        normalizedParameterMode === undefined
      ) {
        return {
          result: false,
          error: `sold_pixel_config.payload_mapping key "${mapping.key}": parameter_target is required`,
        };
      }
      if (
        normalizedParameterTargetRaw !== undefined &&
        !allowedParameterModes.includes(normalizedParameterTargetRaw as any)
      ) {
        return {
          result: false,
          error: `sold_pixel_config.payload_mapping key "${mapping.key}": parameter_target must be one of: ${allowedParameterModes.join(", ")}`,
        };
      }
      if (mapping.value_source === "field" && !mapping.field_name?.trim()) {
        return {
          result: false,
          error: `sold_pixel_config.payload_mapping key "${mapping.key}": field_name is required when value_source is \"field\"`,
        };
      }
      if (
        mapping.value_source === "static" &&
        mapping.static_value === undefined
      ) {
        return {
          result: false,
          error: `sold_pixel_config.payload_mapping key "${mapping.key}": static_value is required when value_source is \"static\"`,
        };
      }
    }

    try {
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted) {
        return { result: false, error: `Campaign ${campaignId} not found` };
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

      const soldPixelConfig = {
        enabled: request.enabled,
        url: request.url.trim(),
        method: request.method,
        ...(request.headers && Object.keys(request.headers).length > 0
          ? { headers: request.headers }
          : {}),
        payload_mapping: request.payload_mapping.map((mapping) => {
          const normalizedTargetRaw =
            typeof mapping.parameter_target === "string"
              ? mapping.parameter_target.trim().toLowerCase()
              : undefined;
          const normalizedTarget =
            normalizedTargetRaw === "query" || normalizedTargetRaw === "body"
              ? normalizedTargetRaw
              : undefined;
          const fallbackTarget =
            normalizedParameterMode ??
            (request.method === "GET" ? "query" : undefined);
          const targetToPersist = normalizedTarget ?? fallbackTarget;
          if (mapping.value_source === "field") {
            return {
              key: mapping.key,
              value_source: "field" as const,
              field_name: mapping.field_name,
              ...(targetToPersist
                ? {
                    parameter_target: targetToPersist as "query" | "body",
                  }
                : {}),
            };
          }

          return {
            key: mapping.key,
            value_source: "static" as const,
            static_value: mapping.static_value,
            ...(targetToPersist
              ? {
                  parameter_target: targetToPersist as "query" | "body",
                }
              : {}),
          };
        }),
      };

      const previousConfig = affiliate.sold_pixel_config ?? null;
      affiliate.sold_pixel_config = soldPixelConfig;

      const now = new Date().toISOString();
      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });

      await this.auditWriterService.writeAuditEvent({
        entity_id: campaignId,
        entity_type: "campaign",
        action: "affiliate_pixel_updated",
        changes: [
          {
            field: `affiliates.${affiliateId}.sold_pixel_config`,
            from: previousConfig,
            to: soldPixelConfig,
          },
        ],
        actor,
        changed_at: now,
      });

      return { result: true, data: this.enrichCampaignForResponse(campaign) };
    } catch (error: any) {
      this.logger.error("Failed to set affiliate sold pixel config", error);
      return {
        result: false,
        error: error.message || "Failed to set affiliate sold pixel config",
      };
    }
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
      {
        action: "client_deleted",
        changes: (before) => [
          {
            field: `clients.${clientId}.status`,
            from: before.status ?? null,
            to: null,
          },
          {
            field: `clients.${clientId}.client_id`,
            from: before.client_id,
            to: null,
          },
        ],
      },
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
    audit?: {
      action: AuditAction;
      changes: (before: ICampaignAffiliate) => AuditChange[];
    },
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
      const auditChanges = audit ? audit.changes({ ...affiliate }) : [];

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

      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });

      if (audit) {
        await this.auditWriterService.writeAuditEvent({
          entity_id: campaignId,
          entity_type: "campaign",
          action: audit.action,
          changes: auditChanges,
          actor,
          changed_at: now,
        });
      }

      this.logger.info("Campaign affiliate mutated", {
        campaignId,
        affiliateId,
        status: affiliate.status,
        addedAt: affiliate.added_at,
      });

      return { result: true, data: this.enrichCampaignForResponse(campaign) };
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
    audit?: {
      action: AuditAction;
      changes: (before: ICampaignClient) => AuditChange[];
    },
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
      const auditChanges = audit ? audit.changes({ ...client }) : [];

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

      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });

      if (audit) {
        await this.auditWriterService.writeAuditEvent({
          entity_id: campaignId,
          entity_type: "campaign",
          action: audit.action,
          changes: auditChanges,
          actor,
          changed_at: now,
        });
      }

      this.logger.info("Campaign client mutated", {
        campaignId,
        clientId,
        status: client.status,
        addedAt: client.added_at,
      });

      return { result: true, data: this.enrichCampaignForResponse(campaign) };
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
      const leadsBase = await this.resolveLeadsBaseUrl();
      return {
        result: true,
        data: {
          campaign: this.enrichCampaignForResponse(campaign),
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
        const deletedAt = new Date().toISOString();
        await this.auditWriterService.writeAuditEvent({
          entity_id: id,
          entity_type: "campaign",
          action: "deleted",
          changes: [],
          actor,
          changed_at: deletedAt,
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
        await this.auditWriterService.writeAuditEvent({
          entity_id: id,
          entity_type: "campaign",
          action: "soft_deleted",
          changes: [],
          actor,
          changed_at: now,
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

  async getCriteriaField(
    campaignId: string,
    fieldId: string,
  ): Promise<ServiceResult<IBaseCriteriaField>> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted) {
        return { result: false, error: `Campaign ${campaignId} not found` };
      }
      const field = (campaign.base_criteria ?? []).find(
        (f) => f.id === fieldId,
      );
      if (!field) {
        return { result: false, error: `Criteria field ${fieldId} not found` };
      }
      return { result: true, data: field };
    } catch (error: any) {
      this.logger.error("Failed to get criteria field", error);
      return {
        result: false,
        error: error.message || "Failed to get criteria field",
      };
    }
  }

  /**
   * Seeds a campaign's base_criteria with the entries in BASE_CRITERIA_FIELDS.
   * Fields that already exist (matched by field_name) are skipped — safe to call multiple times.
   * Returns the full updated criteria list.
   */
  async addBaseFields(
    campaignId: string,
    actor?: RequestActor,
  ): Promise<ServiceResult<IBaseCriteriaField[]>> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted) {
        return { result: false, error: `Campaign ${campaignId} not found` };
      }

      const existing = campaign.base_criteria ?? [];
      const existingNames = new Set(existing.map((f) => f.field_name));
      const toAdd: IBaseCriteriaFieldDef[] = BASE_CRITERIA_FIELDS.filter(
        (f) => !existingNames.has(f.field_name),
      );

      if (toAdd.length === 0) {
        return { result: true, data: existing };
      }

      const now = new Date().toISOString();
      let nextOrder = existing.length + 1;
      const newFields: IBaseCriteriaField[] = toAdd.map((def) => ({
        id: IdGenerator.generate("CF"),
        order: nextOrder++,
        field_label: def.field_label,
        field_name: def.field_name,
        data_type: def.data_type,
        required: def.required,
        client_override: false,
        affiliate_override: false,
        created_at: now,
        updated_at: now,
        created_by: actor,
        updated_by: actor,
      }));

      const updatedCriteria = [...existing, ...newFields];

      campaign.base_criteria = updatedCriteria;
      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });
      await this.auditWriterService.writeAuditEvent({
        entity_id: campaignId,
        entity_type: "campaign",
        action: "criteria_field_added",
        changes: newFields.map((f) => ({
          field: f.field_name,
          from: null,
          to: f.field_label,
        })),
        actor,
        changed_at: now,
      });

      this.logger.info("Base criteria fields added", {
        campaignId,
        addedCount: newFields.length,
        skippedCount: toAdd.length === 0 ? existing.length : 0,
      });

      return { result: true, data: updatedCriteria };
    } catch (error: any) {
      this.logger.error("Failed to add base criteria fields", error);
      return {
        result: false,
        error: error.message || "Failed to add base criteria fields",
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

      campaign.base_criteria = updatedCriteria;
      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });
      await this.auditWriterService.writeAuditEvent({
        entity_id: campaignId,
        entity_type: "campaign",
        action: "criteria_field_added",
        changes: [
          { field: "field_id", from: null, to: newField.id },
          { field: "field_name", from: null, to: newField.field_name },
          { field: "field_label", from: null, to: newField.field_label },
          { field: "data_type", from: null, to: newField.data_type },
        ],
        actor,
        changed_at: now,
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

      campaign.base_criteria = updatedCriteria;
      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });
      await this.auditWriterService.writeAuditEvent({
        entity_id: campaignId,
        entity_type: "campaign",
        action: "criteria_field_updated",
        changes: changes.map((c) => ({
          field: `${fieldId}.${c.field}`,
          from: c.previous_value,
          to: c.new_value,
        })),
        actor,
        changed_at: now,
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

      campaign.base_criteria = updatedCriteria;
      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });
      await this.auditWriterService.writeAuditEvent({
        entity_id: campaignId,
        entity_type: "campaign",
        action: "criteria_field_deleted",
        changes: [
          { field: "field_id", from: removed.id, to: null },
          { field: "field_name", from: removed.field_name, to: null },
          { field: "field_label", from: removed.field_label, to: null },
        ],
        actor,
        changed_at: now,
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

      campaign.base_criteria = updatedCriteria;
      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });
      await this.auditWriterService.writeAuditEvent({
        entity_id: campaignId,
        entity_type: "campaign",
        action: "criteria_fields_reordered",
        changes: [
          {
            field: "order",
            from: existing.map((f) => f.id),
            to: providedIds,
          },
        ],
        actor,
        changed_at: now,
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
  ): Promise<ServiceResult<AuditLogItem[]>> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted) {
        return { result: false, error: `Campaign ${campaignId} not found` };
      }
      const items = await this.dynamoDBUtil.queryAll<AuditLogItem>({
        TableName: this.constants.AUDIT_LOGS_TABLE_NAME,
        KeyConditionExpression: "entity_id = :eid",
        FilterExpression: "action IN (:a1, :a2, :a3, :a4, :a5)",
        ExpressionAttributeValues: {
          ":eid": campaignId,
          ":a1": "criteria_field_added",
          ":a2": "criteria_field_updated",
          ":a3": "criteria_field_deleted",
          ":a4": "criteria_fields_reordered",
          ":a5": "mappings_updated",
        },
      });
      items.sort((a, b) => a.changed_at.localeCompare(b.changed_at));
      return { result: true, data: items };
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

      campaign.base_criteria = updatedCriteria;
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

  // ── Logic Rules ─────────────────────────────────────────────────────────

  async listLogicRules(
    campaignId: string,
  ): Promise<ServiceResult<ILogicRule[]>> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted) {
        return { result: false, error: `Campaign ${campaignId} not found` };
      }
      return { result: true, data: campaign.logic_rules ?? [] };
    } catch (error: any) {
      this.logger.error("Failed to list logic rules", error);
      return {
        result: false,
        error: error.message || "Failed to list logic rules",
      };
    }
  }

  async getLogicRule(
    campaignId: string,
    ruleId: string,
  ): Promise<ServiceResult<ILogicRule>> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted) {
        return { result: false, error: `Campaign ${campaignId} not found` };
      }
      const rule = (campaign.logic_rules ?? []).find((r) => r.id === ruleId);
      if (!rule) {
        return { result: false, error: `Logic rule ${ruleId} not found` };
      }
      return { result: true, data: rule };
    } catch (error: any) {
      this.logger.error("Failed to get logic rule", error);
      return {
        result: false,
        error: error.message || "Failed to get logic rule",
      };
    }
  }

  async createLogicRule(
    campaignId: string,
    request: CreateLogicRuleRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<ILogicRule>> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted) {
        return { result: false, error: `Campaign ${campaignId} not found` };
      }

      const validationError = this.validateLogicRuleRequest(request);
      if (validationError) return { result: false, error: validationError };

      const now = new Date().toISOString();
      const rule: ILogicRule = {
        id: IdGenerator.generate("LR"),
        name: request.name.trim(),
        action: request.action,
        enabled: request.enabled ?? true,
        groups: request.groups.map((g) => ({
          id: IdGenerator.generate("LG"),
          conditions: g.conditions.map((c) => ({
            id: IdGenerator.generate("LC"),
            field_name: c.field_name,
            operator: c.operator,
            ...(c.value !== undefined ? { value: c.value } : {}),
          })),
        })),
        created_at: now,
        updated_at: now,
        created_by: actor,
        updated_by: actor,
      };

      campaign.logic_rules = [...(campaign.logic_rules ?? []), rule];
      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });
      await this.auditWriterService.writeAuditEvent({
        entity_id: campaignId,
        entity_type: "campaign",
        action: "logic_rule_added",
        changes: [
          { field: "rule_id", from: null, to: rule.id },
          { field: "name", from: null, to: rule.name },
          { field: "action", from: null, to: rule.action },
        ],
        actor,
        changed_at: now,
      });

      this.logger.info("Logic rule created", { campaignId, ruleId: rule.id });
      return { result: true, data: rule };
    } catch (error: any) {
      this.logger.error("Failed to create logic rule", error);
      return {
        result: false,
        error: error.message || "Failed to create logic rule",
      };
    }
  }

  async updateLogicRule(
    campaignId: string,
    ruleId: string,
    request: UpdateLogicRuleRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<ILogicRule>> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted) {
        return { result: false, error: `Campaign ${campaignId} not found` };
      }

      const ruleIndex = (campaign.logic_rules ?? []).findIndex(
        (r) => r.id === ruleId,
      );
      if (ruleIndex === -1) {
        return { result: false, error: `Logic rule ${ruleId} not found` };
      }

      if (request.groups !== undefined) {
        const validationError = this.validateLogicRuleRequest({
          name: request.name ?? "x",
          action: request.action ?? "fail",
          groups: request.groups,
        });
        if (validationError) return { result: false, error: validationError };
      }

      const existing = campaign.logic_rules![ruleIndex];
      const now = new Date().toISOString();

      const updated: ILogicRule = {
        ...existing,
        name: request.name !== undefined ? request.name.trim() : existing.name,
        action: request.action !== undefined ? request.action : existing.action,
        enabled:
          request.enabled !== undefined ? request.enabled : existing.enabled,
        groups:
          request.groups !== undefined
            ? request.groups.map((g) => ({
                id: g.id ?? IdGenerator.generate("LG"),
                conditions: g.conditions.map((c) => ({
                  id: c.id ?? IdGenerator.generate("LC"),
                  field_name: c.field_name,
                  operator: c.operator,
                  ...(c.value !== undefined ? { value: c.value } : {}),
                })),
              }))
            : existing.groups,
        updated_at: now,
        updated_by: actor,
      };

      const updatedRules = [...campaign.logic_rules!];
      updatedRules[ruleIndex] = updated;
      campaign.logic_rules = updatedRules;
      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });
      const logicRuleChanges: Array<{
        field: string;
        from: unknown;
        to: unknown;
      }> = [];
      if (request.name !== undefined && request.name.trim() !== existing.name) {
        logicRuleChanges.push({
          field: "name",
          from: existing.name,
          to: request.name.trim(),
        });
      }
      if (request.action !== undefined && request.action !== existing.action) {
        logicRuleChanges.push({
          field: "action",
          from: existing.action,
          to: request.action,
        });
      }
      if (
        request.enabled !== undefined &&
        request.enabled !== existing.enabled
      ) {
        logicRuleChanges.push({
          field: "enabled",
          from: existing.enabled,
          to: request.enabled,
        });
      }
      if (request.groups !== undefined) {
        // Match conditions by content (field_name + operator + value) rather than by ID.
        // The frontend may not send condition IDs on update, which would cause all conditions
        // to receive new IDs — making ID-based diff falsely report every unchanged condition
        // as removed+added.
        const fmtCond = (c: ILogicRuleCondition) =>
          `${c.field_name} ${c.operator}${c.value !== undefined ? ` ${Array.isArray(c.value) ? c.value.join(", ") : c.value}` : ""}`;

        const condSig = (c: ILogicRuleCondition) =>
          JSON.stringify({
            f: c.field_name,
            o: c.operator,
            v: c.value ?? null,
          });

        // Multiset: count occurrences of each content signature before and after
        const beforeCounts = new Map<string, number>();
        const beforeCondBySig = new Map<string, ILogicRuleCondition>();
        for (const g of existing.groups) {
          for (const c of g.conditions) {
            const sig = condSig(c);
            beforeCounts.set(sig, (beforeCounts.get(sig) ?? 0) + 1);
            beforeCondBySig.set(sig, c);
          }
        }

        const afterCounts = new Map<string, number>();
        const afterCondBySig = new Map<string, ILogicRuleCondition>();
        for (const g of updated.groups) {
          for (const c of g.conditions) {
            const sig = condSig(c);
            afterCounts.set(sig, (afterCounts.get(sig) ?? 0) + 1);
            afterCondBySig.set(sig, c);
          }
        }

        const allSigs = new Set([
          ...beforeCounts.keys(),
          ...afterCounts.keys(),
        ]);
        for (const sig of allSigs) {
          const bc = beforeCounts.get(sig) ?? 0;
          const ac = afterCounts.get(sig) ?? 0;
          // Net removals
          for (let i = 0; i < bc - ac; i++) {
            logicRuleChanges.push({
              field: "condition.removed",
              from: fmtCond(beforeCondBySig.get(sig)!),
              to: null,
            });
          }
          // Net additions
          for (let i = 0; i < ac - bc; i++) {
            logicRuleChanges.push({
              field: "condition.added",
              from: null,
              to: fmtCond(afterCondBySig.get(sig)!),
            });
          }
        }

        // If the only thing that changed was grouping / ordering (same conditions, different
        // arrangement across groups), record a structure diff using human-readable strings
        const beforeGroups = existing.groups.map((g) =>
          g.conditions.map((c) => fmtCond(c)),
        );
        const afterGroups = updated.groups.map((g) =>
          g.conditions.map((c) => fmtCond(c)),
        );
        if (
          logicRuleChanges.filter((c) => c.field.startsWith("condition."))
            .length === 0 &&
          JSON.stringify(beforeGroups) !== JSON.stringify(afterGroups)
        ) {
          logicRuleChanges.push({
            field: "groups.structure",
            from: beforeGroups,
            to: afterGroups,
          });
        }
      }
      await this.auditWriterService.writeAuditEvent({
        entity_id: campaignId,
        entity_type: "campaign",
        action: "logic_rule_updated",
        changes: logicRuleChanges,
        actor,
        changed_at: now,
      });

      this.logger.info("Logic rule updated", { campaignId, ruleId });
      return { result: true, data: updated };
    } catch (error: any) {
      this.logger.error("Failed to update logic rule", error);
      return {
        result: false,
        error: error.message || "Failed to update logic rule",
      };
    }
  }

  async deleteLogicRule(
    campaignId: string,
    ruleId: string,
    actor?: RequestActor,
  ): Promise<ServiceResult<{ id: string }>> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted) {
        return { result: false, error: `Campaign ${campaignId} not found` };
      }

      const existing = campaign.logic_rules ?? [];
      const ruleToDelete = existing.find((r) => r.id === ruleId);
      if (!ruleToDelete) {
        return { result: false, error: `Logic rule ${ruleId} not found` };
      }

      const now = new Date().toISOString();
      campaign.logic_rules = existing.filter((r) => r.id !== ruleId);
      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });
      await this.auditWriterService.writeAuditEvent({
        entity_id: campaignId,
        entity_type: "campaign",
        action: "logic_rule_deleted",
        changes: [
          { field: "rule_id", from: ruleToDelete.id, to: null },
          { field: "name", from: ruleToDelete.name, to: null },
          { field: "action", from: ruleToDelete.action, to: null },
        ],
        actor,
        changed_at: now,
      });

      this.logger.info("Logic rule deleted", { campaignId, ruleId });
      return { result: true, data: { id: ruleId } };
    } catch (error: any) {
      this.logger.error("Failed to delete logic rule", error);
      return {
        result: false,
        error: error.message || "Failed to delete logic rule",
      };
    }
  }

  // ── Per-Affiliate Logic Rule Overrides ──────────────────────────────────────

  async listAffiliateLogicRules(
    campaignId: string,
    affiliateId: string,
  ): Promise<ServiceResult<ILogicRule[]>> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted)
        return { result: false, error: `Campaign ${campaignId} not found` };
      const affiliate = (campaign.affiliates ?? []).find(
        (a) => a.affiliate_id === affiliateId,
      );
      if (!affiliate)
        return {
          result: false,
          error: `Affiliate ${affiliateId} not found on this campaign`,
        };
      const overrides = (campaign.affiliate_overrides ?? {})[affiliateId] ?? {};
      return { result: true, data: overrides.logic_rules ?? [] };
    } catch (error: any) {
      this.logger.error("Failed to list affiliate logic rules", error);
      return {
        result: false,
        error: error.message || "Failed to list affiliate logic rules",
      };
    }
  }

  async createAffiliateLogicRule(
    campaignId: string,
    affiliateId: string,
    request: CreateLogicRuleRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<ILogicRule>> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted)
        return { result: false, error: `Campaign ${campaignId} not found` };
      const affiliate = (campaign.affiliates ?? []).find(
        (a) => a.affiliate_id === affiliateId,
      );
      if (!affiliate)
        return {
          result: false,
          error: `Affiliate ${affiliateId} not found on this campaign`,
        };

      const validationError = this.validateLogicRuleRequest(request);
      if (validationError) return { result: false, error: validationError };

      const now = new Date().toISOString();
      const rule: ILogicRule = {
        id: IdGenerator.generate("LR"),
        name: request.name.trim(),
        action: request.action,
        enabled: request.enabled ?? true,
        groups: request.groups.map((g) => ({
          id: IdGenerator.generate("LG"),
          conditions: g.conditions.map((c) => ({
            id: IdGenerator.generate("LC"),
            field_name: c.field_name,
            operator: c.operator,
            ...(c.value !== undefined ? { value: c.value } : {}),
          })),
        })),
        created_at: now,
        updated_at: now,
        created_by: actor,
        updated_by: actor,
      };

      const overrides = { ...(campaign.affiliate_overrides ?? {}) };
      const existing = overrides[affiliateId] ?? {};
      overrides[affiliateId] = {
        ...existing,
        logic_rules: [...(existing.logic_rules ?? []), rule],
      };
      campaign.affiliate_overrides = overrides;
      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });
      await this.auditWriterService.writeAuditEvent({
        entity_id: campaignId,
        entity_type: "campaign",
        action: "affiliate_logic_rule_added",
        changes: [
          { field: "affiliate_id", from: null, to: affiliateId },
          { field: "rule_id", from: null, to: rule.id },
          { field: "name", from: null, to: rule.name },
          { field: "action", from: null, to: rule.action },
        ],
        actor,
        changed_at: now,
      });

      return { result: true, data: rule };
    } catch (error: any) {
      this.logger.error("Failed to create affiliate logic rule", error);
      return {
        result: false,
        error: error.message || "Failed to create affiliate logic rule",
      };
    }
  }

  async updateAffiliateLogicRule(
    campaignId: string,
    affiliateId: string,
    ruleId: string,
    request: UpdateLogicRuleRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<ILogicRule>> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted)
        return { result: false, error: `Campaign ${campaignId} not found` };

      const overrides = { ...(campaign.affiliate_overrides ?? {}) };
      const existing = overrides[affiliateId] ?? {};
      const rules = existing.logic_rules ?? [];
      const ruleIndex = rules.findIndex((r) => r.id === ruleId);
      if (ruleIndex === -1)
        return {
          result: false,
          error: `Logic rule ${ruleId} not found for affiliate ${affiliateId}`,
        };

      if (request.groups !== undefined) {
        const validationError = this.validateLogicRuleRequest({
          name: request.name ?? "x",
          action: request.action ?? "fail",
          groups: request.groups,
        });
        if (validationError) return { result: false, error: validationError };
      }

      const now = new Date().toISOString();
      const existingRule = rules[ruleIndex];
      const updated: ILogicRule = {
        ...existingRule,
        name:
          request.name !== undefined ? request.name.trim() : existingRule.name,
        action:
          request.action !== undefined ? request.action : existingRule.action,
        enabled:
          request.enabled !== undefined
            ? request.enabled
            : existingRule.enabled,
        groups:
          request.groups !== undefined
            ? request.groups.map((g) => ({
                id: g.id ?? IdGenerator.generate("LG"),
                conditions: g.conditions.map((c) => ({
                  id: c.id ?? IdGenerator.generate("LC"),
                  field_name: c.field_name,
                  operator: c.operator,
                  ...(c.value !== undefined ? { value: c.value } : {}),
                })),
              }))
            : existingRule.groups,
        updated_at: now,
        updated_by: actor,
      };

      const updatedRules = [...rules];
      updatedRules[ruleIndex] = updated;
      overrides[affiliateId] = { ...existing, logic_rules: updatedRules };
      campaign.affiliate_overrides = overrides;
      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });
      await this.auditWriterService.writeAuditEvent({
        entity_id: campaignId,
        entity_type: "campaign",
        action: "affiliate_logic_rule_updated",
        changes: [
          { field: "affiliate_id", from: null, to: affiliateId },
          { field: "rule_id", from: ruleId, to: ruleId },
        ],
        actor,
        changed_at: now,
      });

      return { result: true, data: updated };
    } catch (error: any) {
      this.logger.error("Failed to update affiliate logic rule", error);
      return {
        result: false,
        error: error.message || "Failed to update affiliate logic rule",
      };
    }
  }

  async deleteAffiliateLogicRule(
    campaignId: string,
    affiliateId: string,
    ruleId: string,
    actor?: RequestActor,
  ): Promise<ServiceResult<{ id: string }>> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted)
        return { result: false, error: `Campaign ${campaignId} not found` };

      const overrides = { ...(campaign.affiliate_overrides ?? {}) };
      const existing = overrides[affiliateId] ?? {};
      const rules = existing.logic_rules ?? [];
      const ruleToDelete = rules.find((r) => r.id === ruleId);
      if (!ruleToDelete)
        return {
          result: false,
          error: `Logic rule ${ruleId} not found for affiliate ${affiliateId}`,
        };

      const now = new Date().toISOString();
      overrides[affiliateId] = {
        ...existing,
        logic_rules: rules.filter((r) => r.id !== ruleId),
      };
      campaign.affiliate_overrides = overrides;
      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });
      await this.auditWriterService.writeAuditEvent({
        entity_id: campaignId,
        entity_type: "campaign",
        action: "affiliate_logic_rule_deleted",
        changes: [
          { field: "affiliate_id", from: null, to: affiliateId },
          { field: "rule_id", from: ruleToDelete.id, to: null },
          { field: "name", from: ruleToDelete.name, to: null },
        ],
        actor,
        changed_at: now,
      });

      return { result: true, data: { id: ruleId } };
    } catch (error: any) {
      this.logger.error("Failed to delete affiliate logic rule", error);
      return {
        result: false,
        error: error.message || "Failed to delete affiliate logic rule",
      };
    }
  }

  // ── Per-Affiliate Pixel Criteria ──────────────────────────────────────────

  async listAffiliatePixelCriteria(
    campaignId: string,
    affiliateId: string,
  ): Promise<ServiceResult<ILogicRule[]>> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted)
        return { result: false, error: `Campaign ${campaignId} not found` };
      const affiliate = (campaign.affiliates ?? []).find(
        (a) => a.affiliate_id === affiliateId,
      );
      if (!affiliate)
        return {
          result: false,
          error: `Affiliate ${affiliateId} not found on this campaign`,
        };
      return { result: true, data: affiliate.pixel_criteria ?? [] };
    } catch (error: any) {
      this.logger.error("Failed to list affiliate pixel criteria", error);
      return {
        result: false,
        error: error.message || "Failed to list affiliate pixel criteria",
      };
    }
  }

  async createAffiliatePixelCriterion(
    campaignId: string,
    affiliateId: string,
    request: CreateLogicRuleRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<ILogicRule>> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted)
        return { result: false, error: `Campaign ${campaignId} not found` };
      const affiliate = (campaign.affiliates ?? []).find(
        (a) => a.affiliate_id === affiliateId,
      );
      if (!affiliate)
        return {
          result: false,
          error: `Affiliate ${affiliateId} not found on this campaign`,
        };

      const validationError = this.validateLogicRuleRequest(request);
      if (validationError) return { result: false, error: validationError };

      const now = new Date().toISOString();
      const rule: ILogicRule = {
        id: IdGenerator.generate("LR"),
        name: request.name.trim(),
        action: request.action,
        enabled: request.enabled ?? true,
        groups: request.groups.map((g) => ({
          id: IdGenerator.generate("LG"),
          conditions: g.conditions.map((c) => ({
            id: IdGenerator.generate("LC"),
            field_name: c.field_name,
            operator: c.operator,
            ...(c.value !== undefined ? { value: c.value } : {}),
          })),
        })),
        created_at: now,
        updated_at: now,
        created_by: actor,
        updated_by: actor,
      };

      affiliate.pixel_criteria = [...(affiliate.pixel_criteria ?? []), rule];
      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });
      await this.auditWriterService.writeAuditEvent({
        entity_id: campaignId,
        entity_type: "campaign",
        action: "affiliate_pixel_criterion_added",
        changes: [
          { field: "affiliate_id", from: null, to: affiliateId },
          { field: "rule_id", from: null, to: rule.id },
          { field: "name", from: null, to: rule.name },
        ],
        actor,
        changed_at: now,
      });

      return { result: true, data: rule };
    } catch (error: any) {
      this.logger.error("Failed to create affiliate pixel criterion", error);
      return {
        result: false,
        error: error.message || "Failed to create affiliate pixel criterion",
      };
    }
  }

  async updateAffiliatePixelCriterion(
    campaignId: string,
    affiliateId: string,
    ruleId: string,
    request: UpdateLogicRuleRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<ILogicRule>> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted)
        return { result: false, error: `Campaign ${campaignId} not found` };
      const affiliate = (campaign.affiliates ?? []).find(
        (a) => a.affiliate_id === affiliateId,
      );
      if (!affiliate)
        return {
          result: false,
          error: `Affiliate ${affiliateId} not found on this campaign`,
        };

      const rules = affiliate.pixel_criteria ?? [];
      const ruleIndex = rules.findIndex((r) => r.id === ruleId);
      if (ruleIndex === -1)
        return {
          result: false,
          error: `Pixel criterion ${ruleId} not found for affiliate ${affiliateId}`,
        };

      const now = new Date().toISOString();
      const existing = rules[ruleIndex];
      const updated: ILogicRule = {
        ...existing,
        ...(request.name !== undefined ? { name: request.name.trim() } : {}),
        ...(request.action !== undefined ? { action: request.action } : {}),
        ...(request.enabled !== undefined ? { enabled: request.enabled } : {}),
        ...(request.groups !== undefined
          ? {
              groups: request.groups.map((g) => ({
                id: g.id ?? IdGenerator.generate("LG"),
                conditions: g.conditions.map((c) => ({
                  id: c.id ?? IdGenerator.generate("LC"),
                  field_name: c.field_name,
                  operator: c.operator,
                  ...(c.value !== undefined ? { value: c.value } : {}),
                })),
              })),
            }
          : {}),
        updated_at: now,
        updated_by: actor,
      };
      rules[ruleIndex] = updated;
      affiliate.pixel_criteria = rules;
      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });
      await this.auditWriterService.writeAuditEvent({
        entity_id: campaignId,
        entity_type: "campaign",
        action: "affiliate_pixel_criterion_updated",
        changes: [
          { field: "affiliate_id", from: null, to: affiliateId },
          { field: "rule_id", from: null, to: ruleId },
        ],
        actor,
        changed_at: now,
      });

      return { result: true, data: updated };
    } catch (error: any) {
      this.logger.error("Failed to update affiliate pixel criterion", error);
      return {
        result: false,
        error: error.message || "Failed to update affiliate pixel criterion",
      };
    }
  }

  async deleteAffiliatePixelCriterion(
    campaignId: string,
    affiliateId: string,
    ruleId: string,
    actor?: RequestActor,
  ): Promise<ServiceResult<{ id: string }>> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted)
        return { result: false, error: `Campaign ${campaignId} not found` };
      const affiliate = (campaign.affiliates ?? []).find(
        (a) => a.affiliate_id === affiliateId,
      );
      if (!affiliate)
        return {
          result: false,
          error: `Affiliate ${affiliateId} not found on this campaign`,
        };

      const rules = affiliate.pixel_criteria ?? [];
      const ruleToDelete = rules.find((r) => r.id === ruleId);
      if (!ruleToDelete)
        return {
          result: false,
          error: `Pixel criterion ${ruleId} not found for affiliate ${affiliateId}`,
        };

      const now = new Date().toISOString();
      affiliate.pixel_criteria = rules.filter((r) => r.id !== ruleId);
      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });
      await this.auditWriterService.writeAuditEvent({
        entity_id: campaignId,
        entity_type: "campaign",
        action: "affiliate_pixel_criterion_deleted",
        changes: [
          { field: "affiliate_id", from: null, to: affiliateId },
          { field: "rule_id", from: ruleToDelete.id, to: null },
          { field: "name", from: ruleToDelete.name, to: null },
        ],
        actor,
        changed_at: now,
      });

      return { result: true, data: { id: ruleId } };
    } catch (error: any) {
      this.logger.error("Failed to delete affiliate pixel criterion", error);
      return {
        result: false,
        error: error.message || "Failed to delete affiliate pixel criterion",
      };
    }
  }

  // ── Per-Affiliate Sold Criteria ─────────────────────────────────────────

  async listAffiliateSoldCriteria(
    campaignId: string,
    affiliateId: string,
  ): Promise<ServiceResult<ILogicRule[]>> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted)
        return { result: false, error: `Campaign ${campaignId} not found` };
      const affiliate = (campaign.affiliates ?? []).find(
        (a) => a.affiliate_id === affiliateId,
      );
      if (!affiliate)
        return {
          result: false,
          error: `Affiliate ${affiliateId} not found on this campaign`,
        };
      return { result: true, data: affiliate.sold_criteria ?? [] };
    } catch (error: any) {
      this.logger.error("Failed to list affiliate sold criteria", error);
      return {
        result: false,
        error: error.message || "Failed to list affiliate sold criteria",
      };
    }
  }

  async createAffiliateSoldCriterion(
    campaignId: string,
    affiliateId: string,
    request: CreateLogicRuleRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<ILogicRule>> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted)
        return { result: false, error: `Campaign ${campaignId} not found` };
      const affiliate = (campaign.affiliates ?? []).find(
        (a) => a.affiliate_id === affiliateId,
      );
      if (!affiliate)
        return {
          result: false,
          error: `Affiliate ${affiliateId} not found on this campaign`,
        };

      const validationError = this.validateLogicRuleRequest(request);
      if (validationError) return { result: false, error: validationError };

      const now = new Date().toISOString();
      const rule: ILogicRule = {
        id: IdGenerator.generate("LR"),
        name: request.name.trim(),
        action: request.action,
        enabled: request.enabled ?? true,
        groups: request.groups.map((g) => ({
          id: IdGenerator.generate("LG"),
          conditions: g.conditions.map((c) => ({
            id: IdGenerator.generate("LC"),
            field_name: c.field_name,
            operator: c.operator,
            ...(c.value !== undefined ? { value: c.value } : {}),
          })),
        })),
        created_at: now,
        updated_at: now,
        created_by: actor,
        updated_by: actor,
      };

      affiliate.sold_criteria = [...(affiliate.sold_criteria ?? []), rule];
      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });
      await this.auditWriterService.writeAuditEvent({
        entity_id: campaignId,
        entity_type: "campaign",
        action: "affiliate_sold_criterion_added",
        changes: [
          { field: "affiliate_id", from: null, to: affiliateId },
          { field: "rule_id", from: null, to: rule.id },
          { field: "name", from: null, to: rule.name },
        ],
        actor,
        changed_at: now,
      });

      return { result: true, data: rule };
    } catch (error: any) {
      this.logger.error("Failed to create affiliate sold criterion", error);
      return {
        result: false,
        error: error.message || "Failed to create affiliate sold criterion",
      };
    }
  }

  async updateAffiliateSoldCriterion(
    campaignId: string,
    affiliateId: string,
    ruleId: string,
    request: UpdateLogicRuleRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<ILogicRule>> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted)
        return { result: false, error: `Campaign ${campaignId} not found` };
      const affiliate = (campaign.affiliates ?? []).find(
        (a) => a.affiliate_id === affiliateId,
      );
      if (!affiliate)
        return {
          result: false,
          error: `Affiliate ${affiliateId} not found on this campaign`,
        };

      const rules = affiliate.sold_criteria ?? [];
      const ruleIndex = rules.findIndex((r) => r.id === ruleId);
      if (ruleIndex === -1)
        return {
          result: false,
          error: `Sold criterion ${ruleId} not found for affiliate ${affiliateId}`,
        };

      const now = new Date().toISOString();
      const existing = rules[ruleIndex];
      const updated: ILogicRule = {
        ...existing,
        ...(request.name !== undefined ? { name: request.name.trim() } : {}),
        ...(request.action !== undefined ? { action: request.action } : {}),
        ...(request.enabled !== undefined ? { enabled: request.enabled } : {}),
        ...(request.groups !== undefined
          ? {
              groups: request.groups.map((g) => ({
                id: g.id ?? IdGenerator.generate("LG"),
                conditions: g.conditions.map((c) => ({
                  id: c.id ?? IdGenerator.generate("LC"),
                  field_name: c.field_name,
                  operator: c.operator,
                  ...(c.value !== undefined ? { value: c.value } : {}),
                })),
              })),
            }
          : {}),
        updated_at: now,
        updated_by: actor,
      };
      rules[ruleIndex] = updated;
      affiliate.sold_criteria = rules;
      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });
      await this.auditWriterService.writeAuditEvent({
        entity_id: campaignId,
        entity_type: "campaign",
        action: "affiliate_sold_criterion_updated",
        changes: [
          { field: "affiliate_id", from: null, to: affiliateId },
          { field: "rule_id", from: null, to: ruleId },
        ],
        actor,
        changed_at: now,
      });

      return { result: true, data: updated };
    } catch (error: any) {
      this.logger.error("Failed to update affiliate sold criterion", error);
      return {
        result: false,
        error: error.message || "Failed to update affiliate sold criterion",
      };
    }
  }

  async deleteAffiliateSoldCriterion(
    campaignId: string,
    affiliateId: string,
    ruleId: string,
    actor?: RequestActor,
  ): Promise<ServiceResult<{ id: string }>> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted)
        return { result: false, error: `Campaign ${campaignId} not found` };
      const affiliate = (campaign.affiliates ?? []).find(
        (a) => a.affiliate_id === affiliateId,
      );
      if (!affiliate)
        return {
          result: false,
          error: `Affiliate ${affiliateId} not found on this campaign`,
        };

      const rules = affiliate.sold_criteria ?? [];
      const ruleToDelete = rules.find((r) => r.id === ruleId);
      if (!ruleToDelete)
        return {
          result: false,
          error: `Sold criterion ${ruleId} not found for affiliate ${affiliateId}`,
        };

      const now = new Date().toISOString();
      affiliate.sold_criteria = rules.filter((r) => r.id !== ruleId);
      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });
      await this.auditWriterService.writeAuditEvent({
        entity_id: campaignId,
        entity_type: "campaign",
        action: "affiliate_sold_criterion_deleted",
        changes: [
          { field: "affiliate_id", from: null, to: affiliateId },
          { field: "rule_id", from: ruleToDelete.id, to: null },
          { field: "name", from: ruleToDelete.name, to: null },
        ],
        actor,
        changed_at: now,
      });

      return { result: true, data: { id: ruleId } };
    } catch (error: any) {
      this.logger.error("Failed to delete affiliate sold criterion", error);
      return {
        result: false,
        error: error.message || "Failed to delete affiliate sold criterion",
      };
    }
  }

  async updateAffiliateCherryPickOverride(
    campaignId: string,
    affiliateId: string,
    value: boolean | null,
    actor?: RequestActor,
  ): Promise<ServiceResult<ICampaign>> {
    return this.mutateAffiliate(
      campaignId,
      affiliateId,
      (a) => {
        if (value === null) {
          delete a.cherry_pick_override;
        } else {
          a.cherry_pick_override = value;
        }
      },
      actor,
      { recordRemoval: false },
      {
        action: "affiliate_cherry_pick_override_updated",
        changes: (before) => [
          {
            field: `affiliates.${affiliateId}.cherry_pick_override`,
            from: before.cherry_pick_override ?? null,
            to: value,
          },
        ],
      },
    );
  }

  async applyLogicCatalogToAffiliate(
    campaignId: string,
    affiliateId: string,
    request: ApplyLogicCatalogRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<ILogicRule[]>> {
    try {
      const { logic_set_id, version } = request;
      const versionId = `${logic_set_id}#v${version}`;
      const [campaign, catalogVersion] = await Promise.all([
        this.getCampaignById(campaignId),
        this.dynamoDBUtil.get<ILogicCatalogVersion>({
          TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
          Key: { id: versionId },
        }),
      ]);

      if (!campaign || campaign.is_deleted)
        return { result: false, error: `Campaign ${campaignId} not found` };
      const affiliate = (campaign.affiliates ?? []).find(
        (a) => a.affiliate_id === affiliateId,
      );
      if (!affiliate)
        return {
          result: false,
          error: `Affiliate ${affiliateId} not found on this campaign`,
        };
      if (!catalogVersion || catalogVersion.record_type !== "logic_version")
        return {
          result: false,
          error: `Logic catalog version ${versionId} not found`,
        };

      const now = new Date().toISOString();
      const rules: ILogicRule[] = JSON.parse(
        JSON.stringify(catalogVersion.rules),
      );
      const overrides = { ...(campaign.affiliate_overrides ?? {}) };
      const existing = overrides[affiliateId] ?? {};
      overrides[affiliateId] = {
        ...existing,
        logic_set_id,
        logic_set_version: version,
        logic_rules: rules,
      };
      campaign.affiliate_overrides = overrides;
      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });
      await this.auditWriterService.writeAuditEvent({
        entity_id: campaignId,
        entity_type: "campaign",
        action: "affiliate_logic_catalog_applied",
        changes: [
          { field: "affiliate_id", from: null, to: affiliateId },
          {
            field: "logic_set_id",
            from: existing.logic_set_id,
            to: logic_set_id,
          },
          {
            field: "logic_set_version",
            from: existing.logic_set_version,
            to: version,
          },
        ],
        actor,
        changed_at: now,
      });

      return { result: true, data: rules };
    } catch (error: any) {
      this.logger.error("Failed to apply logic catalog to affiliate", error);
      return {
        result: false,
        error: error.message || "Failed to apply logic catalog to affiliate",
      };
    }
  }

  // ── Per-Client Logic Rule Overrides ────────────────────────────────────────

  async listClientLogicRules(
    campaignId: string,
    clientId: string,
  ): Promise<ServiceResult<ILogicRule[]>> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted)
        return { result: false, error: `Campaign ${campaignId} not found` };
      const client = (campaign.clients ?? []).find(
        (c) => c.client_id === clientId,
      );
      if (!client)
        return {
          result: false,
          error: `Client ${clientId} not found on this campaign`,
        };
      const overrides = (campaign.client_overrides ?? {})[clientId] ?? {};
      return { result: true, data: overrides.logic_rules ?? [] };
    } catch (error: any) {
      this.logger.error("Failed to list client logic rules", error);
      return {
        result: false,
        error: error.message || "Failed to list client logic rules",
      };
    }
  }

  async createClientLogicRule(
    campaignId: string,
    clientId: string,
    request: CreateLogicRuleRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<ILogicRule>> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted)
        return { result: false, error: `Campaign ${campaignId} not found` };
      const client = (campaign.clients ?? []).find(
        (c) => c.client_id === clientId,
      );
      if (!client)
        return {
          result: false,
          error: `Client ${clientId} not found on this campaign`,
        };

      const validationError = this.validateLogicRuleRequest(request);
      if (validationError) return { result: false, error: validationError };

      const now = new Date().toISOString();
      const rule: ILogicRule = {
        id: IdGenerator.generate("LR"),
        name: request.name.trim(),
        action: request.action,
        enabled: request.enabled ?? true,
        groups: request.groups.map((g) => ({
          id: IdGenerator.generate("LG"),
          conditions: g.conditions.map((c) => ({
            id: IdGenerator.generate("LC"),
            field_name: c.field_name,
            operator: c.operator,
            ...(c.value !== undefined ? { value: c.value } : {}),
          })),
        })),
        created_at: now,
        updated_at: now,
        created_by: actor,
        updated_by: actor,
      };

      const overrides = { ...(campaign.client_overrides ?? {}) };
      const existing = overrides[clientId] ?? {};
      overrides[clientId] = {
        ...existing,
        logic_rules: [...(existing.logic_rules ?? []), rule],
      };
      campaign.client_overrides = overrides;
      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });
      await this.auditWriterService.writeAuditEvent({
        entity_id: campaignId,
        entity_type: "campaign",
        action: "client_logic_rule_added",
        changes: [
          { field: "client_id", from: null, to: clientId },
          { field: "rule_id", from: null, to: rule.id },
          { field: "name", from: null, to: rule.name },
          { field: "action", from: null, to: rule.action },
        ],
        actor,
        changed_at: now,
      });

      return { result: true, data: rule };
    } catch (error: any) {
      this.logger.error("Failed to create client logic rule", error);
      return {
        result: false,
        error: error.message || "Failed to create client logic rule",
      };
    }
  }

  async updateClientLogicRule(
    campaignId: string,
    clientId: string,
    ruleId: string,
    request: UpdateLogicRuleRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<ILogicRule>> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted)
        return { result: false, error: `Campaign ${campaignId} not found` };

      const overrides = { ...(campaign.client_overrides ?? {}) };
      const existing = overrides[clientId] ?? {};
      const rules = existing.logic_rules ?? [];
      const ruleIndex = rules.findIndex((r) => r.id === ruleId);
      if (ruleIndex === -1)
        return {
          result: false,
          error: `Logic rule ${ruleId} not found for client ${clientId}`,
        };

      if (request.groups !== undefined) {
        const validationError = this.validateLogicRuleRequest({
          name: request.name ?? "x",
          action: request.action ?? "fail",
          groups: request.groups,
        });
        if (validationError) return { result: false, error: validationError };
      }

      const now = new Date().toISOString();
      const existingRule = rules[ruleIndex];
      const updated: ILogicRule = {
        ...existingRule,
        name:
          request.name !== undefined ? request.name.trim() : existingRule.name,
        action:
          request.action !== undefined ? request.action : existingRule.action,
        enabled:
          request.enabled !== undefined
            ? request.enabled
            : existingRule.enabled,
        groups:
          request.groups !== undefined
            ? request.groups.map((g) => ({
                id: g.id ?? IdGenerator.generate("LG"),
                conditions: g.conditions.map((c) => ({
                  id: c.id ?? IdGenerator.generate("LC"),
                  field_name: c.field_name,
                  operator: c.operator,
                  ...(c.value !== undefined ? { value: c.value } : {}),
                })),
              }))
            : existingRule.groups,
        updated_at: now,
        updated_by: actor,
      };

      const updatedRules = [...rules];
      updatedRules[ruleIndex] = updated;
      overrides[clientId] = { ...existing, logic_rules: updatedRules };
      campaign.client_overrides = overrides;
      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });
      await this.auditWriterService.writeAuditEvent({
        entity_id: campaignId,
        entity_type: "campaign",
        action: "client_logic_rule_updated",
        changes: [
          { field: "client_id", from: null, to: clientId },
          { field: "rule_id", from: ruleId, to: ruleId },
        ],
        actor,
        changed_at: now,
      });

      return { result: true, data: updated };
    } catch (error: any) {
      this.logger.error("Failed to update client logic rule", error);
      return {
        result: false,
        error: error.message || "Failed to update client logic rule",
      };
    }
  }

  async deleteClientLogicRule(
    campaignId: string,
    clientId: string,
    ruleId: string,
    actor?: RequestActor,
  ): Promise<ServiceResult<{ id: string }>> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted)
        return { result: false, error: `Campaign ${campaignId} not found` };

      const overrides = { ...(campaign.client_overrides ?? {}) };
      const existing = overrides[clientId] ?? {};
      const rules = existing.logic_rules ?? [];
      const ruleToDelete = rules.find((r) => r.id === ruleId);
      if (!ruleToDelete)
        return {
          result: false,
          error: `Logic rule ${ruleId} not found for client ${clientId}`,
        };

      const now = new Date().toISOString();
      overrides[clientId] = {
        ...existing,
        logic_rules: rules.filter((r) => r.id !== ruleId),
      };
      campaign.client_overrides = overrides;
      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });
      await this.auditWriterService.writeAuditEvent({
        entity_id: campaignId,
        entity_type: "campaign",
        action: "client_logic_rule_deleted",
        changes: [
          { field: "client_id", from: null, to: clientId },
          { field: "rule_id", from: ruleToDelete.id, to: null },
          { field: "name", from: ruleToDelete.name, to: null },
        ],
        actor,
        changed_at: now,
      });

      return { result: true, data: { id: ruleId } };
    } catch (error: any) {
      this.logger.error("Failed to delete client logic rule", error);
      return {
        result: false,
        error: error.message || "Failed to delete client logic rule",
      };
    }
  }

  async applyLogicCatalogToClient(
    campaignId: string,
    clientId: string,
    request: ApplyLogicCatalogRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<ILogicRule[]>> {
    try {
      const { logic_set_id, version } = request;
      const versionId = `${logic_set_id}#v${version}`;
      const [campaign, catalogVersion] = await Promise.all([
        this.getCampaignById(campaignId),
        this.dynamoDBUtil.get<ILogicCatalogVersion>({
          TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
          Key: { id: versionId },
        }),
      ]);

      if (!campaign || campaign.is_deleted)
        return { result: false, error: `Campaign ${campaignId} not found` };
      const client = (campaign.clients ?? []).find(
        (c) => c.client_id === clientId,
      );
      if (!client)
        return {
          result: false,
          error: `Client ${clientId} not found on this campaign`,
        };
      if (!catalogVersion || catalogVersion.record_type !== "logic_version")
        return {
          result: false,
          error: `Logic catalog version ${versionId} not found`,
        };

      const now = new Date().toISOString();
      const rules: ILogicRule[] = JSON.parse(
        JSON.stringify(catalogVersion.rules),
      );
      const overrides = { ...(campaign.client_overrides ?? {}) };
      const existing = overrides[clientId] ?? {};
      overrides[clientId] = {
        ...existing,
        logic_set_id,
        logic_set_version: version,
        logic_rules: rules,
      };
      campaign.client_overrides = overrides;
      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });
      await this.auditWriterService.writeAuditEvent({
        entity_id: campaignId,
        entity_type: "campaign",
        action: "client_logic_catalog_applied",
        changes: [
          { field: "client_id", from: null, to: clientId },
          {
            field: "logic_set_id",
            from: existing.logic_set_id,
            to: logic_set_id,
          },
          {
            field: "logic_set_version",
            from: existing.logic_set_version,
            to: version,
          },
        ],
        actor,
        changed_at: now,
      });

      return { result: true, data: rules };
    } catch (error: any) {
      this.logger.error("Failed to apply logic catalog to client", error);
      return {
        result: false,
        error: error.message || "Failed to apply logic catalog to client",
      };
    }
  }

  /**
   * Sync a client's pinned base logic to the current campaign logic.
   * - Replaces the client's pinned base (logic_set_id/version) with the campaign's.
   * - Removes client override rules that are redundant extensions of campaign rules
   *   (same field_names AND same action).
   * - Keeps true overrides (same fields, different action) and unique rules.
   */
  async syncClientLogicToCampaign(
    campaignId: string,
    clientId: string,
    actor?: RequestActor,
  ): Promise<
    ServiceResult<{ kept_rules: ILogicRule[]; removed_count: number }>
  > {
    try {
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted)
        return { result: false, error: `Campaign ${campaignId} not found` };
      const client = (campaign.clients ?? []).find(
        (c) => c.client_id === clientId,
      );
      if (!client)
        return {
          result: false,
          error: `Client ${clientId} not found on this campaign`,
        };

      const campaignRules = campaign.logic_rules ?? [];
      const overrides = { ...(campaign.client_overrides ?? {}) };
      const existing = overrides[clientId] ?? {};
      const clientRules = existing.logic_rules ?? [];

      // Build a set of "field signature → action" from campaign rules for matching
      const campaignSignatures = new Map<string, string>();
      for (const rule of campaignRules) {
        const fieldNames = new Set<string>();
        for (const group of rule.groups) {
          for (const cond of group.conditions) {
            fieldNames.add(cond.field_name);
          }
        }
        const sig = [...fieldNames].sort().join("|");
        campaignSignatures.set(sig, rule.action);
      }

      // Partition client rules: keep overrides + unique, remove redundant extensions
      const keptRules: ILogicRule[] = [];
      let removedCount = 0;
      for (const rule of clientRules) {
        const fieldNames = new Set<string>();
        for (const group of rule.groups) {
          for (const cond of group.conditions) {
            fieldNames.add(cond.field_name);
          }
        }
        const sig = [...fieldNames].sort().join("|");
        const campaignAction = campaignSignatures.get(sig);
        if (campaignAction !== undefined && campaignAction === rule.action) {
          // Redundant extension — same fields AND same action → remove
          removedCount++;
        } else {
          // True override (different action) or unique rule → keep
          keptRules.push(rule);
        }
      }

      const now = new Date().toISOString();
      overrides[clientId] = {
        ...existing,
        logic_set_id: campaign.logic_set_id,
        logic_set_version: campaign.logic_set_version,
        logic_rules: keptRules,
      };
      campaign.client_overrides = overrides;
      campaign.updated_at = now;
      campaign.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });
      await this.auditWriterService.writeAuditEvent({
        entity_id: campaignId,
        entity_type: "campaign",
        action: "client_logic_synced_to_campaign",
        changes: [
          { field: "client_id", from: null, to: clientId },
          {
            field: "logic_set_id",
            from: existing.logic_set_id,
            to: campaign.logic_set_id,
          },
          {
            field: "logic_set_version",
            from: existing.logic_set_version,
            to: campaign.logic_set_version,
          },
          { field: "removed_extension_rules", from: null, to: removedCount },
        ],
        actor,
        changed_at: now,
      });

      return {
        result: true,
        data: { kept_rules: keptRules, removed_count: removedCount },
      };
    } catch (error: any) {
      this.logger.error("Failed to sync client logic to campaign", error);
      return {
        result: false,
        error: error.message || "Failed to sync client logic to campaign",
      };
    }
  }

  private validateLogicRuleRequest(
    request: Pick<CreateLogicRuleRequest, "name" | "action" | "groups">,
  ): string | null {
    if (!request.name?.trim()) return "name is required";
    if (!["pass", "fail"].includes(request.action))
      return "action must be 'pass' or 'fail'";
    if (!Array.isArray(request.groups) || request.groups.length === 0)
      return "groups must be a non-empty array";

    for (let gi = 0; gi < request.groups.length; gi++) {
      const group = request.groups[gi];
      if (!Array.isArray(group.conditions) || group.conditions.length === 0)
        return `groups[${gi}].conditions must be a non-empty array`;

      const validOperators = [
        "is",
        "is_not",
        "contains",
        "does_not_contain",
        "starts_with",
        "ends_with",
        "greater_than",
        "less_than",
        "is_empty",
        "is_not_empty",
      ];

      for (let ci = 0; ci < group.conditions.length; ci++) {
        const cond = group.conditions[ci];
        if (!cond.field_name?.trim())
          return `groups[${gi}].conditions[${ci}].field_name is required`;
        if (!validOperators.includes(cond.operator))
          return `groups[${gi}].conditions[${ci}].operator '${cond.operator}' is invalid`;
        const noValueNeeded = ["is_empty", "is_not_empty"].includes(
          cond.operator,
        );
        if (
          !noValueNeeded &&
          (cond.value === undefined || cond.value === null || cond.value === "")
        ) {
          return `groups[${gi}].conditions[${ci}].value is required for operator '${cond.operator}'`;
        }
      }
    }
    return null;
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
    const normalizeClients: ICampaignClient[] = (campaign.clients ?? []).map(
      (c: any) =>
        typeof c === "string"
          ? {
              client_id: c,
              status: CampaignParticipantStatus.LIVE,
              added_at: new Date().toISOString(),
            }
          : {
              ...c,
              client_id: c.client_id,
              added_at: c.added_at ?? new Date().toISOString(),
              status: c.status ?? CampaignParticipantStatus.LIVE,
            },
    );

    const normalizeAffiliates: ICampaignAffiliate[] = (
      campaign.affiliates ?? []
    ).map((a: any) =>
      typeof a === "string"
        ? {
            affiliate_id: a,
            campaign_key: IdGenerator.generateCampaignKey(12),
            added_at: new Date().toISOString(),
            status: CampaignParticipantStatus.LIVE,
          }
        : {
            ...a,
            affiliate_id: a.affiliate_id,
            campaign_key: a.campaign_key,
            added_at: a.added_at ?? new Date().toISOString(),
            status: a.status ?? CampaignParticipantStatus.LIVE,
          },
    );

    const { status_history: _statusHistory, ...campaignWithoutStatusHistory } =
      campaign as any;

    return {
      ...campaignWithoutStatusHistory,
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

  private enrichCampaignForResponse(campaign: ICampaign): ICampaign {
    const normalized = this.normalizeParticipants(campaign);
    return {
      ...normalized,
      affiliates: (normalized.affiliates ?? []).map((affiliate) =>
        this.enrichAffiliateForResponse(affiliate),
      ),
    };
  }

  private enrichAffiliateForResponse(
    affiliate: ICampaignAffiliate,
  ): ICampaignAffiliate {
    const sentRaw = affiliate.leads_sent;
    const capRaw = affiliate.lead_cap;

    const sent =
      typeof sentRaw === "number" && Number.isFinite(sentRaw)
        ? Math.max(0, sentRaw)
        : 0;

    if (typeof capRaw !== "number" || !Number.isFinite(capRaw) || capRaw <= 0) {
      return {
        ...affiliate,
        leads_sent: sent,
        leads_remaining: null,
        quota_completion_percent: null,
      };
    }

    const remaining = Math.max(0, capRaw - sent);
    const completion = Math.min(
      100,
      Number(((sent / capRaw) * 100).toFixed(2)),
    );

    return {
      ...affiliate,
      leads_sent: sent,
      leads_remaining: remaining,
      quota_completion_percent: completion,
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
    const patchPhoneCriteria = patchPhone?.criteria as
      | Partial<IIpqsPhoneCriteria>
      | undefined;
    const patchEmail = patch.email as
      | Partial<IIpqsEmailCheckConfig>
      | undefined;
    const patchEmailCriteria = patchEmail?.criteria as
      | Partial<IIpqsEmailCriteria>
      | undefined;
    const patchIp = patch.ip as Partial<IIpqsIpCheckConfig> | undefined;
    const patchIpCriteria = patchIp?.criteria as
      | Partial<IIpqsIpCriteria>
      | undefined;

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
      phone: patchPhone
        ? {
            ...base.phone,
            ...patchPhone,
            criteria: patchPhoneCriteria
              ? {
                  ...base.phone.criteria,
                  ...patchPhoneCriteria,
                  valid: patchPhoneCriteria.valid
                    ? {
                        ...base.phone.criteria.valid,
                        ...patchPhoneCriteria.valid,
                      }
                    : base.phone.criteria.valid,
                  fraud_score: patchPhoneCriteria.fraud_score
                    ? {
                        ...base.phone.criteria.fraud_score,
                        ...patchPhoneCriteria.fraud_score,
                      }
                    : base.phone.criteria.fraud_score,
                  country: patchPhoneCriteria.country
                    ? {
                        ...base.phone.criteria.country,
                        ...patchPhoneCriteria.country,
                      }
                    : base.phone.criteria.country,
                }
              : base.phone.criteria,
          }
        : base.phone,
      email: patchEmail
        ? {
            ...base.email,
            ...patchEmail,
            criteria: patchEmailCriteria
              ? {
                  ...base.email.criteria,
                  ...patchEmailCriteria,
                  valid: patchEmailCriteria.valid
                    ? {
                        ...base.email.criteria.valid,
                        ...patchEmailCriteria.valid,
                      }
                    : base.email.criteria.valid,
                  fraud_score: patchEmailCriteria.fraud_score
                    ? {
                        ...base.email.criteria.fraud_score,
                        ...patchEmailCriteria.fraud_score,
                      }
                    : base.email.criteria.fraud_score,
                }
              : base.email.criteria,
          }
        : base.email,
      ip: patchIp
        ? {
            ...base.ip,
            ...patchIp,
            criteria: patchIpCriteria
              ? {
                  ...base.ip.criteria,
                  ...patchIpCriteria,
                  fraud_score: patchIpCriteria.fraud_score
                    ? {
                        ...base.ip.criteria.fraud_score,
                        ...patchIpCriteria.fraud_score,
                      }
                    : base.ip.criteria.fraud_score,
                  country_code: patchIpCriteria.country_code
                    ? {
                        ...base.ip.criteria.country_code,
                        ...patchIpCriteria.country_code,
                      }
                    : base.ip.criteria.country_code,
                  proxy: patchIpCriteria.proxy
                    ? {
                        ...base.ip.criteria.proxy,
                        ...patchIpCriteria.proxy,
                      }
                    : base.ip.criteria.proxy,
                  vpn: patchIpCriteria.vpn
                    ? {
                        ...base.ip.criteria.vpn,
                        ...patchIpCriteria.vpn,
                      }
                    : base.ip.criteria.vpn,
                }
              : base.ip.criteria,
          }
        : base.ip,
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

    // Query plugin_setting directly by provider — plugin_setting records store
    // `provider` (not schema_id), so a single GSI lookup is sufficient.
    const settings = await this.dynamoDBUtil.queryAll<{
      enabled: boolean;
      is_deleted?: boolean;
    }>({
      TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
      IndexName: typeProviderIndex,
      KeyConditionExpression: "#t = :type AND #p = :provider",
      ExpressionAttributeNames: { "#t": "type", "#p": "provider" },
      ExpressionAttributeValues: {
        ":type": "plugin_setting",
        ":provider": provider,
      },
    });

    const setting = settings.find((s) => !s.is_deleted);
    // No plugin_setting record at tenant level → permissive (not configured = allow)
    if (!setting) return true;

    return setting.enabled === true;
  }

  private async validateCampaignTags(tags: string[]): Promise<string | null> {
    if (!this.constants.TENANT_SETTINGS_TABLE_NAME) return null;

    const typeIndex = `${this.constants.TENANT_SETTINGS_TABLE_NAME}-type-index`;
    const definitions = await this.dynamoDBUtil.queryAll<ITagDefinitionRecord>({
      TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
      IndexName: typeIndex,
      KeyConditionExpression: "#t = :type",
      ExpressionAttributeNames: { "#t": "type" },
      ExpressionAttributeValues: {
        ":type": "tag_definition",
        ":f": false,
      },
      FilterExpression: "attribute_not_exists(is_deleted) OR is_deleted = :f",
    });

    const knownLabels = new Set(definitions.map((d) => d.label.toLowerCase()));

    for (const tag of tags) {
      if (typeof tag !== "string" || tag.trim().length === 0) {
        return "Each tag must be a non-empty string";
      }
      if (!knownLabels.has(tag.trim().toLowerCase())) {
        return `Unknown tag: "${tag}"`;
      }
    }

    return null;
  }

  private getDefaultPlugins(): ICampaignPlugins {
    return {
      duplicate_check: {
        enabled: false,
        criteria: ["phone", "email"],
      },
      trusted_form: {
        enabled: false,
        stage: 3,
        gate: true,
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

  // ── Posting Instructions ──────────────────────────────────────────────────

  async generatePostingInstructions(
    campaignId: string,
    request: GeneratePostingInstructionsRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<PostingInstructionsResult>> {
    try {
      const campaign = await this.getCampaignById(campaignId);
      if (!campaign || campaign.is_deleted) {
        return { result: false, error: `Campaign ${campaignId} not found` };
      }

      const normalized = this.normalizeParticipants(campaign);
      const affiliateLink = (normalized.affiliates ?? []).find(
        (a) => a.affiliate_id === request.affiliate_id,
      );
      if (!affiliateLink) {
        return {
          result: false,
          error: `Affiliate ${request.affiliate_id} is not linked to campaign ${campaignId}`,
        };
      }

      const affiliateRecord = await this.dynamoDBUtil.get<{
        id: string;
        name: string;
      }>({
        TableName: this.constants.AFFILIATES_TABLE_NAME,
        Key: { id: request.affiliate_id },
      });
      if (!affiliateRecord) {
        return {
          result: false,
          error: `Affiliate ${request.affiliate_id} not found`,
        };
      }

      const criteriaFields = [...(campaign.base_criteria ?? [])]
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((f) => ({
          field_name: f.field_name,
          field_label: f.field_label,
          data_type: f.data_type,
          required: f.required ?? false,
          ...(f.description !== undefined && { description: f.description }),
          ...(f.options !== undefined && { options: f.options }),
          ...(f.state_mapping !== undefined && {
            state_mapping: f.state_mapping,
          }),
          order: f.order ?? 0,
        }));

      const leadsBase = await this.resolveLeadsBaseUrl();
      const now = new Date().toISOString();

      await this.auditWriterService.writeAuditEvent({
        entity_id: campaignId,
        entity_type: "campaign",
        action: "posting_instructions_generated",
        changes: [
          { field: "affiliate_id", from: null, to: request.affiliate_id },
          { field: "affiliate_name", from: null, to: affiliateRecord.name },
        ],
        actor,
        changed_at: now,
      });

      this.logger.info("Posting instructions generated", {
        campaignId,
        affiliateId: request.affiliate_id,
      });

      return {
        result: true,
        data: {
          campaign: {
            id: campaign.id,
            name: campaign.name,
            status: campaign.status,
            submit_url: leadsBase,
            submit_url_test: `${leadsBase}/test`,
          },
          affiliate: {
            id: affiliateRecord.id,
            name: affiliateRecord.name,
            campaign_key: affiliateLink.campaign_key,
            link_status: affiliateLink.status ?? CampaignParticipantStatus.LIVE,
          },
          criteria_fields: criteriaFields,
          generated_at: now,
        },
      };
    } catch (error: any) {
      this.logger.error("Failed to generate posting instructions", error);
      return {
        result: false,
        error: error.message || "Failed to generate posting instructions",
      };
    }
  }

  private async resolveLeadsBaseUrl(): Promise<string> {
    if (this.constants.LEADS_BASE_URL) {
      return this.constants.LEADS_BASE_URL.replace(/\/+$/, "");
    }

    if (this.leadsBaseUrlCache) {
      return this.leadsBaseUrlCache;
    }

    const apiName = this.constants.EXTERNAL_LEADS_API_NAME;
    const stage = this.constants.EXTERNAL_LEADS_API_STAGE;
    const region = this.constants.AWS_REGION;

    if (!apiName || !stage) {
      this.logger.warn(
        "External leads API discovery not configured; using relative leads URL",
      );
      this.leadsBaseUrlCache = "/leads";
      return this.leadsBaseUrlCache;
    }

    const client = new APIGatewayClient({ region });
    let position: string | undefined;

    do {
      const response = await client.send(
        new GetRestApisCommand({ limit: 500, position }),
      );
      const api = response.items?.find((item) => item.name === apiName);
      if (api?.id) {
        const safeStage = stage.replace(/^\/+|\/+$/g, "");
        this.leadsBaseUrlCache = `https://${api.id}.execute-api.${region}.amazonaws.com/${safeStage}/v2/leads`;
        return this.leadsBaseUrlCache;
      }
      position = response.position;
    } while (position);

    this.logger.warn(
      "External leads API not found by name; using relative leads URL",
      { apiName },
    );
    this.leadsBaseUrlCache = "/leads";
    return this.leadsBaseUrlCache;
  }

  // ── Criteria Catalog ──────────────────────────────────────────────────────

  async listCriteriaCatalog(): Promise<
    ServiceResult<{ items: ICriteriaCatalogSet[] }>
  > {
    try {
      const scanResult = await this.dynamoDBUtil.scanAll<ICriteriaCatalogSet>({
        TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
        FilterExpression: "record_type = :rt",
        ExpressionAttributeValues: { ":rt": "catalog_set" },
      });
      return { result: true, data: { items: scanResult } };
    } catch (error: any) {
      this.logger.error("Failed to list criteria catalog", error);
      return {
        result: false,
        error: error.message || "Failed to list criteria catalog",
      };
    }
  }

  async getCriteriaCatalogSet(id: string): Promise<
    ServiceResult<{
      set: ICriteriaCatalogSet;
      versions: ICriteriaCatalogVersion[];
    }>
  > {
    try {
      const set = await this.dynamoDBUtil.get<ICriteriaCatalogSet>({
        TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
        Key: { id },
      });
      if (!set || set.record_type !== "catalog_set") {
        return { result: false, error: `Criteria catalog set ${id} not found` };
      }

      const versions =
        await this.dynamoDBUtil.queryAll<ICriteriaCatalogVersion>({
          TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
          IndexName: "criteria_set_id-index",
          KeyConditionExpression: "criteria_set_id = :sid",
          ExpressionAttributeValues: { ":sid": id },
        });

      return { result: true, data: { set, versions } };
    } catch (error: any) {
      this.logger.error("Failed to get criteria catalog set", error);
      return {
        result: false,
        error: error.message || "Failed to get criteria catalog set",
      };
    }
  }

  async getCriteriaCatalogVersion(
    criteriaSetId: string,
    version: number,
  ): Promise<ServiceResult<ICriteriaCatalogVersion>> {
    try {
      const versionId = `${criteriaSetId}#v${version}`;
      const record = await this.dynamoDBUtil.get<ICriteriaCatalogVersion>({
        TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
        Key: { id: versionId },
      });
      if (!record || record.record_type !== "catalog_version") {
        return {
          result: false,
          error: `Criteria catalog version ${versionId} not found`,
        };
      }
      return { result: true, data: record };
    } catch (error: any) {
      this.logger.error("Failed to get criteria catalog version", error);
      return {
        result: false,
        error: error.message || "Failed to get criteria catalog version",
      };
    }
  }

  async createCriteriaCatalogSet(
    request: CreateCriteriaCatalogRequest,
    actor?: RequestActor,
  ): Promise<
    ServiceResult<{
      set: ICriteriaCatalogSet;
      version: ICriteriaCatalogVersion;
    }>
  > {
    try {
      if (!request.name?.trim()) {
        return { result: false, error: "name is required" };
      }

      const now = new Date().toISOString();
      const setId = IdGenerator.generateCriteriaCatalogSetId();
      const versionId = `${setId}#v1`;

      const set: ICriteriaCatalogSet = {
        id: setId,
        record_type: "catalog_set",
        name: request.name.trim(),
        description: request.description,
        ...(request.tags ? { tags: request.tags } : {}),
        latest_version: 1,
        created_at: now,
        updated_at: now,
        created_by: actor,
        updated_by: actor,
      };

      const version: ICriteriaCatalogVersion = {
        id: versionId,
        record_type: "catalog_version",
        criteria_set_id: setId,
        version: 1,
        name: set.name,
        fields: (request.fields ?? []).map((f) => ({
          ...f,
          id: IdGenerator.generateCriteriaFieldId(),
          order: 0,
          active: true,
          created_at: now,
          updated_at: now,
          created_by: actor,
          updated_by: actor,
        })),
        campaigns_using: [],
        created_at: now,
        created_by: actor,
      };

      await Promise.all([
        this.dynamoDBUtil.put({
          TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
          Item: set,
        }),
        this.dynamoDBUtil.put({
          TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
          Item: version,
        }),
      ]);

      await this.auditWriterService.writeAuditEvent({
        entity_id: setId,
        entity_type: "criteria_catalog",
        action: "criteria_catalog_created",
        changes: [],
        actor,
        changed_at: now,
      });

      this.logger.info("Criteria catalog set created", { setId });
      return { result: true, data: { set, version } };
    } catch (error: any) {
      this.logger.error("Failed to create criteria catalog set", error);
      return {
        result: false,
        error: error.message || "Failed to create criteria catalog set",
      };
    }
  }

  async updateCriteriaCatalogSet(
    id: string,
    request: UpdateCriteriaCatalogRequest,
    actor?: RequestActor,
  ): Promise<
    ServiceResult<{
      set: ICriteriaCatalogSet;
      version: ICriteriaCatalogVersion;
    }>
  > {
    try {
      const set = await this.dynamoDBUtil.get<ICriteriaCatalogSet>({
        TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
        Key: { id },
      });
      if (!set || set.record_type !== "catalog_set") {
        return { result: false, error: `Criteria catalog set ${id} not found` };
      }

      const now = new Date().toISOString();
      const newVersionNumber = set.latest_version + 1;
      const versionId = `${id}#v${newVersionNumber}`;

      const changes: AuditChange[] = [];
      if (request.name && request.name !== set.name) {
        changes.push({ field: "name", from: set.name, to: request.name });
        set.name = request.name;
      }
      if (
        request.description !== undefined &&
        request.description !== set.description
      ) {
        changes.push({
          field: "description",
          from: set.description,
          to: request.description,
        });
        set.description = request.description;
      }

      set.latest_version = newVersionNumber;
      set.updated_at = now;
      set.updated_by = actor;

      const newVersion: ICriteriaCatalogVersion = {
        id: versionId,
        record_type: "catalog_version",
        criteria_set_id: id,
        version: newVersionNumber,
        name: set.name,
        fields: request.fields.map((f, idx) => ({
          ...f,
          id: IdGenerator.generateCriteriaFieldId(),
          order: idx,
          active: true,
          created_at: now,
          updated_at: now,
          created_by: actor,
          updated_by: actor,
        })),
        campaigns_using: [],
        created_at: now,
        created_by: actor,
      };

      await Promise.all([
        this.dynamoDBUtil.put({
          TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
          Item: set,
        }),
        this.dynamoDBUtil.put({
          TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
          Item: newVersion,
        }),
      ]);

      await this.auditWriterService.writeAuditEvent({
        entity_id: id,
        entity_type: "criteria_catalog",
        action: "criteria_catalog_updated",
        changes,
        actor,
        changed_at: now,
      });

      this.logger.info("Criteria catalog set updated", {
        setId: id,
        newVersion: newVersionNumber,
      });
      return { result: true, data: { set, version: newVersion } };
    } catch (error: any) {
      this.logger.error("Failed to update criteria catalog set", error);
      return {
        result: false,
        error: error.message || "Failed to update criteria catalog set",
      };
    }
  }

  async deleteCriteriaCatalogSet(
    id: string,
    actor?: RequestActor,
  ): Promise<ServiceResult<void>> {
    try {
      const set = await this.dynamoDBUtil.get<ICriteriaCatalogSet>({
        TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
        Key: { id },
      });
      if (!set || set.record_type !== "catalog_set") {
        return { result: false, error: `Criteria catalog set ${id} not found` };
      }

      const versions =
        await this.dynamoDBUtil.queryAll<ICriteriaCatalogVersion>({
          TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
          IndexName: "criteria_set_id-index",
          KeyConditionExpression: "criteria_set_id = :sid",
          ExpressionAttributeValues: { ":sid": id },
        });

      const inUseVersion = versions.find(
        (v) => (v.campaigns_using ?? []).length > 0,
      );
      if (inUseVersion) {
        return {
          result: false,
          error: `Criteria catalog set ${id} is in use by campaigns and cannot be deleted`,
        };
      }

      await Promise.all([
        this.dynamoDBUtil.delete({
          TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
          Key: { id },
        }),
        ...versions.map((v) =>
          this.dynamoDBUtil.delete({
            TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
            Key: { id: v.id },
          }),
        ),
      ]);

      const now = new Date().toISOString();
      await this.auditWriterService.writeAuditEvent({
        entity_id: id,
        entity_type: "criteria_catalog",
        action: "criteria_catalog_deleted",
        changes: [],
        actor,
        changed_at: now,
      });

      this.logger.info("Criteria catalog set deleted", { setId: id });
      return { result: true };
    } catch (error: any) {
      this.logger.error("Failed to delete criteria catalog set", error);
      return {
        result: false,
        error: error.message || "Failed to delete criteria catalog set",
      };
    }
  }

  async deleteCriteriaCatalogVersion(
    criteriaSetId: string,
    version: number,
    actor?: RequestActor,
  ): Promise<ServiceResult<void>> {
    try {
      const versionId = `${criteriaSetId}#v${version}`;
      const record = await this.dynamoDBUtil.get<ICriteriaCatalogVersion>({
        TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
        Key: { id: versionId },
      });
      if (!record || record.record_type !== "catalog_version") {
        return {
          result: false,
          error: `Criteria catalog version ${versionId} not found`,
        };
      }

      if ((record.campaigns_using ?? []).length > 0) {
        return {
          result: false,
          error: `Criteria catalog version ${versionId} is in use by campaigns and cannot be deleted`,
        };
      }

      await this.dynamoDBUtil.delete({
        TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
        Key: { id: versionId },
      });

      const now = new Date().toISOString();
      await this.auditWriterService.writeAuditEvent({
        entity_id: criteriaSetId,
        entity_type: "criteria_catalog",
        action: "criteria_catalog_version_deleted",
        changes: [{ field: "version", from: version, to: null }],
        actor,
        changed_at: now,
      });

      // If no versions remain, cascade-delete the parent set.
      const remaining =
        await this.dynamoDBUtil.queryAll<ICriteriaCatalogVersion>({
          TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
          IndexName: "criteria_set_id-index",
          KeyConditionExpression: "criteria_set_id = :sid",
          ExpressionAttributeValues: { ":sid": criteriaSetId },
        });

      if (remaining.length === 0) {
        await this.dynamoDBUtil.delete({
          TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
          Key: { id: criteriaSetId },
        });
        await this.auditWriterService.writeAuditEvent({
          entity_id: criteriaSetId,
          entity_type: "criteria_catalog",
          action: "criteria_catalog_deleted",
          changes: [],
          actor,
          changed_at: now,
        });
        this.logger.info(
          "Criteria catalog set cascade-deleted (last version removed)",
          { setId: criteriaSetId },
        );
      }

      this.logger.info("Criteria catalog version deleted", {
        setId: criteriaSetId,
        version,
      });
      return { result: true };
    } catch (error: any) {
      this.logger.error("Failed to delete criteria catalog version", error);
      return {
        result: false,
        error: error.message || "Failed to delete criteria catalog version",
      };
    }
  }

  async applyCriteriaCatalogToCampaign(
    campaignId: string,
    request: ApplyCriteriaCatalogRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<ICampaign>> {
    try {
      const { criteria_set_id, version } = request;

      const versionId = `${criteria_set_id}#v${version}`;
      const [campaign, catalogVersion] = await Promise.all([
        this.getCampaignById(campaignId),
        this.dynamoDBUtil.get<ICriteriaCatalogVersion>({
          TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
          Key: { id: versionId },
        }),
      ]);

      if (!campaign || campaign.is_deleted) {
        return { result: false, error: `Campaign ${campaignId} not found` };
      }
      if (!catalogVersion || catalogVersion.record_type !== "catalog_version") {
        return {
          result: false,
          error: `Criteria catalog version ${versionId} not found`,
        };
      }

      const now = new Date().toISOString();
      const changes: AuditChange[] = [
        {
          field: "criteria_set_id",
          from: campaign.criteria_set_id,
          to: criteria_set_id,
        },
        {
          field: "criteria_set_version",
          from: campaign.criteria_set_version,
          to: version,
        },
      ];

      campaign.base_criteria = [...catalogVersion.fields];
      campaign.criteria_set_id = criteria_set_id;
      campaign.criteria_set_version = version;
      campaign.updated_at = now;
      campaign.updated_by = actor;

      // Track which campaigns are using this catalog version
      if (!catalogVersion.campaigns_using.includes(campaignId)) {
        catalogVersion.campaigns_using.push(campaignId);
      }

      const normalized = this.normalizeParticipants(campaign);
      Object.assign(campaign, normalized);

      await Promise.all([
        this.dynamoDBUtil.put({
          TableName: this.constants.CAMPAIGNS_TABLE_NAME,
          Item: campaign,
        }),
        this.dynamoDBUtil.put({
          TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
          Item: catalogVersion,
        }),
      ]);

      await this.auditWriterService.writeAuditEvent({
        entity_id: campaignId,
        entity_type: "campaign",
        action: "criteria_catalog_assigned",
        changes,
        actor,
        changed_at: now,
      });

      this.logger.info("Criteria catalog applied to campaign", {
        campaignId,
        criteria_set_id,
        version,
      });
      return { result: true, data: this.enrichCampaignForResponse(campaign) };
    } catch (error: any) {
      this.logger.error("Failed to apply criteria catalog to campaign", error);
      return {
        result: false,
        error: error.message || "Failed to apply criteria catalog to campaign",
      };
    }
  }

  // ── Logic Catalog ───────────────────────────────────────────────────────

  async listLogicCatalog(): Promise<
    ServiceResult<{ items: ILogicCatalogSet[] }>
  > {
    try {
      const scanResult = await this.dynamoDBUtil.scanAll<ILogicCatalogSet>({
        TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
        FilterExpression: "record_type = :rt",
        ExpressionAttributeValues: { ":rt": "logic_set" },
      });
      return { result: true, data: { items: scanResult } };
    } catch (error: any) {
      this.logger.error("Failed to list logic catalog", error);
      return {
        result: false,
        error: error.message || "Failed to list logic catalog",
      };
    }
  }

  async getLogicCatalogSet(id: string): Promise<
    ServiceResult<{
      set: ILogicCatalogSet;
      versions: ILogicCatalogVersion[];
    }>
  > {
    try {
      const set = await this.dynamoDBUtil.get<ILogicCatalogSet>({
        TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
        Key: { id },
      });
      if (!set || set.record_type !== "logic_set") {
        return { result: false, error: `Logic catalog set ${id} not found` };
      }

      const versions = await this.dynamoDBUtil.scanAll<ILogicCatalogVersion>({
        TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
        FilterExpression: "record_type = :rt AND logic_set_id = :sid",
        ExpressionAttributeValues: {
          ":rt": "logic_version",
          ":sid": id,
        },
      });

      return {
        result: true,
        data: {
          set,
          versions: versions.sort((a, b) => a.version - b.version),
        },
      };
    } catch (error: any) {
      this.logger.error("Failed to get logic catalog set", error);
      return {
        result: false,
        error: error.message || "Failed to get logic catalog set",
      };
    }
  }

  async getLogicCatalogVersion(
    logicSetId: string,
    version: number,
  ): Promise<ServiceResult<ILogicCatalogVersion>> {
    try {
      const versionId = `${logicSetId}#v${version}`;
      const record = await this.dynamoDBUtil.get<ILogicCatalogVersion>({
        TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
        Key: { id: versionId },
      });
      if (!record || record.record_type !== "logic_version") {
        return {
          result: false,
          error: `Logic catalog version ${versionId} not found`,
        };
      }
      return { result: true, data: record };
    } catch (error: any) {
      this.logger.error("Failed to get logic catalog version", error);
      return {
        result: false,
        error: error.message || "Failed to get logic catalog version",
      };
    }
  }

  async createLogicCatalogSet(
    request: CreateLogicCatalogRequest,
    actor?: RequestActor,
  ): Promise<
    ServiceResult<{
      set: ILogicCatalogSet;
      version: ILogicCatalogVersion;
    }>
  > {
    try {
      if (!request.name?.trim()) {
        return { result: false, error: "name is required" };
      }

      const rulesInput = request.rules ?? [];
      for (let i = 0; i < rulesInput.length; i++) {
        const rule = rulesInput[i];
        const validationError = this.validateLogicRuleRequest({
          name: rule.name,
          action: rule.action,
          groups: rule.groups as any,
        });
        if (validationError) {
          return {
            result: false,
            error: `rules[${i}] ${validationError}`,
          };
        }
      }

      const now = new Date().toISOString();
      const setId = IdGenerator.generate("LCS");
      const versionId = `${setId}#v1`;

      const set: ILogicCatalogSet = {
        id: setId,
        record_type: "logic_set",
        name: request.name.trim(),
        description: request.description,
        ...(request.tags ? { tags: request.tags } : {}),
        latest_version: 1,
        created_at: now,
        updated_at: now,
        created_by: actor,
        updated_by: actor,
      };

      const version: ILogicCatalogVersion = {
        id: versionId,
        record_type: "logic_version",
        logic_set_id: setId,
        version: 1,
        name: set.name,
        rules: this.buildLogicCatalogRules(rulesInput, actor, now),
        campaigns_using: [],
        created_at: now,
        created_by: actor,
      };

      await Promise.all([
        this.dynamoDBUtil.put({
          TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
          Item: set,
        }),
        this.dynamoDBUtil.put({
          TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
          Item: version,
        }),
      ]);

      await this.auditWriterService.writeAuditEvent({
        entity_id: setId,
        entity_type: "logic_catalog",
        action: "logic_catalog_created",
        changes: [],
        actor,
        changed_at: now,
      });

      return { result: true, data: { set, version } };
    } catch (error: any) {
      this.logger.error("Failed to create logic catalog set", error);
      return {
        result: false,
        error: error.message || "Failed to create logic catalog set",
      };
    }
  }

  async updateLogicCatalogSet(
    id: string,
    request: UpdateLogicCatalogRequest,
    actor?: RequestActor,
  ): Promise<
    ServiceResult<{
      set: ILogicCatalogSet;
      version: ILogicCatalogVersion;
    }>
  > {
    try {
      const set = await this.dynamoDBUtil.get<ILogicCatalogSet>({
        TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
        Key: { id },
      });
      if (!set || set.record_type !== "logic_set") {
        return { result: false, error: `Logic catalog set ${id} not found` };
      }

      for (let i = 0; i < request.rules.length; i++) {
        const rule = request.rules[i];
        const validationError = this.validateLogicRuleRequest({
          name: rule.name,
          action: rule.action,
          groups: rule.groups as any,
        });
        if (validationError) {
          return {
            result: false,
            error: `rules[${i}] ${validationError}`,
          };
        }
      }

      const now = new Date().toISOString();
      const newVersionNumber = set.latest_version + 1;
      const versionId = `${id}#v${newVersionNumber}`;

      const changes: AuditChange[] = [];
      if (request.name && request.name !== set.name) {
        changes.push({ field: "name", from: set.name, to: request.name });
        set.name = request.name;
      }
      if (
        request.description !== undefined &&
        request.description !== set.description
      ) {
        changes.push({
          field: "description",
          from: set.description,
          to: request.description,
        });
        set.description = request.description;
      }

      set.latest_version = newVersionNumber;
      set.updated_at = now;
      set.updated_by = actor;

      const newVersion: ILogicCatalogVersion = {
        id: versionId,
        record_type: "logic_version",
        logic_set_id: id,
        version: newVersionNumber,
        name: set.name,
        rules: this.buildLogicCatalogRules(request.rules, actor, now),
        campaigns_using: [],
        created_at: now,
        created_by: actor,
      };

      await Promise.all([
        this.dynamoDBUtil.put({
          TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
          Item: set,
        }),
        this.dynamoDBUtil.put({
          TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
          Item: newVersion,
        }),
      ]);

      await this.auditWriterService.writeAuditEvent({
        entity_id: id,
        entity_type: "logic_catalog",
        action: "logic_catalog_updated",
        changes,
        actor,
        changed_at: now,
      });

      return { result: true, data: { set, version: newVersion } };
    } catch (error: any) {
      this.logger.error("Failed to update logic catalog set", error);
      return {
        result: false,
        error: error.message || "Failed to update logic catalog set",
      };
    }
  }

  async deleteLogicCatalogSet(
    id: string,
    actor?: RequestActor,
  ): Promise<ServiceResult<void>> {
    try {
      const set = await this.dynamoDBUtil.get<ILogicCatalogSet>({
        TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
        Key: { id },
      });
      if (!set || set.record_type !== "logic_set") {
        return { result: false, error: `Logic catalog set ${id} not found` };
      }

      const versions = await this.dynamoDBUtil.scanAll<ILogicCatalogVersion>({
        TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
        FilterExpression: "record_type = :rt AND logic_set_id = :sid",
        ExpressionAttributeValues: {
          ":rt": "logic_version",
          ":sid": id,
        },
      });

      const inUseVersion = versions.find(
        (v) => (v.campaigns_using ?? []).length > 0,
      );
      if (inUseVersion) {
        return {
          result: false,
          error: `Logic catalog set ${id} is in use by campaigns and cannot be deleted`,
        };
      }

      await Promise.all([
        this.dynamoDBUtil.delete({
          TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
          Key: { id },
        }),
        ...versions.map((v) =>
          this.dynamoDBUtil.delete({
            TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
            Key: { id: v.id },
          }),
        ),
      ]);

      const now = new Date().toISOString();
      await this.auditWriterService.writeAuditEvent({
        entity_id: id,
        entity_type: "logic_catalog",
        action: "logic_catalog_deleted",
        changes: [],
        actor,
        changed_at: now,
      });

      return { result: true };
    } catch (error: any) {
      this.logger.error("Failed to delete logic catalog set", error);
      return {
        result: false,
        error: error.message || "Failed to delete logic catalog set",
      };
    }
  }

  async deleteLogicCatalogVersion(
    logicSetId: string,
    version: number,
    actor?: RequestActor,
  ): Promise<ServiceResult<void>> {
    try {
      const versionId = `${logicSetId}#v${version}`;
      const record = await this.dynamoDBUtil.get<ILogicCatalogVersion>({
        TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
        Key: { id: versionId },
      });
      if (!record || record.record_type !== "logic_version") {
        return {
          result: false,
          error: `Logic catalog version ${versionId} not found`,
        };
      }

      if ((record.campaigns_using ?? []).length > 0) {
        return {
          result: false,
          error: `Logic catalog version ${versionId} is in use by campaigns and cannot be deleted`,
        };
      }

      await this.dynamoDBUtil.delete({
        TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
        Key: { id: versionId },
      });

      const now = new Date().toISOString();
      await this.auditWriterService.writeAuditEvent({
        entity_id: logicSetId,
        entity_type: "logic_catalog",
        action: "logic_catalog_version_deleted",
        changes: [{ field: "version", from: version, to: null }],
        actor,
        changed_at: now,
      });

      const remaining = await this.dynamoDBUtil.scanAll<ILogicCatalogVersion>({
        TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
        FilterExpression: "record_type = :rt AND logic_set_id = :sid",
        ExpressionAttributeValues: {
          ":rt": "logic_version",
          ":sid": logicSetId,
        },
      });

      if (remaining.length === 0) {
        await this.dynamoDBUtil.delete({
          TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
          Key: { id: logicSetId },
        });
      }

      return { result: true };
    } catch (error: any) {
      this.logger.error("Failed to delete logic catalog version", error);
      return {
        result: false,
        error: error.message || "Failed to delete logic catalog version",
      };
    }
  }

  async applyLogicCatalogToCampaign(
    campaignId: string,
    request: ApplyLogicCatalogRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<ICampaign>> {
    try {
      const { logic_set_id, version } = request;
      const versionId = `${logic_set_id}#v${version}`;
      const [campaign, catalogVersion] = await Promise.all([
        this.getCampaignById(campaignId),
        this.dynamoDBUtil.get<ILogicCatalogVersion>({
          TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
          Key: { id: versionId },
        }),
      ]);

      if (!campaign || campaign.is_deleted) {
        return { result: false, error: `Campaign ${campaignId} not found` };
      }
      if (!catalogVersion || catalogVersion.record_type !== "logic_version") {
        return {
          result: false,
          error: `Logic catalog version ${versionId} not found`,
        };
      }

      const now = new Date().toISOString();
      const changes: AuditChange[] = [
        {
          field: "logic_set_id",
          from: campaign.logic_set_id,
          to: logic_set_id,
        },
        {
          field: "logic_set_version",
          from: campaign.logic_set_version,
          to: version,
        },
      ];

      campaign.logic_rules = JSON.parse(JSON.stringify(catalogVersion.rules));
      campaign.logic_set_id = logic_set_id;
      campaign.logic_set_version = version;
      campaign.logic_version = String(version);
      campaign.updated_at = now;
      campaign.updated_by = actor;

      if (!catalogVersion.campaigns_using.includes(campaignId)) {
        catalogVersion.campaigns_using.push(campaignId);
      }

      const normalized = this.normalizeParticipants(campaign);
      Object.assign(campaign, normalized);

      await Promise.all([
        this.dynamoDBUtil.put({
          TableName: this.constants.CAMPAIGNS_TABLE_NAME,
          Item: campaign,
        }),
        this.dynamoDBUtil.put({
          TableName: this.constants.CRITERIA_CATALOG_TABLE_NAME,
          Item: catalogVersion,
        }),
      ]);

      await this.auditWriterService.writeAuditEvent({
        entity_id: campaignId,
        entity_type: "campaign",
        action: "logic_catalog_assigned",
        changes,
        actor,
        changed_at: now,
      });

      return { result: true, data: this.enrichCampaignForResponse(campaign) };
    } catch (error: any) {
      this.logger.error("Failed to apply logic catalog to campaign", error);
      return {
        result: false,
        error: error.message || "Failed to apply logic catalog to campaign",
      };
    }
  }

  private buildLogicCatalogRules(
    rules: Array<Pick<ILogicRule, "name" | "action" | "enabled" | "groups">>,
    actor: RequestActor | undefined,
    now: string,
  ): ILogicRule[] {
    return rules.map((rule) => ({
      id: IdGenerator.generate("LR"),
      name: rule.name.trim(),
      action: rule.action,
      enabled: rule.enabled ?? true,
      groups: (rule.groups ?? []).map((group) => ({
        id: IdGenerator.generate("LG"),
        conditions: (group.conditions ?? []).map((condition) => ({
          id: IdGenerator.generate("LC"),
          field_name: condition.field_name,
          operator: condition.operator,
          ...(condition.value !== undefined ? { value: condition.value } : {}),
        })),
      })),
      created_at: now,
      updated_at: now,
      created_by: actor,
      updated_by: actor,
    }));
  }
}
