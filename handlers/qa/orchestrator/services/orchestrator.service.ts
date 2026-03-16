import https from "https";
import { inject, injectable } from "inversify";
import { LambdaInvokeUtil } from "@shared/services/lambda-invoke.util";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { Logger } from "@shared/services/logger.util";
import { decrypt } from "@shared/utils/crypto.util";
import {
  REJECTION_DUPLICATE,
  REJECTION_TRUSTED_FORM_INVALID,
  REJECTION_TRUSTED_FORM_EXPIRED,
  REJECTION_TRUSTED_FORM_ALREADY_CLAIMED,
  REJECTION_IPQS_PHONE,
  REJECTION_IPQS_EMAIL,
  REJECTION_IPQS_IP,
  buildIpqsRejectionMessage,
} from "@shared/constants/rejection-messages.constants";
import { OrchestratorConstants } from "../constants/orchestrator.constants";
import {
  DuplicateCheckResult,
  IpqsPluginConfig,
  IpqsResult,
  OrchestratorResponse,
  TrustedFormPluginConfig,
  TrustedFormResult,
  TrustedFormValidateResponse,
} from "../interfaces/IOrchestrator.interface";
import { OrchestratorEvent } from "../types/orchestrator-event.types";
import { ServiceResult } from "../types/common.types";
import {
  TenantCredentialLookup,
  PluginSettingLookup,
  StageTaskResult,
} from "../interfaces/orchestrator-internal.interface";

@injectable()
export class OrchestratorService {
  constructor(
    @inject("Logger") private readonly logger: Logger,
    @inject("LambdaInvokeUtil")
    private readonly lambdaInvokeUtil: LambdaInvokeUtil,
    @inject("DynamoDBUtil") private readonly dynamoDBUtil: DynamoDBUtil,
    @inject("OrchestratorConstants")
    private readonly constants: OrchestratorConstants,
  ) {}

  async execute(
    event: OrchestratorEvent,
  ): Promise<ServiceResult<OrchestratorResponse>> {
    // ── Stage 1: duplicate_check (hardcoded, always a gate) ──────────────────
    const duplicatePlugin = event.plugins?.duplicate_check;
    const duplicateEnabled = duplicatePlugin?.enabled ?? true;

    let duplicateResult: Partial<DuplicateCheckResult> = {
      duplicate: false,
      duplicate_matches: { lead_ids: [] },
    };

    if (duplicateEnabled) {
      if (!this.constants.DUPLICATE_CHECK_LAMBDA_NAME) {
        this.logger.warn("DUPLICATE_CHECK_LAMBDA_NAME is not configured");
      } else {
        try {
          duplicateResult = await this.lambdaInvokeUtil.invokeJson<
            Partial<DuplicateCheckResult>
          >({
            functionName: this.constants.DUPLICATE_CHECK_LAMBDA_NAME,
            payload: {
              campaign_id: event.campaign_id,
              payload: event.payload ?? {},
              criteria: duplicatePlugin?.criteria ?? ["phone", "email"],
            },
          });
        } catch (error) {
          this.logger.error(
            "QA orchestrator failed to run duplicate_check plugin",
            { error, campaignId: event.campaign_id },
          );
        }
      }
    }

    const matchedLeadIds = Array.isArray(
      duplicateResult?.duplicate_matches?.lead_ids,
    )
      ? duplicateResult.duplicate_matches!.lead_ids.filter(
          (id): id is string => typeof id === "string",
        )
      : [];

    const duplicate =
      matchedLeadIds.length > 0 || duplicateResult?.duplicate === true;

    // Gate: duplicate found → halt pipeline at stage 1, skip stages 2+
    if (duplicate && duplicateEnabled) {
      return {
        result: true,
        data: {
          duplicate: true,
          duplicate_matches: { lead_ids: matchedLeadIds },
          pipeline_halted: true,
          halt_stage: 1,
          halt_plugin: "duplicate_check",
          halt_reason: REJECTION_DUPLICATE,
          plugin_results: {
            duplicate_check: {
              enabled: true,
              duplicate: true,
              matched_lead_ids: matchedLeadIds,
            },
          },
        },
      };
    }

    // ── Stages 2+: configurable plugin pipeline ───────────────────────────────
    const pipeline = this.buildPipeline(event);
    const {
      trustedFormResult,
      ipqsResult,
      pipelineHalted,
      haltStage,
      haltPlugin,
      haltReason,
    } = await this.runPipeline(pipeline);

    // ── Assemble response ─────────────────────────────────────────────────────
    const trustedFormEnabled = event.plugins?.trusted_form?.enabled ?? false;
    const ipqsEnabled = event.plugins?.ipqs?.enabled ?? false;

    const response: OrchestratorResponse = {
      duplicate,
      duplicate_matches: { lead_ids: matchedLeadIds },
      ...(trustedFormResult ? { trusted_form_result: trustedFormResult } : {}),
      ...(ipqsResult ? { ipqs_result: ipqsResult } : {}),
      ...(pipelineHalted
        ? {
            pipeline_halted: true,
            halt_stage: haltStage,
            halt_plugin: haltPlugin,
            halt_reason: haltReason,
          }
        : {}),
      plugin_results: {
        duplicate_check: {
          enabled: duplicateEnabled,
          duplicate,
          matched_lead_ids: matchedLeadIds,
        },
        ...(trustedFormEnabled
          ? {
              trusted_form: {
                enabled: true,
                success: trustedFormResult?.success,
                error: trustedFormResult?.error,
              },
            }
          : {}),
        ...(ipqsEnabled
          ? {
              ipqs: {
                enabled: true,
                success: ipqsResult?.success,
                error: ipqsResult?.error,
              },
            }
          : {}),
      },
    };

    return { result: true, data: response };
  }

