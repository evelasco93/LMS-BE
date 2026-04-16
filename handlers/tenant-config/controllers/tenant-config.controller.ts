import "reflect-metadata";
import { injectable, inject } from "inversify";
import {
  apiController,
  GET,
  POST,
  PUT,
  DELETE,
  body,
  produces,
  Controller,
  pathParam,
  queryParam,
} from "ts-lambda-api";
import { TenantConfigService } from "../services/tenant-config.service";
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
import { RestApiResponse } from "../types/common.types";
import { extractRequestActorFromHeaders } from "@shared/utils/request-audit.util";

@injectable()
@apiController("/tenant-config")
export class TenantConfigController extends Controller {
  constructor(
    @inject("TenantConfigService")
    private readonly service: TenantConfigService,
  ) {
    super();
  }

  private getActor() {
    return extractRequestActorFromHeaders(
      this.request.headers as Record<string, string | string[] | undefined>,
    );
  }

  // ── Credentials ─────────────────────────────────────────────────────────────

  @POST("/credentials")
  @produces("application/json")
  async createCredential(
    @body payload: CreateCredentialRequest,
  ): Promise<RestApiResponse> {
    const result = await this.service.createCredential(
      payload,
      this.getActor(),
    );
    if (!result.result)
      return {
        success: false,
        message: "Failed to create credential",
        error: result.error,
      };
    return {
      success: true,
      message: "Credential created successfully",
      data: result.data,
    };
  }

  @GET("/credentials")
  @produces("application/json")
  async listCredentials(
    @queryParam("provider") provider?: string,
    @queryParam("includeDeleted") includeDeleted?: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.listCredentials(
      provider,
      includeDeleted === "true",
    );
    if (!result.result)
      return {
        success: false,
        message: "Failed to list credentials",
        error: result.error,
      };
    return {
      success: true,
      message: "Credentials retrieved successfully",
      data: result.data,
    };
  }

  @GET("/credentials/:id")
  @produces("application/json")
  async getCredential(@pathParam("id") id: string): Promise<RestApiResponse> {
    const result = await this.service.getCredential(id);
    if (!result.result)
      return {
        success: false,
        message: "Credential not found",
        error: result.error,
      };
    return {
      success: true,
      message: "Credential retrieved successfully",
      data: result.data,
    };
  }

  @PUT("/credentials/:id")
  @produces("application/json")
  async updateCredential(
    @pathParam("id") id: string,
    @body payload: UpdateCredentialRequest,
  ): Promise<RestApiResponse> {
    const result = await this.service.updateCredential(
      id,
      payload,
      this.getActor(),
    );
    if (!result.result)
      return {
        success: false,
        message: "Failed to update credential",
        error: result.error,
      };
    return {
      success: true,
      message: "Credential updated successfully",
      data: result.data,
    };
  }

  @DELETE("/credentials/:id")
  @produces("application/json")
  async deleteCredential(
    @pathParam("id") id: string,
    @queryParam("permanent") permanent?: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.deleteCredential(
      id,
      { permanent: permanent === "true" },
      this.getActor(),
    );
    if (!result.result)
      return {
        success: false,
        message: "Failed to delete credential",
        error: result.error,
      };
    return {
      success: true,
      message:
        permanent === "true"
          ? "Credential permanently deleted"
          : "Credential deleted",
    };
  }

  @PUT("/credentials/:id/restore")
  @produces("application/json")
  async restoreCredential(
    @pathParam("id") id: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.restoreCredential(id, this.getActor());
    if (!result.result)
      return {
        success: false,
        message: "Failed to restore credential",
        error: result.error,
      };
    return { success: true, message: "Credential restored", data: result.data };
  }

  @PUT("/credentials/:id/disable")
  @produces("application/json")
  async disableCredential(
    @pathParam("id") id: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.disableCredential(id, this.getActor());
    if (!result.result)
      return {
        success: false,
        message: "Failed to disable credential",
        error: result.error,
      };
    return { success: true, message: "Credential disabled", data: result.data };
  }

  @PUT("/credentials/:id/enable")
  @produces("application/json")
  async enableCredential(
    @pathParam("id") id: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.enableCredential(id, this.getActor());
    if (!result.result)
      return {
        success: false,
        message: "Failed to enable credential",
        error: result.error,
      };
    return { success: true, message: "Credential enabled", data: result.data };
  }

  // ── Credential Schemas ──────────────────────────────────────────────────────

  @POST("/credential-schemas")
  @produces("application/json")
  async createCredentialSchema(
    @body payload: CreateCredentialSchemaRequest,
  ): Promise<RestApiResponse> {
    const result = await this.service.createCredentialSchema(
      payload,
      this.getActor(),
    );
    if (!result.result)
      return {
        success: false,
        message: "Failed to create credential schema",
        error: result.error,
      };
    return {
      success: true,
      message: "Credential schema created successfully",
      data: result.data,
    };
  }

