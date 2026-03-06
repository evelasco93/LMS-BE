import "reflect-metadata";
import https from "https";
import { inject, injectable } from "inversify";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { Logger } from "@shared/services/logger.util";
import { decrypt } from "@shared/utils/crypto.util";
import { IpqsConstants } from "../constants/ipqs.constants";
import {
  IIpqsCheckResult,
  IIpqsEmailCheckConfig,
  IIpqsEmailCriteria,
  IIpqsIpCheckConfig,
  IIpqsIpCriteria,
  IIpqsPhoneCheckConfig,
  IIpqsPhoneCriteria,
  IIpqsResult,
  IpqsCredentialRecord,
  IpqsEmailApiResponse,
  IpqsIpApiResponse,
  IpqsPhoneApiResponse,
} from "../interfaces/IIpqs.interface";
import { IpqsEvent } from "../types/ipqs-event.types";

type ServiceResult<T> =
  | { result: true; data: T }
  | { result: false; error: string };

@injectable()
export class IpqsService {
  constructor(
    @inject("DynamoDBUtil") private readonly dynamoDBUtil: DynamoDBUtil,
    @inject("Logger") private readonly logger: Logger,
    @inject("IpqsConstants") private readonly constants: IpqsConstants,
  ) {}

  async execute(event: IpqsEvent): Promise<ServiceResult<IIpqsResult>> {
    try {
      const { credentials_id, phone, email, ip_address, config } = event;

      if (!credentials_id) {
        return { result: false, error: "credentials_id is required" };
      }

      const apiKey = await this.resolveApiKey(credentials_id);
      if (!apiKey) {
        return {
          result: false,
          error: `IPQS credential ${credentials_id} not found or missing apiKey`,
        };
      }

      // Run all enabled checks in parallel
      const tasks: Array<Promise<void>> = [];
      let phoneResult: IIpqsCheckResult | undefined;
      let emailResult: IIpqsCheckResult | undefined;
      let ipResult: IIpqsCheckResult | undefined;

      if (config.phone.enabled && phone) {
        tasks.push(
          (async () => {
            phoneResult = await this.runPhoneCheck(apiKey, phone, config.phone);
          })(),
        );
      }

      if (config.email.enabled && email) {
        tasks.push(
          (async () => {
            emailResult = await this.runEmailCheck(apiKey, email, config.email);
          })(),
        );
      }

      if (config.ip.enabled && ip_address) {
        tasks.push(
          (async () => {
            ipResult = await this.runIpCheck(apiKey, ip_address, config.ip);
          })(),
        );
      }

      await Promise.all(tasks);

      // Overall success: every executed check must pass
      const execResults = [phoneResult, emailResult, ipResult].filter(
        (r): r is IIpqsCheckResult => r !== undefined,
      );
      const overallSuccess =
        execResults.length === 0 || execResults.every((r) => r.success);

      const result: IIpqsResult = {
        success: overallSuccess,
        ...(phoneResult ? { phone: phoneResult } : {}),
        ...(emailResult ? { email: emailResult } : {}),
        ...(ipResult ? { ip: ipResult } : {}),
      };

      this.logger.info("IPQS execute complete", {
        campaign_id: event.campaign_id,
        success: overallSuccess,
        phone: !!phoneResult,
        email: !!emailResult,
        ip: !!ipResult,
      });

      return { result: true, data: result };
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : "IPQS execution failed";
      this.logger.error("IPQS execution failed", { error });
      return { result: false, error: msg };
    }
  }

  // ── Phone check ─────────────────────────────────────────────────────────────

  private async runPhoneCheck(
    apiKey: string,
    phone: string,
    cfg: IIpqsPhoneCheckConfig,
  ): Promise<IIpqsCheckResult> {
    try {
      const normalizedPhone = this.normalizePhone(phone);
      const raw = await this.httpsGet<IpqsPhoneApiResponse>(
        `ipqualityscore.com`,
        `/api/json/phone/${encodeURIComponent(apiKey)}/${encodeURIComponent(normalizedPhone)}`,
      );

      const passes = this.evaluatePhoneCriteria(raw, cfg.criteria);

      return {
        success: passes,
        fraud_score: raw.fraud_score,
        valid: raw.valid,
        country: raw.country,
        ...(raw.success === false ? { error: raw.message } : {}),
        raw: raw as Record<string, unknown>,
      };
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "IPQS phone check failed";
      this.logger.error("IPQS phone check error", { err });
      return { success: false, error: msg };
    }
  }

  private evaluatePhoneCriteria(
    raw: IpqsPhoneApiResponse,
    criteria: IIpqsPhoneCriteria,
  ): boolean {
    if (!raw.success) return false;

    if (criteria.valid.enabled && raw.valid !== criteria.valid.required) {
      return false;
    }

    if (
      criteria.fraud_score.enabled &&
      raw.fraud_score !== undefined &&
      !this.evalScore(raw.fraud_score, criteria.fraud_score)
    ) {
      return false;
    }

    if (
      criteria.country.enabled &&
      raw.country !== undefined &&
      !criteria.country.allowed.includes(raw.country)
    ) {
      return false;
    }

    return true;
  }

  // ── Email check ─────────────────────────────────────────────────────────────

