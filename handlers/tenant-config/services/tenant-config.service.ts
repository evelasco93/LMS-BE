import { inject, injectable } from "inversify";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { Logger } from "@shared/services/logger.util";
import { AuditWriterService } from "@shared/services";
import { AuditChange } from "@shared/interfaces";
import { IdGenerator } from "@shared/generators/id.generator";
import { encrypt, decrypt } from "@shared/utils/crypto.util";
import {
  TenantConfigConstants,
  AVAILABLE_PLUGINS,
} from "../constants/tenant-config.constants";
import {
  CredentialType,
  TenantCredentialRecord,
  ICredentialSchemaRecord,
  IPluginSettingRecord,
  IPluginView,
  ITagDefinitionRecord,
  IPlatformPresetRecord,
  ITenantPresetRecord,
} from "../interfaces/ITenantConfig.interface";
import {
  CreateCredentialRequest,
  UpdateCredentialRequest,
  CreateCredentialSchemaRequest,
  UpdateCredentialSchemaRequest,
  SetPluginSettingRequest,
  UpdatePluginSettingRequest,
  CreateTagDefinitionRequest,
  UpdateTagDefinitionRequest,
  UpdatePlatformPresetRequest,
  CreatePlatformPresetRequest,
  CreateTenantPresetRequest,
  UpdateTenantPresetRequest,
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
    @inject("AuditWriterService")
    private readonly auditWriterService: AuditWriterService,
  ) {}

  // ── Index name helpers ─────────────────────────────────────────────────────

  private get typeIndex(): string {
    return `${this.constants.TENANT_SETTINGS_TABLE_NAME}-type-index`;
  }

  private get typeProviderIndex(): string {
    return `${this.constants.TENANT_SETTINGS_TABLE_NAME}-type-provider-index`;
  }

  private get schemaIdIndex(): string {
    return `${this.constants.TENANT_SETTINGS_TABLE_NAME}-schema-id-index`;
  }

  // ── Credential CRUD ────────────────────────────────────────────────────────

  async createCredential(
    request: CreateCredentialRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<TenantCredentialRecord>> {
    try {
      const provider = request.provider?.trim().toLowerCase();
      if (!provider) return { result: false, error: "provider is required" };
      if (!request.name?.trim())
        return { result: false, error: "name is required" };
      if (!request.credential_type)
        return { result: false, error: "credential_type is required" };

      const validation = this.validateCredentials(
        request.credential_type,
        request.credentials,
      );
      if (!validation.result) return { result: false, error: validation.error };

      const now = new Date().toISOString();
      const record: TenantCredentialRecord = {
        id: IdGenerator.generateCredentialId(),
        type: "credential",
        provider,
        schema_id: request.schema_id?.trim() || undefined,
        name: request.name.trim(),
        credential_type: request.credential_type,
        credentials: this.encryptCredentials(
          request.credential_type,
          request.credentials,
        ),
        vendor: request.vendor?.trim() || undefined,
        enabled: true,
        created_at: now,
        updated_at: now,
        created_by: actor,
        updated_by: actor,
        is_deleted: false,
        active: true,
        deleted_at: null,
        deleted_by: null,
      };

      await this.dynamoDBUtil.put({
        TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
        Item: record,
      });
      await this.auditWriterService.writeAuditEvent({
        entity_id: record.id,
        entity_type: "credential",
        action: "created",
        changes: [],
        actor,
        changed_at: now,
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
      const existing = await this.getCredentialById(id);
      if (!existing) return { result: false, error: "Credential not found" };
      if (existing.is_deleted)
        return { result: false, error: "Cannot update a deleted credential" };

      const credentialType =
        request.credential_type ?? existing.credential_type;
      if (request.credentials) {
        const validation = this.validateCredentials(
          credentialType,
          request.credentials,
        );
        if (!validation.result)
          return { result: false, error: validation.error };
      }

      const now = new Date().toISOString();
      const tracked: Array<keyof TenantCredentialRecord> = [
        "name",
        "credential_type",
        "vendor",
        "enabled",
      ];
      const changes: AuditChange[] = [];

      for (const key of tracked) {
        const prev = existing[key];
        const next = (request as any)[key];
        if (
          next !== undefined &&
          JSON.stringify(prev ?? null) !== JSON.stringify(next ?? null)
        ) {
          changes.push({ field: key, from: prev ?? null, to: next });
        }
      }
      if (request.credentials) {
        changes.push({
          field: "credentials",
          from: "[redacted]",
          to: "[updated]",
        });
      }

      const updated: TenantCredentialRecord = {
        ...existing,
        name: request.name?.trim() ?? existing.name,
        credential_type: credentialType,
        credentials: request.credentials
          ? this.encryptCredentials(credentialType, request.credentials)
          : existing.credentials,
        vendor:
          request.vendor !== undefined
            ? request.vendor?.trim() || undefined
            : existing.vendor,
        updated_at: now,
        updated_by: actor,
      };

      await this.dynamoDBUtil.put({
        TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
        Item: updated,
      });
      await this.auditWriterService.writeAuditEvent({
        entity_id: id,
        entity_type: "credential",
        action: "updated",
        changes,
        actor,
        changed_at: now,
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
      const record = await this.getCredentialById(id);
      if (!record) return { result: false, error: "Credential not found" };
      return { result: true, data: this.decryptRecord(record) };
    } catch (error: any) {
      return {
        result: false,
        error: error?.message || "Failed to get credential",
      };
    }
  }

  async listCredentials(
    provider?: string,
    includeDeleted = false,
  ): Promise<ServiceResult<TenantCredentialRecord[]>> {
    try {
      let records: TenantCredentialRecord[];

      if (provider) {
        records = await this.dynamoDBUtil.queryAll<TenantCredentialRecord>({
          TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
          IndexName: this.typeProviderIndex,
          KeyConditionExpression: "#t = :type AND #p = :provider",
          ExpressionAttributeNames: { "#t": "type", "#p": "provider" },
          ExpressionAttributeValues: {
            ":type": "credential",
            ":provider": provider.trim().toLowerCase(),
          },
          ...(includeDeleted
            ? {}
            : {
                FilterExpression:
                  "attribute_not_exists(is_deleted) OR is_deleted = :f",
                ExpressionAttributeValues: {
                  ":type": "credential",
                  ":provider": provider.trim().toLowerCase(),
                  ":f": false,
                },
              }),
        });
      } else {
        records = await this.dynamoDBUtil.queryAll<TenantCredentialRecord>({
          TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
          IndexName: this.typeIndex,
          KeyConditionExpression: "#t = :type",
          ExpressionAttributeNames: { "#t": "type" },
          ExpressionAttributeValues: {
            ":type": "credential",
            ...(includeDeleted ? {} : { ":f": false }),
          },
          ...(includeDeleted
            ? {}
            : {
                FilterExpression:
                  "attribute_not_exists(is_deleted) OR is_deleted = :f",
              }),
        });
      }

      return { result: true, data: records.map((r) => this.decryptRecord(r)) };
    } catch (error: any) {
      this.logger.error("Failed to list credentials", error);
      return {
        result: false,
        error: error?.message || "Failed to list credentials",
      };
    }
  }

  async deleteCredential(
    id: string,
    options: { permanent?: boolean } = {},
    actor?: RequestActor,
  ): Promise<ServiceResult<void>> {
    try {
      const existing = await this.getCredentialById(id);
      if (!existing) return { result: false, error: "Credential not found" };

      // Safeguard: check if any plugin_setting references this credential
      const referencingSettings =
        await this.findPluginSettingsByCredentialId(id);
      if (referencingSettings.length > 0) {
        return {
          result: false,
          error: `Cannot delete credential — it is referenced by ${referencingSettings.length} plugin setting(s). Remove the plugin setting first.`,
        };
      }

      const now = new Date().toISOString();
      if (options.permanent) {
        await this.dynamoDBUtil.delete({
          TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
          Key: { id },
        });
        await this.auditWriterService.writeAuditEvent({
          entity_id: id,
          entity_type: "credential",
          action: "hard_deleted",
          changes: [],
          actor,
          changed_at: now,
        });
        this.logger.info("Credential hard-deleted", { id });
      } else {
        const updated: TenantCredentialRecord = {
          ...existing,
          is_deleted: true,
          active: false,
          deleted_at: now,
          deleted_by: actor ?? null,
          updated_at: now,
          updated_by: actor,
        };
        await this.dynamoDBUtil.put({
          TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
          Item: updated,
        });
        await this.auditWriterService.writeAuditEvent({
          entity_id: id,
          entity_type: "credential",
          action: "soft_deleted",
          changes: [{ field: "is_deleted", from: false, to: true }],
          actor,
          changed_at: now,
        });
        this.logger.info("Credential soft-deleted", { id });
      }

      return { result: true };
    } catch (error: any) {
      this.logger.error("Failed to delete credential", error);
      return {
        result: false,
        error: error?.message || "Failed to delete credential",
      };
    }
  }

  async disableCredential(
    id: string,
    actor?: RequestActor,
  ): Promise<ServiceResult<TenantCredentialRecord>> {
    try {
      const existing = await this.getCredentialById(id);
      if (!existing) return { result: false, error: "Credential not found" };
      if (existing.is_deleted)
        return { result: false, error: "Cannot disable a deleted credential" };

      const now = new Date().toISOString();
      const updated: TenantCredentialRecord = {
        ...existing,
        enabled: false,
        updated_at: now,
        updated_by: actor,
      };

      await this.dynamoDBUtil.put({
        TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
        Item: updated,
      });
      await this.auditWriterService.writeAuditEvent({
        entity_id: id,
        entity_type: "credential",
        action: "credential_disabled",
        changes: [{ field: "enabled", from: existing.enabled, to: false }],
        actor,
        changed_at: now,
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
      const existing = await this.getCredentialById(id);
      if (!existing) return { result: false, error: "Credential not found" };
      if (existing.is_deleted)
        return { result: false, error: "Cannot enable a deleted credential" };

      const now = new Date().toISOString();
      const updated: TenantCredentialRecord = {
        ...existing,
        enabled: true,
        updated_at: now,
        updated_by: actor,
      };

      await this.dynamoDBUtil.put({
        TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
        Item: updated,
      });
      await this.auditWriterService.writeAuditEvent({
        entity_id: id,
        entity_type: "credential",
        action: "credential_enabled",
        changes: [{ field: "enabled", from: existing.enabled, to: true }],
        actor,
        changed_at: now,
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

  async restoreCredential(
    id: string,
    actor?: RequestActor,
  ): Promise<ServiceResult<TenantCredentialRecord>> {
    try {
      const existing = await this.getCredentialById(id);
      if (!existing) return { result: false, error: "Credential not found" };
      if (!existing.is_deleted)
        return { result: false, error: "Credential is not deleted" };

      const now = new Date().toISOString();
      const updated: TenantCredentialRecord = {
        ...existing,
        is_deleted: false,
        active: true,
        deleted_at: null,
        deleted_by: null,
        updated_at: now,
        updated_by: actor,
      };

      await this.dynamoDBUtil.put({
        TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
        Item: updated,
      });
      await this.auditWriterService.writeAuditEvent({
        entity_id: id,
        entity_type: "credential",
        action: "restored",
        changes: [{ field: "is_deleted", from: true, to: false }],
        actor,
        changed_at: now,
      });
      this.logger.info("Credential restored", { id });
      return { result: true, data: this.decryptRecord(updated) };
    } catch (error: any) {
      this.logger.error("Failed to restore credential", error);
      return {
        result: false,
        error: error?.message || "Failed to restore credential",
      };
    }
  }

  /**
   * Finds the first active credential for a given provider.
   * Used by the QA orchestrator to auto-resolve credentials from global plugin settings.
   */
  async findDefaultCredentialForProvider(
    provider: string,
  ): Promise<ServiceResult<TenantCredentialRecord>> {
    try {
      const records = await this.dynamoDBUtil.queryAll<TenantCredentialRecord>({
        TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
        IndexName: this.typeProviderIndex,
        KeyConditionExpression: "#t = :type AND #p = :provider",
        FilterExpression:
          "enabled = :enabled AND (attribute_not_exists(is_deleted) OR is_deleted = :f)",
        ExpressionAttributeNames: { "#t": "type", "#p": "provider" },
        ExpressionAttributeValues: {
          ":type": "credential",
          ":provider": provider,
          ":enabled": true,
          ":f": false,
        },
      });
      const active = records[0];
      if (!active) {
        return {
          result: false,
          error: `No active credential found for provider "${provider}"`,
        };
      }
      return { result: true, data: this.decryptRecord(active) };
    } catch (error: any) {
      this.logger.error("Failed to find default credential", error);
      return {
        result: false,
        error: error?.message || "Failed to find default credential",
      };
    }
  }

  // ── Credential Schemas ─────────────────────────────────────────────────────

  async createCredentialSchema(
    request: CreateCredentialSchemaRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<ICredentialSchemaRecord>> {
    try {
      const provider = request.provider?.trim().toLowerCase();
      if (!provider) return { result: false, error: "provider is required" };
      if (!request.name?.trim())
        return { result: false, error: "name is required" };
      if (!request.credential_type)
        return { result: false, error: "credential_type is required" };
      if (!Array.isArray(request.fields) || request.fields.length === 0)
        return { result: false, error: "fields must be a non-empty array" };

      for (const field of request.fields) {
        if (!field.name?.trim())
          return { result: false, error: "Each field must have a name" };
        if (!field.label?.trim())
          return { result: false, error: "Each field must have a label" };
        if (!field.type)
          return { result: false, error: "Each field must have a type" };
      }

      const now = new Date().toISOString();
      const record: ICredentialSchemaRecord = {
        id: IdGenerator.generateCredentialSchemaId(),
        type: "credential_schema",
        provider,
        name: request.name.trim(),
        credential_type: request.credential_type,
        fields: request.fields,
        description: request.description?.trim() || undefined,
        created_at: now,
        updated_at: now,
        created_by: actor,
        updated_by: actor,
        is_deleted: false,
        active: true,
        deleted_at: null,
        deleted_by: null,
      };

      await this.dynamoDBUtil.put({
        TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
        Item: record,
      });
      await this.auditWriterService.writeAuditEvent({
        entity_id: record.id,
        entity_type: "credential_schema",
        action: "created",
        changes: [],
        actor,
        changed_at: now,
      });
      this.logger.info("Credential schema created", {
        id: record.id,
        provider,
      });
      return { result: true, data: record };
    } catch (error: any) {
      this.logger.error("Failed to create credential schema", error);
      return {
        result: false,
        error: error?.message || "Failed to create credential schema",
      };
    }
  }

  async updateCredentialSchema(
    id: string,
    request: UpdateCredentialSchemaRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<ICredentialSchemaRecord>> {
    try {
      const existing = await this.getCredentialSchemaById(id);
      if (!existing)
        return { result: false, error: "Credential schema not found" };
      if (existing.is_deleted)
        return {
          result: false,
          error: "Cannot update a deleted credential schema",
        };

      const now = new Date().toISOString();
      const changes: AuditChange[] = [];

      if (request.name !== undefined && request.name !== existing.name) {
        changes.push({ field: "name", from: existing.name, to: request.name });
      }
      if (
        request.description !== undefined &&
        request.description !== existing.description
      ) {
        changes.push({
          field: "description",
          from: existing.description ?? null,
          to: request.description,
        });
      }
      if (request.fields !== undefined) {
        changes.push({
          field: "fields",
          from: JSON.stringify(existing.fields),
          to: JSON.stringify(request.fields),
        });
      }
      if (
        request.credential_type !== undefined &&
        request.credential_type !== existing.credential_type
      ) {
        changes.push({
          field: "credential_type",
          from: existing.credential_type,
          to: request.credential_type,
        });
      }
      if (
        request.provider !== undefined &&
        request.provider !== existing.provider
      ) {
        changes.push({
          field: "provider",
          from: existing.provider,
          to: request.provider,
        });
      }

      const updated: ICredentialSchemaRecord = {
        ...existing,
        name: request.name?.trim() ?? existing.name,
        description:
          request.description !== undefined
            ? request.description?.trim() || undefined
            : existing.description,
        fields: request.fields ?? existing.fields,
        credential_type:
          (request.credential_type as ICredentialSchemaRecord["credential_type"]) ??
          existing.credential_type,
        provider: request.provider?.trim().toLowerCase() ?? existing.provider,
        updated_at: now,
        updated_by: actor,
      };

      await this.dynamoDBUtil.put({
        TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
        Item: updated,
      });
      await this.auditWriterService.writeAuditEvent({
        entity_id: id,
        entity_type: "credential_schema",
        action: "updated",
        changes,
        actor,
        changed_at: now,
      });
      this.logger.info("Credential schema updated", { id });
      return { result: true, data: updated };
    } catch (error: any) {
      this.logger.error("Failed to update credential schema", error);
      return {
        result: false,
        error: error?.message || "Failed to update credential schema",
      };
    }
  }

  async listCredentialSchemas(
    includeDeleted = false,
  ): Promise<ServiceResult<ICredentialSchemaRecord[]>> {
    try {
      const records = await this.dynamoDBUtil.queryAll<ICredentialSchemaRecord>(
        {
          TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
          IndexName: this.typeIndex,
          KeyConditionExpression: "#t = :type",
          ExpressionAttributeNames: { "#t": "type" },
          ExpressionAttributeValues: {
            ":type": "credential_schema",
            ...(includeDeleted ? {} : { ":f": false }),
          },
          ...(includeDeleted
            ? {}
            : {
                FilterExpression:
                  "attribute_not_exists(is_deleted) OR is_deleted = :f",
              }),
        },
      );
      return { result: true, data: records };
    } catch (error: any) {
      this.logger.error("Failed to list credential schemas", error);
      return {
        result: false,
        error: error?.message || "Failed to list credential schemas",
      };
    }
  }

  async getCredentialSchema(
    id: string,
  ): Promise<ServiceResult<ICredentialSchemaRecord>> {
    try {
      const record = await this.getCredentialSchemaById(id);
      if (!record)
        return { result: false, error: "Credential schema not found" };
      return { result: true, data: record };
    } catch (error: any) {
      return {
        result: false,
        error: error?.message || "Failed to get credential schema",
      };
    }
  }

  async deleteCredentialSchema(
    id: string,
    options: { permanent?: boolean } = {},
    actor?: RequestActor,
  ): Promise<ServiceResult<void>> {
    try {
      const existing = await this.getCredentialSchemaById(id);
      if (!existing)
        return { result: false, error: "Credential schema not found" };

      // Safeguard: block if any credential (including soft-deleted) still references this schema
      const referencingCredentials = await this.findCredentialsBySchemaId(id);
      if (referencingCredentials.length > 0) {
        return {
          result: false,
          error: `Cannot delete credential schema — ${referencingCredentials.length} credential(s) reference it. Delete those credentials first.`,
        };
      }

      const now = new Date().toISOString();
      if (options.permanent) {
        await this.dynamoDBUtil.delete({
          TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
          Key: { id },
        });
        await this.auditWriterService.writeAuditEvent({
          entity_id: id,
          entity_type: "credential_schema",
          action: "hard_deleted",
          changes: [],
          actor,
          changed_at: now,
        });
        this.logger.info("Credential schema hard-deleted", { id });
      } else {
        const updated: ICredentialSchemaRecord = {
          ...existing,
          is_deleted: true,
          active: false,
          deleted_at: now,
          deleted_by: actor ?? null,
          updated_at: now,
          updated_by: actor,
        };
        await this.dynamoDBUtil.put({
          TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
          Item: updated,
        });
        await this.auditWriterService.writeAuditEvent({
          entity_id: id,
          entity_type: "credential_schema",
          action: "soft_deleted",
          changes: [{ field: "is_deleted", from: false, to: true }],
          actor,
          changed_at: now,
        });
        this.logger.info("Credential schema soft-deleted", { id });
      }

      return { result: true };
    } catch (error: any) {
      this.logger.error("Failed to delete credential schema", error);
      return {
        result: false,
        error: error?.message || "Failed to delete credential schema",
      };
    }
  }

  async restoreCredentialSchema(
    id: string,
    actor?: RequestActor,
  ): Promise<ServiceResult<ICredentialSchemaRecord>> {
    try {
      const existing = await this.getCredentialSchemaById(id);
      if (!existing)
        return { result: false, error: "Credential schema not found" };
      if (!existing.is_deleted)
        return { result: false, error: "Credential schema is not deleted" };

      const now = new Date().toISOString();
      const updated: ICredentialSchemaRecord = {
        ...existing,
        is_deleted: false,
        active: true,
        deleted_at: null,
        deleted_by: null,
        updated_at: now,
        updated_by: actor,
      };

      await this.dynamoDBUtil.put({
        TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
        Item: updated,
      });
      await this.auditWriterService.writeAuditEvent({
        entity_id: id,
        entity_type: "credential_schema",
        action: "restored",
        changes: [{ field: "is_deleted", from: true, to: false }],
        actor,
        changed_at: now,
      });
      this.logger.info("Credential schema restored", { id });
      return { result: true, data: updated };
    } catch (error: any) {
      this.logger.error("Failed to restore credential schema", error);
      return {
        result: false,
        error: error?.message || "Failed to restore credential schema",
      };
    }
  }

  // ── Plugin Settings ────────────────────────────────────────────────────────

  /**
   * Upsert the global default plugin setting for a canonical provider.
   * Validates that `provider` exists in the AVAILABLE_PLUGINS registry so no
   * rogue entries can be created.  If a setting already exists for the provider
   * it is overwritten while preserving id, created_at and edit_history.
   */
  async setPluginSetting(
    provider: string,
    request: SetPluginSettingRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<IPluginSettingRecord>> {
    try {
      if (!provider?.trim())
        return { result: false, error: "provider is required" };

      const plugin = AVAILABLE_PLUGINS.find((p) => p.provider === provider);
      if (!plugin)
        return {
          result: false,
          error: `Unknown plugin provider: "${provider}". Valid values: ${AVAILABLE_PLUGINS.map((p) => p.provider).join(", ")}`,
        };

      // Optionally verify the referenced credential exists and is active
      if (request.credentials_id) {
        const credRecord = await this.getCredentialById(request.credentials_id);
        if (!credRecord)
          return { result: false, error: "Credential not found" };
        if (credRecord.is_deleted)
          return {
            result: false,
            error: "Cannot link to a deleted credential",
          };
      }

      // Look for an existing setting for this provider so we can preserve id and history
      const existing = await this.getPluginSettingByProvider(provider);

      const now = new Date().toISOString();
      const changes: AuditChange[] = [];
      if (existing) {
        const newCredId = request.credentials_id ?? existing.credentials_id;
        if (existing.credentials_id !== newCredId) {
          changes.push({
            field: "credentials_id",
            from: existing.credentials_id,
            to: newCredId,
          });
        }
        if (
          request.enabled !== undefined &&
          existing.enabled !== request.enabled
        ) {
          changes.push({
            field: "enabled",
            from: existing.enabled,
            to: request.enabled,
          });
        }
      }

      const record: IPluginSettingRecord = {
        id: existing?.id ?? IdGenerator.generatePluginSettingId(),
        type: "plugin_setting",
        provider,
        credentials_id:
          request.credentials_id !== undefined
            ? (request.credentials_id ?? null)
            : (existing?.credentials_id ?? null),
        enabled: request.enabled ?? existing?.enabled ?? true,
        created_at: existing?.created_at ?? now,
        updated_at: now,
        created_by: existing?.created_by ?? actor,
        updated_by: actor,
        is_deleted: false,
        active: true,
        deleted_at: null,
        deleted_by: null,
      };

      await this.dynamoDBUtil.put({
        TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
        Item: record,
      });
      if (existing) {
        await this.auditWriterService.writeAuditEvent({
          entity_id: record.id,
          entity_type: "plugin_setting",
          action: "updated",
          changes,
          actor,
          changed_at: now,
        });
      } else {
        await this.auditWriterService.writeAuditEvent({
          entity_id: record.id,
          entity_type: "plugin_setting",
          action: "created",
          changes: [],
          actor,
          changed_at: now,
        });
      }
      this.logger.info("Plugin setting upserted", { id: record.id, provider });
      return { result: true, data: record };
    } catch (error: any) {
      this.logger.error("Failed to set plugin setting", error);
      return {
        result: false,
        error: error?.message || "Failed to set plugin setting",
      };
    }
  }

  async getPluginSetting(
    provider: string,
  ): Promise<ServiceResult<IPluginSettingRecord>> {
    try {
      const record = await this.getPluginSettingByProvider(provider);
      if (!record) return { result: false, error: "Plugin setting not found" };
      return { result: true, data: record };
    } catch (error: any) {
      return {
        result: false,
        error: error?.message || "Failed to get plugin setting",
      };
    }
  }

  /**
   * Returns exactly one entry per registered plugin (AVAILABLE_PLUGINS).
   * Each entry is the stored plugin_setting record if one exists, or a synthetic
   * default object (enabled: false, credentials_id: null) if not yet configured.
   * The `includeDeleted` flag only applies to stored records — canonical plugins
   * always appear in the list.
   */
  /**
   * Returns the static AVAILABLE_PLUGINS registry — used by GET /plugins.
   * No database call; safe to cache on the frontend indefinitely.
   */
  getAvailablePlugins(): typeof AVAILABLE_PLUGINS {
    return AVAILABLE_PLUGINS;
  }

  async listPluginSettings(
    includeDeleted = false,
  ): Promise<ServiceResult<IPluginView[]>> {
    try {
      // Fetch all stored plugin_setting records in one query
      const stored = await this.dynamoDBUtil.queryAll<IPluginSettingRecord>({
        TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
        IndexName: this.typeIndex,
        KeyConditionExpression: "#t = :type",
        ExpressionAttributeNames: { "#t": "type" },
        ExpressionAttributeValues: { ":type": "plugin_setting" },
      });

      // Index stored records by provider for O(1) lookup
      const storedByProvider = new Map<string, IPluginSettingRecord>();
      for (const rec of stored) {
        storedByProvider.set(rec.provider, rec);
      }

      const now = new Date().toISOString();
      const result: IPluginView[] = AVAILABLE_PLUGINS.map((plugin) => {
        const rec = storedByProvider.get(plugin.provider);
        const setting: IPluginSettingRecord =
          rec && (includeDeleted || !rec.is_deleted)
            ? rec
            : {
                // Synthetic default for unconfigured or filtered-out plugins
                id: rec?.id ?? "",
                type: "plugin_setting" as const,
                provider: plugin.provider,
                credentials_id: null,
                enabled: false,
                created_at: now,
                updated_at: now,
                is_deleted: false,
                active: false,
                deleted_at: null,
                deleted_by: null,
              };
        return {
          ...setting,
          name: plugin.name,
          credential_type: plugin.credential_type,
          description: plugin.description,
        };
      });

      return { result: true, data: result };
    } catch (error: any) {
      this.logger.error("Failed to list plugin settings", error);
      return {
        result: false,
        error: error?.message || "Failed to list plugin settings",
      };
    }
  }

  async updatePluginSetting(
    provider: string,
    request: UpdatePluginSettingRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<IPluginSettingRecord>> {
    try {
      const existing = await this.getPluginSettingByProvider(provider);
      if (!existing)
        return { result: false, error: "Plugin setting not found" };
      if (existing.is_deleted)
        return {
          result: false,
          error: "Cannot update a deleted plugin setting",
        };

      if (request.credentials_id) {
        const credRecord = await this.getCredentialById(request.credentials_id);
        if (!credRecord)
          return { result: false, error: "Credential not found" };
        if (credRecord.is_deleted)
          return {
            result: false,
            error: "Cannot link to a deleted credential",
          };
      }

      const now = new Date().toISOString();
      const changes: AuditChange[] = [];

      if (
        request.credentials_id &&
        request.credentials_id !== existing.credentials_id
      ) {
        changes.push({
          field: "credentials_id",
          from: existing.credentials_id,
          to: request.credentials_id,
        });
      }
      if (
        request.enabled !== undefined &&
        request.enabled !== existing.enabled
      ) {
        changes.push({
          field: "enabled",
          from: existing.enabled,
          to: request.enabled,
        });
      }

      const updated: IPluginSettingRecord = {
        ...existing,
        credentials_id: request.credentials_id ?? existing.credentials_id,
        enabled: request.enabled ?? existing.enabled,
        updated_at: now,
        updated_by: actor,
      };

      await this.dynamoDBUtil.put({
        TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
        Item: updated,
      });
      await this.auditWriterService.writeAuditEvent({
        entity_id: existing.id,
        entity_type: "plugin_setting",
        action: "updated",
        changes,
        actor,
        changed_at: now,
      });
      this.logger.info("Plugin setting updated", { provider });

      // Cascade: if the plugin was just disabled, propagate to all campaigns
      if (!updated.enabled) {
        this.cascadePluginDisableToAllCampaigns(provider).catch((err) => {
          this.logger.error(
            "Failed to cascade plugin disable to campaigns",
            err,
          );
        });
      }

      return { result: true, data: updated };
    } catch (error: any) {
      this.logger.error("Failed to update plugin setting", error);
      return {
        result: false,
        error: error?.message || "Failed to update plugin setting",
      };
    }
  }

  async deletePluginSetting(
    provider: string,
    options: { permanent?: boolean } = {},
    actor?: RequestActor,
  ): Promise<ServiceResult<void>> {
    try {
      const existing = await this.getPluginSettingByProvider(provider);
      if (!existing)
        return { result: false, error: "Plugin setting not found" };

      const now = new Date().toISOString();
      if (options.permanent) {
        await this.dynamoDBUtil.delete({
          TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
          Key: { id: existing.id },
        });
        await this.auditWriterService.writeAuditEvent({
          entity_id: existing.id,
          entity_type: "plugin_setting",
          action: "hard_deleted",
          changes: [],
          actor,
          changed_at: now,
        });
        this.logger.info("Plugin setting hard-deleted", {
          provider,
          id: existing.id,
        });
      } else {
        const updated: IPluginSettingRecord = {
          ...existing,
          is_deleted: true,
          active: false,
          deleted_at: now,
          deleted_by: actor ?? null,
          updated_at: now,
          updated_by: actor,
        };
        await this.dynamoDBUtil.put({
          TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
          Item: updated,
        });
        await this.auditWriterService.writeAuditEvent({
          entity_id: existing.id,
          entity_type: "plugin_setting",
          action: "soft_deleted",
          changes: [{ field: "is_deleted", from: false, to: true }],
          actor,
          changed_at: now,
        });
        this.logger.info("Plugin setting soft-deleted", { provider });
      }

      return { result: true };
    } catch (error: any) {
      this.logger.error("Failed to delete plugin setting", error);
      return {
        result: false,
        error: error?.message || "Failed to delete plugin setting",
      };
    }
  }

  async disablePluginSetting(
    provider: string,
    actor?: RequestActor,
  ): Promise<ServiceResult<IPluginSettingRecord>> {
    try {
      const existing = await this.getPluginSettingByProvider(provider);
      if (!existing)
        return { result: false, error: "Plugin setting not found" };
      if (existing.is_deleted)
        return {
          result: false,
          error: "Cannot disable a deleted plugin setting",
        };

      const now = new Date().toISOString();
      const updated: IPluginSettingRecord = {
        ...existing,
        enabled: false,
        updated_at: now,
        updated_by: actor,
      };

      await this.dynamoDBUtil.put({
        TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
        Item: updated,
      });
      await this.auditWriterService.writeAuditEvent({
        entity_id: existing.id,
        entity_type: "plugin_setting",
        action: "plugin_setting_disabled",
        changes: [{ field: "enabled", from: existing.enabled, to: false }],
        actor,
        changed_at: now,
      });
      this.logger.info("Plugin setting disabled", { provider });

      // Cascade: propagate disabled state to all campaigns that have this plugin enabled
      this.cascadePluginDisableToAllCampaigns(provider).catch((err) => {
        this.logger.error("Failed to cascade plugin disable to campaigns", err);
      });

      return { result: true, data: updated };
    } catch (error: any) {
      this.logger.error("Failed to disable plugin setting", error);
      return {
        result: false,
        error: error?.message || "Failed to disable plugin setting",
      };
    }
  }

  async enablePluginSetting(
    provider: string,
    actor?: RequestActor,
  ): Promise<ServiceResult<IPluginSettingRecord>> {
    try {
      const existing = await this.getPluginSettingByProvider(provider);
      if (!existing)
        return { result: false, error: "Plugin setting not found" };
      if (existing.is_deleted)
        return {
          result: false,
          error: "Cannot enable a deleted plugin setting",
        };

      const now = new Date().toISOString();
      const updated: IPluginSettingRecord = {
        ...existing,
        enabled: true,
        updated_at: now,
        updated_by: actor,
      };

      await this.dynamoDBUtil.put({
        TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
        Item: updated,
      });
      await this.auditWriterService.writeAuditEvent({
        entity_id: existing.id,
        entity_type: "plugin_setting",
        action: "plugin_setting_enabled",
        changes: [{ field: "enabled", from: existing.enabled, to: true }],
        actor,
        changed_at: now,
      });
      this.logger.info("Plugin setting enabled", { provider });
      return { result: true, data: updated };
    } catch (error: any) {
      this.logger.error("Failed to enable plugin setting", error);
      return {
        result: false,
        error: error?.message || "Failed to enable plugin setting",
      };
    }
  }

  async restorePluginSetting(
    provider: string,
    actor?: RequestActor,
  ): Promise<ServiceResult<IPluginSettingRecord>> {
    try {
      const existing = await this.getPluginSettingByProvider(provider);
      if (!existing)
        return { result: false, error: "Plugin setting not found" };
      if (!existing.is_deleted)
        return { result: false, error: "Plugin setting is not deleted" };

      const now = new Date().toISOString();
      const updated: IPluginSettingRecord = {
        ...existing,
        is_deleted: false,
        active: true,
        deleted_at: null,
        deleted_by: null,
        updated_at: now,
        updated_by: actor,
      };

      await this.dynamoDBUtil.put({
        TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
        Item: updated,
      });
      await this.auditWriterService.writeAuditEvent({
        entity_id: existing.id,
        entity_type: "plugin_setting",
        action: "restored",
        changes: [{ field: "is_deleted", from: true, to: false }],
        actor,
        changed_at: now,
      });
      this.logger.info("Plugin setting restored", { provider });
      return { result: true, data: updated };
    } catch (error: any) {
      this.logger.error("Failed to restore plugin setting", error);
      return {
        result: false,
        error: error?.message || "Failed to restore plugin setting",
      };
    }
  }

  // ── Tag Definitions ──────────────────────────────────────────────────────

  async listTagDefinitions(
    includeDeleted = false,
  ): Promise<ServiceResult<ITagDefinitionRecord[]>> {
    try {
      const records = await this.dynamoDBUtil.queryAll<ITagDefinitionRecord>({
        TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
        IndexName: this.typeIndex,
        KeyConditionExpression: "#t = :type",
        ExpressionAttributeNames: { "#t": "type" },
        ExpressionAttributeValues: {
          ":type": "tag_definition",
          ...(includeDeleted ? {} : { ":f": false }),
        },
        ...(includeDeleted
          ? {}
          : {
              FilterExpression:
                "attribute_not_exists(is_deleted) OR is_deleted = :f",
            }),
      });

      return {
        result: true,
        data: records.sort((a, b) => a.label.localeCompare(b.label)),
      };
    } catch (error: any) {
      this.logger.error("Failed to list tag definitions", error);
      return {
        result: false,
        error: error?.message || "Failed to list tag definitions",
      };
    }
  }

  async createTagDefinition(
    request: CreateTagDefinitionRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<ITagDefinitionRecord>> {
    try {
      const label = request.label?.trim();
      if (!label) return { result: false, error: "label is required" };

      const existing = await this.listTagDefinitions(true);
      if (!existing.result) {
        return { result: false, error: existing.error };
      }
      const duplicate = (existing.data ?? []).find(
        (item) =>
          item.label.toLowerCase() === label.toLowerCase() && !item.is_deleted,
      );
      if (duplicate) {
        return {
          result: false,
          error: `Tag "${label}" already exists`,
        };
      }

      const now = new Date().toISOString();
      const color = request.color?.trim() || undefined;
      const record: ITagDefinitionRecord = {
        id: IdGenerator.generate("TG"),
        type: "tag_definition",
        label,
        ...(color && { color }),
        created_at: now,
        updated_at: now,
        created_by: actor,
        updated_by: actor,
        is_deleted: false,
        active: true,
        deleted_at: null,
        deleted_by: null,
      };

      await this.dynamoDBUtil.put({
        TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
        Item: record,
      });

      await this.auditWriterService.writeAuditEvent({
        entity_id: record.id,
        entity_type: "tag_definition",
        action: "created",
        changes: [],
        actor,
        changed_at: now,
      });

      return { result: true, data: record };
    } catch (error: any) {
      this.logger.error("Failed to create tag definition", error);
      return {
        result: false,
        error: error?.message || "Failed to create tag definition",
      };
    }
  }

  async updateTagDefinition(
    id: string,
    request: UpdateTagDefinitionRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<ITagDefinitionRecord>> {
    try {
      const existing = await this.getTagDefinitionById(id);
      if (!existing)
        return { result: false, error: "Tag definition not found" };
      if (existing.is_deleted) {
        return {
          result: false,
          error: "Cannot update a deleted tag definition",
        };
      }

      const label = request.label?.trim();
      const color = request.color?.trim();

      // At least one field must be provided
      if (!label && color === undefined) {
        return { result: false, error: "label is required" };
      }

      const now = new Date().toISOString();
      const changes: AuditChange[] = [];

      if (label && label !== existing.label) {
        changes.push({
          field: "label",
          from: existing.label,
          to: label,
        });
      }

      if (color !== undefined && color !== (existing.color ?? "")) {
        changes.push({
          field: "color",
          from: existing.color ?? "",
          to: color,
        });
      }

      const updated: ITagDefinitionRecord = {
        ...existing,
        ...(label && { label }),
        ...(color !== undefined && { color: color || undefined }),
        updated_at: now,
        updated_by: actor,
      };

      await this.dynamoDBUtil.put({
        TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
        Item: updated,
      });

      await this.auditWriterService.writeAuditEvent({
        entity_id: id,
        entity_type: "tag_definition",
        action: "updated",
        changes,
        actor,
        changed_at: now,
      });

      return { result: true, data: updated };
    } catch (error: any) {
      this.logger.error("Failed to update tag definition", error);
      return {
        result: false,
        error: error?.message || "Failed to update tag definition",
      };
    }
  }

  async deleteTagDefinition(
    id: string,
    options: { permanent?: boolean } = {},
    actor?: RequestActor,
  ): Promise<ServiceResult<void>> {
    try {
      const existing = await this.getTagDefinitionById(id);
      if (!existing)
        return { result: false, error: "Tag definition not found" };

      const now = new Date().toISOString();
      if (options.permanent) {
        await this.dynamoDBUtil.delete({
          TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
          Key: { id },
        });
        await this.auditWriterService.writeAuditEvent({
          entity_id: id,
          entity_type: "tag_definition",
          action: "hard_deleted",
          changes: [],
          actor,
          changed_at: now,
        });
      } else {
        const updated: ITagDefinitionRecord = {
          ...existing,
          is_deleted: true,
          active: false,
          deleted_at: now,
          deleted_by: actor ?? null,
          updated_at: now,
          updated_by: actor,
        };
        await this.dynamoDBUtil.put({
          TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
          Item: updated,
        });
        await this.auditWriterService.writeAuditEvent({
          entity_id: id,
          entity_type: "tag_definition",
          action: "soft_deleted",
          changes: [{ field: "is_deleted", from: false, to: true }],
          actor,
          changed_at: now,
        });
      }

      return { result: true };
    } catch (error: any) {
      this.logger.error("Failed to delete tag definition", error);
      return {
        result: false,
        error: error?.message || "Failed to delete tag definition",
      };
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async getTagDefinitionById(
    id: string,
  ): Promise<ITagDefinitionRecord | null> {
    const result = await this.dynamoDBUtil.get<ITagDefinitionRecord>({
      TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
      Key: { id },
    });
    if (!result || result.type !== "tag_definition") return null;
    return result;
  }

  /**
   * Scans the campaigns table for any campaign that has `plugins.{provider}.enabled = true`
   * and sets it to `false`.  Called fire-and-forget after a tenant-level plugin disable.
   *
   * Silently no-ops when CAMPAIGNS_TABLE_NAME is not configured.
   */
  private async cascadePluginDisableToAllCampaigns(
    provider: string,
  ): Promise<void> {
    if (!this.constants.CAMPAIGNS_TABLE_NAME) return;

    interface CampaignItem {
      id: string;
      plugins?: Record<string, { enabled?: boolean } & Record<string, unknown>>;
      updated_at?: string;
      [key: string]: unknown;
    }

    const campaigns = await this.dynamoDBUtil.scanAll<CampaignItem>({
      TableName: this.constants.CAMPAIGNS_TABLE_NAME,
      FilterExpression: "#plugins.#provider.#enabled = :true",
      ExpressionAttributeNames: {
        "#plugins": "plugins",
        "#provider": provider,
        "#enabled": "enabled",
      },
      ExpressionAttributeValues: { ":true": true },
    });

    if (!campaigns.length) {
      this.logger.info(
        `Cascade: no campaigns found with ${provider} enabled — nothing to update`,
      );
      return;
    }

    await Promise.all(
      campaigns.map(async (campaign) => {
        if (!campaign.plugins) return;
        campaign.plugins[provider] = {
          ...campaign.plugins[provider],
          enabled: false,
        };
        campaign.updated_at = new Date().toISOString();
        await this.dynamoDBUtil.put({
          TableName: this.constants.CAMPAIGNS_TABLE_NAME!,
          Item: campaign,
        });
      }),
    );

    this.logger.info(
      `Cascade: disabled ${provider} plugin on ${campaigns.length} campaign(s)`,
    );
  }

  private async getCredentialById(
    id: string,
  ): Promise<TenantCredentialRecord | null> {
    const result = await this.dynamoDBUtil.get<TenantCredentialRecord>({
      TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
      Key: { id },
    });
    return result ?? null;
  }

  private async getCredentialSchemaById(
    id: string,
  ): Promise<ICredentialSchemaRecord | null> {
    const result = await this.dynamoDBUtil.get<ICredentialSchemaRecord>({
      TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
      Key: { id },
    });
    return result ?? null;
  }

  private async getPluginSettingByProvider(
    provider: string,
  ): Promise<IPluginSettingRecord | null> {
    const records = await this.dynamoDBUtil.queryAll<IPluginSettingRecord>({
      TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
      IndexName: this.typeProviderIndex,
      KeyConditionExpression: "#t = :type AND #p = :provider",
      ExpressionAttributeNames: { "#t": "type", "#p": "provider" },
      ExpressionAttributeValues: {
        ":type": "plugin_setting",
        ":provider": provider,
      },
    });
    return records[0] ?? null;
  }

  private async findPluginSettingsByCredentialId(
    credentialsId: string,
  ): Promise<IPluginSettingRecord[]> {
    // Scan plugin_settings by type, then filter by credentials_id
    const records = await this.dynamoDBUtil.queryAll<IPluginSettingRecord>({
      TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
      IndexName: this.typeIndex,
      KeyConditionExpression: "#t = :type",
      FilterExpression: "#cid = :credId",
      ExpressionAttributeNames: { "#t": "type", "#cid": "credentials_id" },
      ExpressionAttributeValues: {
        ":type": "plugin_setting",
        ":credId": credentialsId,
      },
    });
    return records;
  }

  private async findCredentialsBySchemaId(
    schemaId: string,
  ): Promise<TenantCredentialRecord[]> {
    // Scan credentials by type, then filter by schema_id (including soft-deleted ones)
    const records = await this.dynamoDBUtil.queryAll<TenantCredentialRecord>({
      TableName: this.constants.TENANT_SETTINGS_TABLE_NAME,
      IndexName: this.typeIndex,
      KeyConditionExpression: "#t = :type",
      FilterExpression: "#sid = :schemaId",
      ExpressionAttributeNames: { "#t": "type", "#sid": "schema_id" },
      ExpressionAttributeValues: {
        ":type": "credential",
        ":schemaId": schemaId,
      },
    });
    return records;
  }

  private encryptCredentials(
    type: CredentialType,
    credentials: Record<string, string>,
  ): Record<string, string> {
    const sensitiveFields = SENSITIVE_FIELDS[type] ?? [];
    const result: Record<string, string> = { ...credentials };
    for (const field of sensitiveFields) {
      if (result[field]) {
        result[field] = encrypt(
          result[field],
          this.constants.CREDENTIALS_ENCRYPTION_KEY,
        );
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
          result[field] = decrypt(
            result[field],
            this.constants.CREDENTIALS_ENCRYPTION_KEY,
          );
        } catch {
          // Value may already be plaintext (migration/first-run edge case)
        }
      }
    }
    return result;
  }

  private decryptRecord(
    record: TenantCredentialRecord,
  ): TenantCredentialRecord {
    return {
      ...record,
      credentials: this.decryptCredentials(
        record.credential_type,
        record.credentials,
      ),
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
      if (!credentials.apiKey)
        return {
          result: false,
          error: "credentials.apiKey is required for api_key",
        };
      return { result: true };
    }
    if (type === "basic_auth") {
      if (!credentials.username || !credentials.password)
        return {
          result: false,
          error:
            "credentials.username and credentials.password are required for basic_auth",
        };
      return { result: true };
    }
    if (type === "bearer_token") {
      if (!credentials.token)
        return {
          result: false,
          error: "credentials.token is required for bearer_token",
        };
      return { result: true };
    }
    return { result: false, error: `Unsupported credential type: ${type}` };
  }

  // ── Platform Presets ────────────────────────────────────────────────────────

  async listPlatformPresets(): Promise<ServiceResult<IPlatformPresetRecord[]>> {
    try {
      const items = await this.dynamoDBUtil.scanAll<IPlatformPresetRecord>({
        TableName: this.constants.PLATFORM_PRESETS_TABLE_NAME,
      });
      return { result: true, data: items };
    } catch (error: any) {
      this.logger.error("Failed to list platform presets", error);
      return {
        result: false,
        error: error.message || "Failed to list platform presets",
      };
    }
  }

  async createPlatformPreset(
    payload: CreatePlatformPresetRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<IPlatformPresetRecord>> {
    try {
      const now = new Date().toISOString();
      const record: IPlatformPresetRecord = {
        id: IdGenerator.generate("PP"),
        scope: "platform",
        name: payload.name,
        description: payload.description,
        data_type: payload.data_type,
        options: payload.options,
        casing: payload.casing,
        state_mapping: payload.state_mapping,
        created_at: now,
        updated_at: now,
        created_by: actor,
        updated_by: actor,
      };
      await this.dynamoDBUtil.put({
        TableName: this.constants.PLATFORM_PRESETS_TABLE_NAME,
        Item: record,
      });
      await this.auditWriter.write({
        action: "platform_preset_created",
        entity_type: "platform_preset",
        entity_id: record.id,
        actor,
        changes: [{ field: "name", from: null, to: record.name }],
      });
      return { result: true, data: record };
    } catch (error: any) {
      this.logger.error("Failed to create platform preset", error);
      return {
        result: false,
        error: error.message || "Failed to create platform preset",
      };
    }
  }

  async getPlatformPreset(
    id: string,
  ): Promise<ServiceResult<IPlatformPresetRecord>> {
    try {
      const item = await this.dynamoDBUtil.get<IPlatformPresetRecord>({
        TableName: this.constants.PLATFORM_PRESETS_TABLE_NAME,
        Key: { id },
      });
      if (!item) {
        return { result: false, error: `Platform preset ${id} not found` };
      }
      return { result: true, data: item };
    } catch (error: any) {
      this.logger.error("Failed to get platform preset", error);
      return {
        result: false,
        error: error.message || "Failed to get platform preset",
      };
    }
  }

  async updatePlatformPreset(
    id: string,
    payload: UpdatePlatformPresetRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<IPlatformPresetRecord>> {
    try {
      const existing = await this.dynamoDBUtil.get<IPlatformPresetRecord>({
        TableName: this.constants.PLATFORM_PRESETS_TABLE_NAME,
        Key: { id },
      });
      if (!existing) {
        return { result: false, error: `Platform preset ${id} not found` };
      }

      const now = new Date().toISOString();
      const changes: AuditChange[] = [];

      if (payload.name !== undefined && payload.name !== existing.name) {
        changes.push({ field: "name", from: existing.name, to: payload.name });
        existing.name = payload.name;
      }
      if (
        payload.description !== undefined &&
        payload.description !== existing.description
      ) {
        changes.push({
          field: "description",
          from: existing.description,
          to: payload.description,
        });
        existing.description = payload.description;
      }
      if (payload.options !== undefined) {
        changes.push({
          field: "options",
          from: existing.options?.length ?? 0,
          to: payload.options.length,
        });
        existing.options = payload.options;
      }
      if (payload.casing !== undefined && payload.casing !== existing.casing) {
        changes.push({
          field: "casing",
          from: existing.casing,
          to: payload.casing,
        });
        existing.casing = payload.casing;
      }
      if (
        payload.state_mapping !== undefined &&
        payload.state_mapping !== existing.state_mapping
      ) {
        changes.push({
          field: "state_mapping",
          from: existing.state_mapping,
          to: payload.state_mapping,
        });
        existing.state_mapping = payload.state_mapping;
      }

      existing.updated_at = now;
      existing.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.PLATFORM_PRESETS_TABLE_NAME,
        Item: existing,
      });

      if (changes.length > 0) {
        await this.auditWriterService.writeAuditEvent({
          entity_id: id,
          entity_type: "platform_preset",
          action: "updated",
          changes,
          actor,
          changed_at: now,
        });
      }

      return { result: true, data: existing };
    } catch (error: any) {
      this.logger.error("Failed to update platform preset", error);
      return {
        result: false,
        error: error.message || "Failed to update platform preset",
      };
    }
  }

  // ── Tenant Presets ──────────────────────────────────────────────────────────

  async listTenantPresets(
    tags?: string[],
  ): Promise<ServiceResult<ITenantPresetRecord[]>> {
    try {
      const items = await this.dynamoDBUtil.queryAll<ITenantPresetRecord>({
        TableName: this.constants.PRESETS_TABLE_NAME,
        IndexName: "criteria_set_id-index",
        KeyConditionExpression: "criteria_set_id = :type",
        ExpressionAttributeValues: { ":type": "tenant_preset" },
      });

      let filtered = items.filter((i) => !i.is_deleted);
      if (tags && tags.length > 0) {
        filtered = filtered.filter(
          (i) => i.tags && tags.some((t) => i.tags!.includes(t)),
        );
      }
      return { result: true, data: filtered };
    } catch (error: any) {
      this.logger.error("Failed to list tenant presets", error);
      return {
        result: false,
        error: error.message || "Failed to list tenant presets",
      };
    }
  }

  async getTenantPreset(
    id: string,
  ): Promise<ServiceResult<ITenantPresetRecord>> {
    try {
      const item = await this.dynamoDBUtil.get<ITenantPresetRecord>({
        TableName: this.constants.PRESETS_TABLE_NAME,
        Key: { id },
      });
      if (!item || item.is_deleted) {
        return { result: false, error: `Tenant preset ${id} not found` };
      }
      return { result: true, data: item };
    } catch (error: any) {
      this.logger.error("Failed to get tenant preset", error);
      return {
        result: false,
        error: error.message || "Failed to get tenant preset",
      };
    }
  }

  async createTenantPreset(
    payload: CreateTenantPresetRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<ITenantPresetRecord>> {
    try {
      const now = new Date().toISOString();
      const record: ITenantPresetRecord = {
        id: IdGenerator.generate("TP"),
        record_type: "tenant_preset",
        criteria_set_id: "tenant_preset",
        name: payload.name,
        description: payload.description,
        tags: payload.tags ?? [],
        data_type: payload.data_type,
        options: payload.options ?? [],
        casing: payload.casing,
        state_mapping: payload.state_mapping ?? null,
        created_at: now,
        updated_at: now,
        created_by: actor,
        updated_by: actor,
        is_deleted: false,
        active: true,
        deleted_at: null,
        deleted_by: null,
      };

      await this.dynamoDBUtil.put({
        TableName: this.constants.PRESETS_TABLE_NAME,
        Item: record,
      });
      await this.auditWriterService.writeAuditEvent({
        entity_id: record.id,
        entity_type: "tenant_preset",
        action: "created",
        changes: [{ field: "name", from: null, to: record.name }],
        actor,
        changed_at: now,
      });

      return { result: true, data: record };
    } catch (error: any) {
      this.logger.error("Failed to create tenant preset", error);
      return {
        result: false,
        error: error.message || "Failed to create tenant preset",
      };
    }
  }

  async updateTenantPreset(
    id: string,
    payload: UpdateTenantPresetRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<ITenantPresetRecord>> {
    try {
      const existing = await this.dynamoDBUtil.get<ITenantPresetRecord>({
        TableName: this.constants.PRESETS_TABLE_NAME,
        Key: { id },
      });
      if (!existing || existing.is_deleted) {
        return { result: false, error: `Tenant preset ${id} not found` };
      }

      const now = new Date().toISOString();
      const changes: AuditChange[] = [];

      if (payload.name !== undefined && payload.name !== existing.name) {
        changes.push({ field: "name", from: existing.name, to: payload.name });
        existing.name = payload.name;
      }
      if (payload.description !== undefined) {
        existing.description = payload.description;
      }
      if (payload.tags !== undefined) {
        existing.tags = payload.tags;
      }
      if (payload.options !== undefined) {
        changes.push({
          field: "options",
          from: existing.options?.length ?? 0,
          to: payload.options.length,
        });
        existing.options = payload.options;
      }
      if (payload.casing !== undefined) {
        existing.casing = payload.casing;
      }
      if (payload.state_mapping !== undefined) {
        existing.state_mapping = payload.state_mapping;
      }

      existing.updated_at = now;
      existing.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.PRESETS_TABLE_NAME,
        Item: existing,
      });

      if (changes.length > 0) {
        await this.auditWriterService.writeAuditEvent({
          entity_id: id,
          entity_type: "tenant_preset",
          action: "updated",
          changes,
          actor,
          changed_at: now,
        });
      }

      return { result: true, data: existing };
    } catch (error: any) {
      this.logger.error("Failed to update tenant preset", error);
      return {
        result: false,
        error: error.message || "Failed to update tenant preset",
      };
    }
  }

  async deleteTenantPreset(
    id: string,
    actor?: RequestActor,
  ): Promise<ServiceResult<void>> {
    try {
      const existing = await this.dynamoDBUtil.get<ITenantPresetRecord>({
        TableName: this.constants.PRESETS_TABLE_NAME,
        Key: { id },
      });
      if (!existing || existing.is_deleted) {
        return { result: false, error: `Tenant preset ${id} not found` };
      }

      const now = new Date().toISOString();
      existing.is_deleted = true;
      existing.active = false;
      existing.deleted_at = now;
      existing.deleted_by = actor ?? null;
      existing.updated_at = now;
      existing.updated_by = actor;

      await this.dynamoDBUtil.put({
        TableName: this.constants.PRESETS_TABLE_NAME,
        Item: existing,
      });
      await this.auditWriterService.writeAuditEvent({
        entity_id: id,
        entity_type: "tenant_preset",
        action: "deleted",
        changes: [{ field: "is_deleted", from: false, to: true }],
        actor,
        changed_at: now,
      });

      return { result: true };
    } catch (error: any) {
      this.logger.error("Failed to delete tenant preset", error);
      return {
        result: false,
        error: error.message || "Failed to delete tenant preset",
      };
    }
  }
}
