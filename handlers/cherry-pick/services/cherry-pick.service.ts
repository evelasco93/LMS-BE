import { injectable, inject } from "inversify";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { Logger } from "@shared/services/logger.util";
import { LambdaInvokeUtil } from "@shared/services/lambda-invoke.util";
import { AuditWriterService } from "@shared/services";
import { RequestActor } from "@shared/utils/request-audit.util";
import { CherryPickConstants } from "../constants/cherry-pick.constants";
import {
  ExecuteCherryPickRequest,
  UpdatePickabilityRequest,
  EligibleContractEntry,
} from "../types/cherry-pick-request.types";
import { ServiceResult } from "../types/common.types";
import {
  ILead,
  ICherryPickMeta,
  IAffiliatePixelResult,
  ITrustedFormResult,
} from "../../leads/interfaces/ILead.interface";
import { MetricsService } from "../../leads/services/metrics.service";
import { MetricsDlqClient } from "../../leads/services/metrics-dlq.client";
import {
  buildCherryPickEvent,
  buildLeadOutcomeEvent,
} from "../../leads/services/lead-outcome-event.builder";
import {
  ICampaign,
  ICampaignContract,
} from "../../campaigns/interfaces/ICampaign.interface";
import {
  IAffiliateSoldPixelConfig,
  IClientDeliveryConfig,
  IDestination,
  ILeadDeliveryResult,
  ILeadDeliveryPayloadSnapshot,
  IResolvedWebhookPayloadEntry,
  IWebhookFieldMapping,
} from "../../campaigns/interfaces/IClientDelivery.interface";
import { CampaignParticipantStatus } from "../../campaigns/enums/campaign-participant-status.enum";

const MAX_WEBHOOK_ATTEMPTS = 3;
const WEBHOOK_TIMEOUT_MS = 10_000;
const PIXEL_TIMEOUT_MS = 5_000;
const RETRY_BACKOFF_MS = 500;

export interface ISourceAffiliatePixelInfo {
  affiliate_id: string;
  campaign_id: string;
  campaign_key: string;
  pixel_enabled: boolean;
  pixel_url?: string;
  pixel_method?: IAffiliateSoldPixelConfig["method"];
}

@injectable()
export class CherryPickService {
  constructor(
    @inject("DynamoDBUtil") private readonly dynamoDBUtil: DynamoDBUtil,
    @inject("Logger") private readonly logger: Logger,
    @inject("LambdaInvokeUtil")
    private readonly lambdaInvokeUtil: LambdaInvokeUtil,
    @inject("CherryPickConstants")
    private readonly constants: CherryPickConstants,
    @inject("AuditWriterService")
    private readonly auditWriterService: AuditWriterService,
    @inject("MetricsService")
    private readonly metricsService: MetricsService,
    @inject("MetricsDlqClient")
    private readonly metricsDlqClient: MetricsDlqClient,
  ) {}

  /**
   * Resolve the primary destination on a contract. The contract delivery
   * model is destinations[] with exactly one `is_primary: true`. If no
   * destination is flagged primary we fall back to the first entry to keep
   * cherry-pick (a manual override) functional on partially-configured
   * contracts.
   */
  private getPrimaryDestinationForContract(
    contract: ICampaignContract,
  ): IDestination | null {
    const destinations = contract.destinations ?? [];
    if (destinations.length === 0) return null;
    return (
      destinations.find((d: IDestination) => d.is_primary) ??
      destinations[0] ??
      null
    );
  }

  /**
   * Adapt a destination + the contract-level `response_validation` to the
   * legacy `IClientDeliveryConfig` shape consumed by `executeWebhook`. Only
   * `passed` rules scoped to this destination_id are surfaced; cherry-pick
   * never auto-fails on a `failed` rule because it is an operator-driven
   * override.
   *
   * NOTE (product): When `response_validation` has no `passed` rule for the
   * primary destination we treat any 2xx response as accepted (override
   * semantics — see `executeWebhook`'s acceptance_rules-empty branch).
   */
  private buildDestinationAdapter(
    contract: ICampaignContract,
    destination: IDestination,
  ): IClientDeliveryConfig {
    const rules = contract.response_validation?.rules ?? [];
    const acceptanceRules = rules
      .filter(
        (r: { destination_id: string; action: string }) =>
          r.destination_id === destination.id && r.action === "passed",
      )
      .map((r: { match_value: string }) => ({
        match_value: r.match_value,
        action: "passed" as const,
      }));

    return {
      url: destination.url,
      method: destination.method,
      ...(destination.headers ? { headers: destination.headers } : {}),
      payload_mapping: destination.payload_mapping,
      acceptance_rules: acceptanceRules,
      claim_trusted_form: true,
      ...(destination.require_successful_claim !== undefined
        ? { require_successful_claim: destination.require_successful_claim }
        : {}),
    };
  }

