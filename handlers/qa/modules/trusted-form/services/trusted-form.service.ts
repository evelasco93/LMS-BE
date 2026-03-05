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

      // 3. Validate
      const validateResponse = await this.callValidate(
        cleanCertId,
        cleanPhone,
        username,
        password,
      );

      const validateOutcome = validateResponse?.outcome as string | undefined;
      const validateReason = validateResponse?.reason as string | undefined;

      if (
        validateOutcome === "failure" ||
        validateOutcome === "error"
      ) {
        this.logger.warn("TrustedForm validate failed", {
          cert_id: cleanCertId,
          outcome: validateOutcome,
          reason: validateReason,
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

      // 4. Claim
      const claimResponse = await this.callClaim(
        cleanCertId,
        cleanPhone,
        effectiveVendor,
        username,
        password,
      );

      const certData = claimResponse?.cert;

      this.logger.info("TrustedForm cert claimed", {
        cert_id: cleanCertId,
        outcome: claimResponse?.outcome,
        vendor: certData?.vendor,
      });

      return {
        result: true,
        data: {
          success: true,
          cert_id: cleanCertId,
          outcome: (claimResponse?.outcome as string) ?? "success",
          phone: cleanPhone,
          phone_match: (
            validateResponse?.match_lead as
              | { phone_match?: boolean }
              | undefined
          )?.phone_match,
          vendor: certData?.vendor ?? effectiveVendor,
          previously_retained: certData?.previously_retained,
          expires_at: certData?.expires_at,
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
      TableName: this.constants.CREDENTIALS_TABLE_NAME,
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
    phone: string | undefined,
    username: string,
    password: string,
  ): Promise<TrustedFormValidateResponse> {
    const body = JSON.stringify(
      phone ? { match_lead: { phone } } : {},
    );

    return this.httpsPost(
      `cert.trustedform.com`,
      `/${certId}/validate`,
      body,
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

    return this.httpsPost(
      `cert.trustedform.com`,
      `/${certId}`,
      body,
      username,
      password,
    ) as Promise<TrustedFormClaimResponse>;
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
          try {
            resolve(JSON.parse(raw));
          } catch {
            resolve(raw);
          }
        });
      });

      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }
}
