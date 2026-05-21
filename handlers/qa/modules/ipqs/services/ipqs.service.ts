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

// ── Safe defaults (all criteria disabled — API call runs, always passes unless API returns success:false) ──
const DEFAULT_PHONE_CRITERIA: IIpqsPhoneCriteria = {
  valid: { enabled: false, required: true },
  fraud_score: { enabled: false, operator: "lte", value: 100 },
  country: { enabled: false, allowed: [] },
};
const DEFAULT_EMAIL_CRITERIA: IIpqsEmailCriteria = {
  valid: { enabled: false, required: true },
  fraud_score: { enabled: false, operator: "lte", value: 100 },
};
const DEFAULT_IP_CRITERIA: IIpqsIpCriteria = {
  fraud_score: { enabled: false, operator: "lte", value: 100 },
  country_code: { enabled: false, allowed: [] },
  proxy: { enabled: false, allowed: false },
  vpn: { enabled: false, allowed: false },
};

@injectable()
export class IpqsService {
  constructor(
    @inject("DynamoDBUtil") private readonly dynamoDBUtil: DynamoDBUtil,
    @inject("Logger") private readonly logger: Logger,
    @inject("IpqsConstants") private readonly constants: IpqsConstants,
  ) {}

  async execute(event: IpqsEvent): Promise<ServiceResult<IIpqsResult>> {
    try {
      const { credentials_id, phone, email, ip_address } = event;
      const cfg = this.normalizeConfig(event.config, {
        phone,
        email,
        ip_address,
      });

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

      if (cfg.phone.enabled && phone) {
        tasks.push(
          (async () => {
            phoneResult = await this.runPhoneCheck(apiKey, phone, cfg.phone);
          })(),
        );
      }

      if (cfg.email.enabled && email) {
        tasks.push(
          (async () => {
            emailResult = await this.runEmailCheck(apiKey, email, cfg.email);
          })(),
        );
      }

      if (cfg.ip.enabled && ip_address) {
        tasks.push(
          (async () => {
            ipResult = await this.runIpCheck(apiKey, ip_address, cfg.ip);
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

  // ── Config normalizer ────────────────────────────────────────────────────────

  /**
   * Builds a fully-formed, safe config from whatever the caller provided.
   * Rules:
   *   - If a sub-check key is absent/undefined → disabled with all criteria off.
   *   - If a sub-check is present but missing criteria → use all-disabled defaults.
   *   - If no config at all → enable each sub-check when the corresponding field value exists.
   */
  private normalizeConfig(
    raw: IpqsEvent["config"],
    fields: { phone?: string; email?: string; ip_address?: string },
  ): {
    phone: IIpqsPhoneCheckConfig;
    email: IIpqsEmailCheckConfig;
    ip: IIpqsIpCheckConfig;
  } {
    const inferEnabled = (
      subCfg: { enabled?: boolean } | undefined,
      hasField: boolean,
    ): boolean => {
      if (subCfg === undefined || subCfg === null) {
        // When no config at all, enable if the field value was provided
        return raw === undefined || raw === null ? hasField : false;
      }
      return subCfg.enabled ?? hasField;
    };

    const phoneCriteria =
      (raw?.phone as { criteria?: Partial<IIpqsPhoneCriteria> } | undefined)
        ?.criteria ?? {};
    const emailCriteria =
      (raw?.email as { criteria?: Partial<IIpqsEmailCriteria> } | undefined)
        ?.criteria ?? {};
    const ipCriteria =
      (raw?.ip as { criteria?: Partial<IIpqsIpCriteria> } | undefined)
        ?.criteria ?? {};

    const normalizeAllowedList = (
      value: unknown,
      fallback: string[],
    ): string[] => {
      if (!Array.isArray(value)) return fallback;
      return value.filter((item): item is string => typeof item === "string");
    };

    return {
      phone: {
        enabled: inferEnabled(raw?.phone, !!fields.phone),
        criteria: {
          valid: {
            ...DEFAULT_PHONE_CRITERIA.valid,
            ...(phoneCriteria.valid ?? {}),
          },
          fraud_score: {
            ...DEFAULT_PHONE_CRITERIA.fraud_score,
            ...(phoneCriteria.fraud_score ?? {}),
          },
          country: {
            ...DEFAULT_PHONE_CRITERIA.country,
            ...(phoneCriteria.country ?? {}),
            allowed: normalizeAllowedList(
              phoneCriteria.country?.allowed,
              DEFAULT_PHONE_CRITERIA.country.allowed,
            ),
          },
        },
      },
      email: {
        enabled: inferEnabled(raw?.email, !!fields.email),
        criteria: {
          valid: {
            ...DEFAULT_EMAIL_CRITERIA.valid,
            ...(emailCriteria.valid ?? {}),
          },
          fraud_score: {
            ...DEFAULT_EMAIL_CRITERIA.fraud_score,
            ...(emailCriteria.fraud_score ?? {}),
          },
        },
      },
      ip: {
        enabled: inferEnabled(raw?.ip, !!fields.ip_address),
        criteria: {
          fraud_score: {
            ...DEFAULT_IP_CRITERIA.fraud_score,
            ...(ipCriteria.fraud_score ?? {}),
          },
          country_code: {
            ...DEFAULT_IP_CRITERIA.country_code,
            ...(ipCriteria.country_code ?? {}),
            allowed: normalizeAllowedList(
              ipCriteria.country_code?.allowed,
              DEFAULT_IP_CRITERIA.country_code.allowed,
            ),
          },
          proxy: {
            ...DEFAULT_IP_CRITERIA.proxy,
            ...(ipCriteria.proxy ?? {}),
          },
          vpn: {
            ...DEFAULT_IP_CRITERIA.vpn,
            ...(ipCriteria.vpn ?? {}),
          },
        },
      },
    };
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

      const evaluation = this.evaluatePhoneCriteria(raw, cfg.criteria);

      return {
        success: evaluation.success,
        criteria_results: evaluation.criteria_results,
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
  ): { success: boolean; criteria_results: Record<string, boolean> } {
    const criteriaResults: Record<string, boolean> = {
      api_success: !!raw.success,
    };
    if (!raw.success) {
      return { success: false, criteria_results: criteriaResults };
    }

    const validCheck = criteria?.valid;
    const fraudScoreCheck = criteria?.fraud_score;
    const countryCheck = criteria?.country;

    if (validCheck?.enabled) {
      criteriaResults.valid = raw.valid === validCheck.required;
    }

    if (fraudScoreCheck?.enabled) {
      criteriaResults.fraud_score =
        raw.fraud_score === undefined
          ? true
          : this.evalScore(raw.fraud_score, fraudScoreCheck);
    }

    if (countryCheck?.enabled) {
      const allowedCountries = Array.isArray(countryCheck.allowed)
        ? countryCheck.allowed
        : [];
      criteriaResults.country =
        raw.country === undefined
          ? true
          : allowedCountries.includes(raw.country);
    }

    const success = Object.values(criteriaResults).every(Boolean);
    return { success, criteria_results: criteriaResults };
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

      const evaluation = this.evaluateEmailCriteria(raw, cfg.criteria);

      return {
        success: evaluation.success,
        criteria_results: evaluation.criteria_results,
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
  ): { success: boolean; criteria_results: Record<string, boolean> } {
    const criteriaResults: Record<string, boolean> = {
      api_success: !!raw.success,
    };
    if (!raw.success) {
      return { success: false, criteria_results: criteriaResults };
    }

    const validCheck = criteria?.valid;
    const fraudScoreCheck = criteria?.fraud_score;

    if (validCheck?.enabled) {
      criteriaResults.valid = raw.valid === validCheck.required;
    }

    if (fraudScoreCheck?.enabled) {
      criteriaResults.fraud_score =
        raw.fraud_score === undefined
          ? true
          : this.evalScore(raw.fraud_score, fraudScoreCheck);
    }

    const success = Object.values(criteriaResults).every(Boolean);
    return { success, criteria_results: criteriaResults };
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

      const evaluation = this.evaluateIpCriteria(raw, cfg.criteria);

      return {
        success: evaluation.success,
        criteria_results: evaluation.criteria_results,
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
  ): { success: boolean; criteria_results: Record<string, boolean> } {
    const criteriaResults: Record<string, boolean> = {
      api_success: !!raw.success,
    };
    if (!raw.success) {
      return { success: false, criteria_results: criteriaResults };
    }

    const fraudScoreCheck = criteria?.fraud_score;
    const countryCodeCheck = criteria?.country_code;
    const proxyCheck = criteria?.proxy;
    const vpnCheck = criteria?.vpn;

    if (fraudScoreCheck?.enabled) {
      criteriaResults.fraud_score =
        raw.fraud_score === undefined
          ? true
          : this.evalScore(raw.fraud_score, fraudScoreCheck);
    }

    if (countryCodeCheck?.enabled) {
      const allowedCountries = Array.isArray(countryCodeCheck.allowed)
        ? countryCodeCheck.allowed
        : [];
      criteriaResults.country_code =
        raw.country_code === undefined
          ? true
          : allowedCountries.includes(raw.country_code);
    }

    if (proxyCheck?.enabled) {
      criteriaResults.proxy =
        raw.proxy === undefined ? true : raw.proxy === proxyCheck.allowed;
    }

    if (vpnCheck?.enabled) {
      criteriaResults.vpn =
        raw.vpn === undefined ? true : raw.vpn === vpnCheck.allowed;
    }

    const success = Object.values(criteriaResults).every(Boolean);
    return { success, criteria_results: criteriaResults };
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