  async executeCherryPick(
    leadId: string,
    request: ExecuteCherryPickRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<ICherryPickMeta>> {
    try {
      const lead = await this.dynamoDBUtil.get<ILead>({
        TableName: this.constants.LEADS_TABLE_NAME,
        Key: { id: leadId },
      });
      if (!lead) {
        return { result: false, error: `Lead ${leadId} not found` };
      }
      if (lead.cherry_picked) {
        return {
          result: false,
          error: `Lead ${leadId} has already been cherry-picked`,
        };
      }

      if (!request.target_contract_id) {
        return {
          result: false,
          error: "target_contract_id is required",
        };
      }

      const lookup = await this.resolveContractTarget(
        request.target_contract_id,
        request.campaign_id,
      );
      if (!lookup.result) {
        return { result: false, error: lookup.error };
      }
      const campaign = lookup.data!.campaign;
      const campaignClient = lookup.data!.contract;

      const primaryDestination =
        this.getPrimaryDestinationForContract(campaignClient);
      if (!primaryDestination?.url) {
        return {
          result: false,
          error: `Contract ${request.target_contract_id} does not have a primary destination configured`,
        };
      }
      const deliveryConfig = this.buildDestinationAdapter(
        campaignClient,
        primaryDestination,
      );

      const leadForDelivery = this.applyCherryPickPayloadMutations(
        lead,
        request,
      );

      // TrustedForm claim before delivery — skipped when operator explicitly opts out.
      if (
        deliveryConfig.claim_trusted_form &&
        !request.skip_trusted_form_claim
      ) {
        const { claimed, error: claimError } =
          await this.claimTrustedFormCert(leadForDelivery);
        const claimGate =
          deliveryConfig.require_successful_claim === true ||
          campaign.plugins?.trusted_form?.gate === true;
        if (!claimed && claimGate) {
          const reason = claimError?.trim()
            ? `TrustedForm claim failed: ${claimError}`
            : "TrustedForm claim failed";
          return { result: false, error: reason };
        }
      }

      const executedAt = new Date().toISOString();
      const deliveryResult = await this.executeWebhook(
        leadForDelivery,
        campaignClient,
        deliveryConfig,
      );

      const resolvedTargetClientId = campaignClient.client_id;
      const resolvedTargetContractId = campaignClient.contract_id;
      const resolvedTargetCampaignId = campaign!.id;

      const cherryPickMeta: ICherryPickMeta = {
        target_contract_id: resolvedTargetContractId,
        target_campaign_id: resolvedTargetCampaignId,
        // Source campaign (Option A): the lead stays on its origin campaign;
        // we record the lead's source here so reporting attribution is
        // unchanged even when the target contract belongs to a different
        // campaign.
        source_campaign_id: lead.campaign_id,
        delivery_result: deliveryResult,
        executed_at: executedAt,
        executed_by: actor,
      };

      const accepted = deliveryResult.accepted === true;
      const rejectionReason = accepted
        ? null
        : this.buildCherryPickRejectionReason(deliveryResult);

      const updateExpression = accepted
        ? "SET cherry_picked = :cp, cherry_pickable = :pickable, cherry_pick_meta = :cpm, sold = :sold, sold_to_client_id = :clientId, delivery_result = :dr, rejected = :rejected, rejection_reason = :rejectionReason, rejection_errors = :rejectionErrors, updated_at = :now"
        : "SET cherry_picked = :cp, cherry_pickable = :pickable, cherry_pick_meta = :cpm, sold = :sold, delivery_result = :dr, rejected = :rejected, rejection_reason = :rejectionReason, rejection_errors = :rejectionErrors, updated_at = :now REMOVE sold_to_client_id";

      // Persist cherry-pick outcome on the lead.
      await this.dynamoDBUtil.update({
        TableName: this.constants.LEADS_TABLE_NAME,
        Key: { id: leadId },
        UpdateExpression: updateExpression,
        ExpressionAttributeValues: {
          ":cp": true,
          ":pickable": false,
          ":cpm": cherryPickMeta,
          ":sold": accepted,
          ":dr": deliveryResult,
          ":rejected": !accepted,
          ":rejectionReason": rejectionReason,
          ":rejectionErrors": rejectionReason ? [rejectionReason] : [],
          ...(accepted ? { ":clientId": resolvedTargetClientId } : {}),
          ":now": executedAt,
        },
      });

      lead.cherry_picked = true;
      lead.cherry_pickable = false;
      lead.cherry_pick_meta = cherryPickMeta;
      lead.sold = accepted;
      lead.sold_to_client_id = accepted ? resolvedTargetClientId : undefined;
      lead.delivery_result = deliveryResult;
      lead.rejected = !accepted;
      lead.rejection_reason = rejectionReason ?? undefined;
      lead.rejection_errors = rejectionReason ? [rejectionReason] : undefined;
      lead.updated_at = executedAt;

      await this.auditWriterService.writeAuditEvent({
        entity_id: leadId,
        entity_type: "lead",
        action: "cherry_pick_executed",
        changes: [
          { field: "cherry_picked", from: lead.cherry_picked, to: true },
          {
            field: "cherry_pickable",
            from: lead.cherry_pickable,
            to: false,
          },
          { field: "cherry_pick_meta", from: null, to: cherryPickMeta },
          { field: "sold", from: lead.sold, to: accepted },
          {
            field: "sold_to_client_id",
            from: lead.sold_to_client_id,
            to: accepted ? resolvedTargetClientId : null,
          },
          { field: "rejected", from: lead.rejected, to: !accepted },
          {
            field: "rejection_reason",
            from: lead.rejection_reason,
            to: rejectionReason,
          },
          ...(request.payload_overrides
            ? [
                {
                  field: "payload_overrides",
                  from: null,
                  to: request.payload_overrides,
                },
              ]
            : []),
          ...(request.removed_payload_fields &&
          request.removed_payload_fields.length > 0
            ? [
                {
                  field: "removed_payload_fields",
                  from: null,
                  to: request.removed_payload_fields,
                },
              ]
            : []),
        ],
        actor,
        changed_at: executedAt,
      });

      // ── Metrics fanout (best effort) ─────────────────────────────────────
      // Ensure non-test cherry-picks always emit the outcome axis and the
      // cherry-pick axis. Outcome emission is idempotent on
      // `lead_outcome:<lead_id>`, so already-counted leads remain safe.
      if (this.shouldEmitMetricsForLead(lead)) {
        try {
          await this.metricsService.recordLeadOutcome(lead);
        } catch (metricsError: any) {
          this.logger.error(
            "Failed to record cherry-pick lead outcome metric",
            {
              leadId,
              error: metricsError?.message,
            },
          );
          await this.metricsDlqClient.enqueue(
            buildLeadOutcomeEvent(lead),
            metricsError,
          );
        }

        try {
          await this.metricsService.recordLeadCherryPick(lead, executedAt);
        } catch (metricsError: any) {
          this.logger.error("Failed to record cherry-pick metric", {
            leadId,
            error: metricsError?.message,
          });
          await this.metricsDlqClient.enqueue(
            buildCherryPickEvent(lead, executedAt),
            metricsError,
          );
        }
      }

      if (accepted && request.fire_affiliate_pixel === true) {
        try {
          const sourceCampaign =
            lead.campaign_id === campaign.id
              ? campaign
              : await this.dynamoDBUtil.get<ICampaign>({
                  TableName: this.constants.CAMPAIGNS_TABLE_NAME,
                  Key: { id: lead.campaign_id },
                });

          const pixelResult = sourceCampaign
            ? await this.dispatchAffiliateSoldPixel(sourceCampaign, lead)
            : this.buildMissingSourceCampaignPixelResult(lead);

          await this.persistAffiliatePixelResult(lead, pixelResult, actor);
        } catch (pixelError: any) {
          this.logger.warn("Cherry-pick affiliate pixel workflow failed", {
            leadId,
            error: pixelError?.message,
          });
        }
      }

      this.logger.info("Cherry-pick executed", {
        leadId,
        targetContractId: resolvedTargetContractId,
        targetClientId: resolvedTargetClientId,
        targetCampaignId: resolvedTargetCampaignId,
        crossCampaign: resolvedTargetCampaignId !== lead.campaign_id,
        accepted: deliveryResult.accepted,
      });

      return { result: true, data: cherryPickMeta };
    } catch (error: any) {
      this.logger.error("Failed to execute cherry-pick", error);
      return {
        result: false,
        error: error.message || "Failed to execute cherry-pick",
      };
    }
  }

  async updatePickability(
    leadId: string,
    request: UpdatePickabilityRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<ILead>> {
    try {
      const lead = await this.dynamoDBUtil.get<ILead>({
        TableName: this.constants.LEADS_TABLE_NAME,
        Key: { id: leadId },
      });
      if (!lead) {
        return { result: false, error: `Lead ${leadId} not found` };
      }

      const now = new Date().toISOString();
      const prevValue = lead.cherry_pickable ?? false;

      await this.dynamoDBUtil.update({
        TableName: this.constants.LEADS_TABLE_NAME,
        Key: { id: leadId },
        UpdateExpression: "SET cherry_pickable = :cp, updated_at = :now",
        ExpressionAttributeValues: {
          ":cp": request.cherry_pickable,
          ":now": now,
        },
      });

      await this.auditWriterService.writeAuditEvent({
        entity_id: leadId,
        entity_type: "lead",
        action: "cherry_pick_pickability_updated",
        changes: [
          {
            field: "cherry_pickable",
            from: prevValue,
            to: request.cherry_pickable,
          },
        ],
        actor,
        changed_at: now,
      });

      lead.cherry_pickable = request.cherry_pickable;
      lead.updated_at = now;

      this.logger.info("Lead cherry-pick pickability updated", {
        leadId,
        cherry_pickable: request.cherry_pickable,
      });
      return { result: true, data: lead };
    } catch (error: any) {
      this.logger.error("Failed to update cherry-pick pickability", error);
      return {
        result: false,
        error: error.message || "Failed to update pickability",
      };
    }
  }

  /**
   * List ALL contracts eligible to receive a cherry-picked lead. Eligibility
   * is contract-level (`status === LIVE` + a configured delivery URL); the
   * parent campaign's status is intentionally NOT a filter — closed/paused
   * campaigns can still own active contracts that accept cherry-picks. The
   * lead's source attribution stays unchanged when delivered cross-campaign.
   */
  async listEligibleContracts(leadId: string): Promise<
    ServiceResult<{
      contracts: EligibleContractEntry[];
      source_affiliate_pixel?: ISourceAffiliatePixelInfo;
    }>
  > {
    try {
      const lead = await this.dynamoDBUtil.get<ILead>({
        TableName: this.constants.LEADS_TABLE_NAME,
        Key: { id: leadId },
      });
      if (!lead) {
        return { result: false, error: `Lead ${leadId} not found` };
      }

      const allCampaigns = await this.dynamoDBUtil.scanAll<ICampaign>({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        FilterExpression: "is_deleted <> :t",
        ExpressionAttributeValues: { ":t": true },
      });

      const sourceCampaign =
        allCampaigns.find((c) => c.id === lead.campaign_id) ??
        (await this.dynamoDBUtil.get<ICampaign>({
          TableName: this.constants.CAMPAIGNS_TABLE_NAME,
          Key: { id: lead.campaign_id },
        }));
      const sourceAffiliatePixel = this.buildSourceAffiliatePixelInfo(
        sourceCampaign ?? undefined,
        lead,
      );

      // Collect every LIVE contract that has a usable primary destination,
      // regardless of the parent campaign's status. Cherry-pick is an
      // operator override: it does NOT exclude the lead's source
      // campaign / source contract, nor contracts that previously rejected
      // the lead. The only filter is contract.status === LIVE plus a
      // configured primary destination URL.
      const liveEntries: {
        campaign: ICampaign;
        contract: ICampaignContract;
        primaryUrl: string;
      }[] = [];
      for (const campaign of allCampaigns) {
        const contracts = campaign.contracts ?? [];
        for (const contract of contracts) {
          if (contract.status !== CampaignParticipantStatus.LIVE) continue;
          const primary = this.getPrimaryDestinationForContract(contract);
          if (!primary?.url) continue;
          liveEntries.push({ campaign, contract, primaryUrl: primary.url });
        }
      }

      if (liveEntries.length === 0) {
        return {
          result: true,
          data: {
            contracts: [],
            ...(sourceAffiliatePixel
              ? { source_affiliate_pixel: sourceAffiliatePixel }
              : {}),
          },
        };
      }

      const uniqueClientIds = [
        ...new Set(liveEntries.map((e) => e.contract.client_id)),
      ];
      const batchKeys = uniqueClientIds.map((id) => ({ id }));
      const batchResult = await this.dynamoDBUtil.batchGet({
        RequestItems: {
          [this.constants.CLIENTS_TABLE_NAME]: {
            Keys: batchKeys,
            ProjectionExpression: "id, #n",
            ExpressionAttributeNames: { "#n": "name" },
          },
        },
      });

      const clientRecords: Record<string, string> = {};
      for (const record of batchResult[this.constants.CLIENTS_TABLE_NAME] ??
        []) {
        clientRecords[record.id] = record.name;
      }

      // Deduplicate by contract_id. A contract is unique to one campaign.
      const seen = new Set<string>();
      const contracts: EligibleContractEntry[] = [];
      for (const { campaign, contract, primaryUrl } of liveEntries) {
        const key = `contract::${contract.contract_id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        contracts.push({
          contract_id: contract.contract_id,
          contract_name:
            contract.contract_name ??
            clientRecords[contract.client_id] ??
            contract.client_id,
          client_id: contract.client_id,
          client_name: clientRecords[contract.client_id] ?? contract.client_id,
          campaign_id: campaign.id,
          campaign_name: campaign.name,
          contract_status: String(contract.status ?? ""),
          campaign_status: String(campaign.status ?? ""),
          delivery_url: primaryUrl,
        });
      }

      return {
        result: true,
        data: {
          contracts,
          ...(sourceAffiliatePixel
            ? { source_affiliate_pixel: sourceAffiliatePixel }
            : {}),
        },
      };
    } catch (error: any) {
      this.logger.error("Failed to list eligible contracts", error);
      return {
        result: false,
        error: error.message || "Failed to list eligible contracts",
      };
    }
  }

  /**
   * Resolve a cherry-pick contract target. Scans campaigns to locate the
   * contract by `contract_id`. Validates the contract is LIVE — closed/paused
   * parent campaigns are intentionally permitted as long as the contract
   * itself is active.
   */
  private async resolveContractTarget(
    contractId: string,
    preferredCampaignId?: string,
  ): Promise<
    ServiceResult<{ campaign: ICampaign; contract: ICampaignContract }>
  > {
    if (preferredCampaignId) {
      const campaign = await this.dynamoDBUtil.get<ICampaign>({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Key: { id: preferredCampaignId },
      });
      if (campaign) {
        const contract = (campaign.contracts ?? []).find(
          (c) => c.contract_id === contractId,
        );
        if (contract) {
          return this.assertContractActive(campaign, contract, contractId);
        }
      }
    }

    const campaigns = await this.dynamoDBUtil.scanAll<ICampaign>({
      TableName: this.constants.CAMPAIGNS_TABLE_NAME,
      FilterExpression: "is_deleted <> :t",
      ExpressionAttributeValues: { ":t": true },
    });

    for (const campaign of campaigns) {
      const contract = (campaign.contracts ?? []).find(
        (c) => c.contract_id === contractId,
      );
      if (contract) {
        return this.assertContractActive(campaign, contract, contractId);
      }
    }

    return { result: false, error: `Contract ${contractId} not found` };
  }

  private assertContractActive(
    campaign: ICampaign,
    contract: ICampaignContract,
    contractId: string,
  ): ServiceResult<{ campaign: ICampaign; contract: ICampaignContract }> {
    if (contract.status !== CampaignParticipantStatus.LIVE) {
      return {
        result: false,
        error: `Contract ${contractId} is not active (status=${contract.status ?? "unknown"})`,
      };
    }
    return { result: true, data: { campaign, contract } };
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private applyCherryPickPayloadMutations(
    lead: ILead,
    request: ExecuteCherryPickRequest,
  ): ILead {
    if (
      (!request.payload_overrides ||
        Object.keys(request.payload_overrides).length === 0) &&
      (!request.removed_payload_fields ||
        request.removed_payload_fields.length === 0)
    ) {
      return lead;
    }

    const payload = {
      ...((lead.payload as Record<string, unknown> | undefined) ?? {}),
    };

    for (const field of request.removed_payload_fields ?? []) {
      if (typeof field === "string" && field.trim().length > 0) {
        delete payload[field];
      }
    }

    if (request.payload_overrides) {
      Object.entries(request.payload_overrides).forEach(([key, value]) => {
        payload[key] = value;
      });
    }

    return {
      ...lead,
      payload,
    };
  }

  private async claimTrustedFormCert(
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
      return {
        claimed: false,
        error: err?.message ?? "TrustedForm Lambda invocation failed",
      };
    }
  }

  private buildSourceAffiliatePixelInfo(
    sourceCampaign: ICampaign | undefined,
    lead: ILead,
  ): ISourceAffiliatePixelInfo | undefined {
    if (!sourceCampaign) return undefined;

    const sourceAffiliate = (sourceCampaign.affiliates ?? []).find(
      (a) => a.campaign_key === lead.campaign_key,
    );
    if (!sourceAffiliate) return undefined;

    return {
      affiliate_id: sourceAffiliate.affiliate_id,
      campaign_id: sourceCampaign.id,
      campaign_key: sourceAffiliate.campaign_key,
      pixel_enabled: sourceAffiliate.sold_pixel_config?.enabled === true,
      ...(sourceAffiliate.sold_pixel_config?.url
        ? { pixel_url: sourceAffiliate.sold_pixel_config.url }
        : {}),
      ...(sourceAffiliate.sold_pixel_config?.method
        ? { pixel_method: sourceAffiliate.sold_pixel_config.method }
        : {}),
    };
  }

  private async dispatchAffiliateSoldPixel(
    sourceCampaign: ICampaign,
    lead: ILead,
  ): Promise<IAffiliatePixelResult> {
    const sourceAffiliate = (sourceCampaign.affiliates ?? []).find(
      (a) => a.campaign_key === lead.campaign_key,
    );
    const firedAt = new Date().toISOString();

    if (!sourceAffiliate) {
      return {
        affiliate_id: "unknown",
        campaign_id: sourceCampaign.id,
        fired_at: firedAt,
        webhook_url: "unknown",
        final_webhook_url: "unknown",
        webhook_method: "POST",
        success: false,
        error:
          "Could not resolve source affiliate for this lead campaign_key; pixel not fired",
      };
    }

    const config = sourceAffiliate.sold_pixel_config;
    if (!config?.enabled || !config.url) {
      return {
        affiliate_id: sourceAffiliate.affiliate_id,
        campaign_id: sourceCampaign.id,
        fired_at: firedAt,
        webhook_url: config?.url ?? "unknown",
        final_webhook_url: config?.url ?? "unknown",
        webhook_method: config?.method ?? "POST",
        success: false,
        error:
          "Source affiliate sold pixel is disabled or not configured; pixel not fired",
      };
    }

    const { queryParams, bodyPayload } = this.buildAffiliatePixelPayload(
      lead,
      config,
    );
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
      const timeoutId = setTimeout(() => controller.abort(), PIXEL_TIMEOUT_MS);

      let response: Response;
      try {
        response = await fetch(finalUrl, {
          method: config.method,
          signal: controller.signal,
          headers: {
            ...(isBodyMethod ? { "Content-Type": "application/json" } : {}),
            Accept: "application/json, text/plain, */*",
            "X-Lead-Id": lead.id,
            "X-Cherry-Pick": "true",
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
          ? `Affiliate pixel timed out after ${PIXEL_TIMEOUT_MS}ms`
          : (error?.message ?? "Unknown affiliate pixel error");
    }

    const success =
      errorMessage === undefined &&
      typeof responseStatus === "number" &&
      responseStatus >= 200 &&
      responseStatus < 300;

    return {
      affiliate_id: sourceAffiliate.affiliate_id,
      campaign_id: sourceCampaign.id,
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
  }

  private buildAffiliatePixelPayload(
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

  private async persistAffiliatePixelResult(
    lead: ILead,
    result: IAffiliatePixelResult,
    actor?: RequestActor,
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
      actor,
      changed_at: result.fired_at,
    });
  }

  private buildMissingSourceCampaignPixelResult(
    lead: ILead,
  ): IAffiliatePixelResult {
    const firedAt = new Date().toISOString();
    return {
      affiliate_id: "unknown",
      campaign_id: lead.campaign_id,
      fired_at: firedAt,
      webhook_url: "unknown",
      final_webhook_url: "unknown",
      webhook_method: "POST",
      success: false,
      error:
        "Source campaign not found for this lead; affiliate pixel not fired",
    };
  }

  private async executeWebhook(
    lead: ILead,
    campaignClient: ICampaignContract,
    config: IClientDeliveryConfig,
  ): Promise<ILeadDeliveryResult> {
    const deliveredAt = new Date().toISOString();
    const { queryParams, bodyPayload, effectiveMappedPayload } =
      this.buildPayload(lead, config);
    const hasQueryParams = Object.keys(queryParams).length > 0;
    const hasBodyPayload = Object.keys(bodyPayload).length > 0;
    const isBodyMethod = config.method !== "GET" && hasBodyPayload;
    const finalUrl = hasQueryParams
      ? this.appendQueryParams(config.url, queryParams)
      : config.url;
    const serializedBodyPayload = isBodyMethod
      ? JSON.stringify(bodyPayload)
      : undefined;

    let responseStatus: number | undefined;
    let responseBody: string | undefined;
    let accepted = false;
    let acceptanceMatch: string | undefined;
    let error: string | undefined;
    let attempts = 0;
    let finalWebhookUrl: string | undefined;
    let sentPayloadSnapshot: ILeadDeliveryPayloadSnapshot | undefined;

    for (let attempt = 1; attempt <= MAX_WEBHOOK_ATTEMPTS; attempt++) {
      attempts = attempt;
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(),
          WEBHOOK_TIMEOUT_MS,
        );

        let response: Response;
        try {
          finalWebhookUrl = finalUrl;
          const requestHeaders: Record<string, string> = {
            ...(isBodyMethod ? { "Content-Type": "application/json" } : {}),
            Accept: "application/json, text/plain, */*",
            "Idempotency-Key": `${lead.id}:${campaignClient.client_id}:cherry-pick`,
            "X-Lead-Id": lead.id,
            "X-Delivery-Attempt": String(attempt),
            "X-Cherry-Pick": "true",
            ...config.headers,
          };

          sentPayloadSnapshot = {
            configured_webhook_url: config.url,
            final_webhook_url: finalWebhookUrl,
            webhook_method: config.method,
            attempt,
            headers: requestHeaders,
            ...(hasQueryParams ? { query_params: queryParams } : {}),
            ...(hasBodyPayload ? { body_payload: bodyPayload } : {}),
            ...(serializedBodyPayload !== undefined
              ? { body_raw: serializedBodyPayload }
              : {}),
            effective_mapped_payload: effectiveMappedPayload,
          };

          response = await fetch(finalWebhookUrl, {
            method: config.method,
            signal: controller.signal,
            headers: requestHeaders,
            ...(serializedBodyPayload !== undefined
              ? { body: serializedBodyPayload }
              : {}),
          });
        } finally {
          clearTimeout(timeoutId);
        }

        responseStatus = response.status;
        const raw = await response.text();
        responseBody = raw.slice(0, 4096);

        if (
          this.isRetryableStatus(responseStatus) &&
          attempt < MAX_WEBHOOK_ATTEMPTS
        ) {
          await this.sleep(RETRY_BACKOFF_MS * 2 ** (attempt - 1));
          continue;
        }

        const matchResult = this.evaluateAcceptanceRules(
          responseBody,
          config.acceptance_rules,
          responseStatus,
        );
        accepted = matchResult.accepted;
        acceptanceMatch = matchResult.matchedValue;
        error = undefined;
        break;
      } catch (err: any) {
        error =
          err?.name === "AbortError"
            ? `Webhook timed out after ${WEBHOOK_TIMEOUT_MS}ms`
            : (err?.message ?? "Unknown delivery error");

        if (this.isRetryableError(err) && attempt < MAX_WEBHOOK_ATTEMPTS) {
          await this.sleep(RETRY_BACKOFF_MS * 2 ** (attempt - 1));
          continue;
        }
        accepted = false;
        break;
      }
    }

    return {
      contract_id: campaignClient.contract_id,
      client_id: campaignClient.client_id,
      delivered_at: deliveredAt,
      attempts,
      webhook_url: config.url,
      ...(finalWebhookUrl !== undefined || finalUrl.length > 0
        ? { final_webhook_url: finalWebhookUrl ?? finalUrl }
        : {}),
      webhook_method: config.method,
      ...(hasQueryParams ? { sent_query_params: queryParams } : {}),
      ...(hasBodyPayload ? { sent_body_payload: bodyPayload } : {}),
      ...(sentPayloadSnapshot !== undefined
        ? { sent_payload_snapshot: sentPayloadSnapshot }
        : {}),
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
      distribution_mode: "round_robin",
      contract_weight_at_delivery: campaignClient.weight ?? 1,
      client_weight_at_delivery: campaignClient.weight ?? 1,
    };
  }

  private buildPayload(
    lead: ILead,
    config: IClientDeliveryConfig,
  ): {
    queryParams: Record<string, unknown>;
    bodyPayload: Record<string, unknown>;
    effectiveMappedPayload: IResolvedWebhookPayloadEntry[];
  } {
    const queryParams: Record<string, unknown> = {};
    const bodyPayload: Record<string, unknown> = {};
    const effectiveMappedPayload: IResolvedWebhookPayloadEntry[] = [];

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

      effectiveMappedPayload.push({
        key: mapping.key,
        parameter_target: resolvedTarget,
        value_source:
          mapping.value_source === "lead_id" ? "field" : mapping.value_source,
        ...(mapping.field_name !== undefined
          ? { field_name: mapping.field_name }
          : {}),
        ...(mapping.static_value !== undefined
          ? { static_value: mapping.static_value }
          : {}),
        value,
      });
    }

    return { queryParams, bodyPayload, effectiveMappedPayload };
  }

  private resolveMapping(mapping: IWebhookFieldMapping, lead: ILead): unknown {
    if (mapping.value_source === "static") {
      return mapping.static_value;
    }

    if (mapping.value_source === "lead_id") {
      return lead.id;
    }

    const fieldName = mapping.field_name!;
    const leadPayload = lead.payload as Record<string, unknown> | undefined;

    if (leadPayload && fieldName in leadPayload) {
      return leadPayload[fieldName];
    }

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

  private evaluateAcceptanceRules(
    body: string,
    rules: IClientDeliveryConfig["acceptance_rules"],
    status?: number,
  ): { accepted: boolean; matchedValue?: string } {
    // Cherry-pick override: when no acceptance rules are defined for the
    // primary destination (i.e. no `passed` rule in `response_validation`),
    // accept on any 2xx response. This matches the operator-driven nature of
    // cherry-pick — automated delivery's strict rule-driven gating does not
    // apply here.
    if (!rules || rules.length === 0) {
      const ok = typeof status === "number" && status >= 200 && status < 300;
      return { accepted: ok };
    }
    const lowerBody = body.toLowerCase();
    for (const rule of rules) {
      if (lowerBody.includes(rule.match_value.toLowerCase())) {
        return {
          accepted: rule.action === "passed",
          matchedValue: rule.match_value,
        };
      }
    }
    return { accepted: false };
  }

  private buildCherryPickRejectionReason(result: ILeadDeliveryResult): string {
    if (result.error && result.error.trim().length > 0) {
      return `Cherry-pick delivery failed: ${result.error}`;
    }
    if (typeof result.webhook_response_status === "number") {
      return `Cherry-pick delivery was rejected (status ${result.webhook_response_status})`;
    }
    return "Cherry-pick delivery was not accepted";
  }

  private isRetryableStatus(status: number): boolean {
    return status === 408 || status === 425 || status === 429 || status >= 500;
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

  private shouldEmitMetricsForLead(lead: ILead): boolean {
    return lead.test !== true;
  }
}