  /**
   * Groups enabled plugins into stages (sorted ascending by stage number).
   * Stage 1 (duplicate_check) is always handled first in execute().
   * All other plugins use their configured stage number (minimum 2).
   */
  private buildPipeline(
    event: OrchestratorEvent,
  ): Map<number, Array<() => Promise<StageTaskResult>>> {
    const stages = new Map<number, Array<() => Promise<StageTaskResult>>>();

    const trustedFormPlugin = event.plugins?.trusted_form;
    if (trustedFormPlugin?.enabled && event.cert_id) {
      const stageNum = trustedFormPlugin.stage ?? 2;
      if (!stages.has(stageNum)) stages.set(stageNum, []);
      stages
        .get(stageNum)!
        .push(() => this.runTrustedFormTask(event, trustedFormPlugin));
    }

    const ipqsPlugin = event.plugins?.ipqs;
    if (
      ipqsPlugin?.enabled &&
      (event.phone || event.email || event.ip_address)
    ) {
      const stageNum = ipqsPlugin.stage ?? 2;
      if (!stages.has(stageNum)) stages.set(stageNum, []);
      stages.get(stageNum)!.push(() => this.runIpqsTask(event, ipqsPlugin));
    }

    // Return stages sorted ascending so lower stage numbers run first
    return new Map([...stages.entries()].sort(([a], [b]) => a - b));
  }

  /**
   * Executes stages in order. Within each stage all tasks run in parallel.
   * If any gate=true task fails, the pipeline halts and remaining stages are
   * skipped. Results from completed stages are always accumulated and returned.
   */
  private async runPipeline(
    pipeline: Map<number, Array<() => Promise<StageTaskResult>>>,
  ): Promise<{
    trustedFormResult?: TrustedFormResult;
    ipqsResult?: IpqsResult;
    pipelineHalted: boolean;
    haltStage?: number;
    haltPlugin?: string;
    haltReason?: string;
  }> {
    let trustedFormResult: TrustedFormResult | undefined;
    let ipqsResult: IpqsResult | undefined;
    let pipelineHalted = false;
    let haltStage: number | undefined;
    let haltPlugin: string | undefined;
    let haltReason: string | undefined;

    for (const [stageNum, tasks] of pipeline) {
      // All tasks within a stage run concurrently
      const stageResults = await Promise.all(tasks.map((t) => t()));

      // Collect plugin results from this stage before checking for halts
      for (const r of stageResults) {
        if (r.trustedFormResult) trustedFormResult = r.trustedFormResult;
        if (r.ipqsResult) ipqsResult = r.ipqsResult;
      }

      // First gate=true task that failed halts the pipeline
      const gateFailure = stageResults.find((r) => r.gate && !r.success);
      if (gateFailure) {
        pipelineHalted = true;
        haltStage = stageNum;
        haltPlugin = gateFailure.name;
        haltReason = gateFailure.haltReason;
        break;
      }
    }

    return {
      trustedFormResult,
      ipqsResult,
      pipelineHalted,
      haltStage,
      haltPlugin,
      haltReason,
    };
  }

