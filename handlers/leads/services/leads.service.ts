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
import {
  ILead,
  IEditHistoryEntry,
  IMappedFieldEntry,
} from "../interfaces/ILead.interface";
import { CampaignStatus } from "../enums/campaign-status.enum";
import { RequestActor } from "@shared/utils/request-audit.util";
import {
  REJECTION_DUPLICATE,
  REJECTION_AFFILIATE_DISABLED,
  REJECTION_CRITERIA_VALIDATION,
  REJECTION_LOGIC_RULES,
} from "@shared/constants/rejection-messages.constants";
import { resolveStateMappings } from "@shared/constants";

interface CampaignAffiliate {
  affiliate_id: string;
  campaign_key: string;
  status?: CampaignParticipantStatus;
}

interface BaseCriteriaField {
  id: string;
  field_name: string;
  required: boolean;
  value_mappings?: { from: string[]; to: string }[];
  state_mapping?: "abbr_to_name" | "name_to_abbr";
}

interface ValueMappingResult {
  payload: Record<string, unknown>;
  mappedFields: IMappedFieldEntry[];
  editHistory: IEditHistoryEntry[];
  editedFields: string[];
}

interface CampaignRecord {
  id: string;
  status: CampaignStatus;
  affiliates: CampaignAffiliate[];
  has_received_leads?: boolean;
  base_criteria?: BaseCriteriaField[];
  plugins?: {
    duplicate_check?: {
      enabled?: boolean;
      criteria?: string[];
    };
    trusted_form?: {
      enabled?: boolean;
      credentials_id?: string;
    };
    ipqs?: {
      enabled?: boolean;
    };
  };
}

interface CriteriaValidationResponse {
  valid: boolean;
  missing_fields?: string[];
  rejection_reason?: string;
}

