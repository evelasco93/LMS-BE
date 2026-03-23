import { injectable, inject } from "inversify";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { Logger } from "@shared/services/logger.util";
import { LambdaInvokeUtil } from "@shared/services/lambda-invoke.util";
import { AuditWriterService } from "@shared/services";
import { LeadsConstants } from "../constants/leads.constants";
import { ILead, ITrustedFormResult } from "../interfaces/ILead.interface";
import {
  ICampaign,
  ICampaignClient,
} from "../../campaigns/interfaces/ICampaign.interface";
import {
  IClientDeliveryConfig,
  ILeadDeliveryResult,
  IWebhookFieldMapping,
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
   * Mutates `lead` in-place (sold, sold_to_client_id, delivery_result) so the
   * caller can return the enriched object in the intake response if needed.
   */
  async deliverLead(
    lead: ILead,
    campaign: ICampaign,
    isTest: boolean,
  ): Promise<void> {
    if (isTest) {
      // Test leads are never delivered.
      return;
    }

    const distribution = campaign.distribution;
    if (!distribution?.enabled) {
      // Distribution is disabled for this campaign; nothing to do.
      return;
    }

    const client = this.pickDeliveryClient(campaign);
    if (!client) {
      this.logger.info("No eligible LIVE client found for delivery", {
        campaignId: campaign.id,
        leadId: lead.id,
      });
      return;
    }

    // Claim the TrustedForm certificate before delivery if required.
    if (client.delivery_config?.claim_trusted_form) {
      const { claimed, error: claimError } =
        await this.claimCertBeforeDelivery(lead);
      // Gate on claim failure if either: per-client require_successful_claim is set,
      // OR the campaign-level TrustedForm plugin has gate=true ("Reject on failure").
      const claimGate =
        client.delivery_config.require_successful_claim === true ||
        campaign.plugins?.trusted_form?.gate === true;
      if (!claimed && claimGate) {
        this.logger.warn(
          "TrustedForm claim failed; skipping delivery due to claim gate",
          { leadId: lead.id, clientId: client.client_id, error: claimError },
        );
        const now = new Date().toISOString();
        const rejectionReason =
          claimError && claimError.trim().length > 0
            ? `TrustedForm claim failed: ${claimError}`
            : "TrustedForm claim failed";
        lead.rejected = true;
        lead.rejection_reason = rejectionReason;
        lead.rejection_errors = [rejectionReason];
        lead.updated_at = now;
        await this.dynamoDBUtil.update({
          TableName: this.constants.LEADS_TABLE_NAME,
          Key: { id: lead.id },
          UpdateExpression:
            "SET delivery_skipped_reason = :reason, rejected = :rejected, rejection_reason = :rejection_reason, rejection_errors = :rejection_errors, updated_at = :now",
          ExpressionAttributeValues: {
            ":reason": rejectionReason,
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
      client,
      distribution.mode ?? "round_robin",
    );

    // Persist delivery outcome on the lead record.
    const now = new Date().toISOString();
    lead.sold = result.accepted;
    lead.sold_to_client_id = result.accepted ? client.client_id : undefined;
    lead.delivery_result = result;
    lead.updated_at = now;

    await this.dynamoDBUtil.update({
      TableName: this.constants.LEADS_TABLE_NAME,
      Key: { id: lead.id },
      UpdateExpression:
        "SET sold = :sold, delivery_result = :dr, updated_at = :now" +
        (result.accepted ? ", sold_to_client_id = :clientId" : ""),
      ExpressionAttributeValues: {
        ":sold": result.accepted,
        ":dr": result,
        ":now": now,
        ...(result.accepted ? { ":clientId": client.client_id } : {}),
      },
    });

    // Atomically increment the client's leads_delivered_count on the campaign.
    // We do a full campaign reload + put rather than a complex nested list update
    // because DynamoDB UpdateExpression cannot address items by value inside a list.
    await this.incrementClientLeadsDelivered(campaign, client.client_id, now);

    // Update rr cursor when round_robin mode is active.
    if (distribution.mode === "round_robin") {
      await this.dynamoDBUtil.update({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Key: { id: campaign.id },
        UpdateExpression: "SET rr_last_client_id = :cid, updated_at = :now",
        ExpressionAttributeValues: {
          ":cid": client.client_id,
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
          field: "sold_to_client_id",
          from: null,
          to: result.accepted ? client.client_id : null,
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

    this.logger.info("Lead delivery complete", {
      leadId: lead.id,
      clientId: client.client_id,
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

  /**   * Select exactly one LIVE client to deliver to according to distribution mode.
   *
   * LIVE guard (delivery_config completeness) is enforced at status-update time,
   * so here we only need to filter by status + config presence.
   */
  private pickDeliveryClient(campaign: ICampaign): ICampaignClient | null {
    const eligible = (campaign.clients ?? []).filter(
      (c) =>
        c.status === CampaignParticipantStatus.LIVE &&
        c.delivery_config?.url &&
        c.delivery_config?.payload_mapping?.length &&
        c.delivery_config?.acceptance_rules?.length,
    );

    if (eligible.length === 0) return null;
    if (eligible.length === 1) return eligible[0];

    const mode = campaign.distribution?.mode ?? "round_robin";

    if (mode === "weighted") {
      return this.pickWeighted(eligible);
    }

    // round_robin (default)
    return this.pickRoundRobin(eligible, campaign.rr_last_client_id);
  }

  private pickRoundRobin(
    clients: ICampaignClient[],
    lastClientId?: string,
  ): ICampaignClient {
    if (!lastClientId) return clients[0];
    const lastIdx = clients.findIndex((c) => c.client_id === lastClientId);
    if (lastIdx === -1) return clients[0];
    return clients[(lastIdx + 1) % clients.length];
  }

  private pickWeighted(clients: ICampaignClient[]): ICampaignClient {
    // Weighted-fair: pick the client that is furthest below its target ratio.
    // ratio_target = client.weight / sum(all weights)
    // ratio_actual = client.leads_delivered_count / total_delivered
    const totalWeight = clients.reduce((s, c) => s + (c.weight ?? 1), 0);
    const totalDelivered = clients.reduce(
      (s, c) => s + (c.leads_delivered_count ?? 0),
      0,
    );

    let best: ICampaignClient = clients[0];
    let bestDeficit = -Infinity;

    for (const c of clients) {
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
   * POST the lead payload to the client's webhook and interpret the response.
   */
  private async executeWebhook(
    lead: ILead,
    client: ICampaignClient,
    distributionMode: "round_robin" | "weighted",
  ): Promise<ILeadDeliveryResult> {
    const config = client.delivery_config as IClientDeliveryConfig;
    const deliveredAt = new Date().toISOString();

    const payload = this.buildPayload(lead, config);

    let responseStatus: number | undefined;
    let responseBody: string | undefined;
    let accepted = false;
    let acceptanceMatch: string | undefined;
    let error: string | undefined;

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        LeadDeliveryService.WEBHOOK_TIMEOUT_MS,
      );

      let response: Response;
      try {
        // Only POST / PUT / PATCH send a JSON body; GET uses query params.
        const isBodyMethod = ["POST", "PUT", "PATCH"].includes(config.method);
        const url = isBodyMethod
          ? config.url
          : this.appendQueryParams(config.url, payload);

        response = await fetch(url, {
          method: config.method,
          signal: controller.signal,
          headers: {
            ...(isBodyMethod ? { "Content-Type": "application/json" } : {}),
            Accept: "application/json, text/plain, */*",
            ...config.headers,
          },
          ...(isBodyMethod ? { body: JSON.stringify(payload) } : {}),
        });
      } finally {
        clearTimeout(timeoutId);
      }

      responseStatus = response.status;
      // Limit body capture to 4 KB to avoid bloating DynamoDB items.
      const raw = await response.text();
      responseBody = raw.slice(0, 4096);

      // Evaluate acceptance rules against the raw response body.
      const matchResult = this.evaluateAcceptanceRules(
        responseBody,
        config.acceptance_rules,
      );
      accepted = matchResult.accepted;
      acceptanceMatch = matchResult.matchedValue;
    } catch (err: any) {
      error =
        err?.name === "AbortError"
          ? `Webhook timed out after ${LeadDeliveryService.WEBHOOK_TIMEOUT_MS}ms`
          : (err?.message ?? "Unknown delivery error");
      accepted = false;
    }

    return {
      client_id: client.client_id,
      delivered_at: deliveredAt,
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
      client_weight_at_delivery: client.weight ?? 1,
    };
  }

  /**
   * Build the outbound payload object by resolving each field mapping against
   * the lead's payload, using `field_name` to look up values.
   */
  private buildPayload(
    lead: ILead,
    config: IClientDeliveryConfig,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const mapping of config.payload_mapping) {
      result[mapping.key] = this.resolveMapping(mapping, lead);
    }

    return result;
  }

  private resolveMapping(mapping: IWebhookFieldMapping, lead: ILead): unknown {
    if (mapping.value_source === "static") {
      return mapping.static_value;
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

  /**
   * Walk acceptance rules in order and return the first match.
   * If no rule matches the response body, default to failed (no match = no sale).
   */
  private evaluateAcceptanceRules(
    body: string,
    rules: IClientDeliveryConfig["acceptance_rules"],
  ): { accepted: boolean; matchedValue?: string } {
    const lowerBody = body.toLowerCase();

    for (const rule of rules) {
      if (lowerBody.includes(rule.match_value.toLowerCase())) {
        return {
          accepted: rule.action === "passed",
          matchedValue: rule.match_value,
        };
      }
    }

    // No rule matched — treat as failed (no sale).
    return { accepted: false };
  }

  /**
   * Reload the campaign and increment leads_delivered_count for the specified
   * client.  A full put is used because DynamoDB cannot address list items by
   * value in an UpdateExpression.
   */
  private async incrementClientLeadsDelivered(
    campaign: ICampaign,
    clientId: string,
    now: string,
  ): Promise<void> {
    try {
      // We already have the campaign in memory (passed by reference from
      // deliverLead). Mutate it so the in-memory copy stays consistent.
      const client = (campaign.clients ?? []).find(
        (c) => c.client_id === clientId,
      );
      if (client) {
        client.leads_delivered_count = (client.leads_delivered_count ?? 0) + 1;
      }
      campaign.updated_at = now;

      await this.dynamoDBUtil.put({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Item: campaign,
      });
    } catch (err: any) {
      // Non-fatal: log and continue. The lead delivery result is already persisted.
      this.logger.error("Failed to increment client leads_delivered_count", {
        campaignId: campaign.id,
        clientId,
        error: err?.message,
      });
    }
  }
}
