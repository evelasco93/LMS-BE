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
  CreatePluginSchemaRequest,
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

  // ── Credential CRUD ─────────────────────────────────────────────────────────

  @POST("/credentials")
  @produces("application/json")
  async createCredential(
    @body payload: CreateCredentialRequest,
  ): Promise<RestApiResponse> {
    const result = await this.service.createCredential(
      payload,
      this.getActor(),
    );

    if (!result.result) {
      return {
        success: false,
        message: "Failed to create credential",
        error: result.error,
      };
    }

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
  ): Promise<RestApiResponse> {
    const result = await this.service.listCredentials(provider);

    if (!result.result) {
      return {
        success: false,
        message: "Failed to list credentials",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Credentials retrieved successfully",
      data: result.data,
    };
  }

  @GET("/credentials/:id")
  @produces("application/json")
  async getCredential(
    @pathParam("id") id: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.getCredential(id);

    if (!result.result) {
      return {
        success: false,
        message: "Credential not found",
        error: result.error,
      };
    }

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

    if (!result.result) {
      return {
        success: false,
        message: "Failed to update credential",
        error: result.error,
      };
    }

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
  ): Promise<RestApiResponse> {
    const result = await this.service.deleteCredential(id);

    if (!result.result) {
      return {
        success: false,
        message: "Failed to delete credential",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Credential deleted successfully",
    };
  }

  @PUT("/credentials/:id/disable")
  @produces("application/json")
  async disableCredential(
    @pathParam("id") id: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.disableCredential(id, this.getActor());

    if (!result.result) {
      return {
        success: false,
        message: "Failed to disable credential",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Credential disabled",
      data: result.data,
    };
  }

  @PUT("/credentials/:id/enable")
  @produces("application/json")
  async enableCredential(
    @pathParam("id") id: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.enableCredential(id, this.getActor());

    if (!result.result) {
      return {
        success: false,
        message: "Failed to enable credential",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Credential enabled",
      data: result.data,
    };
  }
  // ── Plugin Schemas ─────────────────────────────────────────────────────────

  @POST("/plugin-schemas")
  @produces("application/json")
  async createPluginSchema(
    @body payload: CreatePluginSchemaRequest,
  ): Promise<RestApiResponse> {
    const result = await this.service.createPluginSchema(
      payload,
      this.getActor(),
    );

    if (!result.result) {
      return {
        success: false,
        message: "Failed to create plugin schema",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Plugin schema created successfully",
      data: result.data,
    };
  }

  @GET("/plugin-schemas")
  @produces("application/json")
  async listPluginSchemas(): Promise<RestApiResponse> {
    const result = await this.service.listPluginSchemas();

    if (!result.result) {
      return {
        success: false,
        message: "Failed to list plugin schemas",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Plugin schemas retrieved successfully",
      data: result.data,
    };
  }

  @GET("/plugin-schemas/:id")
  @produces("application/json")
  async getPluginSchema(
    @pathParam("id") id: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.getPluginSchema(id);

    if (!result.result) {
      return {
        success: false,
        message: "Plugin schema not found",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Plugin schema retrieved successfully",
      data: result.data,
    };
  }
  // ── TrustedForm ad-hoc validate ─────────────────────────────────────────────

  /**   * POST /tenant-config/trusted-form/check-cert
   * Validates a TrustedForm certificate using the stored TrustedForm credential.
   * Body: { cert_id: string, credentials_id?: string }
   * If credentials_id is omitted the first active trusted_form credential is used.
   * Returns the raw TrustedForm validate response.
   */
  @POST("/trusted-form/check-cert")
  @produces("application/json")
  async checkTrustedFormCert(
    @body payload: { cert_id: string; credentials_id?: string },
  ): Promise<RestApiResponse> {
    const result = await this.service.checkCert(
      payload?.cert_id,
      payload?.credentials_id,
    );
    if (!result.result) {
      return { success: false, error: result.error };
    }
    return { success: true, message: "TrustedForm certificate checked", data: result.data };
  }

  @POST("/trusted-form/validate")
  @produces("application/json")
  async validateTrustedForm(
    @body payload: { credentials_id: string; cert_id: string },
  ): Promise<RestApiResponse> {
    const result = await this.service.validateTrustedFormCert(
      payload?.cert_id,
      payload?.credentials_id,
    );
    if (!result.result) {
      return { success: false, error: result.error };
    }
    return { success: true, message: "TrustedForm certificate validated", data: result.data };
  }
}
