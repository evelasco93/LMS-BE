import { injectable, inject } from "inversify";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { Logger } from "@shared/services/logger.util";
import { LambdaInvokeUtil } from "@shared/services/lambda-invoke.util";
import { AuditWriterService } from "@shared/services";
import { LeadsConstants } from "../constants/leads.constants";
import {
  ILead,
  ITrustedFormResult,
  IAffiliatePixelResult,
} from "../interfaces/ILead.interface";
import {
  ICampaign,
  ICampaignContract,
  ILogicRule,
} from "../../campaigns/interfaces/ICampaign.interface";
import {
  IClientDeliveryConfig,
  ILeadDeliveryResult,
  IAffiliateSoldPixelConfig,
  IWebhookFieldMapping,
  IDestination,
  IClientResponseValidation,
  IValidationRule,
} from "../../campaigns/interfaces/IClientDelivery.interface";
import { CampaignParticipantStatus } from "../../campaigns/enums/campaign-participant-status.enum";

/**
 * Handles synchronous webhook delivery of accepted leads to buyer clients.
 *
 * Key design constraints (agreed with product):
 *  - Delivery is synchronous; the affiliate Lambda call waits for the result.
 *  - Test leads skip delivery entirely (early return).
 *  - A delivery failure (network error, non-2xx, acceptance-rule "failed") sets
 *    sold=false immediately with no retry / SQS queue.
 *  - Only ONE LIVE client is selected per lead per distribution config.
 */
@injectable()
export class LeadDeliveryService {
  private static readonly WEBHOOK_TIMEOUT_MS = 15_000;
  private static readonly PIXEL_TIMEOUT_MS = 5_000;
  private static readonly MAX_WEBHOOK_ATTEMPTS = 3;
  private static readonly RETRY_BACKOFF_MS = 250;

  constructor(
    @inject("DynamoDBUtil") private readonly dynamoDBUtil: DynamoDBUtil,
    @inject("Logger") private readonly logger: Logger,
    @inject("LeadsConstants") private readonly constants: LeadsConstants,
    @inject("AuditWriterService")
    private readonly auditWriterService: AuditWriterService,
    @inject("LambdaInvokeUtil")
    private readonly lambdaInvokeUtil: LambdaInvokeUtil,
  ) {}

