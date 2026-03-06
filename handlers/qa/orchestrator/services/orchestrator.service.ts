import https from "https";
import { inject, injectable } from "inversify";
import { LambdaInvokeUtil } from "@shared/services/lambda-invoke.util";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { Logger } from "@shared/services/logger.util";
import { decrypt } from "@shared/utils/crypto.util";
import { OrchestratorConstants } from "../constants/orchestrator.constants";
import {
  DuplicateCheckResult,
  IpqsResult,
  OrchestratorResponse,
  TrustedFormResult,
  TrustedFormValidateResponse,
} from "../interfaces/IOrchestrator.interface";
import { OrchestratorEvent } from "../types/orchestrator-event.types";
import { ServiceResult } from "../types/common.types";

/** Minimal shape of a tenant-settings credential record we need */
interface TenantCredentialLookup {
  id: string;
  type: "credential";
  credential_type: string;
  credentials: Record<string, string>;
  enabled: boolean;
  is_deleted?: boolean;
}

/** Minimal shape of a plugin_setting record */
interface PluginSettingLookup {
  id: string;
  type: "plugin_setting";
  schema_id: string;
  credentials_id: string;
  enabled: boolean;
  is_deleted?: boolean;
}

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
    // ── 1. Duplicate check ────────────────────────────────────────────────────
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

    // ── 2. Plugin checks (parallel) ───────────────────────────────────────────
    // Run all enabled plugins concurrently now that duplicate_check has completed.
    const trustedFormPlugin = event.plugins?.trusted_form;
    const trustedFormEnabled = trustedFormPlugin?.enabled ?? false;

    const pluginPromises: Array<Promise<void>> = [];
    let trustedFormResult: TrustedFormResult | undefined;
    let ipqsResult: IpqsResult | undefined;

    if (trustedFormEnabled && event.cert_id) {
      pluginPromises.push(
        (async () => {
          if (!this.constants.TRUSTED_FORM_LAMBDA_NAME) {
            this.logger.warn("TRUSTED_FORM_LAMBDA_NAME is not configured");
            return;
          }
          const credentialsIdResult =
            await this.resolveDefaultCredentialsId("trusted_form");
          if (!credentialsIdResult) {
            this.logger.warn(
              "No active trusted_form credential found in tenant settings — skipping TrustedForm check",
            );
            return;
          }
          try {
            trustedFormResult =
              await this.lambdaInvokeUtil.invokeJson<TrustedFormResult>({
                functionName: this.constants.TRUSTED_FORM_LAMBDA_NAME,
                payload: {
                  campaign_id: event.campaign_id,
                  credentials_id: credentialsIdResult,
                  cert_id: event.cert_id,
                  phone: event.phone,
                },
              });
          } catch (error) {
            this.logger.error(
              "QA orchestrator failed to run trusted_form plugin",
              { error, campaignId: event.campaign_id },
            );
            trustedFormResult = {
              success: false,
              cert_id: event.cert_id ?? "",
              error: "TrustedForm lambda invocation failed",
            };
          }
        })(),
      );
    }

    // ── IPQS plugin ─────────────────────────────────────────────────────────
    const ipqsPlugin = event.plugins?.ipqs;
    const ipqsEnabled = ipqsPlugin?.enabled ?? false;

    if (ipqsEnabled && (event.phone || event.email || event.ip_address)) {
      pluginPromises.push(
        (async () => {
          if (!this.constants.IPQS_LAMBDA_NAME) {
            this.logger.warn("IPQS_LAMBDA_NAME is not configured");
            return;
          }
          const credentialsIdResult =
            await this.resolveDefaultCredentialsId("ipqs");
          if (!credentialsIdResult) {
            this.logger.warn(
              "No active ipqs credential found in tenant settings — skipping IPQS check",
            );
            return;
          }
          try {
            ipqsResult = await this.lambdaInvokeUtil.invokeJson<IpqsResult>({
              functionName: this.constants.IPQS_LAMBDA_NAME,
              payload: {
                campaign_id: event.campaign_id,
                credentials_id: credentialsIdResult,
                phone: event.phone,
                email: event.email,
                ip_address: event.ip_address,
                config: {
                  phone: ipqsPlugin?.phone,
                  email: ipqsPlugin?.email,
                  ip: ipqsPlugin?.ip,
                },
              },
            });
          } catch (error) {
            this.logger.error("QA orchestrator failed to run ipqs plugin", {
              error,
              campaignId: event.campaign_id,
            });
            ipqsResult = {
              success: false,
              error: "IPQS lambda invocation failed",
            };
          }
        })(),
      );
    }

    // Await all parallel plugin tasks
    await Promise.all(pluginPromises);

    // ── 3. Assemble response ──────────────────────────────────────────────────
    const response: OrchestratorResponse = {
      duplicate,
      duplicate_matches: {
        lead_ids: matchedLeadIds,
      },
      ...(trustedFormResult ? { trusted_form_result: trustedFormResult } : {}),
      ...(ipqsResult ? { ipqs_result: ipqsResult } : {}),
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
   * Looks up the active plugin_setting for `provider` in the tenant-settings
   * table using the type-provider GSI, then returns the linked credentials_id.
   * Returns null if nothing is found so callers can decide how to proceed.
   */
  async resolveDefaultCredentialsId(provider: string): Promise<string | null> {
    if (!this.constants.TENANT_SETTINGS_TABLE_NAME) return null;

    try {
      const tableName = this.constants.TENANT_SETTINGS_TABLE_NAME;

      // 1. Find the credential_schema for this provider
      const schemaRecords = await this.dynamoDBUtil.queryAll<{
        id: string;
        type: string;
      }>({
        TableName: tableName,
        IndexName: `${tableName}-type-provider-index`,
        KeyConditionExpression: "#t = :type AND #p = :provider",
        FilterExpression: "attribute_not_exists(is_deleted) OR is_deleted = :f",
        ExpressionAttributeNames: { "#t": "type", "#p": "provider" },
        ExpressionAttributeValues: {
          ":type": "credential_schema",
          ":provider": provider,
          ":f": false,
        },
        Limit: 1,
      });

      if (!schemaRecords.length) {
        this.logger.warn(
          `No credential schema found for provider "${provider}"`,
        );
        return null;
      }

      const schemaId = schemaRecords[0].id;

      // 2. Find the plugin_setting for that schema
      const settingRecords =
        await this.dynamoDBUtil.queryAll<PluginSettingLookup>({
          TableName: tableName,
          IndexName: `${tableName}-schema-id-index`,
          KeyConditionExpression: "#s = :schemaId",
          FilterExpression:
            "enabled = :e AND (attribute_not_exists(is_deleted) OR is_deleted = :f)",
          ExpressionAttributeNames: { "#s": "schema_id" },
          ExpressionAttributeValues: {
            ":schemaId": schemaId,
            ":e": true,
            ":f": false,
          },
          Limit: 1,
        });

      if (!settingRecords.length) {
        this.logger.warn(
          `No active plugin setting found for schema "${schemaId}"`,
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