interface LogicRulesResponse {
  passed: boolean;
  rejection_reason?: string;
  matched_rule_id?: string;
  matched_rule_name?: string;
}

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
  ipqs_result?: {
    success: boolean;
    phone?: {
      success: boolean;
      raw?: Record<string, unknown>;
      error?: string;
      criteria_results?: Record<string, boolean>;
    };
    email?: {
      success: boolean;
      raw?: Record<string, unknown>;
      error?: string;
      criteria_results?: Record<string, boolean>;
    };
    ip?: {
      success: boolean;
      raw?: Record<string, unknown>;
      error?: string;
      criteria_results?: Record<string, boolean>;
    };
    error?: string;
  };
  /** True when a gate plugin failed and halted the remaining pipeline stages */
  pipeline_halted?: boolean;
  /** Stage number where the pipeline was halted */
  halt_stage?: number;
  /** Name of the plugin that triggered the halt */
  halt_plugin?: string;
  /** Affiliate-readable rejection message from the halting plugin */
  halt_reason?: string;
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
      // Normalize: support both structured and flat external formats.
      //   Structured (internal/test):  { campaign_id, campaign_key, payload: { ...leadData } }
      //   Flat (external affiliate):   { campaign_id, campaign_key, first_name, phone, email, ... }
      // When payload is absent at the top level, every field other than
      // campaign_id / campaign_key is treated as lead payload data.
      const raw = request as Record<string, unknown>;
      const campaignId = raw.campaign_id as string;
      const campaignKey = raw.campaign_key as string;
      const leadPayload: Record<string, unknown> =
        raw.payload !== undefined &&
        raw.payload !== null &&
        typeof raw.payload === "object" &&
        !Array.isArray(raw.payload)
          ? (raw.payload as Record<string, unknown>)
          : (() => {
              const {
                campaign_id: _ci,
                campaign_key: _ck,
                payload: _p,
                ...rest
              } = raw;
              // Re-include campaign_id/campaign_key in the lead payload so
              // criteria validation can check them as required fields.
              return {
                ...rest,
                campaign_id: campaignId,
                campaign_key: campaignKey,
              };
            })();

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

      // ── Stage 0a: Apply value mappings so canonical values flow into all downstream checks ─
      const {
        payload: mappedPayload,
        mappedFields,
        editHistory: valueMapEditHistory,
        editedFields: valueMapEditedFields,
      } = this.applyValueMappings(campaign.base_criteria, leadPayload, now);

      // ── Stage 0: Criteria validation (required fields) — runs before duplicate check ─
      const criteriaValidationResult = await this.runCriteriaValidation(
        campaignId,
        mappedPayload,
      );
      const rejectedByCriteria = !criteriaValidationResult.valid;

      if (rejectedByCriteria) {
        // Early-reject: save the lead immediately with rejection details and return
        const rejectionReason =
          criteriaValidationResult.rejection_reason ??
          REJECTION_CRITERIA_VALIDATION;
        const lead: ILead = {
          id: IdGenerator.generateLeadId(),
          campaign_id: campaignId,
          campaign_key: campaignKey,
          test: isTest,
          payload: mappedPayload,
          ...(mappedFields.length > 0 ? { mapped_fields: mappedFields } : {}),
          ...(valueMapEditHistory.length > 0
            ? {
                edit_history: valueMapEditHistory,
                edited_fields: valueMapEditedFields,
              }
            : {}),
          duplicate: false,
          duplicate_matches: { lead_ids: [] },
          created_at: now,
          affiliate_status_at_intake: affiliateStatus,
          rejected: true,
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

        this.logger.info("Lead rejected by criteria validation", {
          leadId: lead.id,
          campaignId,
          missingFields: criteriaValidationResult.missing_fields,
        });

        return { result: true, data: lead };
      }

      // ── Stage 1: Logic rules evaluation (custom pass/fail rules) ─
      const logicRulesResult = await this.runLogicRules(
        campaignId,
        mappedPayload,
      );

      if (!logicRulesResult.passed) {
        const rejectionReason =
          logicRulesResult.rejection_reason ?? REJECTION_LOGIC_RULES;
        const lead: ILead = {
          id: IdGenerator.generateLeadId(),
          campaign_id: campaignId,
          campaign_key: campaignKey,
          test: isTest,
          payload: mappedPayload,
          ...(mappedFields.length > 0 ? { mapped_fields: mappedFields } : {}),
          ...(valueMapEditHistory.length > 0
            ? {
                edit_history: valueMapEditHistory,
                edited_fields: valueMapEditedFields,
              }
            : {}),
          duplicate: false,
          duplicate_matches: { lead_ids: [] },
          logic_rules_result: {
            passed: false,
            rejection_reason: rejectionReason,
            ...(logicRulesResult.matched_rule_id
              ? { matched_rule_id: logicRulesResult.matched_rule_id }
              : {}),
            ...(logicRulesResult.matched_rule_name
              ? { matched_rule_name: logicRulesResult.matched_rule_name }
              : {}),
          },
          created_at: now,
          affiliate_status_at_intake: affiliateStatus,
          rejected: true,
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

        this.logger.info("Lead rejected by logic rules", {
          leadId: lead.id,
          campaignId,
          matchedRuleId: logicRulesResult.matched_rule_id,
          matchedRuleName: logicRulesResult.matched_rule_name,
        });

        return { result: true, data: lead };
      }

      const qaResult = await this.runQaPlugins(campaign, {
        campaign_id: campaignId,
        campaign_key: campaignKey,
        payload: mappedPayload,
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

      // Plugin gate rejection: a configured plugin failed with gate=true.
      // duplicate_check halt is handled separately via rejectedByDuplicate.
      const pluginGateRejected =
        qaResult.pipeline_halted === true &&
        qaResult.halt_plugin !== "duplicate_check";

      const rejected =
        rejectedByAffiliate || rejectedByDuplicate || pluginGateRejected;

      const rejectionReasons: string[] = [];
      if (rejectedByAffiliate)
        rejectionReasons.push(REJECTION_AFFILIATE_DISABLED);
      if (rejectedByDuplicate) rejectionReasons.push(REJECTION_DUPLICATE);
      if (pluginGateRejected && qaResult.halt_reason)
        rejectionReasons.push(qaResult.halt_reason);

      const rejectionReason =
        rejectionReasons.length > 0 ? rejectionReasons.join("; ") : undefined;

      const lead: ILead = {
        id: IdGenerator.generateLeadId(),
        campaign_id: campaignId,
        campaign_key: campaignKey,
        test: isTest,
        payload: mappedPayload,
        ...(mappedFields.length > 0 ? { mapped_fields: mappedFields } : {}),
        ...(valueMapEditHistory.length > 0
          ? {
              edit_history: valueMapEditHistory,
              edited_fields: valueMapEditedFields,
            }
          : {}),
        duplicate: duplicateDetected,
        duplicate_matches: {
          lead_ids: duplicateMatchIds,
        },
        ...(qaResult.trusted_form_result
          ? { trusted_form_result: qaResult.trusted_form_result }
          : {}),
        ...(qaResult.ipqs_result ? { ipqs_result: qaResult.ipqs_result } : {}),
        ...(qaResult.pipeline_halted
          ? {
              pipeline_halted: true,
              halt_stage: qaResult.halt_stage,
              halt_plugin: qaResult.halt_plugin,
              halt_reason: qaResult.halt_reason,
            }
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
        ...(newHistoryEntries.length > 0
          ? {
              edited_fields: Array.from(
                new Set([
                  ...(existing.edited_fields ?? []),
                  ...newHistoryEntries.map((e) =>
                    e.field.replace(/^payload\./, ""),
                  ),
                ]),
              ),
            }
          : {}),
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

  /**
   * Applies `value_mappings` and `state_mapping` presets from the campaign's
   * base_criteria to the incoming lead payload.  Returns the (possibly mutated)
   * payload plus audit records for every field that was changed.
   *
   * Custom `value_mappings` are evaluated first; the `state_mapping` preset
   * runs second if the custom mappings didn't already fire for that field.
   * Matching is case-insensitive.
   */
  private applyValueMappings(
    baseCriteria: BaseCriteriaField[] | undefined,
    payload: Record<string, unknown>,
    now: string,
  ): ValueMappingResult {
    if (!baseCriteria?.length) {
      return { payload, mappedFields: [], editHistory: [], editedFields: [] };
    }

    const SYSTEM_ACTOR: RequestActor = {
      username: "system:value_mapper",
      full_name: "Value Mapper",
    };

    const mappedPayload = { ...payload };
    const mappedFields: IMappedFieldEntry[] = [];
    const editHistory: IEditHistoryEntry[] = [];
    const editedFields: string[] = [];

    for (const field of baseCriteria) {
      const rawValue = mappedPayload[field.field_name];
      if (typeof rawValue !== "string") continue;

      // Custom value_mappings first, then state preset
      const stateMappings = resolveStateMappings(field.state_mapping);
      const allMappings = [...(field.value_mappings ?? []), ...stateMappings];
      if (!allMappings.length) continue;

      const normalized = rawValue.toLowerCase();
      let mappedTo: string | undefined;
      for (const mapping of allMappings) {
        if (mapping.from.some((f) => f.toLowerCase() === normalized)) {
          mappedTo = mapping.to;
          break;
        }
      }

      if (mappedTo === undefined || mappedTo === rawValue) continue;

      mappedPayload[field.field_name] = mappedTo;
      mappedFields.push({
        field: field.field_name,
        original_value: rawValue,
        mapped_value: mappedTo,
        mapped_at: now,
      });
      editHistory.push({
        field: `payload.${field.field_name}`,
        previous_value: rawValue,
        new_value: mappedTo,
        changed_at: now,
        changed_by: SYSTEM_ACTOR,
      });
      editedFields.push(field.field_name);
    }

    return { payload: mappedPayload, mappedFields, editHistory, editedFields };
  }

  private validateStatus(
    status: CampaignStatus,
    isTest: boolean,
  ): string | null {
    const baseUrl = this.constants.EXTERNAL_LEADS_API_URL;
    const liveUrl = baseUrl || "/leads";
    const testUrl = baseUrl ? `${baseUrl}/test` : "/leads/test";

    if (isTest) {
      if (status === CampaignStatus.ACTIVE) {
        return `Campaign is live; send to ${liveUrl}`;
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
      return `Campaign is in test mode; send to ${testUrl}`;
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

  private async runLogicRules(
    campaignId: string,
    payload: Record<string, unknown>,
  ): Promise<LogicRulesResponse> {
    if (!this.constants.LOGIC_RULES_LAMBDA_NAME) {
      return { passed: true };
    }

    try {
      return await this.lambdaInvokeUtil.invokeJson<LogicRulesResponse>({
        functionName: this.constants.LOGIC_RULES_LAMBDA_NAME,
        payload: { campaign_id: campaignId, payload },
      });
    } catch (error) {
      this.logger.error(
        "Failed to execute logic rules evaluation — allowing lead through",
        error,
      );
      // Fail open: if the lambda errors we don't want to silently drop leads.
      return { passed: true };
    }
  }

  private async runCriteriaValidation(
    campaignId: string,
    payload: Record<string, unknown>,
  ): Promise<CriteriaValidationResponse> {
    if (!this.constants.CRITERIA_VALIDATION_LAMBDA_NAME) {
      return { valid: true };
    }

    try {
      return await this.lambdaInvokeUtil.invokeJson<CriteriaValidationResponse>(
        {
          functionName: this.constants.CRITERIA_VALIDATION_LAMBDA_NAME,
          payload: { campaign_id: campaignId, payload },
        },
      );
    } catch (error) {
      this.logger.error(
        "Failed to execute criteria validation — allowing lead through",
        error,
      );
      // Fail open: if the validation lambda errors we don't want to silently
      // drop leads; the issue should be investigated via logs.
      return { valid: true };
    }
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
      const email =
        typeof leadPayload.email === "string" ? leadPayload.email : undefined;
      const ipAddress =
        typeof leadPayload.ip_address === "string"
          ? leadPayload.ip_address
          : undefined;

      return await this.lambdaInvokeUtil.invokeJson<QaOrchestratorResult>({
        functionName: this.constants.QA_ORCHESTRATOR_LAMBDA_NAME,
        payload: {
          campaign_id: request.campaign_id,
          payload: leadPayload,
          plugins: campaign.plugins,
          ...(certId ? { cert_id: certId } : {}),
          ...(phone ? { phone } : {}),
          ...(email ? { email } : {}),
          ...(ipAddress ? { ip_address: ipAddress } : {}),
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