  @GET("/credential-schemas")
  @produces("application/json")
  async listCredentialSchemas(
    @queryParam("includeDeleted") includeDeleted?: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.listCredentialSchemas(
      includeDeleted === "true",
    );
    if (!result.result)
      return {
        success: false,
        message: "Failed to list credential schemas",
        error: result.error,
      };
    return {
      success: true,
      message: "Credential schemas retrieved successfully",
      data: result.data,
    };
  }

  @GET("/credential-schemas/:id")
  @produces("application/json")
  async getCredentialSchema(
    @pathParam("id") id: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.getCredentialSchema(id);
    if (!result.result)
      return {
        success: false,
        message: "Credential schema not found",
        error: result.error,
      };
    return {
      success: true,
      message: "Credential schema retrieved successfully",
      data: result.data,
    };
  }

  @PUT("/credential-schemas/:id")
  @produces("application/json")
  async updateCredentialSchema(
    @pathParam("id") id: string,
    @body payload: UpdateCredentialSchemaRequest,
  ): Promise<RestApiResponse> {
    const result = await this.service.updateCredentialSchema(
      id,
      payload,
      this.getActor(),
    );
    if (!result.result)
      return {
        success: false,
        message: "Failed to update credential schema",
        error: result.error,
      };
    return {
      success: true,
      message: "Credential schema updated successfully",
      data: result.data,
    };
  }

  @DELETE("/credential-schemas/:id")
  @produces("application/json")
  async deleteCredentialSchema(
    @pathParam("id") id: string,
    @queryParam("permanent") permanent?: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.deleteCredentialSchema(
      id,
      { permanent: permanent === "true" },
      this.getActor(),
    );
    if (!result.result)
      return {
        success: false,
        message: "Failed to delete credential schema",
        error: result.error,
      };
    return {
      success: true,
      message:
        permanent === "true"
          ? "Credential schema permanently deleted"
          : "Credential schema deleted",
    };
  }

  @PUT("/credential-schemas/:id/restore")
  @produces("application/json")
  async restoreCredentialSchema(
    @pathParam("id") id: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.restoreCredentialSchema(
      id,
      this.getActor(),
    );
    if (!result.result)
      return {
        success: false,
        message: "Failed to restore credential schema",
        error: result.error,
      };
    return {
      success: true,
      message: "Credential schema restored",
      data: result.data,
    };
  }

  // ── Plugin Registry ──────────────────────────────────────────────────────────

  /**
   * GET /tenant-config/plugins
   * Returns the static AVAILABLE_PLUGINS registry — the canonical list of all
   * plugins the platform supports.  No database call; safe to cache.
   * Use this to know what plugins exist and their metadata (name, credential_type, description).
   */
  @GET("/plugins")
  @produces("application/json")
  async listAvailablePlugins(): Promise<RestApiResponse> {
    return {
      success: true,
      message: "Available plugins retrieved successfully",
      data: this.service.getAvailablePlugins(),
    };
  }

  // ── Plugin Settings ─────────────────────────────────────────────────────────

  /**
   * GET /tenant-config/plugin-settings
   * Returns exactly one entry per canonical plugin — each entry merges the registry
   * metadata (name, credential_type, description) with the current setting state
   * (credentials_id, enabled).  Unconfigured plugins are included with enabled=false
   * and credentials_id=null so the frontend always sees the complete list.
   */
  @GET("/plugin-settings")
  @produces("application/json")
  async listPluginSettings(
    @queryParam("includeDeleted") includeDeleted?: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.listPluginSettings(
      includeDeleted === "true",
    );
    if (!result.result)
      return {
        success: false,
        message: "Failed to list plugin settings",
        error: result.error,
      };
    return {
      success: true,
      message: "Plugin settings retrieved successfully",
      data: result.data,
    };
  }

  /**
   * GET /tenant-config/plugin-settings/:provider
   * Returns the global plugin setting for the given provider (e.g. "trusted_form", "ipqs").
   */
  @GET("/plugin-settings/:provider")
  @produces("application/json")
  async getPluginSetting(
    @pathParam("provider") provider: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.getPluginSetting(provider);
    if (!result.result)
      return {
        success: false,
        message: "Plugin setting not found",
        error: result.error,
      };
    return {
      success: true,
      message: "Plugin setting retrieved successfully",
      data: result.data,
    };
  }