  /**
   * Main entry-point called from LeadsService after a lead is saved.
   *
   * Mutates `lead` in-place (sold, sold_to_contract_id, sold_to_client_id,
   * delivery_result) so the
   * caller can return the enriched object in the intake response if needed.
   */
  async deliverLead(lead: ILead, campaign: ICampaign): Promise<void> {
    if (lead.test) {
      // Test leads are never delivered.
      return;
    }

    const distribution = campaign.distribution;
    if (!distribution?.enabled) {
      await this.markLeadRejectedWithoutDelivery(
        lead,
        "Campaign distribution is disabled",
      );
      return;
    }

    const contract = this.pickDeliveryContract(campaign, lead.payload ?? {});
    if (!contract) {
      this.logger.info("No eligible LIVE contract found for delivery", {
        campaignId: campaign.id,
        leadId: lead.id,
      });

      await this.markLeadRejectedWithoutDelivery(
        lead,
        "No eligible LIVE contract available for delivery",
      );
      return;
    }

    // Claim the TrustedForm certificate before delivery if required.
    if (contract.delivery_config?.claim_trusted_form) {
      const { claimed, error: claimError } =
        await this.claimCertBeforeDelivery(lead);
      // Gate on claim failure if either: per-contract require_successful_claim is set,
      // OR the campaign-level TrustedForm plugin has gate=true ("Reject on failure").
      const claimGate =
        contract.delivery_config.require_successful_claim === true ||
        campaign.plugins?.trusted_form?.gate === true;
      if (!claimed && claimGate) {
        this.logger.warn(
          "TrustedForm claim failed; skipping delivery due to claim gate",
          {
            leadId: lead.id,
            contractId: contract.contract_id,
            clientId: contract.client_id,
            error: claimError,
          },
        );
        const now = new Date().toISOString();
        const rejectionReason =
          claimError && claimError.trim().length > 0
            ? `TrustedForm claim failed: ${claimError}`
            : "TrustedForm claim failed";
        lead.rejected = true;
        lead.rejection_reason = rejectionReason;
        lead.rejection_errors = [rejectionReason];
        lead.sold = false;
        lead.updated_at = now;
        await this.dynamoDBUtil.update({
          TableName: this.constants.LEADS_TABLE_NAME,
          Key: { id: lead.id },
          UpdateExpression:
            "SET delivery_skipped_reason = :reason, sold = :sold, rejected = :rejected, rejection_reason = :rejection_reason, rejection_errors = :rejection_errors, updated_at = :now",
          ExpressionAttributeValues: {
            ":reason": rejectionReason,
            ":sold": false,
            ":rejected": true,
            ":rejection_reason": rejectionReason,
            ":rejection_errors": [rejectionReason],
            ":now": now,
          },
        });
        await this.auditWriterService.writeAuditEvent({
          entity_id: lead.id,
          entity_type: "lead",
          action: "delivery_skipped",
          changes: [
            {
              field: "delivery_skipped_reason",
              from: null,
              to: rejectionReason,
            },
            {
              field: "rejected",
              from: false,
              to: true,
            },
            {
              field: "rejection_reason",
              from: null,
              to: rejectionReason,
            },
          ],
          actor: {
            username: "system:lead-delivery",
            full_name: "Lead Delivery",
          },
          changed_at: now,
        });
        return;
      }
    }

    const result = await this.executeWebhook(
      lead,
      contract,
      distribution.mode ?? "round_robin",
    );

    // Persist delivery outcome on the lead record.
    const now = new Date().toISOString();
    lead.sold = result.accepted;
    lead.sold_to_contract_id = result.accepted
      ? contract.contract_id
      : undefined;
    lead.sold_to_client_id = result.accepted ? contract.client_id : undefined;
    lead.delivery_result = result;
    if (!result.accepted) {
      const rejectionReason = this.buildDeliveryRejectionReason(result);
      lead.rejected = true;
      lead.rejection_reason = rejectionReason;
      lead.rejection_errors = [rejectionReason];
    }
    lead.updated_at = now;

    await this.dynamoDBUtil.update({
      TableName: this.constants.LEADS_TABLE_NAME,
      Key: { id: lead.id },
      UpdateExpression:
        "SET sold = :sold, delivery_result = :dr, updated_at = :now" +
        (result.accepted
          ? ", sold_to_contract_id = :contractId, sold_to_client_id = :clientId"
          : ", rejected = :rejected, rejection_reason = :rejection_reason, rejection_errors = :rejection_errors"),
      ExpressionAttributeValues: {
        ":sold": result.accepted,
        ":dr": result,
        ":now": now,
        ...(result.accepted
          ? {
              ":contractId": contract.contract_id,
              ":clientId": contract.client_id,
            }
          : {
              ":rejected": true,
              ":rejection_reason": this.buildDeliveryRejectionReason(result),
              ":rejection_errors": [this.buildDeliveryRejectionReason(result)],
            }),
      },
    });

    // Atomically increment the contract's delivered count only for sold leads.
    // We do a full campaign put rather than a complex nested list update because
    // DynamoDB UpdateExpression cannot address list items by value.
    if (result.accepted) {
      await this.incrementContractLeadsDelivered(
        campaign,
        contract.contract_id,
        now,
      );
    }

    // Update rr cursor when round_robin mode is active.
    if (distribution.mode === "round_robin") {
      await this.dynamoDBUtil.update({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Key: { id: campaign.id },
        UpdateExpression:
          "SET rr_last_contract_id = :contractId, updated_at = :now",
        ExpressionAttributeValues: {
          ":contractId": contract.contract_id,
          ":now": now,
        },
      });
    }

    await this.auditWriterService.writeAuditEvent({
      entity_id: lead.id,
      entity_type: "lead",
      action: "lead_delivered",
      changes: [
        {
          field: "sold",
          from: false,
          to: result.accepted,
        },
        {
          field: "sold_to_contract_id",
          from: null,
          to: result.accepted ? contract.contract_id : null,
        },
        {
          field: "sold_to_client_id",
          from: null,
          to: result.accepted ? contract.client_id : null,
        },
        {
          field: "cert_id",
          from: null,
          to: lead.trusted_form_result?.cert_id ?? null,
        },
        {
          field: "delivery_result",
          from: null,
          to: result,
        },
      ],
      actor: { username: "system:lead-delivery", full_name: "Lead Delivery" },
      changed_at: now,
    });

    if (result.accepted) {
      // Skip pixel when affiliate logic failed — affiliate sees "rejected".
      if (!lead.affiliate_logic_failed) {
        // Await pixel dispatch so each sold lead has deterministic pixel audit data.
        await this.fireAffiliateSoldPixel(campaign, lead);
      }
    }

    this.logger.info("Lead delivery complete", {
      leadId: lead.id,
      contractId: contract.contract_id,
      clientId: contract.client_id,
      accepted: result.accepted,
      status: result.webhook_response_status,
    });
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**   * Queries the tenant-settings table for the default TrustedForm plugin
   * credential, then invokes the TrustedForm Lambda with `claim: true` to
   * retain the lead's certificate before webhook delivery.
   *
   * Non-throwing: all errors are caught and returned as { claimed: false, error }.
   */
  private async claimCertBeforeDelivery(
    lead: ILead,
  ): Promise<{ claimed: boolean; error?: string }> {
    const certId =
      lead.trusted_form_result?.cert_id ??
      (typeof (lead.payload as Record<string, unknown> | undefined)
        ?.trusted_form_cert_id === "string"
        ? ((lead.payload as Record<string, unknown>)
            .trusted_form_cert_id as string)
        : undefined);
    if (!certId) {
      return { claimed: false, error: "No cert_id found on lead" };
    }
    if (!this.constants.TRUSTED_FORM_LAMBDA_NAME) {
      this.logger.warn(
        "TRUSTED_FORM_LAMBDA_NAME not configured — skipping claim",
        { leadId: lead.id },
      );
      return {
        claimed: false,
        error: "TRUSTED_FORM_LAMBDA_NAME not configured",
      };
    }
    if (!this.constants.TENANT_SETTINGS_TABLE_NAME) {
      return {
        claimed: false,
        error: "TENANT_SETTINGS_TABLE_NAME not configured",
      };
    }

    try {
      const tableName = this.constants.TENANT_SETTINGS_TABLE_NAME;
      const settingRecords = await this.dynamoDBUtil.queryAll<{
        credentials_id: string;
      }>({
        TableName: tableName,
        IndexName: `${tableName}-type-provider-index`,
        KeyConditionExpression: "#t = :type AND #p = :provider",
        FilterExpression:
          "enabled = :e AND (attribute_not_exists(is_deleted) OR is_deleted = :f)",
        ExpressionAttributeNames: { "#t": "type", "#p": "provider" },
        ExpressionAttributeValues: {
          ":type": "plugin_setting",
          ":provider": "trusted_form",
          ":e": true,
          ":f": false,
        },
        Limit: 1,
      });

      if (!settingRecords.length) {
        this.logger.warn(
          "No active trusted_form plugin setting found — skipping claim",
          { leadId: lead.id },
        );
        return {
          claimed: false,
          error: "No active TrustedForm credential configured",
        };
      }

      const credentialsId = settingRecords[0].credentials_id;
      const result = await this.lambdaInvokeUtil.invokeJson<ITrustedFormResult>(
        {
          functionName: this.constants.TRUSTED_FORM_LAMBDA_NAME,
          payload: {
            credentials_id: credentialsId,
            cert_id: certId,
            claim: true,
            phone: (lead.payload as Record<string, unknown> | undefined)
              ?.phone as string | undefined,
          },
        },
      );

      // Update in-memory + DynamoDB so the lead record reflects the claim result.
      if (result) {
        lead.trusted_form_result = result;
        const now = new Date().toISOString();
        lead.updated_at = now;
        await this.dynamoDBUtil.update({
          TableName: this.constants.LEADS_TABLE_NAME,
          Key: { id: lead.id },
          UpdateExpression: "SET trusted_form_result = :tfr, updated_at = :now",
          ExpressionAttributeValues: { ":tfr": result, ":now": now },
        });
        await this.auditWriterService.writeAuditEvent({
          entity_id: lead.id,
          entity_type: "lead",
          action: "cert_claimed",
          changes: [
            { field: "trusted_form_result.cert_id", from: null, to: certId },
            {
              field: "trusted_form_result.success",
              from: null,
              to: result.success,
            },
            {
              field: "trusted_form_result.previously_retained",
              from: null,
              to: result.previously_retained ?? null,
            },
          ],
          actor: {
            username: "system:lead-delivery",
            full_name: "Lead Delivery",
          },
          changed_at: now,
        });
      }

      const claimed = result?.success === true;
      return {
        claimed,
        ...(claimed
          ? {}
          : {
              error:
                result?.error ?? "TrustedForm claim returned success=false",
            }),
      };
    } catch (err: any) {
      const msg = err?.message ?? "TrustedForm Lambda invocation failed";
      this.logger.error("TrustedForm claim invocation failed", {
        leadId: lead.id,
        error: msg,
      });
      return { claimed: false, error: msg };
    }
  }

  /**
   * Select exactly one LIVE contract to deliver to according to distribution mode.
   *
   * Contracts that have logic rules (own override or campaign-level) that reject
   * the lead's payload are excluded from the eligible pool.
   */
  private pickDeliveryContract(
    campaign: ICampaign,
    leadPayload: Record<string, unknown>,
  ): ICampaignContract | null {
    const contracts = campaign.contracts ?? campaign.clients ?? [];
    const eligible = contracts.filter((c) => {
      if (
        c.status !== CampaignParticipantStatus.LIVE ||
        !this.hasDeliverableContractConfig(c)
      ) {
        return false;
      }

      // Resolve the effective logic rules for this contract based on logic_mode:
      // - "inherit_campaign" (default) → always use current campaign rules
      // - "pinned" (legacy) → use the contract's own override rules; fall back to campaign rules
      const override =
        campaign.contract_overrides?.[c.contract_id] ??
        campaign.client_overrides?.[c.contract_id] ??
        campaign.client_overrides?.[c.client_id];
      const mode = override?.logic_mode ?? "inherit_campaign";
      const overrideRules = override?.logic_rules ?? [];
      const effectiveRules =
        mode === "inherit_campaign"
          ? (campaign.logic_rules ?? [])
          : overrideRules.length > 0
            ? overrideRules
            : (campaign.logic_rules ?? []);

      return this.passesLogicRules(effectiveRules, leadPayload);
    });

    if (eligible.length === 0) return null;
    if (eligible.length === 1) return eligible[0];

    const mode = campaign.distribution?.mode ?? "round_robin";

    if (mode === "weighted") {
      return this.pickWeighted(eligible);
    }

    // round_robin (default)
    return this.pickRoundRobin(
      eligible,
      campaign.rr_last_contract_id ?? campaign.rr_last_client_id,
    );
  }

  private pickRoundRobin(
    contracts: ICampaignContract[],
    lastContractId?: string,
  ): ICampaignContract {
    if (!lastContractId) return contracts[0];
    const lastIdx = contracts.findIndex(
      (c) => c.contract_id === lastContractId,
    );
    if (lastIdx === -1) return contracts[0];
    return contracts[(lastIdx + 1) % contracts.length];
  }

  private pickWeighted(contracts: ICampaignContract[]): ICampaignContract {
    // Weighted-fair: pick the contract that is furthest below its target ratio.
    const totalWeight = contracts.reduce((s, c) => s + (c.weight ?? 1), 0);
    const totalDelivered = contracts.reduce(
      (s, c) => s + (c.leads_delivered_count ?? 0),
      0,
    );

    let best: ICampaignContract = contracts[0];
    let bestDeficit = -Infinity;

    for (const c of contracts) {
      const targetRatio = (c.weight ?? 1) / totalWeight;
      const actualRatio =
        totalDelivered === 0
          ? 0
          : (c.leads_delivered_count ?? 0) / totalDelivered;
      const deficit = targetRatio - actualRatio;
      if (deficit > bestDeficit) {
        bestDeficit = deficit;
        best = c;
      }
    }

    return best;
  }

  /**
   * Evaluates a set of logic rules against `payload`.
   * Rules are evaluated with OR — the lead passes if ANY enabled rule matches.
   * Each rule's conditions are evaluated with AND — all must match.
   * If zero rules exist, the lead passes by default.
   * If no rules match, the lead is rejected.
   */
  passesLogicRules(
    rules: ILogicRule[],
    payload: Record<string, unknown>,
  ): boolean {
    const enabled = rules.filter((r) => r.enabled);
    if (enabled.length === 0) return true;

    for (const rule of enabled) {
      const matches = rule.conditions.every((cond) => {
        const raw = payload[cond.field_name];
        const fieldVal = (raw === undefined || raw === null ? "" : String(raw))
          .toLowerCase()
          .trim();

        if (cond.operator === "is_empty") return fieldVal === "";
        if (cond.operator === "is_not_empty") return fieldVal !== "";

        const condValues = (
          Array.isArray(cond.value) ? cond.value : [cond.value ?? ""]
        ).flatMap((v) =>
          String(v).includes(",")
            ? String(v)
                .split(",")
                .map((s) => s.trim().toLowerCase())
            : [String(v).trim().toLowerCase()],
        );

        switch (cond.operator) {
          case "is":
            return condValues.some((v) => fieldVal === v);
          case "is_not":
            return condValues.every((v) => fieldVal !== v);
          case "contains":
            return condValues.some((v) => fieldVal.includes(v));
          case "does_not_contain":
            return condValues.every((v) => !fieldVal.includes(v));
          case "starts_with":
            return condValues.some((v) => fieldVal.startsWith(v));
          case "ends_with":
            return condValues.some((v) => fieldVal.endsWith(v));
          case "greater_than":
            return parseFloat(fieldVal) > parseFloat(condValues[0]);
          case "less_than":
            return parseFloat(fieldVal) < parseFloat(condValues[0]);
          default:
            return true;
        }
      });

      if (matches) return true;
    }

    // No rule matched — lead is rejected
    return false;
  }

  private hasDeliverableContractConfig(contract: ICampaignContract): boolean {
    const primary = this.getPrimaryDestination(contract);
    if (primary) {
      if (
        !primary.url?.trim() ||
        !primary.method ||
        !primary.payload_mapping?.length
      ) {
        return false;
      }

      if (primary.type === "webhook") {
        const rules = this.normalizeResponseValidationRules(
          contract.response_validation,
        );
        return rules.some(
          (rule) =>
            rule.destination_id === primary.id &&
            rule.action === "passed" &&
            rule.match_value?.trim().length > 0,
        );
      }

      return (
        primary.non_webhook_delivery_action === "passed" ||
        primary.non_webhook_delivery_action === "failed"
      );
    }

    const dc = contract.delivery_config;
    return !!(
      dc?.url?.trim() &&
      dc.method &&
      dc.payload_mapping?.length &&
      dc.acceptance_rules?.length
    );
  }

  private getPrimaryDestination(
    contract: ICampaignContract,
  ): IDestination | null {
    const destinations = contract.destinations ?? [];
    if (destinations.length === 0) return null;
    return destinations.find((d) => d.is_primary) ?? destinations[0] ?? null;
  }

  /**
   * POST the lead payload to the contract destination and interpret the response.
   */
  private async executeWebhook(
    lead: ILead,
    contract: ICampaignContract,
    distributionMode: "round_robin" | "weighted",
  ): Promise<ILeadDeliveryResult> {
    const primaryDestination = this.getPrimaryDestination(contract);
    const config: IClientDeliveryConfig | null = primaryDestination
      ? {
          url: primaryDestination.url,
          method: primaryDestination.method,
          ...(primaryDestination.headers
            ? { headers: primaryDestination.headers }
            : {}),
          payload_mapping: primaryDestination.payload_mapping,
          acceptance_rules: primaryDestination.acceptance_rules ?? [],
          claim_trusted_form: true,
          ...(primaryDestination.require_successful_claim !== undefined
            ? {
                require_successful_claim:
                  primaryDestination.require_successful_claim,
              }
            : {}),
        }
      : ((contract.delivery_config as IClientDeliveryConfig | undefined) ??
        null);

    if (!config) {
      return {
        contract_id: contract.contract_id,
        client_id: contract.client_id,
        delivered_at: new Date().toISOString(),
        attempts: 0,
        webhook_url: "",
        webhook_method: "POST",
        accepted: false,
        error: "Contract has no delivery configuration",
        distribution_mode: distributionMode,
        contract_weight_at_delivery: contract.weight ?? 1,
        client_weight_at_delivery: contract.weight ?? 1,
      };
    }

    const destinationType = primaryDestination?.type ?? "webhook";
    const nonWebhookDeliveryAction =
      primaryDestination?.non_webhook_delivery_action;
    const deliveredAt = new Date().toISOString();

    const { queryParams, bodyPayload } = this.buildPayload(lead, config);

    let responseStatus: number | undefined;
    let responseBody: string | undefined;
    let accepted = false;
    let acceptanceMatch: string | undefined;
    let error: string | undefined;
    let attempts = 0;

    for (
      let attempt = 1;
      attempt <= LeadDeliveryService.MAX_WEBHOOK_ATTEMPTS;
      attempt++
    ) {
      attempts = attempt;

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          LeadDeliveryService.WEBHOOK_TIMEOUT_MS,
        );

        let response: Response;
        try {
          const hasQueryParams = Object.keys(queryParams).length > 0;
          const hasBodyPayload = Object.keys(bodyPayload).length > 0;
          const isBodyMethod = config.method !== "GET" && hasBodyPayload;
          const url = hasQueryParams
            ? this.appendQueryParams(config.url, queryParams)
            : config.url;

          response = await fetch(url, {
            method: config.method,
            signal: controller.signal,
            headers: {
              ...(isBodyMethod ? { "Content-Type": "application/json" } : {}),
              Accept: "application/json, text/plain, */*",
              // Helps downstream buyers de-duplicate retries.
              "Idempotency-Key": `${lead.id}:${contract.contract_id}`,
              "X-Lead-Id": lead.id,
              "X-Delivery-Attempt": String(attempt),
              ...config.headers,
            },
            ...(isBodyMethod ? { body: JSON.stringify(bodyPayload) } : {}),
          });
        } finally {
          clearTimeout(timeoutId);
        }

        responseStatus = response.status;
        // Limit body capture to 4 KB to avoid bloating DynamoDB items.
        const raw = await response.text();
        responseBody = raw.slice(0, 4096);

        if (
          this.isRetryableStatus(responseStatus) &&
          attempt < LeadDeliveryService.MAX_WEBHOOK_ATTEMPTS
        ) {
          await this.sleep(
            LeadDeliveryService.RETRY_BACKOFF_MS * 2 ** (attempt - 1),
          );
          continue;
        }

        if (destinationType === "webhook" && primaryDestination) {
          const matchResult = this.evaluateResponseValidation(
            responseBody,
            responseStatus,
            contract.response_validation,
            primaryDestination.id,
          );
          accepted = matchResult.accepted;
          acceptanceMatch = matchResult.matchedValue;
        } else if (destinationType !== "webhook") {
          const successfulSend = responseStatus >= 200 && responseStatus < 300;
          accepted = successfulSend && nonWebhookDeliveryAction === "passed";
          acceptanceMatch = successfulSend
            ? `status:${responseStatus}|${nonWebhookDeliveryAction ?? "failed"}`
            : undefined;
        } else {
          // Legacy delivery_config mode.
          const matchResult = this.evaluateAcceptanceRules(
            responseBody,
            responseStatus,
            config.acceptance_rules,
          );
          accepted = matchResult.accepted;
          acceptanceMatch = matchResult.matchedValue;
        }
        error = undefined;
        break;
      } catch (err: any) {
        error =
          err?.name === "AbortError"
            ? `Webhook timed out after ${LeadDeliveryService.WEBHOOK_TIMEOUT_MS}ms`
            : (err?.message ?? "Unknown delivery error");

        if (
          this.isRetryableError(err) &&
          attempt < LeadDeliveryService.MAX_WEBHOOK_ATTEMPTS
        ) {
          await this.sleep(
            LeadDeliveryService.RETRY_BACKOFF_MS * 2 ** (attempt - 1),
          );
          continue;
        }

        accepted = false;
        break;
      }
    }

