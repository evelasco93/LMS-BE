import { injectable, inject } from "inversify";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { Logger } from "@shared/services/logger.util";
import { LambdaInvokeUtil } from "@shared/services/lambda-invoke.util";
import { validateAllowedFields } from "@shared/utils/payload-validation.util";
import { IdGenerator } from "@shared/generators/id.generator";
import { LeadsConstants } from "../constants/leads.constants";
import { CampaignParticipantStatus } from "../../campaigns/enums/campaign-participant-status.enum";
import {
  CreateLeadRequest,
  ListLeadsQuery,
  UpdateLeadRequest,
} from "../types/lead-request.types";
import { ServiceResult } from "../types/common.types";
import { ILead, IEditHistoryEntry } from "../interfaces/ILead.interface";
import { CampaignStatus } from "../enums/campaign-status.enum";
import { RequestActor } from "@shared/utils/request-audit.util";

interface CampaignAffiliate {
  affiliate_id: string;
  campaign_key: string;
  status?: CampaignParticipantStatus;
}

interface CampaignRecord {
  id: string;
  status: CampaignStatus;
  affiliates: CampaignAffiliate[];
  has_received_leads?: boolean;
  plugins?: {
    duplicate_check?: {
      enabled?: boolean;
      criteria?: string[];
    };
    trusted_form?: {
      enabled?: boolean;
      credentials_id?: string;
    };
  };
}

const DUPLICATE_REJECTION_REASON =
  "Lead rejected by campaign duplicate_check plugin";

interface QaOrchestratorResult {
  duplicate?: boolean;
  duplicate_matches?: {
    lead_ids?: string[];
  };
  trusted_form_result?: {
    success: boolean;
    cert_id: string;
    outcome?: string;
    error?: string;
    phone?: string;
    phone_match?: boolean;
    vendor?: string;
    previously_retained?: boolean;
    expires_at?: string;
  };
}

@injectable()
export class LeadsService {
  constructor(
    @inject("DynamoDBUtil") private readonly dynamoDBUtil: DynamoDBUtil,
    @inject("Logger") private readonly logger: Logger,
    @inject("LambdaInvokeUtil")
    private readonly lambdaInvokeUtil: LambdaInvokeUtil,
    @inject("LeadsConstants") private readonly constants: LeadsConstants,
  ) {}

  async createLead(
    request: CreateLeadRequest,
    isTest: boolean,
    actor?: RequestActor,
  ): Promise<ServiceResult<ILead>> {
    try {
      const { ok, extras, sanitized } = validateAllowedFields(
        request as Record<string, unknown>,
        ["campaign_id", "campaign_key", "payload"],
      );

      if (!ok) {
        return { result: false, error: `Invalid fields: ${extras.join(", ")}` };
      }

      const campaignId = sanitized.campaign_id as string;
      const campaignKey = sanitized.campaign_key as string;

      if (!campaignId || !campaignKey) {
        return {
          result: false,
          error: "campaign_id and campaign_key are required",
        };
      }

      const campaign = await this.getCampaign(campaignId);
      if (!campaign) {
        return { result: false, error: "Campaign not found" };
      }

      const affiliate = campaign.affiliates.find(
        (a) => a.campaign_key === campaignKey,
      );
      if (!affiliate) {
        return { result: false, error: "Invalid campaign_key for campaign" };
      }

      const affiliateStatus =
        affiliate.status ?? CampaignParticipantStatus.LIVE;

      const statusCheck =
        affiliateStatus === CampaignParticipantStatus.DISABLED
          ? null
          : this.validateStatus(campaign.status, isTest);

      if (statusCheck) {
        return { result: false, error: statusCheck };
      }

      if (
        affiliateStatus !== CampaignParticipantStatus.DISABLED &&
        isTest &&
        affiliateStatus !== CampaignParticipantStatus.TEST
      ) {
        return {
          result: false,
          error: "Affiliate is not set to TEST for this campaign",
        };
      }

      if (
        affiliateStatus !== CampaignParticipantStatus.DISABLED &&
        !isTest &&
        affiliateStatus !== CampaignParticipantStatus.LIVE
      ) {
        return {
          result: false,
          error: "Affiliate must be LIVE for live leads",
        };
      }

      const now = new Date().toISOString();
      const qaResult = await this.runQaPlugins(campaign, {
        campaign_id: campaignId,
        campaign_key: campaignKey,
        payload: sanitized.payload as Record<string, unknown> | undefined,
      });

      const duplicateMatchIds = Array.isArray(
        qaResult.duplicate_matches?.lead_ids,
      )
        ? qaResult.duplicate_matches?.lead_ids.filter(
            (leadId): leadId is string => typeof leadId === "string",
          )
        : [];

      const duplicateCheckEnabled =
        campaign.plugins?.duplicate_check?.enabled ?? true;
      const duplicateDetected = qaResult.duplicate === true;
      const rejectedByAffiliate =
        affiliateStatus === CampaignParticipantStatus.DISABLED;
      const rejectedByDuplicate = duplicateCheckEnabled && duplicateDetected;
      const rejected = rejectedByAffiliate || rejectedByDuplicate;

      const rejectionReason = rejectedByAffiliate
        ? "Lead received while affiliate is DISABLED for this campaign"
        : rejectedByDuplicate
          ? DUPLICATE_REJECTION_REASON
          : undefined;

      const lead: ILead = {
        id: IdGenerator.generateLeadId(),
        campaign_id: campaignId,
        campaign_key: campaignKey,
        test: isTest,
        payload: sanitized.payload as Record<string, unknown> | undefined,
        duplicate: duplicateDetected,
        duplicate_matches: {
          lead_ids: duplicateMatchIds,
        },
        ...(qaResult.trusted_form_result
          ? { trusted_form_result: qaResult.trusted_form_result }
          : {}),
        created_at: now,
        affiliate_status_at_intake: affiliateStatus,
        rejected,
        rejection_reason: rejectionReason,
        created_by: actor,
        updated_at: now,
        updated_by: actor,
        is_deleted: false,
        active: true,
      };

      await this.dynamoDBUtil.put({
        TableName: this.constants.LEADS_TABLE_NAME,
        Item: lead,
      });

      if (!campaign.has_received_leads) {
        await this.dynamoDBUtil.update({
          TableName: this.constants.CAMPAIGNS_TABLE_NAME,
          Key: { id: campaignId },
          UpdateExpression:
            "SET has_received_leads = :true, updated_at = if_not_exists(updated_at, :now)",
          ExpressionAttributeValues: {
            ":true": true,
            ":now": now,
          },
        });
      }

      this.logger.info("Lead stored", {
        leadId: lead.id,
        campaignId,
        test: isTest,
      });

      return { result: true, data: lead };
    } catch (error: any) {
      this.logger.error("Failed to create lead", error);
      return {
        result: false,
        error: error.message || "Failed to create lead",
      };
    }
  }

