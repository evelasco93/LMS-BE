import { injectable, inject } from "inversify";
import {
  APIGatewayClient,
  GetRestApisCommand,
} from "@aws-sdk/client-api-gateway";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { Logger } from "@shared/services/logger.util";
import { LambdaInvokeUtil } from "@shared/services/lambda-invoke.util";
import { AuditWriterService } from "@shared/services";
import { AuditChange } from "@shared/interfaces";
import { validateAllowedFields } from "@shared/utils/payload-validation.util";
import { IdGenerator } from "@shared/generators/id.generator";
import { LeadsConstants } from "../constants/leads.constants";
import { LeadDeliveryService } from "./lead-delivery.service";
import {
  CreateLeadRequest,
  ListLeadsQuery,
  UpdateLeadRequest,
  ListIntakeLogsQuery,
} from "../types/lead-request.types";
import { LeadIntakeResponse, ServiceResult } from "../types/common.types";
import { ILead, IMappedFieldEntry } from "../interfaces/ILead.interface";
import {
  ILeadIntakeLog,
  LeadIntakeStatus,
} from "../interfaces/ILeadIntakeLog.interface";
import {
  BaseCriteriaField,
  CriteriaValidationResponse,
  LogicRulesResponse,
  QaOrchestratorResult,
  ValueMappingResult,
} from "../interfaces/leads-internal.interface";
import { ICampaign } from "../../campaigns/interfaces/ICampaign.interface";
import { CampaignStatus } from "../enums/campaign-status.enum";
import { CampaignParticipantStatus } from "../../campaigns/enums/campaign-participant-status.enum";
import {
  RequestActor,
  IEditHistoryEntry,
} from "@shared/utils/request-audit.util";
import {
  REJECTION_DUPLICATE,
  REJECTION_AFFILIATE_DISABLED,
  REJECTION_CRITERIA_VALIDATION,
  REJECTION_LOGIC_RULES,
  LEAD_ACCEPTED_MESSAGE,
  LEAD_ACCEPTED_TEST_MESSAGE,
} from "@shared/constants/rejection-messages.constants";
import { resolveStateMappings } from "@shared/constants";

@injectable()
export class LeadsService {
  private externalLeadsBaseUrlCache?: string;

  constructor(
    @inject("DynamoDBUtil") private readonly dynamoDBUtil: DynamoDBUtil,
    @inject("Logger") private readonly logger: Logger,
    @inject("LambdaInvokeUtil")
    private readonly lambdaInvokeUtil: LambdaInvokeUtil,
    @inject("LeadsConstants") private readonly constants: LeadsConstants,
    @inject("AuditWriterService")
    private readonly auditWriterService: AuditWriterService,
    @inject("LeadDeliveryService")
    private readonly leadDeliveryService: LeadDeliveryService,
  ) {}

