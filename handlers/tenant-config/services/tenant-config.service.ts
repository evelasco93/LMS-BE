import { inject, injectable } from "inversify";
import https from "https";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { Logger } from "@shared/services/logger.util";
import { IdGenerator } from "@shared/generators/id.generator";
import { encrypt, decrypt } from "@shared/utils/crypto.util";
import { TenantConfigConstants } from "../constants/tenant-config.constants";
import {
  CredentialType,
  TenantCredentialRecord,
  IPluginSchemaRecord,
} from "../interfaces/ITenantConfig.interface";
import {
  CreateCredentialRequest,
  UpdateCredentialRequest,
  CreatePluginSchemaRequest,
} from "../types/tenant-config-request.types";
import { ServiceResult } from "../types/common.types";
import { RequestActor } from "@shared/utils/request-audit.util";

/** Fields that must be encrypted at rest */
const SENSITIVE_FIELDS: Record<CredentialType, string[]> = {
  api_key: ["apiKey"],
  basic_auth: ["password"],
  bearer_token: ["token"],
};

@injectable()
export class TenantConfigService {
  constructor(
    @inject("Logger") private readonly logger: Logger,
    @inject("DynamoDBUtil") private readonly dynamoDBUtil: DynamoDBUtil,
    @inject("TenantConfigConstants")
    private readonly constants: TenantConfigConstants,
  ) {}