  private async runEmailCheck(
    apiKey: string,
    email: string,
    cfg: IIpqsEmailCheckConfig,
  ): Promise<IIpqsCheckResult> {
    try {
      const raw = await this.httpsGet<IpqsEmailApiResponse>(
        `ipqualityscore.com`,
        `/api/json/email/${encodeURIComponent(apiKey)}/${encodeURIComponent(email)}`,
      );

      const passes = this.evaluateEmailCriteria(raw, cfg.criteria);

      return {
        success: passes,
        fraud_score: raw.fraud_score,
        valid: raw.valid,
        ...(raw.success === false ? { error: raw.message } : {}),
        raw: raw as Record<string, unknown>,
      };
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "IPQS email check failed";
      this.logger.error("IPQS email check error", { err });
      return { success: false, error: msg };
    }
  }

  private evaluateEmailCriteria(
    raw: IpqsEmailApiResponse,
    criteria: IIpqsEmailCriteria,
  ): boolean {
    if (!raw.success) return false;

    if (criteria.valid.enabled && raw.valid !== criteria.valid.required) {
      return false;
    }

    if (
      criteria.fraud_score.enabled &&
      raw.fraud_score !== undefined &&
      !this.evalScore(raw.fraud_score, criteria.fraud_score)
    ) {
      return false;
    }

    return true;
  }

  // ── IP check ─────────────────────────────────────────────────────────────────

  private async runIpCheck(
    apiKey: string,
    ipAddress: string,
    cfg: IIpqsIpCheckConfig,
  ): Promise<IIpqsCheckResult> {
    try {
      const raw = await this.httpsGet<IpqsIpApiResponse>(
        `ipqualityscore.com`,
        `/api/json/ip/${encodeURIComponent(apiKey)}/${encodeURIComponent(ipAddress)}`,
      );

      const passes = this.evaluateIpCriteria(raw, cfg.criteria);

      return {
        success: passes,
        fraud_score: raw.fraud_score,
        country: raw.country_code,
        proxy: raw.proxy,
        vpn: raw.vpn,
        ...(raw.success === false ? { error: raw.message } : {}),
        raw: raw as Record<string, unknown>,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "IPQS IP check failed";
      this.logger.error("IPQS IP check error", { err });
      return { success: false, error: msg };
    }
  }

  private evaluateIpCriteria(
    raw: IpqsIpApiResponse,
    criteria: IIpqsIpCriteria,
  ): boolean {
    if (!raw.success) return false;

    if (
      criteria.fraud_score.enabled &&
      raw.fraud_score !== undefined &&
      !this.evalScore(raw.fraud_score, criteria.fraud_score)
    ) {
      return false;
    }

    if (
      criteria.country_code.enabled &&
      raw.country_code !== undefined &&
      !criteria.country_code.allowed.includes(raw.country_code)
    ) {
      return false;
    }

    if (
      criteria.proxy.enabled &&
      raw.proxy !== undefined &&
      raw.proxy !== criteria.proxy.allowed
    ) {
      return false;
    }

    if (
      criteria.vpn.enabled &&
      raw.vpn !== undefined &&
      raw.vpn !== criteria.vpn.allowed
    ) {
      return false;
    }

    return true;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private evalScore(
    score: number,
    check: { operator: string; value: number },
  ): boolean {
    switch (check.operator) {
      case "lte":
        return score <= check.value;
      case "gte":
        return score >= check.value;
      case "eq":
        return score === check.value;
      default:
        return true;
    }
  }

  /**
   * Normalize phone for IPQS: strip leading '+', keep country code digit.
   * IPQS prefers plain digits starting with country code (e.g. "15551234567").
   */
  private normalizePhone(phone: string): string {
    return phone.replace(/^\+/, "").replace(/\s|-|\(|\)/g, "");
  }

  private async resolveApiKey(credentialsId: string): Promise<string | null> {
    try {
      const record = await this.dynamoDBUtil.get<IpqsCredentialRecord>({
        TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
        Key: { id: credentialsId },
      });
      if (!record) return null;

      const rawApiKey = record.credentials["apiKey"] ?? "";
      if (!rawApiKey) return null;

      // Decrypt if needed
      if (this.constants.CREDENTIALS_ENCRYPTION_KEY) {
        try {
          return decrypt(rawApiKey, this.constants.CREDENTIALS_ENCRYPTION_KEY);
        } catch {
          // If decryption fails, return as-is (already plaintext in some envs)
          return rawApiKey;
        }
      }
      return rawApiKey;
    } catch (error) {
      this.logger.error("Failed to resolve IPQS API key", {
        error,
        credentialsId,
      });
      return null;
    }
  }

  private httpsGet<T>(hostname: string, path: string): Promise<T> {
    return new Promise((resolve, reject) => {
      const options: https.RequestOptions = {
        hostname,
        path,
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      };

      const req = https.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          try {
            const raw = Buffer.concat(chunks).toString("utf8");
            const parsed = raw ? JSON.parse(raw) : {};
            resolve(parsed as T);
          } catch (parseErr) {
            reject(parseErr);
          }
        });
      });

      req.on("error", reject);
      req.end();
    });
  }
}
