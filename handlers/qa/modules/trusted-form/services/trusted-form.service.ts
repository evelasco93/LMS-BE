import "reflect-metadata";
import { inject, injectable } from "inversify";
import https from "https";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { Logger } from "@shared/services/logger.util";
import { decrypt } from "@shared/utils/crypto.util";
import { TrustedFormConstants } from "../constants/trusted-form.constants";
import {
  CredentialRecord,
  TrustedFormClaimResponse,
  TrustedFormResult,
  TrustedFormValidateResponse,
} from "../interfaces/ITrustedForm.interface";
import { TrustedFormEvent } from "../types/trusted-form-event.types";
import { ServiceResult } from "../types/common.types";

const SENSITIVE_FIELD = "password";

@injectable()
export class TrustedFormService {
  constructor(
    @inject("DynamoDBUtil") private readonly dynamoDBUtil: DynamoDBUtil,
    @inject("Logger") private readonly logger: Logger,
    @inject("TrustedFormConstants")
    private readonly constants: TrustedFormConstants,
  ) {}

  async execute(
    event: TrustedFormEvent,
  ): Promise<ServiceResult<TrustedFormResult>> {
    try {
      const { credentials_id, cert_id, phone, vendor } = event;

      if (!credentials_id) {
        return { result: false, error: "credentials_id is required" };
      }
      if (!cert_id) {
        return { result: false, error: "cert_id is required" };
      }

      // 1. Fetch + decrypt credentials
      const cred = await this.fetchCredential(credentials_id);
      if (!cred) {
        return {
          result: false,
          error: `Credential ${credentials_id} not found`,
        };
      }

      const { username, password } = this.decryptCredential(cred);
      if (!username || !password) {
        return {
          result: false,
          error: "TrustedForm credential missing username or password",
        };
      }

      // 2. Normalize inputs
      const cleanCertId = this.normalizeCertId(cert_id);
      const cleanPhone = phone ? this.normalizePhone(phone) : undefined;
      const effectiveVendor = vendor ?? cred.vendor ?? "";

      this.logger.info("TrustedForm executing", {
        raw_cert_id: cert_id,
        clean_cert_id: cleanCertId,
        phone: cleanPhone,
        vendor: effectiveVendor,
        credentials_id,
      });

      // 3. Validate
      const validateResponse = await this.callValidate(
        cleanCertId,
        username,
        password,
      );

      this.logger.info("TrustedForm validate response", {
        cert_id: cleanCertId,
        response: validateResponse,
      });

      const validateOutcome = validateResponse?.outcome as string | undefined;
      const validateReason = validateResponse?.reason as string | undefined;

      if (validateOutcome === "failure" || validateOutcome === "error") {
        this.logger.warn("TrustedForm validate failed", {
          cert_id: cleanCertId,
          outcome: validateOutcome,
          reason: validateReason,
          full_response: validateResponse,
        });

        return {
          result: true,
          data: {
            success: false,
            cert_id: cleanCertId,
            outcome: validateOutcome,
            error: validateReason,
            phone: cleanPhone,
          },
        };
      }

      // 4. Claim — only when caller explicitly sets claim: true
      if (event.claim !== true) {
        this.logger.info("TrustedForm validate-only (claim=false)", {
          cert_id: cleanCertId,
          outcome: validateOutcome,
        });
        return {
          result: true,
          data: {
            success: true,
            cert_id: cleanCertId,
            outcome: validateOutcome ?? "success",
            phone: cleanPhone,
          },
        };
      }
      const claimResponse = await this.callClaim(
        cleanCertId,
        cleanPhone,
        effectiveVendor,
        username,
        password,
      );

      this.logger.info("TrustedForm claim response", {
        cert_id: cleanCertId,
        response: claimResponse,
      });

      const retainResults = claimResponse?.retain?.results;
      const retainVendor = claimResponse?.retain?.vendor;
      const phoneMatch = claimResponse?.match_lead?.result?.phone_match;

      this.logger.info("TrustedForm cert claimed", {
        cert_id: cleanCertId,
        outcome: claimResponse?.outcome,
        vendor: retainVendor,
        phone_match: phoneMatch,
        previously_retained: retainResults?.previously_retained,
      });

      const claimOutcome = (claimResponse?.outcome as string) ?? "failure";
      const isSuccess = claimOutcome === "success";

      return {
        result: true,
        data: {
          success: isSuccess,
          cert_id: cleanCertId,
          outcome: claimOutcome,
          phone: cleanPhone,
          phone_match: phoneMatch,
          vendor: retainVendor ?? effectiveVendor,
          previously_retained: retainResults?.previously_retained,
          expires_at: retainResults?.expires_at,
        },
      };
    } catch (error: unknown) {
      const msg =
        error instanceof Error ? error.message : "TrustedForm execution failed";
      this.logger.error("TrustedForm service error", { error });
      return { result: false, error: msg };
    }
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private async fetchCredential(
    credentialsId: string,
  ): Promise<CredentialRecord | null> {
    const item = await this.dynamoDBUtil.get({
      TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
      Key: { id: credentialsId },
    });
    return (item as CredentialRecord | null) ?? null;
  }

  private decryptCredential(cred: CredentialRecord): {
    username: string;
    password: string;
  } {
    const raw = cred.credentials ?? {};
    const username = raw.username ?? "";
    const encryptedPassword = raw[SENSITIVE_FIELD] ?? "";

    let password = "";
    if (encryptedPassword) {
      try {
        password = decrypt(
          encryptedPassword,
          this.constants.CREDENTIALS_ENCRYPTION_KEY,
        );
      } catch {
        this.logger.warn("Failed to decrypt TrustedForm password", {
          credId: cred.id,
        });
      }
    }

    return { username, password };
  }

  /** Strip full URL down to the bare 40-char hex cert ID */
  normalizeCertId(input: string): string {
    const match = input.match(
      /(?:https?:\/\/cert\.trustedform\.com\/)?([a-f0-9]{40})(?:\/.*)?$/i,
    );
    return match ? match[1] : input.trim();
  }

  /** Keep only digits */
  normalizePhone(phone: string): string {
    return phone.replace(/\D/g, "");
  }

  private callValidate(
    certId: string,
    username: string,
    password: string,
  ): Promise<TrustedFormValidateResponse> {
    const path = `/${certId}/validate`;

    this.logger.info("TrustedForm → GET validate", {
      url: `https://cert.trustedform.com${path}`,
    });

    return this.httpsGet(
      `cert.trustedform.com`,
      path,
      username,
      password,
    ) as Promise<TrustedFormValidateResponse>;
  }

  private callClaim(
    certId: string,
    phone: string | undefined,
    vendor: string,
    username: string,
    password: string,
  ): Promise<TrustedFormClaimResponse> {
    const body = JSON.stringify({
      ...(phone ? { match_lead: { phone } } : {}),
      retain: { vendor },
    });

    this.logger.info("TrustedForm → POST retain", {
      url: `https://cert.trustedform.com/${certId}`,
      body,
    });

    return this.httpsPost(
      `cert.trustedform.com`,
      `/${certId}`,
      body,
      username,
      password,
    ) as Promise<TrustedFormClaimResponse>;
  }

  private httpsGet(
    hostname: string,
    path: string,
    username: string,
    password: string,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const auth = Buffer.from(`${username}:${password}`).toString("base64");
      const options = {
        hostname,
        path,
        method: "GET",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      };

      const req = https.request(options, (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          this.logger.info("TrustedForm ← HTTP response", {
            url: `https://${hostname}${path}`,
            status: res.statusCode,
            raw_body: raw,
          });
          try {
            resolve(JSON.parse(raw));
          } catch {
            resolve(raw);
          }
        });
      });

      req.on("error", (err) => {
        this.logger.error("TrustedForm HTTP request error", {
          url: `https://${hostname}${path}`,
          error: err.message,
        });
        reject(err);
      });
      req.end();
    });
  }

  private httpsPost(
    hostname: string,
    path: string,
    body: string,
    username: string,
    password: string,
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const auth = Buffer.from(`${username}:${password}`).toString("base64");
      const options = {
        hostname,
        path,
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/json",
          Accept: "application/json",
          "Api-Version": "4.0",
          "Content-Length": Buffer.byteLength(body),
        },
      };

      const req = https.request(options, (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          this.logger.info("TrustedForm ← HTTP response", {
            url: `https://${hostname}${path}`,
            status: res.statusCode,
            raw_body: raw,
          });
          try {
            resolve(JSON.parse(raw));
          } catch {
            resolve(raw);
          }
        });
      });

      req.on("error", (err) => {
        this.logger.error("TrustedForm HTTP request error", {
          url: `https://${hostname}${path}`,
          error: err.message,
        });
        reject(err);
      });
      req.write(body);
      req.end();
    });
  }
}