  /** Runs the TrustedForm plugin task and returns a StageTaskResult. */
  private async runTrustedFormTask(
    event: OrchestratorEvent,
    plugin: TrustedFormPluginConfig,
  ): Promise<StageTaskResult> {
    const gate = plugin.gate ?? true;

    if (!this.constants.TRUSTED_FORM_LAMBDA_NAME) {
      this.logger.warn("TRUSTED_FORM_LAMBDA_NAME is not configured — skipping");
      return { name: "trusted_form", success: true, gate };
    }

    const credentialsId =
      await this.resolveDefaultCredentialsId("trusted_form");
    if (!credentialsId) {
      this.logger.warn(
        "No active trusted_form credential found — skipping TrustedForm check",
      );
      return { name: "trusted_form", success: true, gate };
    }

    try {
      const trustedFormResult =
        await this.lambdaInvokeUtil.invokeJson<TrustedFormResult>({
          functionName: this.constants.TRUSTED_FORM_LAMBDA_NAME,
          payload: {
            campaign_id: event.campaign_id,
            credentials_id: credentialsId,
            cert_id: event.cert_id,
            phone: event.phone,
            vendor: plugin.vendor,
            claim: plugin.claim ?? false,
          },
        });

      const success = trustedFormResult?.success !== false;
      const haltReason = !success
        ? this.mapTrustedFormToHaltReason(trustedFormResult)
        : undefined;

      return {
        name: "trusted_form",
        success,
        gate,
        haltReason,
        trustedFormResult,
      };
    } catch (error) {
      this.logger.error("QA orchestrator failed to run trusted_form plugin", {
        error,
        campaignId: event.campaign_id,
      });
      const fallbackResult: TrustedFormResult = {
        success: false,
        cert_id: event.cert_id ?? "",
        error: "TrustedForm lambda invocation failed",
      };
      return {
        name: "trusted_form",
        success: false,
        gate,
        haltReason: REJECTION_TRUSTED_FORM_INVALID,
        trustedFormResult: fallbackResult,
      };
    }
  }

  /** Runs the IPQS plugin task and returns a StageTaskResult. */
  private async runIpqsTask(
    event: OrchestratorEvent,
    plugin: IpqsPluginConfig,
  ): Promise<StageTaskResult> {
    const gate = plugin.gate ?? true;

    if (!this.constants.IPQS_LAMBDA_NAME) {
      this.logger.warn("IPQS_LAMBDA_NAME is not configured — skipping");
      return { name: "ipqs", success: true, gate };
    }

    const credentialsId = await this.resolveDefaultCredentialsId("ipqs");
    if (!credentialsId) {
      this.logger.warn("No active ipqs credential found — skipping IPQS check");
      return { name: "ipqs", success: true, gate };
    }

    try {
      const ipqsResult = await this.lambdaInvokeUtil.invokeJson<IpqsResult>({
        functionName: this.constants.IPQS_LAMBDA_NAME,
        payload: {
          campaign_id: event.campaign_id,
          credentials_id: credentialsId,
          phone: event.phone,
          email: event.email,
          ip_address: event.ip_address,
          config: {
            phone: plugin.phone,
            email: plugin.email,
            ip: plugin.ip,
          },
        },
      });

      const success = ipqsResult?.success !== false;
      let haltReason: string | undefined;
      if (!success) {
        const failedChecks: string[] = [];
        if (ipqsResult?.phone?.success === false)
          failedChecks.push(REJECTION_IPQS_PHONE);
        if (ipqsResult?.email?.success === false)
          failedChecks.push(REJECTION_IPQS_EMAIL);
        if (ipqsResult?.ip?.success === false)
          failedChecks.push(REJECTION_IPQS_IP);
        haltReason = buildIpqsRejectionMessage(failedChecks);
      }

      return { name: "ipqs", success, gate, haltReason, ipqsResult };
    } catch (error) {
      this.logger.error("QA orchestrator failed to run ipqs plugin", {
        error,
        campaignId: event.campaign_id,
      });
      const fallbackResult: IpqsResult = {
        success: false,
        error: "IPQS lambda invocation failed",
      };
      return {
        name: "ipqs",
        success: false,
        gate,
        haltReason: buildIpqsRejectionMessage([]),
        ipqsResult: fallbackResult,
      };
    }
  }