  /**
   * PUT /tenant-config/plugin-settings/:provider
   * Upsert the global default plugin setting for the given provider.
   * Body: { credentials_id?: string | null, enabled?: boolean }
   */
  @PUT("/plugin-settings/:provider")
  @produces("application/json")
  async setPluginSetting(
    @pathParam("provider") provider: string,
    @body payload: SetPluginSettingRequest,
  ): Promise<RestApiResponse> {
    const result = await this.service.setPluginSetting(
      provider,
      payload,
      this.getActor(),
    );
    if (!result.result)
      return {
        success: false,
        message: "Failed to set plugin setting",
        error: result.error,
      };
    return {
      success: true,
      message: "Plugin setting saved successfully",
      data: result.data,
    };
  }

  /**
   * PUT /tenant-config/plugin-settings/:provider/update
   * Partially update the plugin setting credentials_id or enabled flag.
   */
  @PUT("/plugin-settings/:provider/update")
  @produces("application/json")
  async updatePluginSetting(
    @pathParam("provider") provider: string,
    @body payload: UpdatePluginSettingRequest,
  ): Promise<RestApiResponse> {
    const result = await this.service.updatePluginSetting(
      provider,
      payload,
      this.getActor(),
    );
    if (!result.result)
      return {
        success: false,
        message: "Failed to update plugin setting",
        error: result.error,
      };
    return {
      success: true,
      message: "Plugin setting updated successfully",
      data: result.data,
    };
  }

  @DELETE("/plugin-settings/:provider")
  @produces("application/json")
  async deletePluginSetting(
    @pathParam("provider") provider: string,
    @queryParam("permanent") permanent?: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.deletePluginSetting(
      provider,
      { permanent: permanent === "true" },
      this.getActor(),
    );
    if (!result.result)
      return {
        success: false,
        message: "Failed to delete plugin setting",
        error: result.error,
      };
    return {
      success: true,
      message:
        permanent === "true"
          ? "Plugin setting permanently deleted"
          : "Plugin setting deleted",
    };
  }

  @PUT("/plugin-settings/:provider/disable")
  @produces("application/json")
  async disablePluginSetting(
    @pathParam("provider") provider: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.disablePluginSetting(
      provider,
      this.getActor(),
    );
    if (!result.result)
      return {
        success: false,
        message: "Failed to disable plugin setting",
        error: result.error,
      };
    return {
      success: true,
      message: "Plugin setting disabled",
      data: result.data,
    };
  }

  @PUT("/plugin-settings/:provider/enable")
  @produces("application/json")
  async enablePluginSetting(
    @pathParam("provider") provider: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.enablePluginSetting(
      provider,
      this.getActor(),
    );
    if (!result.result)
      return {
        success: false,
        message: "Failed to enable plugin setting",
        error: result.error,
      };
    return {
      success: true,
      message: "Plugin setting enabled",
      data: result.data,
    };
  }

  @PUT("/plugin-settings/:provider/restore")
  @produces("application/json")
  async restorePluginSetting(
    @pathParam("provider") provider: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.restorePluginSetting(
      provider,
      this.getActor(),
    );
    if (!result.result)
      return {
        success: false,
        message: "Failed to restore plugin setting",
        error: result.error,
      };
    return {
      success: true,
      message: "Plugin setting restored",
      data: result.data,
    };
  }

  // ── Tag Definitions ──────────────────────────────────────────────────────

  @GET("/tag-definitions")
  @produces("application/json")
  async listTagDefinitions(
    @queryParam("includeDeleted") includeDeleted?: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.listTagDefinitions(
      includeDeleted === "true",
    );
    if (!result.result)
      return {
        success: false,
        message: "Failed to list tag definitions",
        error: result.error,
      };
    return {
      success: true,
      message: "Tag definitions retrieved successfully",
      data: {
        items: result.data,
        count: result.data?.length ?? 0,
      },
    };
  }

  @POST("/tag-definitions")
  @produces("application/json")
  async createTagDefinition(
    @body payload: CreateTagDefinitionRequest,
  ): Promise<RestApiResponse> {
    const result = await this.service.createTagDefinition(
      payload,
      this.getActor(),
    );
    if (!result.result)
      return {
        success: false,
        message: "Failed to create tag definition",
        error: result.error,
      };
    return {
      success: true,
      message: "Tag definition created successfully",
      data: result.data,
    };
  }

  @PUT("/tag-definitions/:id")
  @produces("application/json")
  async updateTagDefinition(
    @pathParam("id") id: string,
    @body payload: UpdateTagDefinitionRequest,
  ): Promise<RestApiResponse> {
    const result = await this.service.updateTagDefinition(
      id,
      payload,
      this.getActor(),
    );
    if (!result.result)
      return {
        success: false,
        message: "Failed to update tag definition",
        error: result.error,
      };
    return {
      success: true,
      message: "Tag definition updated successfully",
      data: result.data,
    };
  }