  async createLead(
    request: CreateLeadRequest,
    isTest: boolean,
    actor?: RequestActor,
    rawHeaders?: Record<string, string | string[] | undefined>,
  ): Promise<LeadIntakeResponse> {
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
          result: "failed",
          message: isTest ? "Test lead rejected" : "Lead rejected",
          error: "campaign_id and campaign_key are required",
        };
      }

      const normalizedLeadPayload: Record<string, unknown> = Object.fromEntries(
        Object.entries(leadPayload).map(([k, v]) => [k.toLowerCase(), v]),
      );

      // ── Capture original_source (immutable after this point) ──────────────
      // Read the raw `source` field (or an already-named `original_source` field)
      // from the incoming payload before any transformations.
      const originalSource =
        (normalizedLeadPayload.source as string | undefined) ??
        (normalizedLeadPayload.original_source as string | undefined);

      // ── Normalize order_number → always an integer >= 1 ───────────────────
      const rawOrderNumber = normalizedLeadPayload.order_number;
      const parsedOrderNumber =
        typeof rawOrderNumber === "number"
          ? rawOrderNumber
          : typeof rawOrderNumber === "string" && rawOrderNumber.trim() !== ""
            ? parseInt(rawOrderNumber, 10)
            : null;
      const orderNumberWasNormalized =
        parsedOrderNumber === null ||
        parsedOrderNumber < 1 ||
        !Number.isFinite(parsedOrderNumber);
      const orderNumber = orderNumberWasNormalized ? 1 : parsedOrderNumber!;

      const campaign = await this.getCampaign(campaignId);
      if (!campaign) {
        return {
          result: "failed",
          message: isTest ? "Test lead rejected" : "Lead rejected",
          error: "Campaign not found",
        };
      }

      const affiliate = campaign.affiliates.find(
        (a) => a.campaign_key === campaignKey,
      );
      if (!affiliate) {
        return {
          result: "failed",
          message: isTest ? "Test lead rejected" : "Lead rejected",
          error: "Invalid campaign_key for campaign",
        };
      }

      const affiliateStatus =
        affiliate.status ?? CampaignParticipantStatus.LIVE;

      // Affiliate-driven status gate.
      // A TEST affiliate's per-campaign role takes precedence over the campaign-level
      // status check: they may send test leads to ACTIVE campaigns (e.g. one of many
      // affiliates on a live campaign is still in QA/test mode).
      if (affiliateStatus !== CampaignParticipantStatus.DISABLED) {
        if (affiliateStatus === CampaignParticipantStatus.TEST) {
          // TEST affiliate: test endpoint only; DRAFT and INACTIVE campaigns are blocked.
          if (!isTest) {
            const baseUrl = await this.resolveExternalLeadsBaseUrl();
            const testUrl = baseUrl ? `${baseUrl}/test` : "/leads/test";
            return {
              result: "failed",
              message: "Lead rejected",
              error: `This campaign is in test mode. Please send your lead to: ${testUrl}`,
            };
          }
          if (campaign.status === CampaignStatus.INACTIVE) {
            return {
              result: "failed",
              message: "Test lead rejected",
              error: "Campaign is inactive",
            };
          }
          if (campaign.status === CampaignStatus.DRAFT) {
            return {
              result: "failed",
              message: "Test lead rejected",
              error:
                "Campaign is in draft; move to TEST before sending test leads",
            };
          }
          // ACTIVE or TEST campaign → TEST affiliate is allowed on the test endpoint
        } else {
          // LIVE affiliate: live endpoint only; full campaign-status validation applies.
          if (isTest) {
            const baseUrl = await this.resolveExternalLeadsBaseUrl();
            const liveUrl = baseUrl || "/leads";
            return {
              result: "failed",
              message: "Test lead rejected",
              error: `This campaign is live. Please send your lead to: ${liveUrl}`,
            };
          }
          const statusCheck = await this.validateStatus(campaign.status, false);
          if (statusCheck) {
            return {
              result: "failed",
              message: "Lead rejected",
              error: statusCheck,
            };
          }
        }
      }

      const now = new Date().toISOString();

      // ── Affiliate lead cap check (live leads only) ────────────────────────
      // Cap is tracked per-affiliate per-campaign on the campaign record.
      // Test submissions skip the cap so QA traffic is never blocked.
      if (!isTest && affiliate.lead_cap != null) {
        const sent = affiliate.leads_sent ?? 0;
        if (sent >= affiliate.lead_cap) {
          return {
            result: "failed",
            message: "Lead rejected",
            error: `Affiliate lead cap of ${affiliate.lead_cap} reached for this campaign`,
          };
        }
      }

      // ── Stage 0a: Apply value mappings so canonical values flow into all downstream checks ─
      const {
        payload: mappedPayload,
        mappedFields,
        editHistory: valueMapEditHistory,
        editedFields: valueMapEditedFields,
      } = this.applyValueMappings(
        campaign.base_criteria,
        normalizedLeadPayload,
        now,
      );

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
        const criteriaRejectionErrors = (
          criteriaValidationResult.missing_fields ?? []
        ).map((field) => `${field.replace(/_/g, " ")} is required`);
        const lead: ILead = {
          id: IdGenerator.generateLeadId(),
          campaign_id: campaignId,
          campaign_key: campaignKey,
          test: isTest,
          ...(originalSource !== undefined
            ? { original_source: originalSource }
            : {}),
          order_number: orderNumber,
          payload: mappedPayload,
          ...(mappedFields.length > 0 ? { mapped_fields: mappedFields } : {}),
          duplicate: false,
          duplicate_matches: { lead_ids: [] },
          created_at: now,
          affiliate_status_at_intake: affiliateStatus,
          rejected: true,
          rejection_reason: rejectionReason,
          ...(criteriaRejectionErrors.length > 0
            ? { rejection_errors: criteriaRejectionErrors }
            : {}),
          created_by: actor,
          updated_at: now,
          updated_by: actor,
          is_deleted: false,
          active: false,
        };

        await this.dynamoDBUtil.put({
          TableName: this.constants.LEADS_TABLE_NAME,
          Item: lead,
        });

        await this.writeLeadIntakeAuditEvents(
          lead.id,
          originalSource,
          rawOrderNumber,
          orderNumberWasNormalized,
          orderNumber,
          now,
        );

        if (mappedFields.length > 0) {
          await this.auditWriterService.writeAuditEvent({
            entity_id: lead.id,
            entity_type: "lead",
            action: "value_mapped",
            changes: mappedFields.map((f) => ({
              field: `payload.${f.field}`,
              from: f.original_value,
              to: f.mapped_value,
            })),
            actor: {
              username: "system:value_mapper",
              full_name: "Value Mapper",
            },
            changed_at: now,
          });
        }

        this.logger.info("Lead rejected by criteria validation", {
          leadId: lead.id,
          campaignId,
          missingFields: criteriaValidationResult.missing_fields,
        });

        const criteriaResponse: LeadIntakeResponse = {
          result: "failed",
          lead_id: lead.id,
          message: "Lead Rejected",
          ...(criteriaRejectionErrors.length > 0
            ? { errors: criteriaRejectionErrors }
            : {}),
        };

        this.writeIntakeLog(
          lead,
          isTest,
          raw as Record<string, unknown>,
          rawHeaders,
          normalizedLeadPayload,
          criteriaResponse,
        ).catch((err) => this.logger.error("Failed to write intake log", err));

        return criteriaResponse;
      }

      // ── Stage 1: Logic rules evaluation (custom pass/fail rules) ─
      // NOTE: Logic rules are evaluated against the *original* pre-mapping payload
      // because users configure rule conditions based on the raw values they send
      // (e.g. "State is California", not "State is CA"). Value mappings are an
      // internal normalization step and should not affect how user-defined rules match.
      // Keys are still normalized to lowercase for consistent field lookup.
      const logicRulesResult = await this.runLogicRules(
        campaignId,
        normalizedLeadPayload,
      );

      if (!logicRulesResult.passed) {
        const rejectionReason =
          logicRulesResult.rejection_reason ?? REJECTION_LOGIC_RULES;
        const logicRejectionErrors = (
          logicRulesResult.condition_failures ?? []
        ).map((f) => {
          const fieldLabel = f.field.replace(/_/g, " ");
          const expected = Array.isArray(f.expected)
            ? f.expected.join(" or ")
            : f.expected;
          switch (f.operator) {
            case "is":
              return `${fieldLabel} must equal ${expected}`;
            case "is_not":
              return `${fieldLabel} must not equal ${expected}`;
            case "contains":
              return `${fieldLabel} does not match options`;
            case "does_not_contain":
              return `${fieldLabel} contains a disallowed value`;
            case "starts_with":
              return `${fieldLabel} must start with ${expected}`;
            case "does_not_start_with":
              return `${fieldLabel} must not start with ${expected}`;
            case "ends_with":
              return `${fieldLabel} must end with ${expected}`;
            case "does_not_end_with":
              return `${fieldLabel} must not end with ${expected}`;
            case "greater_than":
              return `${fieldLabel} must be greater than ${expected}`;
            case "less_than":
              return `${fieldLabel} must be less than ${expected}`;
            default:
              return `${fieldLabel} does not meet requirements`;
          }
        });

        const logicRejectLead: ILead = {
          id: IdGenerator.generateLeadId(),
          campaign_id: campaignId,
          campaign_key: campaignKey,
          test: isTest,
          ...(originalSource !== undefined
            ? { original_source: originalSource }
            : {}),
          order_number: orderNumber,
          payload: mappedPayload,
          ...(mappedFields.length > 0 ? { mapped_fields: mappedFields } : {}),
          duplicate: false,
          duplicate_matches: { lead_ids: [] },
          created_at: now,
          affiliate_status_at_intake: affiliateStatus,
          rejected: true,
          rejection_reason: rejectionReason,
          ...(logicRejectionErrors.length > 0
            ? { rejection_errors: logicRejectionErrors }
            : {}),
          logic_rules_result: {
            passed: false,
            rejection_reason: rejectionReason,
            matched_rule_id: logicRulesResult.matched_rule_id,
            matched_rule_name: logicRulesResult.matched_rule_name,
          },
          created_by: actor,
          updated_at: now,
          updated_by: actor,
          is_deleted: false,
          active: false,
        };

        await this.dynamoDBUtil.put({
          TableName: this.constants.LEADS_TABLE_NAME,
          Item: logicRejectLead,
        });

        await this.writeLeadIntakeAuditEvents(
          logicRejectLead.id,
          originalSource,
          rawOrderNumber,
          orderNumberWasNormalized,
          orderNumber,
          now,
        );

        if (mappedFields.length > 0) {
          await this.auditWriterService.writeAuditEvent({
            entity_id: logicRejectLead.id,
            entity_type: "lead",
            action: "value_mapped",
            changes: mappedFields.map((f) => ({
              field: `payload.${f.field}`,
              from: f.original_value,
              to: f.mapped_value,
            })),
            actor: {
              username: "system:value_mapper",
              full_name: "Value Mapper",
            },
            changed_at: now,
          });
        }

        this.logger.info("Lead rejected by logic rules", {
          leadId: logicRejectLead.id,
          campaignId,
          matchedRuleId: logicRulesResult.matched_rule_id,
          matchedRuleName: logicRulesResult.matched_rule_name,
          errorCount: logicRejectionErrors.length,
        });

        const logicRejectResponse: LeadIntakeResponse = {
          result: "failed",
          lead_id: logicRejectLead.id,
          message: "Lead Rejected",
          errors:
            logicRejectionErrors.length > 0
              ? logicRejectionErrors
              : [rejectionReason],
        };

        this.writeIntakeLog(
          logicRejectLead,
          isTest,
          raw as Record<string, unknown>,
          rawHeaders,
          normalizedLeadPayload,
          logicRejectResponse,
        ).catch((err) => this.logger.error("Failed to write intake log", err));

        return logicRejectResponse;
      }

      const qaResult = await this.runQaPlugins(campaign, {
        campaign_id: campaignId,
        campaign_key: campaignKey,
        payload: mappedPayload,
        test: isTest,
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
        ...(originalSource !== undefined
          ? { original_source: originalSource }
          : {}),
        order_number: orderNumber,
        payload: mappedPayload,
        ...(mappedFields.length > 0 ? { mapped_fields: mappedFields } : {}),
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

      await this.writeLeadIntakeAuditEvents(
        lead.id,
        originalSource,
        rawOrderNumber,
        orderNumberWasNormalized,
        orderNumber,
        now,
      );

      if (mappedFields.length > 0) {
        await this.auditWriterService.writeAuditEvent({
          entity_id: lead.id,
          entity_type: "lead",
          action: "value_mapped",
          changes: mappedFields.map((f) => ({
            field: `payload.${f.field}`,
            from: f.original_value,
            to: f.mapped_value,
          })),
          actor: { username: "system:value_mapper", full_name: "Value Mapper" },
          changed_at: now,
        });
      }

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

      // ── Increment affiliate leads_sent (live, accepted leads only) ─────────
      // Uses DynamoDB UpdateItem against the affiliate's entry in the campaign
      // record.  The affiliate's position in the list is resolved by index so
      // the expression can use a numeric path like affiliates[2].leads_sent.
      if (!isTest && !rejected) {
        const affiliateIndex = (campaign.affiliates ?? []).findIndex(
          (a) => a.campaign_key === campaignKey,
        );
        if (affiliateIndex >= 0) {
          await this.dynamoDBUtil
            .update({
              TableName: this.constants.CAMPAIGNS_TABLE_NAME,
              Key: { id: campaignId },
              UpdateExpression: `ADD affiliates[${affiliateIndex}].leads_sent :one SET updated_at = :now`,
              ExpressionAttributeValues: {
                ":one": 1,
                ":now": now,
              },
            })
            .catch((err: any) =>
              this.logger.error("Failed to increment affiliate leads_sent", {
                campaignId,
                affiliateIndex,
                error: err?.message,
              }),
            );
        }
      }

      // ── Synchronous webhook delivery (live, accepted leads only) ──────────
      if (!isTest && !rejected) {
        await this.leadDeliveryService
          .deliverLead(lead, campaign, isTest)
          .catch((err: any) =>
            this.logger.error("Lead delivery error (non-fatal)", {
              leadId: lead.id,
              error: err?.message,
            }),
          );
      }

      const leadResponse: LeadIntakeResponse = lead.rejected
        ? {
            result: "failed",
            lead_id: lead.id,
            message: "Lead Rejected",
            ...(lead.rejection_errors && lead.rejection_errors.length > 0
              ? { errors: lead.rejection_errors }
              : lead.rejection_reason
                ? { errors: [lead.rejection_reason] }
                : {}),
          }
        : {
            result: "passed",
            message: isTest ? "Test lead accepted" : "Lead accepted",
            data: {
              lead_id: lead.id,
              message: isTest
                ? LEAD_ACCEPTED_TEST_MESSAGE
                : LEAD_ACCEPTED_MESSAGE,
            },
          };

      this.writeIntakeLog(
        lead,
        isTest,
        raw as Record<string, unknown>,
        rawHeaders,
        normalizedLeadPayload,
        leadResponse,
      ).catch((err) => this.logger.error("Failed to write intake log", err));

      return leadResponse;
    } catch (error: any) {
      this.logger.error("Failed to create lead", error);
      return {
        result: "failed",
        message: isTest ? "Test lead rejected" : "Lead rejected",
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
          items: scanResult.items.map((lead) =>
            this.enrichLeadForResponse(lead),
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

      return { result: true, data: this.enrichLeadForResponse(lead) };
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

      // Diff payload fields for audit
      const oldPayload = existing.payload ?? {};
      const hasIncomingPayload = sanitized.payload !== undefined;
      if (
        hasIncomingPayload &&
        (sanitized.payload === null ||
          typeof sanitized.payload !== "object" ||
          Array.isArray(sanitized.payload))
      ) {
        return { result: false, error: "payload must be an object" };
      }
      const incomingPayload = hasIncomingPayload
        ? (sanitized.payload as Record<string, unknown>)
        : undefined;
      const newPayload = incomingPayload
        ? { ...oldPayload, ...incomingPayload }
        : oldPayload;
      const changedKeys = incomingPayload ? Object.keys(incomingPayload) : [];
      // Type-tolerant equality: treats number/string coercion as equal (e.g. 42 === "42")
      // to avoid spurious audit entries when the frontend normalises numeric fields to strings.
      const auditValuesEqual = (a: unknown, b: unknown): boolean => {
        const p = a ?? null;
        const n = b ?? null;
        if (JSON.stringify(p) === JSON.stringify(n)) return true;
        if (
          p !== null &&
          n !== null &&
          (typeof p === "number" || typeof p === "string") &&
          (typeof n === "number" || typeof n === "string") &&
          String(p) === String(n)
        ) {
          return true;
        }
        return false;
      };
      const changes: AuditChange[] = [];
      for (const key of changedKeys) {
        const prev = oldPayload[key];
        const next = newPayload[key];
        if (!auditValuesEqual(prev, next)) {
          changes.push({
            field: `payload.${key}`,
            from: prev ?? null,
            to: next ?? null,
          });
        }
      }

      const updated: ILead = {
        ...existing,
        ...(hasIncomingPayload ? { payload: newPayload } : {}),
        updated_at: now,
        updated_by: actor,
      };

      await this.dynamoDBUtil.put({
        TableName: this.constants.LEADS_TABLE_NAME,
        Item: updated,
      });

      await this.auditWriterService.writeAuditEvent({
        entity_id: id,
        entity_type: "lead",
        action: "updated",
        changes,
        actor,
        changed_at: now,
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

  private async writeIntakeLog(
    lead: ILead,
    isTest: boolean,
    rawBody: Record<string, unknown>,
    rawHeaders: Record<string, string | string[] | undefined> | undefined,
    normalizedPayload: Record<string, unknown>,
    responseBody: LeadIntakeResponse,
  ): Promise<void> {
    if (!this.constants.LEAD_INTAKE_LOGS_TABLE_NAME) return;

    const status: LeadIntakeStatus = isTest
      ? "test"
      : lead.rejected
        ? "rejected"
        : "accepted";

    const s = (key: string) =>
      typeof normalizedPayload[key] === "string"
        ? (normalizedPayload[key] as string)
        : undefined;

    const log: ILeadIntakeLog = {
      id: lead.id,
      campaign_id: lead.campaign_id,
      campaign_key: lead.campaign_key,
      received_at: lead.created_at,
      status,
      method: "POST",
      is_test: isTest,
      ...(s("marketing_source")
        ? { marketing_source: s("marketing_source") }
        : {}),
      ...(s("pub_id") ? { pub_id: s("pub_id") } : {}),
      ...(s("first_name") ? { first_name: s("first_name") } : {}),
      ...(s("last_name") ? { last_name: s("last_name") } : {}),
      ...(s("email") ? { email: s("email") } : {}),
      ...(s("phone") ? { phone: s("phone") } : {}),
      ...(s("trusted_form_cert_id")
        ? { trusted_form_cert: s("trusted_form_cert_id") }
        : {}),
      raw_body: rawBody,
      ...(rawHeaders ? { raw_headers: rawHeaders } : {}),
      response_status_code: 200,
      response_body: responseBody as unknown as Record<string, unknown>,
      ...(lead.sold !== undefined ? { sold: lead.sold } : {}),
      sold_status: this.resolveSoldStatus(lead),
      ...(lead.sold_to_client_id
        ? { sold_to_client_id: lead.sold_to_client_id }
        : {}),
      ...(lead.delivery_result
        ? { delivery_result: lead.delivery_result }
        : {}),
      ...(lead.rejection_reason
        ? { rejection_reason: lead.rejection_reason }
        : {}),
      ...(lead.rejection_errors
        ? { rejection_errors: lead.rejection_errors }
        : {}),
    };

    await this.dynamoDBUtil.put({
      TableName: this.constants.LEAD_INTAKE_LOGS_TABLE_NAME,
      Item: log,
    });
  }

  async listIntakeLogs(query: ListIntakeLogsQuery = {}): Promise<
    ServiceResult<{
      items: ILeadIntakeLog[];
      count: number;
      lastEvaluatedKey?: string;
    }>
  > {
    try {
      if (!this.constants.LEAD_INTAKE_LOGS_TABLE_NAME) {
        return { result: false, error: "Intake logs table not configured" };
      }

      const {
        campaign_id,
        status,
        from_date,
        to_date,
        limit = 50,
        lastEvaluatedKey,
      } = query;

      const exclusiveStartKey = lastEvaluatedKey
        ? JSON.parse(Buffer.from(lastEvaluatedKey, "base64").toString())
        : undefined;

      const tableName = this.constants.LEAD_INTAKE_LOGS_TABLE_NAME;

      if (campaign_id) {
        // Query the GSI for efficient campaign-scoped lookup
        const indexName = `${tableName}-campaign-received-at-index`;
        const keyConditions: string[] = ["#campaign_id = :campaign_id"];
        const names: Record<string, string> = {
          "#campaign_id": "campaign_id",
        };
        const values: Record<string, unknown> = {
          ":campaign_id": campaign_id,
        };

        if (from_date && to_date) {
          keyConditions.push("#received_at BETWEEN :from_date AND :to_date");
          names["#received_at"] = "received_at";
          values[":from_date"] = from_date;
          values[":to_date"] = to_date;
        } else if (from_date) {
          keyConditions.push("#received_at >= :from_date");
          names["#received_at"] = "received_at";
          values[":from_date"] = from_date;
        } else if (to_date) {
          keyConditions.push("#received_at <= :to_date");
          names["#received_at"] = "received_at";
          values[":to_date"] = to_date;
        }

        const filterParts: string[] = [];
        if (status) {
          filterParts.push("#status = :status");
          names["#status"] = "status";
          values[":status"] = status;
        }

        const queryResult = await this.dynamoDBUtil.query<ILeadIntakeLog>({
          TableName: tableName,
          IndexName: indexName,
          KeyConditionExpression: keyConditions.join(" AND "),
          ExpressionAttributeNames: names,
          ExpressionAttributeValues: values,
          ...(filterParts.length
            ? { FilterExpression: filterParts.join(" AND ") }
            : {}),
          Limit: limit,
          ScanIndexForward: false,
          ExclusiveStartKey: exclusiveStartKey,
        });

        const encodedKey = queryResult.lastEvaluatedKey
          ? Buffer.from(JSON.stringify(queryResult.lastEvaluatedKey)).toString(
              "base64",
            )
          : undefined;

        return {
          result: true,
          data: {
            items: queryResult.items,
            count: queryResult.items.length,
            lastEvaluatedKey: encodedKey,
          },
        };
      }

      // No campaign_id — fall back to scan with optional filters
      const filters: string[] = [];
      const names: Record<string, string> = {};
      const values: Record<string, unknown> = {};

      if (status) {
        filters.push("#status = :status");
        names["#status"] = "status";
        values[":status"] = status;
      }
      if (from_date) {
        filters.push("#received_at >= :from_date");
        names["#received_at"] = "received_at";
        values[":from_date"] = from_date;
      }
      if (to_date) {
        filters.push("#received_at <= :to_date");
        names["#received_at"] = "received_at";
        values[":to_date"] = to_date;
      }

      const scanResult = await this.dynamoDBUtil.scan<ILeadIntakeLog>({
        TableName: tableName,
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
        ...(filters.length
          ? {
              FilterExpression: filters.join(" AND "),
              ...(Object.keys(names).length > 0
                ? { ExpressionAttributeNames: names }
                : {}),
              ExpressionAttributeValues: values,
            }
          : {}),
      });

      const encodedKey = scanResult.lastEvaluatedKey
        ? Buffer.from(JSON.stringify(scanResult.lastEvaluatedKey)).toString(
            "base64",
          )
        : undefined;

      return {
        result: true,
        data: {
          items: scanResult.items,
          count: scanResult.items.length,
          lastEvaluatedKey: encodedKey,
        },
      };
    } catch (error: any) {
      this.logger.error("Failed to list intake logs", error);
      return {
        result: false,
        error: error.message || "Failed to list intake logs",
      };
    }
  }

  private async validateStatus(
    status: CampaignStatus,
    isTest: boolean,
  ): Promise<string | null> {
    const baseUrl = await this.resolveExternalLeadsBaseUrl();
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

  private async resolveExternalLeadsBaseUrl(): Promise<string> {
    if (this.constants.EXTERNAL_LEADS_API_URL) {
      return this.constants.EXTERNAL_LEADS_API_URL.replace(/\/+$/, "");
    }

    if (this.externalLeadsBaseUrlCache) {
      return this.externalLeadsBaseUrlCache;
    }

    const apiName = this.constants.EXTERNAL_LEADS_API_NAME;
    const stage = this.constants.EXTERNAL_LEADS_API_STAGE;
    const region = this.constants.AWS_REGION;

    if (!apiName || !stage) {
      this.externalLeadsBaseUrlCache = "";
      return this.externalLeadsBaseUrlCache;
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
        this.externalLeadsBaseUrlCache = `https://${api.id}.execute-api.${region}.amazonaws.com/${safeStage}/v2/leads`;
        return this.externalLeadsBaseUrlCache;
      }
      position = response.position;
    } while (position);

    this.externalLeadsBaseUrlCache = "";
    return this.externalLeadsBaseUrlCache;
  }

  private resolveSoldStatus(
    lead: ILead,
  ): "sold" | "not_sold" | "not_delivered" {
    if (lead.sold === true || Boolean(lead.sold_to_client_id)) {
      return "sold";
    }
    if (lead.sold === false || lead.delivery_result !== undefined) {
      return "not_sold";
    }
    return "not_delivered";
  }

  private enrichLeadForResponse(lead: ILead): ILead {
    return {
      ...lead,
      sold_status: this.resolveSoldStatus(lead),
    };
  }

  private async getCampaign(id: string): Promise<ICampaign | null> {
    const campaign = await this.dynamoDBUtil.get<ICampaign>({
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
    campaign: ICampaign,
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
          test: request.test ?? false,
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

  /**
   * Writes system audit events for `original_source` capture and
   * `order_number` normalization.  Called immediately after every lead put,
   * regardless of whether the lead was rejected or accepted.
   */
  private async writeLeadIntakeAuditEvents(
    leadId: string,
    originalSource: string | undefined,
    rawOrderNumber: unknown,
    orderNumberWasNormalized: boolean,
    orderNumber: number,
    now: string,
  ): Promise<void> {
    if (originalSource !== undefined) {
      await this.auditWriterService.writeAuditEvent({
        entity_id: leadId,
        entity_type: "lead",
        action: "original_source_set",
        changes: [{ field: "original_source", from: null, to: originalSource }],
        actor: { username: "system:intake", full_name: "Lead Intake" },
        changed_at: now,
      });
    }

    if (orderNumberWasNormalized && rawOrderNumber != null) {
      await this.auditWriterService.writeAuditEvent({
        entity_id: leadId,
        entity_type: "lead",
        action: "order_number_normalized",
        changes: [
          { field: "order_number", from: rawOrderNumber, to: orderNumber },
        ],
        actor: { username: "system:intake", full_name: "Lead Intake" },
        changed_at: now,
      });
    }
  }
}