  /**
   * Maps a TrustedForm failure result to an affiliate-readable rejection message
   * using the raw outcome/error values from TrustedForm's API response.
   */
  private mapTrustedFormToHaltReason(result: TrustedFormResult): string {
    const error = (result.error ?? "").toLowerCase();
    if (error.includes("expired")) return REJECTION_TRUSTED_FORM_EXPIRED;
    if (error.includes("retained") || error.includes("claimed"))
      return REJECTION_TRUSTED_FORM_ALREADY_CLAIMED;
    return REJECTION_TRUSTED_FORM_INVALID;
  }

  /**
   * Looks up the active plugin_setting for `provider` in the tenant-settings
   * table using the type-provider GSI, then returns the linked credentials_id.
   * Returns null if nothing is found so callers can decide how to proceed.
   */
  async resolveDefaultCredentialsId(provider: string): Promise<string | null> {
    if (!this.constants.TENANT_SETTINGS_TABLE_NAME) return null;

    try {
      const tableName = this.constants.TENANT_SETTINGS_TABLE_NAME;

      // Query plugin_setting directly by provider using the type-provider GSI.
      // plugin_setting records store `provider` (not schema_id), so we can
      // resolve in a single lookup.
      const settingRecords =
        await this.dynamoDBUtil.queryAll<PluginSettingLookup>({
          TableName: tableName,
          IndexName: `${tableName}-type-provider-index`,
          KeyConditionExpression: "#t = :type AND #p = :provider",
          FilterExpression:
            "enabled = :e AND (attribute_not_exists(is_deleted) OR is_deleted = :f)",
          ExpressionAttributeNames: { "#t": "type", "#p": "provider" },
          ExpressionAttributeValues: {
            ":type": "plugin_setting",
            ":provider": provider,
            ":e": true,
            ":f": false,
          },
          Limit: 1,
        });

      if (!settingRecords.length) {
        this.logger.warn(
          `No active plugin setting found for provider "${provider}"`,
        );
        return null;
      }

      return settingRecords[0].credentials_id;
    } catch (error) {
      this.logger.error("Failed to resolve default credentials_id", {
        error,
        provider,
      });
      return null;
    }
  }

  /**
   * POST /qa/trusted-form/validate — direct TrustedForm validate proxy.
   *
   * Calls GET https://cert.trustedform.com/{cert_id}/validate with Basic auth,
   * masking the upstream URL from callers. Credentials are always resolved from
   * the global plugin-setting for "trusted_form" configured in the tenant
   * settings table — no credential ID is accepted from the caller.
   */
  async validateTrustedFormCert(
    certId: string,
  ): Promise<TrustedFormValidateResponse> {
    // Normalize: strip full URL prefix if caller passed one
    const cleanCertId = this.normalizeCertId(certId);

    const resolvedCredentialsId =
      await this.resolveDefaultCredentialsId("trusted_form");
    if (!resolvedCredentialsId) {
      return {
        outcome: "error",
        reason:
          "No active TrustedForm credential found in tenant settings. Configure a plugin setting first.",
      };
    }

    const cred = await this.getDecryptedCredential(resolvedCredentialsId);
    if (!cred) {
      return {
        outcome: "error",
        reason: `Credential ${resolvedCredentialsId} not found or is inactive`,
      };
    }

    if (cred.enabled === false) {
      return {
        outcome: "error",
        reason: "TrustedForm credential is disabled",
      };
    }

    const username = cred.credentials["username"];
    const password = cred.credentials["password"];
    if (!username || !password) {
      return {
        outcome: "error",
        reason: "TrustedForm credential missing username or password",
      };
    }

    this.logger.info("TrustedForm → GET validate", {
      url: `https://cert.trustedform.com/${cleanCertId}/validate`,
      credentials_id: resolvedCredentialsId,
    });

    try {
      const result = await this.httpsGet(
        "cert.trustedform.com",
        `/${cleanCertId}/validate`,
        username,
        password,
      );
      return result as TrustedFormValidateResponse;
    } catch (error: any) {
      this.logger.error("TrustedForm validate HTTP call failed", { error });
      return {
        outcome: "error",
        reason: error?.message || "TrustedForm API request failed",
      };
    }
  }

