import { injectable, inject } from "inversify";
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
import {
  ICampaign,
  IAffiliateOutboundResponseOverride,
  ICampaignValidationBypassConfig,
} from "../../campaigns/interfaces/ICampaign.interface";
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
import { applyCasing } from "@shared/utils/casing.util";

@injectable()
export class LeadsService {
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
          message: "Lead rejected",
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
          message: "Lead rejected",
          error: "Campaign not found",
        };
      }

      const affiliate = campaign.affiliates.find(
        (a) => a.campaign_key === campaignKey,
      );
      if (!affiliate) {
        return {
          result: "failed",
          message: "Lead rejected",
          error: "Invalid campaign_key for campaign",
        };
      }

      const affiliateStatus =
        affiliate.status ?? CampaignParticipantStatus.LIVE;

      // ── Derive test mode ──────────────────────────────────────────────────
      // Test mode is determined by:
      //   1. Affiliate status is TEST
      //   2. The word "test" (case-insensitive) in any payload field value
      //   3. An explicit "test" key in the payload set to a truthy value (1, "1", true, "true")
      const isTestByStatus = affiliateStatus === CampaignParticipantStatus.TEST;
      const isTestByPayload = Object.values(normalizedLeadPayload).some(
        (v) => typeof v === "string" && /\btest\b/i.test(v),
      );
      const testKeyValue = normalizedLeadPayload["test"];
      const isTestByKey =
        testKeyValue !== undefined &&
        (testKeyValue === 1 ||
          testKeyValue === "1" ||
          testKeyValue === true ||
          testKeyValue === "true");
      const isTest = isTestByStatus || isTestByPayload || isTestByKey;

      // Affiliate-driven status gate.
      if (affiliateStatus === CampaignParticipantStatus.DISABLED) {
        // Disabled affiliates proceed — rejectedByAffiliate is handled later.
      } else if (isTestByStatus) {
        // TEST affiliate: DRAFT and INACTIVE campaigns are blocked.
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
        // ACTIVE or TEST campaign → TEST affiliate is allowed
      } else {
        // LIVE affiliate: full campaign-status validation applies.
        const statusCheck = await this.validateStatus(campaign.status, false);
        if (statusCheck) {
          return {
            result: "failed",
            message: "Lead rejected",
            error: statusCheck,
          };
        }
      }

      const now = new Date().toISOString();
      const validationBypass = this.resolveValidationBypass(
        campaign,
        affiliate,
      );
      const outboundResponseOverride = this.resolveOutboundResponseOverride(
        campaign,
        affiliate.affiliate_id,
      );

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

      // ── Persist normalized order_number into the payload ─────────────────
      mappedPayload.order_number = orderNumber;

      // ── Stage 0b: Apply casing rules to text fields ──────────────────────
      for (const field of campaign.base_criteria ?? []) {
        const key = field.field_name;
        if (key && mappedPayload[key] != null) {
          const mode = field.casing ?? campaign.default_field_casing;
          if (mode && mode !== "default") {
            mappedPayload[key] = applyCasing(String(mappedPayload[key]), mode);
          }
        }
      }

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
        ).map((field) => `${this.toTitleCasePhrase(field)} Is Required`);
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
          decision_trace: {
            version: 1,
            intake: {
              ...(originalSource !== undefined
                ? { original_source: originalSource }
                : {}),
              order_number: orderNumber,
              order_number_normalized: orderNumberWasNormalized,
              ...(isTest
                ? {
                    test_detected_by: isTestByStatus
                      ? ("affiliate_status" as const)
                      : ("payload_detection" as const),
                  }
                : {}),
              captured_at: now,
            },
            final_decision: {
              accepted: false,
              reason: rejectionReason,
              decided_at: now,
            },
          },
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
          message:
            outboundResponseOverride?.failure_message?.trim() ||
            "Lead Rejected",
          ...((outboundResponseOverride?.failure_errors?.length ?? 0) > 0 ||
          criteriaRejectionErrors.length > 0
            ? {
                errors: outboundResponseOverride?.failure_errors?.length
                  ? outboundResponseOverride.failure_errors
                  : criteriaRejectionErrors,
              }
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
        affiliate.affiliate_id,
      );

      const affiliateLogicFailed = !logicRulesResult.passed;
      let logicRejectionReason: string | undefined;
      let logicRejectionErrors: string[] = [];

      if (affiliateLogicFailed) {
        logicRejectionReason =
          logicRulesResult.rejection_reason ?? REJECTION_LOGIC_RULES;
        logicRejectionErrors = (logicRulesResult.condition_failures ?? []).map(
          (f) => {
            const fieldLabel = this.toTitleCasePhrase(f.field);
            const expected = Array.isArray(f.expected)
              ? f.expected
                  .map((value) => this.formatRuleValue(value))
                  .join(" Or ")
              : f.expected;
            switch (f.operator) {
              case "is":
                return `${fieldLabel} Must Equal ${this.formatRuleValue(expected)}`;
              case "is_not":
                return `${fieldLabel} Must Not Equal ${this.formatRuleValue(expected)}`;
              case "contains":
                return `${fieldLabel} Does Not Match Options`;
              case "does_not_contain":
                return `${fieldLabel} Contains A Disallowed Value`;
              case "starts_with":
                return `${fieldLabel} Must Start With ${this.formatRuleValue(expected)}`;
              case "does_not_start_with":
                return `${fieldLabel} Must Not Start With ${this.formatRuleValue(expected)}`;
              case "ends_with":
                return `${fieldLabel} Must End With ${this.formatRuleValue(expected)}`;
              case "does_not_end_with":
                return `${fieldLabel} Must Not End With ${this.formatRuleValue(expected)}`;
              case "greater_than":
                return `${fieldLabel} Must Be Greater Than ${this.formatRuleValue(expected)}`;
              case "less_than":
                return `${fieldLabel} Must Be Less Than ${this.formatRuleValue(expected)}`;
              default:
                return `${fieldLabel} Does Not Meet Requirements`;
            }
          },
        );
      }

      const qaResult = await this.runQaPlugins(
        campaign,
        {
          campaign_id: campaignId,
          campaign_key: campaignKey,
          payload: mappedPayload,
          test: isTest,
        },
        {
          affiliate_id: affiliate.affiliate_id,
          bypass: validationBypass,
        },
      );

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
        rejectedByAffiliate ||
        rejectedByDuplicate ||
        pluginGateRejected ||
        affiliateLogicFailed;

      const rejectionReasons: string[] = [];
      if (affiliateLogicFailed && logicRejectionReason)
        rejectionReasons.push(logicRejectionReason);
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
        ...(affiliateLogicFailed
          ? {
              affiliate_logic_failed: true,
              logic_rules_result: {
                passed: false,
                rejection_reason: logicRejectionReason,
                matched_rule_id: logicRulesResult.matched_rule_id,
                matched_rule_name: logicRulesResult.matched_rule_name,
                ...(logicRulesResult.failed_rules
                  ? { failed_rules: logicRulesResult.failed_rules }
                  : {}),
              },
              ...(logicRejectionErrors.length > 0
                ? { rejection_errors: logicRejectionErrors }
                : {}),
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
        decision_trace: {
          version: 1,
          intake: {
            ...(originalSource !== undefined
              ? { original_source: originalSource }
              : {}),
            order_number: orderNumber,
            order_number_normalized: orderNumberWasNormalized,
            ...(isTest
              ? {
                  test_detected_by: isTestByStatus
                    ? ("affiliate_status" as const)
                    : ("payload_detection" as const),
                }
              : {}),
            captured_at: now,
          },
          qa: {
            duplicate_detected: duplicateDetected,
            pipeline_halted: qaResult.pipeline_halted === true,
            ...(qaResult.halt_plugin
              ? { halt_plugin: qaResult.halt_plugin }
              : {}),
            ...(qaResult.halt_reason
              ? { halt_reason: qaResult.halt_reason }
              : {}),
            ...(qaResult.bypass_applied
              ? { bypass_applied: qaResult.bypass_applied }
              : validationBypass
                ? { bypass_applied: validationBypass }
                : {}),
            evaluated_at: now,
          },
          final_decision: {
            accepted: !rejected,
            reason:
              rejectionReason ??
              (isTest ? LEAD_ACCEPTED_TEST_MESSAGE : LEAD_ACCEPTED_MESSAGE),
            decided_at: now,
          },
        },
        created_by: actor,
        updated_at: now,
        updated_by: actor,
        is_deleted: false,
        active: true,
      };

      // Auto-set cherry_pickable for rejected, non-test leads based on config
      if (rejected && !isTest) {
        const affiliateEntry = campaign.affiliates?.find(
          (a) => a.campaign_key === campaignKey,
        );
        const pickable =
          affiliateEntry?.cherry_pick_override ??
          campaign.default_cherry_pickable ??
          true;
        if (pickable) {
          lead.cherry_pickable = true;
        }
      }

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

      // ── Synchronous webhook delivery ──────────────────────────────────────
      // Deliver when: not test, not hard-rejected (affiliate disabled, duplicate,
      // plugin gate).  Logic-failed leads still attempt delivery — the client's
      // own override rules decide acceptance in pickDeliveryClient().
      const hardRejected =
        rejectedByAffiliate || rejectedByDuplicate || pluginGateRejected;
      if (!isTest && !hardRejected) {
        await this.leadDeliveryService
          .deliverLead(lead, campaign)
          .catch((err: any) =>
            this.logger.error("Lead delivery error (non-fatal)", {
              leadId: lead.id,
              error: err?.message,
            }),
          );
      }

      // ── Evaluate sold criteria & increment lead cap post-delivery ─────────
      // leads_sent only increments for leads that are actually sold.  If the
      // affiliate defines sold_criteria rules, the lead must ALSO pass those
      // rules (evaluated against the lead payload) to count as sold.
      if (!isTest && lead.sold === true) {
        const soldCriteria = affiliate.sold_criteria ?? [];
        const enabledSoldCriteria = soldCriteria.filter(
          (r) => r.enabled !== false,
        );
        if (enabledSoldCriteria.length > 0) {
          const payload = (lead.payload ?? {}) as Record<string, unknown>;
          const soldCriteriaPassed = this.leadDeliveryService.passesLogicRules(
            enabledSoldCriteria,
            payload,
          );
          if (!soldCriteriaPassed) {
            lead.sold = false;
            lead.sold_to_client_id = undefined;
            lead.sold_criteria_failed = true;
            await this.dynamoDBUtil.update({
              TableName: this.constants.LEADS_TABLE_NAME,
              Key: { id: lead.id },
              UpdateExpression:
                "SET sold = :sold, sold_criteria_failed = :scf, updated_at = :now REMOVE sold_to_client_id",
              ExpressionAttributeValues: {
                ":sold": false,
                ":scf": true,
                ":now": now,
              },
            });
          }
        }
      }

      if (!isTest && lead.sold === true) {
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

      const leadResponse: LeadIntakeResponse = lead.rejected
        ? {
            result: "failed",
            lead_id: lead.id,
            message:
              outboundResponseOverride?.failure_message?.trim() ||
              "Lead Rejected",
            ...(lead.rejection_errors && lead.rejection_errors.length > 0
              ? {
                  errors: outboundResponseOverride?.failure_errors?.length
                    ? outboundResponseOverride.failure_errors
                    : lead.rejection_errors,
                }
              : lead.rejection_reason
                ? {
                    errors: outboundResponseOverride?.failure_errors?.length
                      ? outboundResponseOverride.failure_errors
                      : [this.formatRejectionMessage(lead.rejection_reason)],
                  }
                : outboundResponseOverride?.failure_errors?.length
                  ? { errors: outboundResponseOverride.failure_errors }
                  : {}),
          }
        : {
            result: "passed",
            message:
              outboundResponseOverride?.success_message?.trim() ||
              (isTest ? "Test Lead Accepted" : "Lead Accepted"),
            data: {
              lead_id: lead.id,
              message:
                outboundResponseOverride?.success_message?.trim() ||
                (isTest ? LEAD_ACCEPTED_TEST_MESSAGE : LEAD_ACCEPTED_MESSAGE),
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
        message: "Lead rejected",
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
        include_trace = false,
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

      if (typeof test === "boolean") {
        filters.push("#test = :test");
        names["#test"] = "test";
        values[":test"] = test;
      }

      const filterExpression = filters.length
        ? filters.join(" AND ")
        : undefined;

      let items: ILead[] = [];
      let nextKey: Record<string, unknown> | undefined;

      if (campaign_id) {
        try {
          const queryNames: Record<string, string> = {
            ...names,
            "#campaign_id": "campaign_id",
          };
          const queryValues: Record<string, unknown> = {
            ...values,
            ":campaign_id": campaign_id,
          };

          const queryResult = await this.dynamoDBUtil.query<ILead>({
            TableName: this.constants.LEADS_TABLE_NAME,
            IndexName: this.constants.LEADS_CAMPAIGN_CREATED_AT_INDEX_NAME,
            KeyConditionExpression: "#campaign_id = :campaign_id",
            ExpressionAttributeNames: queryNames,
            ExpressionAttributeValues: queryValues,
            ...(filterExpression ? { FilterExpression: filterExpression } : {}),
            Limit: limit,
            ExclusiveStartKey: exclusiveStartKey,
            ScanIndexForward: false,
          });

          items = queryResult.items;
          nextKey = queryResult.lastEvaluatedKey;
        } catch (error: any) {
          // Safe rollout: if index is not available yet, keep behavior by
          // falling back to scan for this request.
          this.logger.warn(
            "Leads campaign index query failed; falling back to scan",
            {
              campaignId: campaign_id,
              error: error?.message,
              indexName: this.constants.LEADS_CAMPAIGN_CREATED_AT_INDEX_NAME,
            },
          );

          const scanFilters = ["#campaign_id = :campaign_id", ...filters];
          const scanNames: Record<string, string> = {
            ...names,
            "#campaign_id": "campaign_id",
          };
          const scanValues: Record<string, unknown> = {
            ...values,
            ":campaign_id": campaign_id,
          };

          const scanResult = await this.dynamoDBUtil.scan<ILead>({
            TableName: this.constants.LEADS_TABLE_NAME,
            Limit: limit,
            ExclusiveStartKey: exclusiveStartKey,
            FilterExpression: scanFilters.join(" AND "),
            ExpressionAttributeNames: scanNames,
            ExpressionAttributeValues: scanValues,
          });

          items = scanResult.items;
          nextKey = scanResult.lastEvaluatedKey;
        }
      } else {
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

        items = scanResult.items;
        nextKey = scanResult.lastEvaluatedKey;
      }

      return {
        result: true,
        data: {
          items: items.map((lead) =>
            this.enrichLeadForResponse(lead, include_trace),
          ),
          count: items.length,
          lastEvaluatedKey: nextKey
            ? Buffer.from(JSON.stringify(nextKey)).toString("base64")
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

  async getLead(
    id: string,
    includeTrace = false,
  ): Promise<ServiceResult<ILead>> {
    try {
      const lead = await this.dynamoDBUtil.get<ILead>({
        TableName: this.constants.LEADS_TABLE_NAME,
        Key: { id },
      });

      if (!lead) {
        return { result: false, error: `Lead ${id} not found` };
      }

      return {
        result: true,
        data: this.enrichLeadForResponse(lead, includeTrace),
      };
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
        : lead.original_source
          ? { marketing_source: lead.original_source }
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
    if (isTest) {
      if (status === CampaignStatus.ACTIVE) {
        return "Campaign is live; test leads are not accepted on live campaigns unless affiliate status is TEST";
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
      return "Campaign is in test mode";
    }
    if (status === CampaignStatus.INACTIVE) {
      return "Campaign is inactive";
    }
    if (status === CampaignStatus.DRAFT) {
      return "Campaign is in draft; move to TEST before live leads";
    }
    return null;
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

  private enrichLeadForResponse(lead: ILead, includeTrace = false): ILead {
    const enriched: ILead = {
      ...lead,
      sold_status: this.resolveSoldStatus(lead),
    };
    if (!includeTrace) {
      delete enriched.decision_trace;
    }
    return enriched;
  }

  private resolveValidationBypass(
    campaign: ICampaign,
    affiliate: {
      affiliate_id: string;
      validation_bypass?: ICampaignValidationBypassConfig;
    },
  ): ICampaignValidationBypassConfig | undefined {
    const campaignBypass = campaign.validation_bypass ?? {};
    const affiliateBypass = affiliate.validation_bypass ?? {};
    const overrideBypass =
      campaign.affiliate_overrides?.[affiliate.affiliate_id]
        ?.validation_bypass ?? {};

    const merged: ICampaignValidationBypassConfig = {
      ...campaignBypass,
      ...affiliateBypass,
      ...overrideBypass,
    };
    return Object.keys(merged).length > 0 ? merged : undefined;
  }

  private toTitleCasePhrase(input: string): string {
    return input
      .replace(/[_\-\.]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .split(" ")
      .filter(Boolean)
      .map((word) => {
        const lower = word.toLowerCase();
        if (lower === "id" || lower === "ip" || lower === "ipqs") {
          return lower.toUpperCase();
        }
        return lower.charAt(0).toUpperCase() + lower.slice(1);
      })
      .join(" ");
  }

  private formatRuleValue(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return trimmed;
    const lower = trimmed.toLowerCase();
    if (lower === "yes") return "Yes";
    if (lower === "no") return "No";
    return this.toTitleCasePhrase(trimmed);
  }

  private formatRejectionMessage(raw: string): string {
    const trimmed = raw.trim();
    if (!trimmed) return trimmed;
    const [head, ...rest] = trimmed.split(":");
    if (rest.length > 0) {
      return `${this.toTitleCasePhrase(head)}: ${rest.join(":").trim()}`;
    }
    return this.toTitleCasePhrase(trimmed);
  }

  private resolveOutboundResponseOverride(
    campaign: ICampaign,
    affiliateId: string,
  ): IAffiliateOutboundResponseOverride | undefined {
    const override =
      campaign.affiliate_overrides?.[affiliateId]?.outbound_response;
    if (!override) return undefined;
    return override;
  }

  private mapBypassForOrchestrator(bypass?: ICampaignValidationBypassConfig):
    | {
        duplicate_check?: boolean;
        trusted_form?: boolean;
        ipqs_phone?: boolean;
        ipqs_email?: boolean;
        ipqs_ip?: boolean;
        all?: boolean;
      }
    | undefined {
    if (!bypass) return undefined;
    const mapped = {
      ...(bypass.duplicate_check !== undefined
        ? { duplicate_check: bypass.duplicate_check }
        : {}),
      ...(bypass.trusted_form_claim !== undefined
        ? { trusted_form: bypass.trusted_form_claim }
        : {}),
      ...(bypass.ipqs_phone !== undefined
        ? { ipqs_phone: bypass.ipqs_phone }
        : {}),
      ...(bypass.ipqs_email !== undefined
        ? { ipqs_email: bypass.ipqs_email }
        : {}),
      ...(bypass.ipqs_ip !== undefined ? { ipqs_ip: bypass.ipqs_ip } : {}),
      ...(bypass.all !== undefined ? { all: bypass.all } : {}),
    };
    return Object.keys(mapped).length > 0 ? mapped : undefined;
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
    affiliateId?: string,
  ): Promise<LogicRulesResponse> {
    if (!this.constants.LOGIC_RULES_LAMBDA_NAME) {
      return { passed: true };
    }

    try {
      return await this.lambdaInvokeUtil.invokeJson<LogicRulesResponse>({
        functionName: this.constants.LOGIC_RULES_LAMBDA_NAME,
        payload: {
          campaign_id: campaignId,
          payload,
          ...(affiliateId ? { affiliate_id: affiliateId } : {}),
        },
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
    options?: {
      affiliate_id?: string;
      lead_id?: string;
      bypass?: ICampaignValidationBypassConfig;
    },
  ): Promise<QaOrchestratorResult> {
    const orchestratorBypass = this.mapBypassForOrchestrator(options?.bypass);

    if (!this.constants.QA_ORCHESTRATOR_LAMBDA_NAME) {
      return {
        duplicate: false,
        duplicate_matches: {
          lead_ids: [],
        },
        ...(orchestratorBypass ? { bypass_applied: orchestratorBypass } : {}),
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
          ...(options?.lead_id ? { lead_id: options.lead_id } : {}),
          ...(options?.affiliate_id
            ? { affiliate_id: options.affiliate_id }
            : {}),
          test: request.test ?? false,
          payload: leadPayload,
          plugins: campaign.plugins,
          ...(orchestratorBypass ? { bypass: orchestratorBypass } : {}),
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
        ...(orchestratorBypass ? { bypass_applied: orchestratorBypass } : {}),
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