  async listLeads(query: ListLeadsQuery = {}): Promise<
    ServiceResult<{
      items: ILead[];
      count: number;
      lastEvaluatedKey?: string;
    }>
  > {
    try {
      const {
        campaign_id,
        test,
        limit = 20,
        lastEvaluatedKey,
        includeDeleted = false,
      } = query;

      const exclusiveStartKey = lastEvaluatedKey
        ? JSON.parse(Buffer.from(lastEvaluatedKey, "base64").toString())
        : undefined;

      const filters: string[] = [];
      const names: Record<string, string> = {};
      const values: Record<string, any> = {};

      if (!includeDeleted) {
        filters.push(
          "(attribute_not_exists(is_deleted) OR is_deleted = :is_deleted_false)",
        );
        values[":is_deleted_false"] = false;
      }

      if (campaign_id) {
        filters.push("#campaign_id = :campaign_id");
        names["#campaign_id"] = "campaign_id";
        values[":campaign_id"] = campaign_id;
      }

      if (typeof test === "boolean") {
        filters.push("#test = :test");
        names["#test"] = "test";
        values[":test"] = test;
      }

      const filterExpression = filters.length
        ? filters.join(" AND ")
        : undefined;

      const scanResult = await this.dynamoDBUtil.scan<ILead>({
        TableName: this.constants.LEADS_TABLE_NAME,
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
        ...(filterExpression
          ? {
              FilterExpression: filterExpression,
              ...(Object.keys(names).length > 0
                ? { ExpressionAttributeNames: names }
                : {}),
              ExpressionAttributeValues: values,
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
      this.logger.error("Failed to list leads", error);
      return {
        result: false,
        error: error.message || "Failed to list leads",
      };
    }
  }

  async getLead(id: string): Promise<ServiceResult<ILead>> {
    try {
      const lead = await this.dynamoDBUtil.get<ILead>({
        TableName: this.constants.LEADS_TABLE_NAME,
        Key: { id },
      });

      if (!lead) {
        return { result: false, error: `Lead ${id} not found` };
      }

      return { result: true, data: lead };
    } catch (error: any) {
      this.logger.error("Failed to get lead", error);
      return { result: false, error: error.message || "Failed to get lead" };
    }
  }

  async updateLead(
    id: string,
    request: UpdateLeadRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<ILead>> {
    try {
      const { ok, extras, sanitized } = validateAllowedFields(
        request as Record<string, unknown>,
        ["payload"],
      );

      if (!ok) {
        return { result: false, error: `Invalid fields: ${extras.join(", ")}` };
      }

      const existing = await this.dynamoDBUtil.get<ILead>({
        TableName: this.constants.LEADS_TABLE_NAME,
        Key: { id },
      });

      if (!existing) {
        return { result: false, error: `Lead ${id} not found` };
      }

      const now = new Date().toISOString();

      // Diff payload fields and append to edit_history
      const oldPayload = existing.payload ?? {};
      const newPayload = sanitized.payload
        ? (sanitized.payload as Record<string, unknown>)
        : oldPayload;
      const allKeys = new Set([
        ...Object.keys(oldPayload),
        ...Object.keys(newPayload),
      ]);
      const newHistoryEntries: IEditHistoryEntry[] = [];
      for (const key of allKeys) {
        const prev = oldPayload[key];
        const next = newPayload[key];
        if (JSON.stringify(prev ?? null) !== JSON.stringify(next ?? null)) {
          newHistoryEntries.push({
            field: `payload.${key}`,
            previous_value: prev ?? null,
            new_value: next ?? null,
            changed_at: now,
            changed_by: actor,
          });
        }
      }

      const updated: ILead = {
        ...existing,
        ...(sanitized.payload ? { payload: newPayload } : {}),
        edit_history: [...(existing.edit_history ?? []), ...newHistoryEntries],
        updated_at: now,
        updated_by: actor,
      };

      await this.dynamoDBUtil.put({
        TableName: this.constants.LEADS_TABLE_NAME,
        Item: updated,
      });

      return { result: true, data: updated };
    } catch (error: any) {
      this.logger.error("Failed to update lead", error);
      return {
        result: false,
        error: error.message || "Failed to update lead",
      };
    }
  }

  async deleteLead(
    id: string,
    options: { permanent?: boolean } = {},
    actor?: RequestActor,
  ): Promise<ServiceResult<void>> {
    try {
      const existing = await this.dynamoDBUtil.get<ILead>({
        TableName: this.constants.LEADS_TABLE_NAME,
        Key: { id },
      });

      if (!existing) {
        return { result: false, error: `Lead ${id} not found` };
      }

      if (options.permanent) {
        await this.dynamoDBUtil.delete({
          TableName: this.constants.LEADS_TABLE_NAME,
          Key: { id },
        });
        this.logger.info("Lead permanently deleted", { leadId: id, actor });
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
          TableName: this.constants.LEADS_TABLE_NAME,
          Key: { id },
          ...expression,
        });

        this.logger.info("Lead soft-deleted", { leadId: id, actor });
      }

      return { result: true };
    } catch (error: any) {
      this.logger.error("Failed to delete lead", error);
      return {
        result: false,
        error: error.message || "Failed to delete lead",
      };
    }
  }

  private validateStatus(
    status: CampaignStatus,
    isTest: boolean,
  ): string | null {
    if (isTest) {
      if (status === CampaignStatus.ACTIVE) {
        return "Campaign is live; send to /lead";
      }
      if (status === CampaignStatus.INACTIVE) {
        return "Campaign is inactive";
      }
      if (status === CampaignStatus.DRAFT) {
        return "Campaign is in draft; move to TEST before sending test leads";
      }
      return null;
    }

    if (status === CampaignStatus.TEST) {
      return "Campaign is in test mode; send to /lead/test";
    }
    if (status === CampaignStatus.INACTIVE) {
      return "Campaign is inactive";
    }
    if (status === CampaignStatus.DRAFT) {
      return "Campaign is in draft; move to TEST before live leads";
    }
    return null;
  }

  private async getCampaign(id: string): Promise<CampaignRecord | null> {
    const campaign = await this.dynamoDBUtil.get<CampaignRecord>({
      TableName: this.constants.CAMPAIGNS_TABLE_NAME,
      Key: { id },
    });

    return campaign ?? null;
  }

  private async runQaPlugins(
    campaign: CampaignRecord,
    request: CreateLeadRequest,
  ): Promise<QaOrchestratorResult> {
    if (!this.constants.QA_ORCHESTRATOR_LAMBDA_NAME) {
      return {
        duplicate: false,
        duplicate_matches: {
          lead_ids: [],
        },
      };
    }

    try {
      const leadPayload = request.payload ?? {};
      // Extract TrustedForm cert ID and phone from the lead payload.
      // Affiliates submit these as `trusted_form_cert_id` and `phone`.
      const certId =
        typeof leadPayload.trusted_form_cert_id === "string"
          ? leadPayload.trusted_form_cert_id
          : undefined;
      const phone =
        typeof leadPayload.phone === "string" ? leadPayload.phone : undefined;

      return await this.lambdaInvokeUtil.invokeJson<QaOrchestratorResult>({
        functionName: this.constants.QA_ORCHESTRATOR_LAMBDA_NAME,
        payload: {
          campaign_id: request.campaign_id,
          payload: leadPayload,
          plugins: campaign.plugins,
          ...(certId ? { cert_id: certId } : {}),
          ...(phone ? { phone } : {}),
        },
      });
    } catch (error) {
      this.logger.error("Failed to execute QA orchestrator", error);

      return {
        duplicate: false,
        duplicate_matches: {
          lead_ids: [],
        },
      };
    }
  }
}
