import { inject, injectable } from "inversify";
import { Logger } from "@shared/services/logger.util";
import { SecretsManagerUtil } from "@shared/services/secrets-manager.util";
import { TenantConfigConstants } from "../constants/tenant-config.constants";
import {
  CredentialType,
  TenantCredentialRecord,
} from "../interfaces/ITenantConfig.interface";
import { UpsertCredentialRequest } from "../types/tenant-config-request.types";
import { ServiceResult } from "../types/common.types";
import { RequestActor } from "@shared/utils/request-audit.util";

@injectable()
export class TenantConfigService {
  constructor(
    @inject("Logger") private readonly logger: Logger,
    @inject("SecretsManagerUtil")
    private readonly secretsManagerUtil: SecretsManagerUtil,
    @inject("TenantConfigConstants")
    private readonly constants: TenantConfigConstants,
  ) {}

  async upsertCredential(
    request: UpsertCredentialRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<TenantCredentialRecord>> {
    try {
      const provider = request.provider?.trim().toLowerCase();
      if (!provider) {
        return { result: false, error: "provider is required" };
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

      const secretName = this.resolveSecretName(provider);
      const record: TenantCredentialRecord = {
        provider,
        type: request.type,
        credentials: request.credentials,
        updated_at: new Date().toISOString(),
        updated_by: actor,
      };

      await this.secretsManagerUtil.upsertJsonSecret(secretName, record);

      this.logger.info("Tenant credential upserted", {
        provider,
        secretName,
      });

      return {
        result: true,
        data: record,
      };
    } catch (error: any) {
      this.logger.error("Failed to upsert tenant credential", error);
      return {
        result: false,
        error: error?.message || "Failed to upsert tenant credential",
      };
    }
  }

  async getCredential(
    provider: string,
  ): Promise<ServiceResult<TenantCredentialRecord>> {
    try {
      const normalizedProvider = provider?.trim().toLowerCase();
      if (!normalizedProvider) {
        return { result: false, error: "provider is required" };
      }

      const secretName = this.resolveSecretName(normalizedProvider);
      const credential =
        await this.secretsManagerUtil.getJsonSecret<TenantCredentialRecord>(
          secretName,
        );

      if (!credential) {
        return { result: false, error: "Credential not found" };
      }

      return { result: true, data: credential };
    } catch (error: any) {
      this.logger.error("Failed to get tenant credential", error);
      return {
        result: false,
        error: error?.message || "Failed to get tenant credential",
      };
    }
  }

  async listCredentials(): Promise<ServiceResult<TenantCredentialRecord[]>> {
    const providers = [
      "ipqs",
      "trusted_forms",
      "internal_api_auth",
      "external_leads_api",
    ];
    const items: TenantCredentialRecord[] = [];

    for (const provider of providers) {
      const result = await this.getCredential(provider);
      if (result.result && result.data) {
        items.push(result.data);
      }
    }

    return { result: true, data: items };
  }

  async deleteCredential(provider: string): Promise<ServiceResult<void>> {
    try {
      const normalizedProvider = provider?.trim().toLowerCase();
      if (!normalizedProvider) {
        return { result: false, error: "provider is required" };
      }

      const secretName = this.resolveSecretName(normalizedProvider);
      await this.secretsManagerUtil.deleteSecret({
        secretName,
        forceDeleteWithoutRecovery: true,
      });

      this.logger.info("Tenant credential deleted", {
        provider: normalizedProvider,
        secretName,
      });

      return { result: true };
    } catch (error: any) {
      this.logger.error("Failed to delete tenant credential", error);
      return {
        result: false,
        error: error?.message || "Failed to delete tenant credential",
      };
    }
  }

  private resolveSecretName(provider: string): string {
    if (provider === "ipqs" && this.constants.IPQS_SECRET_NAME) {
      return this.constants.IPQS_SECRET_NAME;
    }

    if (
      (provider === "trusted_forms" || provider === "trusted-forms") &&
      this.constants.TRUSTED_FORMS_SECRET_NAME
    ) {
      return this.constants.TRUSTED_FORMS_SECRET_NAME;
    }

    if (
      (provider === "internal_api_auth" || provider === "internal-api-auth") &&
      this.constants.INTERNAL_API_AUTH_TOKEN_SECRET_NAME
    ) {
      return this.constants.INTERNAL_API_AUTH_TOKEN_SECRET_NAME;
    }

    if (
      (provider === "external_leads_api" ||
        provider === "external-leads-api") &&
      this.constants.EXTERNAL_LEADS_API_KEY_SECRET_NAME
    ) {
      return this.constants.EXTERNAL_LEADS_API_KEY_SECRET_NAME;
    }

    const normalized = provider.replace(/[^a-z0-9-_]/g, "-");
    if (!this.constants.SECRET_PREFIX) {
      return normalized;
    }

    return `${this.constants.SECRET_PREFIX}-${normalized}`;
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