    return {
      contract_id: contract.contract_id,
      client_id: contract.client_id,
      delivered_at: deliveredAt,
      attempts,
      webhook_url: config.url,
      webhook_method: config.method,
      ...(responseStatus !== undefined
        ? { webhook_response_status: responseStatus }
        : {}),
      ...(responseBody !== undefined
        ? { webhook_response_body: responseBody }
        : {}),
      accepted,
      ...(acceptanceMatch !== undefined
        ? { acceptance_match: acceptanceMatch }
        : {}),
      ...(error !== undefined ? { error } : {}),
      distribution_mode: distributionMode,
      contract_weight_at_delivery: contract.weight ?? 1,
      client_weight_at_delivery: contract.weight ?? 1,
    };
  }

  private evaluateResponseValidation(
    body: string,
    status: number | undefined,
    validation: ICampaignContract["response_validation"],
    destinationId: string,
  ): { accepted: boolean; matchedValue?: string } {
    const rules = this.normalizeResponseValidationRules(validation).filter(
      (rule) =>
        rule.destination_id === destinationId &&
        rule.match_value?.trim().length > 0,
    );

    if (rules.length === 0) {
      return { accepted: false };
    }

    const responseIndex = this.buildResponseIndex(body);
    for (const rule of rules) {
      const matched = this.matchesRuleExpression(
        rule.match_value,
        status,
        responseIndex,
      );
      if (matched) {
        return {
          accepted: rule.action === "passed",
          ...(rule.match_value.trim().length > 0
            ? { matchedValue: rule.match_value.trim() }
            : {}),
        };
      }
    }

    return { accepted: false };
  }

  private isRetryableStatus(status: number): boolean {
    return status === 408 || status === 425 || status === 429 || status >= 500;
  }

  private buildDeliveryRejectionReason(result: ILeadDeliveryResult): string {
    if (result.error && result.error.trim().length > 0) {
      return `Contract delivery failed: ${result.error}`;
    }
    if (typeof result.webhook_response_status === "number") {
      return `Contract delivery was rejected (status ${result.webhook_response_status})`;
    }
    return "Contract delivery was not accepted";
  }

  private async markLeadRejectedWithoutDelivery(
    lead: ILead,
    reason: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    const existingReason =
      typeof lead.rejection_reason === "string" &&
      lead.rejection_reason.trim().length > 0
        ? lead.rejection_reason.trim()
        : undefined;
    const existingErrors = Array.isArray(lead.rejection_errors)
      ? lead.rejection_errors.filter(
          (value): value is string =>
            typeof value === "string" && value.trim().length > 0,
        )
      : [];
    const effectiveReason = existingReason ?? reason;
    const effectiveErrors =
      existingErrors.length > 0 ? existingErrors : [effectiveReason];

    lead.sold = false;
    lead.rejected = true;
    lead.rejection_reason = effectiveReason;
    lead.rejection_errors = effectiveErrors;
    lead.updated_at = now;

    await this.dynamoDBUtil.update({
      TableName: this.constants.LEADS_TABLE_NAME,
      Key: { id: lead.id },
      UpdateExpression:
        "SET delivery_skipped_reason = :reason, sold = :sold, rejected = :rejected, rejection_reason = :rejection_reason, rejection_errors = :rejection_errors, updated_at = :now",
      ExpressionAttributeValues: {
        ":reason": reason,
        ":sold": false,
        ":rejected": true,
        ":rejection_reason": effectiveReason,
        ":rejection_errors": effectiveErrors,
        ":now": now,
      },
    });

    await this.auditWriterService.writeAuditEvent({
      entity_id: lead.id,
      entity_type: "lead",
      action: "delivery_skipped",
      changes: [
        {
          field: "delivery_skipped_reason",
          from: null,
          to: reason,
        },
        {
          field: "sold",
          from: null,
          to: false,
        },
        {
          field: "rejected",
          from: false,
          to: true,
        },
        {
          field: "rejection_reason",
          from: existingReason ?? null,
          to: effectiveReason,
        },
      ],
      actor: {
        username: "system:lead-delivery",
        full_name: "Lead Delivery",
      },
      changed_at: now,
    });
  }

  private isRetryableError(err: unknown): boolean {
    const e = err as { name?: string; message?: string };
    if (e?.name === "AbortError") return true;
    const msg = (e?.message ?? "").toLowerCase();
    return (
      msg.includes("timeout") ||
      msg.includes("timed out") ||
      msg.includes("network") ||
      msg.includes("fetch failed")
    );
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async fireAffiliateSoldPixel(
    campaign: ICampaign,
    lead: ILead,
  ): Promise<void> {
    const affiliate = (campaign.affiliates ?? []).find(
      (a) => a.campaign_key === lead.campaign_key,
    );

    if (!affiliate?.sold_pixel_config?.enabled) {
      return;
    }

    // Per-affiliate pixel_criteria: evaluate against lead payload.
    // If any rule fails, suppress the pixel entirely.
    const pixelCriteria = affiliate.pixel_criteria ?? [];
    if (pixelCriteria.length > 0) {
      const payload = (lead.payload ?? {}) as Record<string, unknown>;
      if (!this.passesLogicRules(pixelCriteria, payload)) {
        this.logger.info("Pixel suppressed by pixel_criteria", {
          leadId: lead.id,
          affiliateId: affiliate.affiliate_id,
        });
        return;
      }
    }

    const config = affiliate.sold_pixel_config;
    const firedAt = new Date().toISOString();
    const { queryParams, bodyPayload } = this.buildPixelPayload(lead, config);
    const hasQueryParams = Object.keys(queryParams).length > 0;
    const hasBodyPayload = Object.keys(bodyPayload).length > 0;
    const isBodyMethod = config.method !== "GET" && hasBodyPayload;
    const finalUrl = hasQueryParams
      ? this.appendQueryParams(config.url, queryParams)
      : config.url;

    let responseStatus: number | undefined;
    let responseBody: string | undefined;
    let errorMessage: string | undefined;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        LeadDeliveryService.PIXEL_TIMEOUT_MS,
      );

      let response: Response;
      try {
        response = await fetch(finalUrl, {
          method: config.method,
          signal: controller.signal,
          headers: {
            ...(isBodyMethod ? { "Content-Type": "application/json" } : {}),
            Accept: "application/json, text/plain, */*",
            "X-Lead-Id": lead.id,
            "X-Affiliate-Pixel": "true",
            ...config.headers,
          },
          ...(isBodyMethod ? { body: JSON.stringify(bodyPayload) } : {}),
        });
      } finally {
        clearTimeout(timeoutId);
      }

      responseStatus = response.status;
      const raw = await response.text();
      responseBody = raw.slice(0, 4096);
    } catch (error: any) {
      errorMessage =
        error?.name === "AbortError"
          ? `Pixel webhook timed out after ${LeadDeliveryService.PIXEL_TIMEOUT_MS}ms`
          : (error?.message ?? "Unknown affiliate pixel error");
    }

    const success =
      errorMessage === undefined &&
      typeof responseStatus === "number" &&
      responseStatus >= 200 &&
      responseStatus < 300;

    const pixelResult: IAffiliatePixelResult = {
      affiliate_id: affiliate.affiliate_id,
      campaign_id: campaign.id,
      fired_at: firedAt,
      webhook_url: config.url,
      final_webhook_url: finalUrl,
      webhook_method: config.method,
      ...(hasQueryParams ? { sent_query_params: queryParams } : {}),
      ...(hasBodyPayload ? { sent_body_payload: bodyPayload } : {}),
      ...(responseStatus !== undefined
        ? { webhook_response_status: responseStatus }
        : {}),
      ...(responseBody !== undefined
        ? { webhook_response_body: responseBody }
        : {}),
      success,
      ...(errorMessage !== undefined ? { error: errorMessage } : {}),
    };

    await this.persistAffiliatePixelResult(lead, pixelResult);

    if (!success) {
      this.logger.warn("Affiliate sold pixel dispatch failed", {
        leadId: lead.id,
        campaignId: campaign.id,
        affiliateId: affiliate.affiliate_id,
        status: responseStatus,
        error: errorMessage,
      });
      return;
    }

    this.logger.info("Affiliate sold pixel dispatched", {
      leadId: lead.id,
      campaignId: campaign.id,
      affiliateId: affiliate.affiliate_id,
      status: responseStatus,
    });
  }

  private async persistAffiliatePixelResult(
    lead: ILead,
    result: IAffiliatePixelResult,
  ): Promise<void> {
    const previousResult = lead.affiliate_pixel_result ?? null;
    lead.affiliate_pixel_result = result;
    lead.updated_at = result.fired_at;

    await this.dynamoDBUtil.update({
      TableName: this.constants.LEADS_TABLE_NAME,
      Key: { id: lead.id },
      UpdateExpression: "SET affiliate_pixel_result = :apr, updated_at = :now",
      ExpressionAttributeValues: {
        ":apr": result,
        ":now": result.fired_at,
      },
    });

    await this.auditWriterService.writeAuditEvent({
      entity_id: lead.id,
      entity_type: "lead",
      action: result.success
        ? "affiliate_pixel_fired"
        : "affiliate_pixel_failed",
      changes: [
        {
          field: "affiliate_pixel_result",
          from: previousResult,
          to: result,
        },
      ],
      actor: { username: "system:lead-delivery", full_name: "Lead Delivery" },
      changed_at: result.fired_at,
    });
  }

  private buildPixelPayload(
    lead: ILead,
    config: IAffiliateSoldPixelConfig,
  ): {
    queryParams: Record<string, unknown>;
    bodyPayload: Record<string, unknown>;
  } {
    const queryParams: Record<string, unknown> = {};
    const bodyPayload: Record<string, unknown> = {};

    for (const mapping of config.payload_mapping) {
      const resolvedTarget =
        mapping.parameter_target ??
        (config.method === "GET"
          ? "query"
          : (config.parameter_mode ?? "query"));
      const value = this.resolveMapping(mapping, lead);

      if (resolvedTarget === "body") {
        bodyPayload[mapping.key] = value;
      } else {
        queryParams[mapping.key] = value;
      }
    }

    return { queryParams, bodyPayload };
  }

  /**
   * Build the outbound payload object by resolving each field mapping against
   * the lead's payload, using `field_name` to look up values.
   */
  private buildPayload(
    lead: ILead,
    config: IClientDeliveryConfig,
  ): {
    queryParams: Record<string, unknown>;
    bodyPayload: Record<string, unknown>;
  } {
    const queryParams: Record<string, unknown> = {};
    const bodyPayload: Record<string, unknown> = {};

    for (const mapping of config.payload_mapping) {
      const value = this.resolveMapping(mapping, lead);
      const resolvedTarget =
        config.method === "GET"
          ? "query"
          : (mapping.parameter_target ?? "body");

      if (resolvedTarget === "query") {
        queryParams[mapping.key] = value;
      } else {
        bodyPayload[mapping.key] = value;
      }
    }

    return { queryParams, bodyPayload };
  }

  private resolveMapping(mapping: IWebhookFieldMapping, lead: ILead): unknown {
    if (mapping.value_source === "static") {
      return mapping.static_value;
    }

    if (mapping.value_source === "lead_id") {
      return lead.id;
    }

    // value_source === "field"
    const fieldName = mapping.field_name!;
    const leadPayload = lead.payload as Record<string, unknown> | undefined;

    if (leadPayload && fieldName in leadPayload) {
      return leadPayload[fieldName];
    }

    // Fall through to top-level lead fields.
    const topLevel: Record<string, unknown> = lead as unknown as Record<
      string,
      unknown
    >;
    return topLevel[fieldName];
  }

  private appendQueryParams(
    url: string,
    params: Record<string, unknown>,
  ): string {
    const u = new URL(url);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) {
        u.searchParams.set(k, String(v));
      }
    }
    return u.toString();
  }

  private normalizeResponseValidationRules(
    validation:
      | (IClientResponseValidation & {
          groups?: Array<{ conditions?: Array<Partial<IValidationRule>> }>;
        })
      | undefined,
  ): IValidationRule[] {
    if (!validation) return [];

    const rules = (validation as { rules?: Array<Partial<IValidationRule>> })
      .rules;
    if (Array.isArray(rules)) {
      return rules
        .filter((rule) => typeof rule?.destination_id === "string")
        .map((rule) => ({
          destination_id: rule.destination_id as string,
          match_value:
            typeof rule.match_value === "string" ? rule.match_value : "",
          action: rule.action as IValidationRule["action"],
        }));
    }

    const flattened: IValidationRule[] = [];
    for (const group of validation.groups ?? []) {
      for (const condition of group.conditions ?? []) {
        flattened.push({
          destination_id:
            typeof condition.destination_id === "string"
              ? condition.destination_id
              : "",
          match_value:
            typeof condition.match_value === "string"
              ? condition.match_value
              : "",
          action: condition.action as IValidationRule["action"],
        });
      }
    }

    return flattened;
  }

  /**
   * Walk acceptance rules in order and return the first match.
   * If no rule matches the response body, default to failed (no match = no sale).
   */
  private evaluateAcceptanceRules(
    body: string,
    status: number | undefined,
    rules: IClientDeliveryConfig["acceptance_rules"] | undefined,
  ): { accepted: boolean; matchedValue?: string } {
    if (!Array.isArray(rules) || rules.length === 0) {
      return { accepted: false };
    }

    const responseIndex = this.buildResponseIndex(body);

    for (const rule of rules) {
      if (this.matchesRuleExpression(rule.match_value, status, responseIndex)) {
        return {
          accepted: rule.action === "passed",
          matchedValue: rule.match_value,
        };
      }
    }

    // No rule matched — treat as failed (no sale).
    return { accepted: false };
  }

  private buildResponseIndex(body: string): {
    lowerBody: string;
    keyValuePairs: Array<{ key: string; value: string }>;
  } {
    const lowerBody = body.toLowerCase();
    const keyValuePairs: Array<{ key: string; value: string }> = [];

    // Try JSON first for precise key:value matching.
    try {
      const parsed = JSON.parse(body);
      const walk = (node: unknown, path: string[]) => {
        if (
          node === null ||
          typeof node === "string" ||
          typeof node === "number" ||
          typeof node === "boolean"
        ) {
          const keyPath = path.join(".").toLowerCase();
          const value = String(node).toLowerCase();
          if (keyPath && value) {
            keyValuePairs.push({ key: keyPath, value });
            const leaf = path[path.length - 1]?.toLowerCase();
            if (leaf && leaf !== keyPath) {
              keyValuePairs.push({ key: leaf, value });
            }
          }
          return;
        }

        if (Array.isArray(node)) {
          node.forEach((value, index) => walk(value, [...path, String(index)]));
          return;
        }

        if (typeof node === "object" && node !== null) {
          for (const [key, value] of Object.entries(node)) {
            walk(value, [...path, key]);
          }
        }
      };

      walk(parsed, []);
    } catch {
      // Not JSON; fall through to other extractors.
    }

    // Lightweight XML leaf extraction for expressions like "status:accepted".
    const xmlRegex = /<([a-zA-Z0-9_.:-]+)(?:\s[^>]*)?>([^<]*)<\/\1>/g;
    let xmlMatch: RegExpExecArray | null;
    while ((xmlMatch = xmlRegex.exec(body)) !== null) {
      const key = xmlMatch[1]?.trim().toLowerCase();
      const value = xmlMatch[2]?.trim().toLowerCase();
      if (key && value) {
        keyValuePairs.push({ key, value });
      }
    }

    // Generic plain-text key/value extraction fallback.
    const kvRegex = /"?([a-zA-Z0-9_.:-]+)"?\s*[:=]\s*"?([^,\n\r\}\]]+)"?/g;
    let kvMatch: RegExpExecArray | null;
    while ((kvMatch = kvRegex.exec(body)) !== null) {
      const key = kvMatch[1]?.trim().toLowerCase();
      const value = kvMatch[2]?.trim().toLowerCase();
      if (key && value) {
        keyValuePairs.push({ key, value });
      }
    }

    return { lowerBody, keyValuePairs };
  }

  private matchesRuleExpression(
    matchValue: string,
    status: number | undefined,
    responseIndex: {
      lowerBody: string;
      keyValuePairs: Array<{ key: string; value: string }>;
    },
  ): boolean {
    const token = matchValue.trim();
    if (!token) return false;

    const statusExpression = /^status\s*:\s*(.+)$/i.exec(token);
    if (statusExpression) {
      return this.matchesStatusExpression(status, statusExpression[1]);
    }

    const idx = token.indexOf(":");
    if (idx > 0) {
      const key = token.slice(0, idx).trim().toLowerCase();
      const expected = token
        .slice(idx + 1)
        .trim()
        .toLowerCase();
      if (!key || !expected) return false;

      return responseIndex.keyValuePairs.some(
        (pair) =>
          (pair.key === key || pair.key.endsWith(`.${key}`)) &&
          pair.value.includes(expected),
      );
    }

    return responseIndex.lowerBody.includes(token.toLowerCase());
  }

  private matchesStatusExpression(
    status: number | undefined,
    expression: string,
  ): boolean {
    if (status === undefined) return false;

    const candidates = expression
      .split(",")
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean);

    for (const candidate of candidates) {
      if (/^\d{3}$/.test(candidate)) {
        if (status === Number(candidate)) return true;
        continue;
      }

      if (/^\dxx$/.test(candidate)) {
        if (Math.floor(status / 100) === Number(candidate[0])) return true;
        continue;
      }

      const range = /^(\d{3})\s*-\s*(\d{3})$/.exec(candidate);
      if (range) {
        const min = Number(range[1]);
        const max = Number(range[2]);
        if (status >= min && status <= max) return true;
        continue;
      }

      const comparator = /^(>=|<=|>|<)\s*(\d{3})$/.exec(candidate);
      if (comparator) {
        const operator = comparator[1];
        const boundary = Number(comparator[2]);
        if (operator === ">" && status > boundary) return true;
        if (operator === "<" && status < boundary) return true;
        if (operator === ">=" && status >= boundary) return true;
        if (operator === "<=" && status <= boundary) return true;
      }
    }

    return false;
  }

  /**
   * Reload the campaign and increment leads_delivered_count for the specified
   * contract. A full put is used because DynamoDB cannot address list items by
   * value in an UpdateExpression.
   */
  private async incrementContractLeadsDelivered(
    campaign: ICampaign,
    contractId: string,
    now: string,
  ): Promise<void> {
    try {
      // We already have the campaign in memory (passed by reference from
      // deliverLead). Mutate it so the in-memory copy stays consistent.
      const contracts = campaign.contracts ?? campaign.clients ?? [];
      const contract = contracts.find((c) => c.contract_id === contractId);
      if (contract) {
        contract.leads_delivered_count =
          (contract.leads_delivered_count ?? 0) + 1;
        campaign.contracts = contracts;
        campaign.clients = contracts;
      }
      campaign.updated_at = now;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });
    } catch (err: any) {
      // Non-fatal: log and continue. The lead delivery result is already persisted.
      this.logger.error("Failed to increment contract leads_delivered_count", {
        campaignId: campaign.id,
        contractId,
        error: err?.message,
      });
    }
  }
}
