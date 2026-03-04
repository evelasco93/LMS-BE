import "reflect-metadata";
import { injectable, inject } from "inversify";
import {
  apiController,
  GET,
  PUT,
  DELETE,
  body,
  produces,
  Controller,
  pathParam,
} from "ts-lambda-api";
import { TenantConfigService } from "../services/tenant-config.service";
import { UpsertCredentialRequest } from "../types/tenant-config-request.types";
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

  @GET("/credentials")
  @produces("application/json")
  async listCredentials(): Promise<RestApiResponse> {
    const result = await this.service.listCredentials();

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

  @GET("/credentials/:provider")
  @produces("application/json")
  async getCredential(
    @pathParam("provider") provider: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.getCredential(provider);

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

  @PUT("/credentials")
  @produces("application/json")
  async upsertCredential(
    @body payload: UpsertCredentialRequest,
  ): Promise<RestApiResponse> {
    const result = await this.service.upsertCredential(payload, this.getActor());

    if (!result.result) {
      return {
        success: false,
        message: "Failed to upsert credential",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Credential upserted successfully",
      data: result.data,
    };
  }

  @DELETE("/credentials/:provider")
  @produces("application/json")
  async deleteCredential(
    @pathParam("provider") provider: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.deleteCredential(provider);

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
}
