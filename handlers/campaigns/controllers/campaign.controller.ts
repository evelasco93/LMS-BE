import "reflect-metadata";
import { injectable, inject } from "inversify";
import {
  apiController,
  GET,
  POST,
  DELETE,
  PUT,
  body,
  pathParam,
  queryParam,
  produces,
  Controller,
} from "ts-lambda-api";
import { CampaignService } from "../services/campaign.service";
import {
  CreateCampaignRequest,
  LinkAffiliateRequest,
  LinkClientRequest,
  ListCampaignsQuery,
  UpdateCampaignStatusRequest,
  UpdateCampaignPluginsRequest,
  UpdateParticipantStatusRequest,
} from "../types/campaign-request.types";
import { RestApiResponse } from "../types/common.types";
import { CampaignStatus } from "../enums/campaign-status.enum";

@injectable()
@apiController("/campaigns")
export class CampaignController extends Controller {
  constructor(
    @inject("CampaignService")
    private readonly campaignService: CampaignService,
  ) {
    super();
  }

  @POST("/")
  @produces("application/json")
  async createCampaign(
    @body payload: CreateCampaignRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.createCampaign(payload);

    if (!result.result) {
      return {
        success: false,
        message: "Failed to create campaign",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Campaign created successfully",
      data: result.data,
    };
  }

  @GET("/")
  @produces("application/json")
  async listCampaigns(
    @queryParam("status") status?: CampaignStatus,
    @queryParam("limit") limit?: string,
    @queryParam("lastEvaluatedKey") lastEvaluatedKey?: string,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.listCampaigns({
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
      lastEvaluatedKey,
    } satisfies ListCampaignsQuery);

    if (!result.result) {
      return {
        success: false,
        message: "Failed to list campaigns",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Campaigns retrieved successfully",
      count: result.data?.count,
      data: result.data?.items,
      lastEvaluatedKey: result.data?.lastEvaluatedKey,
    };
  }

  @POST("/:id/clients")
  @produces("application/json")
  async linkClient(
    @pathParam("id") id: string,
    @body payload: LinkClientRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.linkClient(id, payload);

    if (!result.result) {
      return {
        success: false,
        message: "Failed to link client",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Client linked successfully",
      data: result.data,
    };
  }

  @PUT("/:id/clients/:clientId")
  @produces("application/json")
  async updateClientStatus(
    @pathParam("id") id: string,
    @pathParam("clientId") clientId: string,
    @body payload: UpdateParticipantStatusRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.updateClientStatus(
      id,
      clientId,
      payload,
    );

    if (!result.result) {
      return {
        success: false,
        message: "Failed to update client status",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Client status updated",
      data: result.data,
    };
  }

  @DELETE("/:id/clients/:clientId")
  @produces("application/json")
  async deleteClient(
    @pathParam("id") id: string,
    @pathParam("clientId") clientId: string,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.deleteClient(id, clientId);

    if (!result.result) {
      return {
        success: false,
        message: "Failed to delete client from campaign",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Client removed from campaign",
      data: result.data,
    };
  }

  @POST("/:id/affiliates")
  @produces("application/json")
  async linkAffiliate(
    @pathParam("id") id: string,
    @body payload: LinkAffiliateRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.linkAffiliate(id, payload);

    if (!result.result) {
      return {
        success: false,
        message: "Failed to link affiliate",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Affiliate linked successfully",
      data: result.data,
    };
  }

  @PUT("/:id/affiliates/:affiliateId")
  @produces("application/json")
  async updateAffiliateStatus(
    @pathParam("id") id: string,
    @pathParam("affiliateId") affiliateId: string,
    @body payload: UpdateParticipantStatusRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.updateAffiliateStatus(
      id,
      affiliateId,
      payload,
    );

    if (!result.result) {
      return {
        success: false,
        message: "Failed to update affiliate status",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Affiliate status updated",
      data: result.data,
    };
  }

  @DELETE("/:id/affiliates/:affiliateId")
  @produces("application/json")
  async deleteAffiliate(
    @pathParam("id") id: string,
    @pathParam("affiliateId") affiliateId: string,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.deleteAffiliate(id, affiliateId);

    if (!result.result) {
      return {
        success: false,
        message: "Failed to delete affiliate from campaign",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Affiliate removed from campaign",
      data: result.data,
    };
  }

  @PUT("/:id/status")
  @produces("application/json")
  async updateStatus(
    @pathParam("id") id: string,
    @body payload: UpdateCampaignStatusRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.updateStatus(id, payload);

    if (!result.result) {
      return {
        success: false,
        message: "Failed to update campaign status",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Campaign status updated successfully",
      data: result.data,
    };
  }

  @PUT("/:id/plugins")
  @produces("application/json")
  async updatePlugins(
    @pathParam("id") id: string,
    @body payload: UpdateCampaignPluginsRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.updatePlugins(id, payload);

    if (!result.result) {
      return {
        success: false,
        message: "Failed to update campaign plugins",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Campaign plugins updated successfully",
      data: result.data,
    };
  }
}