  /**
   * Direct IPQS proxy check — invokes the IPQS lambda without going through a
   * full lead submission. Used by POST /qa/ipqs/check.
   */
  async runIpqsCheck(params: {
    credentials_id: string;
    phone?: string;
    email?: string;
    ip_address?: string;
  }): Promise<IpqsResult> {
    if (!this.constants.IPQS_LAMBDA_NAME) {
      return { success: false, error: "IPQS_LAMBDA_NAME is not configured" };
    }
    try {
      return await this.lambdaInvokeUtil.invokeJson<IpqsResult>({
        functionName: this.constants.IPQS_LAMBDA_NAME,
        payload: {
          credentials_id: params.credentials_id,
          phone: params.phone,
          email: params.email,
          ip_address: params.ip_address,
          // No per-check config means all checks default to enabled=true
          config: {
            phone: params.phone ? { enabled: true } : undefined,
            email: params.email ? { enabled: true } : undefined,
            ip: params.ip_address ? { enabled: true } : undefined,
          },
        },
      });
    } catch (error: any) {
      this.logger.error("IPQS direct check failed", { error });
      return { success: false, error: error?.message || "IPQS check failed" };
    }
  }

  /** Strip full cert URL prefix; return bare 40-char hex cert ID */
  private normalizeCertId(input: string): string {
    const match = input.match(
      /(?:https?:\/\/cert\.trustedform\.com\/)?([a-f0-9]{40})(?:\/.*)?$/i,
    );
    return match ? match[1] : input.trim();
  }

  /**
   * Perform an HTTPS GET with Basic auth; returns the parsed JSON body.
   */
  private httpsGet(
    host: string,
    path: string,
    username: string,
    password: string,
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const auth = Buffer.from(`${username}:${password}`).toString("base64");
      const options: https.RequestOptions = {
        hostname: host,
        path,
        method: "GET",
        headers: {
          Authorization: `Basic ${auth}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      };

      const req = https.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          try {
            const raw = Buffer.concat(chunks).toString("utf8");
            const parsed = raw ? JSON.parse(raw) : {};
            resolve(parsed);
          } catch (parseErr) {
            reject(parseErr);
          }
        });
      });

      req.on("error", reject);
      req.end();
    });
  }

  /**
   * Resolves and decrypts a credential record by ID from the tenant-settings table.
   */
  async getDecryptedCredential(
    credentialsId: string,
  ): Promise<TenantCredentialLookup | null> {
    if (!this.constants.TENANT_SETTINGS_TABLE_NAME) return null;
    try {
      const record = await this.dynamoDBUtil.get<TenantCredentialLookup>({
        TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
        Key: { id: credentialsId },
      });
      if (!record || record.type !== "credential") return null;

      // Decrypt bearer_token / api_key / basic_auth
      const credentials = { ...record.credentials };
      const sensitiveMap: Record<string, string[]> = {
        api_key: ["apiKey"],
        basic_auth: ["password"],
        bearer_token: ["token"],
      };
      for (const field of sensitiveMap[record.credential_type] ?? []) {
        if (credentials[field] && this.constants.CREDENTIALS_ENCRYPTION_KEY) {
          try {
            credentials[field] = decrypt(
              credentials[field],
              this.constants.CREDENTIALS_ENCRYPTION_KEY,
            );
          } catch {
            /* noop */
          }
        }
      }

      return { ...record, credentials };
    } catch (error) {
      this.logger.error("Failed to get credential", { error, credentialsId });
      return null;
    }
  }
}