  @DELETE("/tag-definitions/:id")
  @produces("application/json")
  async deleteTagDefinition(
    @pathParam("id") id: string,
    @queryParam("permanent") permanent?: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.deleteTagDefinition(
      id,
      { permanent: permanent === "true" },
      this.getActor(),
    );
    if (!result.result)
      return {
        success: false,
        message: "Failed to delete tag definition",
        error: result.error,
      };
    return {
      success: true,
      message:
        permanent === "true"
          ? "Tag definition permanently deleted"
          : "Tag definition deleted",
    };
  }

  // ── Platform Presets ────────────────────────────────────────────────────────

  @GET("/platform-presets")
  @produces("application/json")
  async listPlatformPresets(): Promise<RestApiResponse> {
    const result = await this.service.listPlatformPresets();
    if (!result.result)
      return {
        success: false,
        message: "Failed to list platform presets",
        error: result.error,
      };
    return { success: true, data: result.data };
  }

  @GET("/platform-presets/:id")
  @produces("application/json")
  async getPlatformPreset(
    @pathParam("id") id: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.getPlatformPreset(id);
    if (!result.result)
      return {
        success: false,
        message: "Platform preset not found",
        error: result.error,
      };
    return { success: true, data: result.data };
  }

  @POST("/platform-presets")
  @produces("application/json")
  async createPlatformPreset(
    @body payload: CreatePlatformPresetRequest,
  ): Promise<RestApiResponse> {
    if (!payload.name || !payload.data_type)
      return {
        success: false,
        message: "name and data_type are required",
      };
    const result = await this.service.createPlatformPreset(
      payload,
      this.getActor(),
    );
    if (!result.result)
      return {
        success: false,
        message: "Failed to create platform preset",
        error: result.error,
      };
    return {
      success: true,
      message: "Platform preset created",
      data: result.data,
    };
  }

  @PUT("/platform-presets/:id")
  @produces("application/json")
  async updatePlatformPreset(
    @pathParam("id") id: string,
    @body payload: UpdatePlatformPresetRequest,
  ): Promise<RestApiResponse> {
    const result = await this.service.updatePlatformPreset(
      id,
      payload,
      this.getActor(),
    );
    if (!result.result)
      return {
        success: false,
        message: "Failed to update platform preset",
        error: result.error,
      };
    return {
      success: true,
      message: "Platform preset updated",
      data: result.data,
    };
  }

  // ── Tenant Presets ──────────────────────────────────────────────────────────

  @GET("/presets")
  @produces("application/json")
  async listTenantPresets(
    @queryParam("tags") tags?: string,
  ): Promise<RestApiResponse> {
    const tagList = tags ? tags.split(",").map((t) => t.trim()) : undefined;
    const result = await this.service.listTenantPresets(tagList);
    if (!result.result)
      return {
        success: false,
        message: "Failed to list tenant presets",
        error: result.error,
      };
    return { success: true, data: result.data };
  }

  @POST("/presets")
  @produces("application/json")
  async createTenantPreset(
    @body payload: CreateTenantPresetRequest,
  ): Promise<RestApiResponse> {
    if (!payload.name || !payload.data_type) {
      return {
        success: false,
        message: "name and data_type are required",
      };
    }
    const result = await this.service.createTenantPreset(
      payload,
      this.getActor(),
    );
    if (!result.result)
      return {
        success: false,
        message: "Failed to create tenant preset",
        error: result.error,
      };
    return {
      success: true,
      message: "Tenant preset created",
      data: result.data,
    };
  }

  @GET("/presets/:id")
  @produces("application/json")
  async getTenantPreset(@pathParam("id") id: string): Promise<RestApiResponse> {
    const result = await this.service.getTenantPreset(id);
    if (!result.result)
      return {
        success: false,
        message: "Tenant preset not found",
        error: result.error,
      };
    return { success: true, data: result.data };
  }

  @PUT("/presets/:id")
  @produces("application/json")
  async updateTenantPreset(
    @pathParam("id") id: string,
    @body payload: UpdateTenantPresetRequest,
  ): Promise<RestApiResponse> {
    const result = await this.service.updateTenantPreset(
      id,
      payload,
      this.getActor(),
    );
    if (!result.result)
      return {
        success: false,
        message: "Failed to update tenant preset",
        error: result.error,
      };
    return {
      success: true,
      message: "Tenant preset updated",
      data: result.data,
    };
  }

  @DELETE("/presets/:id")
  @produces("application/json")
  async deleteTenantPreset(
    @pathParam("id") id: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.deleteTenantPreset(id, this.getActor());
    if (!result.result)
      return {
        success: false,
        message: "Failed to delete tenant preset",
        error: result.error,
      };
    return { success: true, message: "Tenant preset deleted" };
  }
}
