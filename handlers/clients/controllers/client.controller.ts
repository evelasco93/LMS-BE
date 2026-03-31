import "reflect-metadata";
import { injectable, inject } from "inversify";
import {
  apiController,
  GET,
  POST,
  PUT,
  DELETE,
  body,
  pathParam,
  queryParam,
  produces,
  Controller,
} from "ts-lambda-api";
import { ClientService } from "../services/client.service";
import {
  CreateClientRequest,
  UpdateClientRequest,
} from "../types/client-request.types";
import { ClientStatus } from "../enums/client-status.enum";
import { RestApiResponse } from "../types/common.types";
import { extractRequestActorFromHeaders } from "@shared/utils/request-audit.util";

@injectable()
@apiController("/clients")
export class ClientController extends Controller {
  constructor(
    @inject("ClientService") private readonly clientService: ClientService,
  ) {
    super();
  }

  private getActor() {
    return extractRequestActorFromHeaders(
      this.request.headers as Record<string, string | string[] | undefined>,
    );
  }

  @POST("/")
  @produces("application/json")
  async createClient(
    @body payload: CreateClientRequest,
  ): Promise<RestApiResponse> {
    const result = await this.clientService.createClient(
      payload,
      this.getActor(),
    );

    if (!result.result) {
      return {
        success: false,
        message: "Failed to create client",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Client created successfully",
      data: result.data,
    };
  }

  @GET("/:id")
  @produces("application/json")
  async getClient(
    @pathParam("id") id: string,
    @queryParam("includeCampaigns") includeCampaigns?: string,
  ): Promise<RestApiResponse> {
    const result = await this.clientService.getClient(id, {
      includeCampaigns: includeCampaigns === "true" || includeCampaigns === "1",
    });

    if (!result.result) {
      return {
        success: false,
        message: "Client not found",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Client retrieved successfully",
      data: result.data,
    };
  }

  @GET("/")
  @produces("application/json")
  async listClients(
    @queryParam("status") status?: ClientStatus,
    @queryParam("limit") limit?: string,
    @queryParam("lastEvaluatedKey") lastEvaluatedKey?: string,
    @queryParam("includeDeleted") includeDeleted?: string,
    @queryParam("includeCampaigns") includeCampaigns?: string,
  ): Promise<RestApiResponse> {
    const result = await this.clientService.listClients({
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
      lastEvaluatedKey,
      includeDeleted:
        includeDeleted === "true" || includeDeleted === "1" || false,
      includeCampaigns:
        includeCampaigns === "true" || includeCampaigns === "1" || false,
    });

    if (!result.result) {
      return {
        success: false,
        message: "Failed to list clients",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Clients retrieved successfully",
      count: result.data?.count,
      data: result.data?.items,
    };
  }

  @PUT("/:id")
  @produces("application/json")
  async updateClient(
    @pathParam("id") id: string,
    @body payload: UpdateClientRequest,
  ): Promise<RestApiResponse> {
    const result = await this.clientService.updateClient(
      id,
      payload,
      this.getActor(),
    );

    if (!result.result) {
      return {
        success: false,
        message: "Failed to update client",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Client updated successfully",
      data: result.data,
    };
  }

  @DELETE("/:id")
  @produces("application/json")
  async deleteClient(
    @pathParam("id") id: string,
    @queryParam("permanent") permanent?: string,
  ): Promise<RestApiResponse> {
    const result = await this.clientService.deleteClient(
      id,
      {
        permanent: permanent === "true" || permanent === "1",
      },
      this.getActor(),
    );

    if (!result.result) {
      return {
        success: false,
        message: "Failed to delete client",
        error: result.error,
      };
    }

    return {
      success: true,
      message:
        permanent === "true" || permanent === "1"
          ? "Client permanently deleted successfully"
          : "Client deleted successfully",
    };
  }
}