  async createCredential(
    request: CreateCredentialRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<TenantCredentialRecord>> {
    try {
      const provider = request.provider?.trim().toLowerCase();
      if (!provider) {
        return { result: false, error: "provider is required" };
      }
      if (!request.name?.trim()) {
        return { result: false, error: "name is required" };
      }
      if (!request.type) {
        return { result: false, error: "type is required" };
      }

      const credentialsValidation = this.validateCredentials(
        request.type,
        request.credentials,
      );
      if (!credentialsValidation.result) {
        return { result: false, error: credentialsValidation.error };
      }

      const now = new Date().toISOString();
      const record: TenantCredentialRecord = {
        id: IdGenerator.generateCredentialId(),
        provider,
        name: request.name.trim(),
        type: request.type,
        credentials: this.encryptCredentials(
          request.type,
          request.credentials,
        ),
        vendor: request.vendor?.trim() || undefined,
        created_at: now,
        updated_at: now,
        created_by: actor,
        updated_by: actor,
      };

      await this.dynamoDBUtil.put({
        TableName: this.constants.CREDENTIALS_TABLE_NAME,
        Item: record,
      });

      this.logger.info("Credential created", { id: record.id, provider });
      return { result: true, data: this.decryptRecord(record) };
    } catch (error: any) {
      this.logger.error("Failed to create credential", error);
      return {
        result: false,
        error: error?.message || "Failed to create credential",
      };
    }
  }

  async updateCredential(
    id: string,
    request: UpdateCredentialRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<TenantCredentialRecord>> {
    try {
      const existing = await this.getRecordById(id);
      if (!existing) {
        return { result: false, error: "Credential not found" };
      }

      const type = request.type ?? existing.type;

      if (request.credentials) {
        const credentialsValidation = this.validateCredentials(
          type,
          request.credentials,
        );
        if (!credentialsValidation.result) {
          return { result: false, error: credentialsValidation.error };
        }
      }

      const now = new Date().toISOString();
      const updated: TenantCredentialRecord = {
        ...existing,
        name: request.name?.trim() ?? existing.name,
        type,
        credentials: request.credentials
          ? this.encryptCredentials(type, request.credentials)
          : existing.credentials,
        vendor:
          request.vendor !== undefined
            ? request.vendor?.trim() || undefined
            : existing.vendor,
        updated_at: now,
        updated_by: actor,
      };

      await this.dynamoDBUtil.put({
        TableName: this.constants.CREDENTIALS_TABLE_NAME,
        Item: updated,
      });

      this.logger.info("Credential updated", { id });
      return { result: true, data: this.decryptRecord(updated) };
    } catch (error: any) {
      this.logger.error("Failed to update credential", error);
      return {
        result: false,
        error: error?.message || "Failed to update credential",
      };
    }
  }

  async getCredential(
    id: string,
  ): Promise<ServiceResult<TenantCredentialRecord>> {
    try {
      const record = await this.getRecordById(id);
      if (!record) {
        return { result: false, error: "Credential not found" };
      }
      return { result: true, data: this.decryptRecord(record) };
    } catch (error: any) {
      this.logger.error("Failed to get credential", error);
      return {
        result: false,
        error: error?.message || "Failed to get credential",
      };
    }
  }

  async listCredentials(
    provider?: string,
  ): Promise<ServiceResult<TenantCredentialRecord[]>> {
    try {
      let records: TenantCredentialRecord[];

      if (provider) {
        const normalizedProvider = provider.trim().toLowerCase();
        records = await this.dynamoDBUtil.queryAll<TenantCredentialRecord>({
          TableName: this.constants.CREDENTIALS_TABLE_NAME,
          IndexName: `${this.constants.CREDENTIALS_TABLE_NAME}-provider-index`,
          KeyConditionExpression: "#provider = :provider",
          ExpressionAttributeNames: { "#provider": "provider" },
          ExpressionAttributeValues: { ":provider": normalizedProvider },
        });
      } else {
        records = await this.dynamoDBUtil.scanAll<TenantCredentialRecord>({
          TableName: this.constants.CREDENTIALS_TABLE_NAME,
        });
      }

      return {
        result: true,
        data: records.map((r) => this.decryptRecord(r)),
      };
    } catch (error: any) {
      this.logger.error("Failed to list credentials", error);
      return {
        result: false,
        error: error?.message || "Failed to list credentials",
      };
    }
  }

  async deleteCredential(id: string): Promise<ServiceResult<void>> {
    try {
      const existing = await this.getRecordById(id);
      if (!existing) {
        return { result: false, error: "Credential not found" };
      }

      await this.dynamoDBUtil.delete({
        TableName: this.constants.CREDENTIALS_TABLE_NAME,
        Key: { id },
      });

      this.logger.info("Credential deleted", { id });
      return { result: true };
    } catch (error: any) {
      this.logger.error("Failed to delete credential", error);
      return {
        result: false,
        error: error?.message || "Failed to delete credential",
      };
    }
  }

  /**
   * Fetches a raw (encrypted) record by ID. Used internally and by the
   * TrustedForm validate endpoint which passes the decrypted credential
   * to the TrustedForm API call.
   */
  async getRawCredential(
    id: string,
  ): Promise<ServiceResult<TenantCredentialRecord>> {
    try {
      const record = await this.getRecordById(id);
      if (!record) {
        return { result: false, error: "Credential not found" };
      }
      return { result: true, data: this.decryptRecord(record) };
    } catch (error: any) {
      this.logger.error("Failed to get raw credential", error);
      return {
        result: false,
        error: error?.message || "Failed to get raw credential",
      };
    }
  }
  // ── Credential disable / enable ───────────────────────────────────────────

  async disableCredential(
    id: string,
    actor?: RequestActor,
  ): Promise<ServiceResult<TenantCredentialRecord>> {
    try {
      const existing = await this.getRecordById(id);
      if (!existing) {
        return { result: false, error: "Credential not found" };
      }

      const updated: TenantCredentialRecord = {
        ...existing,
        enabled: false,
        updated_at: new Date().toISOString(),
        updated_by: actor,
      };

      await this.dynamoDBUtil.put({
        TableName: this.constants.CREDENTIALS_TABLE_NAME,
        Item: updated,
      });

      this.logger.info("Credential disabled", { id });
      return { result: true, data: this.decryptRecord(updated) };
    } catch (error: any) {
      this.logger.error("Failed to disable credential", error);
      return {
        result: false,
        error: error?.message || "Failed to disable credential",
      };
    }
  }

  async enableCredential(
    id: string,
    actor?: RequestActor,
  ): Promise<ServiceResult<TenantCredentialRecord>> {
    try {
      const existing = await this.getRecordById(id);
      if (!existing) {
        return { result: false, error: "Credential not found" };
      }

      const updated: TenantCredentialRecord = {
        ...existing,
        enabled: true,
        updated_at: new Date().toISOString(),
        updated_by: actor,
      };

      await this.dynamoDBUtil.put({
        TableName: this.constants.CREDENTIALS_TABLE_NAME,
        Item: updated,
      });

      this.logger.info("Credential enabled", { id });
      return { result: true, data: this.decryptRecord(updated) };
    } catch (error: any) {
      this.logger.error("Failed to enable credential", error);
      return {
        result: false,
        error: error?.message || "Failed to enable credential",
      };
    }
  }

  /** Finds the first active TrustedForm (basic_auth) credential for use by the check-cert endpoint */
  async findDefaultTrustedFormCredential(): Promise<ServiceResult<TenantCredentialRecord>> {
    try {
      const records = await this.dynamoDBUtil.queryAll<TenantCredentialRecord>({
        TableName: this.constants.CREDENTIALS_TABLE_NAME,
        IndexName: `${this.constants.CREDENTIALS_TABLE_NAME}-provider-index`,
        KeyConditionExpression: "#provider = :provider",
        ExpressionAttributeNames: { "#provider": "provider" },
        ExpressionAttributeValues: { ":provider": "trusted_form" },
      });
      const active = records.find((r) => r.enabled !== false);
      if (!active) {
        return {
          result: false,
          error: "No active TrustedForm credential found — create one at POST /tenant-config/credentials",
        };
      }
      return { result: true, data: this.decryptRecord(active) };
    } catch (error: any) {
      this.logger.error("Failed to find default TrustedForm credential", error);
      return {
        result: false,
        error: error?.message || "Failed to find TrustedForm credential",
      };
    }
  }
  // ── Plugin Schemas ─────────────────────────────────────────────────────────

  async createPluginSchema(
    request: CreatePluginSchemaRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<IPluginSchemaRecord>> {
    try {
      const provider = request.provider?.trim().toLowerCase();
      if (!provider) {
        return { result: false, error: "provider is required" };
      }
      if (!request.name?.trim()) {
        return { result: false, error: "name is required" };
      }
      if (!request.credential_type) {
        return { result: false, error: "credential_type is required" };
      }
      if (!Array.isArray(request.fields) || request.fields.length === 0) {
        return { result: false, error: "fields must be a non-empty array" };
      }
      for (const field of request.fields) {
        if (!field.name?.trim()) {
          return { result: false, error: "Each field must have a name" };
        }
        if (!field.label?.trim()) {
          return { result: false, error: "Each field must have a label" };
        }
        if (!field.type) {
          return { result: false, error: "Each field must have a type" };
        }
      }

      const now = new Date().toISOString();
      const record: IPluginSchemaRecord = {
        id: IdGenerator.generatePluginSchemaId(),
        provider,
        name: request.name.trim(),
        credential_type: request.credential_type,
        fields: request.fields,
        description: request.description?.trim() || undefined,
        created_at: now,
        updated_at: now,
        created_by: actor,
        updated_by: actor,
      };

      await this.dynamoDBUtil.put({
        TableName: this.constants.PLUGIN_SCHEMAS_TABLE_NAME,
        Item: record,
      });

      this.logger.info("Plugin schema created", { id: record.id, provider });
      return { result: true, data: record };
    } catch (error: any) {
      this.logger.error("Failed to create plugin schema", error);
      return {
        result: false,
        error: error?.message || "Failed to create plugin schema",
      };
    }
  }

  async listPluginSchemas(): Promise<ServiceResult<IPluginSchemaRecord[]>> {
    try {
      const records = await this.dynamoDBUtil.scanAll<IPluginSchemaRecord>({
        TableName: this.constants.PLUGIN_SCHEMAS_TABLE_NAME,
      });
      return { result: true, data: records };
    } catch (error: any) {
      this.logger.error("Failed to list plugin schemas", error);
      return {
        result: false,
        error: error?.message || "Failed to list plugin schemas",
      };
    }
  }

  async getPluginSchema(
    id: string,
  ): Promise<ServiceResult<IPluginSchemaRecord>> {
    try {
      const record = await this.dynamoDBUtil.get<IPluginSchemaRecord>({
        TableName: this.constants.PLUGIN_SCHEMAS_TABLE_NAME,
        Key: { id },
      });
      if (!record) {
        return { result: false, error: "Plugin schema not found" };
      }
      return { result: true, data: record };
    } catch (error: any) {
      this.logger.error("Failed to get plugin schema", error);
      return {
        result: false,
        error: error?.message || "Failed to get plugin schema",
      };
    }
  }

  // ── TrustedForm API operations ───────────────────────────────────────────────

  /**
   * Validates a TrustedForm certificate using an auto-resolved or explicit credential.
   * If credentialsId is omitted, the first active trusted_form credential is used.
   */
  async checkCert(
    certId: string,
    credentialsId?: string,
  ): Promise<ServiceResult<unknown>> {
    try {
      if (!certId?.trim()) {
        return { result: false, error: "cert_id is required" };
      }

      const credResult = credentialsId
        ? await this.getCredential(credentialsId)
        : await this.findDefaultTrustedFormCredential();

      if (!credResult.result || !credResult.data) {
        return { result: false, error: credResult.error ?? "TrustedForm credential not found" };
      }

      return this.callTrustedFormApi(this.extractCertId(certId), credResult.data);
    } catch (error: any) {
      this.logger.error("checkCert failed", error);
      return { result: false, error: error?.message || "check-cert failed" };
    }
  }

  /**
   * Validates a TrustedForm certificate using an explicitly supplied credential ID.
   */
  async validateTrustedFormCert(
    certId: string,
    credentialsId: string,
  ): Promise<ServiceResult<unknown>> {
    try {
      if (!certId?.trim()) {
        return { result: false, error: "cert_id is required" };
      }
      if (!credentialsId?.trim()) {
        return { result: false, error: "credentials_id is required" };
      }

      const credResult = await this.getCredential(credentialsId);
      if (!credResult.result || !credResult.data) {
        return { result: false, error: credResult.error ?? "Credential not found" };
      }

      return this.callTrustedFormApi(this.extractCertId(certId), credResult.data);
    } catch (error: any) {
      this.logger.error("validateTrustedFormCert failed", error);
      return { result: false, error: error?.message || "validate failed" };
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private extractCertId(input: string): string {
    // Accepts a bare 40-char hex ID or a full https://cert.trustedform.com/... URL
    const match = input.match(
      /(?:https?:\/\/cert\.trustedform\.com\/)?([a-f0-9]{40})(?:\/.*)?$/i,
    );
    return match ? match[1] : input.trim();
  }

  private async callTrustedFormApi(
    certId: string,
    cred: TenantCredentialRecord,
  ): Promise<ServiceResult<unknown>> {
    if (cred.type !== "basic_auth") {
      return {
        result: false,
        error: "TrustedForm credentials must be of type basic_auth",
      };
    }

    const { username, password } = cred.credentials;
    if (!username || !password) {
      return {
        result: false,
        error: "TrustedForm credential missing username or password",
      };
    }

    try {
      const data = await new Promise<unknown>((resolve, reject) => {
        const auth = Buffer.from(`${username}:${password}`).toString("base64");
        const req = https.request(
          {
            hostname: "cert.trustedform.com",
            path: `/${certId}/validate`,
            method: "POST",
            headers: {
              Authorization: `Basic ${auth}`,
              "Content-Type": "application/json",
              Accept: "application/json",
              "Api-Version": "4.0",
              "Content-Length": 2,
            },
          },
          (res) => {
            let raw = "";
            res.on("data", (chunk) => (raw += chunk));
            res.on("end", () => {
              try {
                resolve(JSON.parse(raw));
              } catch {
                resolve(raw);
              }
            });
          },
        );
        req.on("error", reject);
        req.write("{}");
        req.end();
      });
      return { result: true, data };
    } catch (error: any) {
      this.logger.error("TrustedForm API call failed", { certId, error: error?.message });
      return { result: false, error: error?.message || "TrustedForm API call failed" };
    }
  }

  private async getRecordById(
    id: string,
  ): Promise<TenantCredentialRecord | null> {
    const result = await this.dynamoDBUtil.get<TenantCredentialRecord>({
      TableName: this.constants.CREDENTIALS_TABLE_NAME,
      Key: { id },
    });
    return result ?? null;
  }

  private encryptCredentials(
    type: CredentialType,
    credentials: Record<string, string>,
  ): Record<string, string> {
    const sensitiveFields = SENSITIVE_FIELDS[type] ?? [];
    const result: Record<string, string> = { ...credentials };
    for (const field of sensitiveFields) {
      if (result[field]) {
        result[field] = encrypt(result[field], this.constants.CREDENTIALS_ENCRYPTION_KEY);
      }
    }
    return result;
  }

  private decryptCredentials(
    type: CredentialType,
    credentials: Record<string, string>,
  ): Record<string, string> {
    const sensitiveFields = SENSITIVE_FIELDS[type] ?? [];
    const result: Record<string, string> = { ...credentials };
    for (const field of sensitiveFields) {
      if (result[field]) {
        try {
          result[field] = decrypt(result[field], this.constants.CREDENTIALS_ENCRYPTION_KEY);
        } catch {
          // Value may already be plaintext (migration / first-run edge case)
        }
      }
    }
    return result;
  }

  private decryptRecord(record: TenantCredentialRecord): TenantCredentialRecord {
    return {
      ...record,
      credentials: this.decryptCredentials(record.type, record.credentials),
    };
  }

  private validateCredentials(
    type: CredentialType,
    credentials?: Record<string, string>,
  ): ServiceResult<void> {
    if (!credentials || typeof credentials !== "object") {
      return { result: false, error: "credentials are required" };
    }

    if (type === "api_key") {
      if (!credentials.apiKey) {
        return {
          result: false,
          error: "credentials.apiKey is required for api_key",
        };
      }
      return { result: true };
    }

    if (type === "basic_auth") {
      if (!credentials.username || !credentials.password) {
        return {
          result: false,
          error:
            "credentials.username and credentials.password are required for basic_auth",
        };
      }
      return { result: true };
    }

    if (type === "bearer_token") {
      if (!credentials.token) {
        return {
          result: false,
          error: "credentials.token is required for bearer_token",
        };
      }
      return { result: true };
    }

    return {
      result: false,
      error: `Unsupported credential type: ${type}`,
    };
  }
}
