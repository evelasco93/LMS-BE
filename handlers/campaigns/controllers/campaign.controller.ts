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
  UpdateCampaignRequest,
  UpdateCampaignStatusRequest,
  UpdateCampaignPluginsRequest,
  UpdateParticipantStatusRequest,
} from "../types/campaign-request.types";
import { RestApiResponse } from "../types/common.types";
import { CampaignStatus } from "../enums/campaign-status.enum";
import { extractRequestActorFromHeaders } from "@shared/utils/request-audit.util";

@injectable()
@apiController("/campaigns")
export class CampaignController extends Controller {
  constructor(
    @inject("CampaignService")
    private readonly campaignService: CampaignService,
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
  async createCampaign(
    @body payload: CreateCampaignRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.createCampaign(
      payload,
      this.getActor(),
    );

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
    @queryParam("includeDeleted") includeDeleted?: string,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.listCampaigns({
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
      lastEvaluatedKey,
      includeDeleted:
        includeDeleted === "true" || includeDeleted === "1" || false,
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

  @PUT("/:id")
  @produces("application/json")
  async updateCampaign(
    @pathParam("id") id: string,
    @body payload: UpdateCampaignRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.updateCampaign(
      id,
      payload,
      this.getActor(),
    );

    if (!result.result) {
      return {
        success: false,
        message: "Failed to update campaign",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Campaign updated successfully",
      data: result.data,
    };
  }

  @POST("/:id/clients")
  @produces("application/json")
  async linkClient(
    @pathParam("id") id: string,
    @body payload: LinkClientRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.linkClient(
      id,
      payload,
      this.getActor(),
    );

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
      this.getActor(),
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
    const result = await this.campaignService.deleteClient(
      id,
      clientId,
      this.getActor(),
    );

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
    const result = await this.campaignService.linkAffiliate(
      id,
      payload,
      this.getActor(),
    );

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
      this.getActor(),
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

  @POST("/:id/affiliates/:affiliateId/rotate-key")
  @produces("application/json")
  async rotateAffiliateKey(
    @pathParam("id") id: string,
    @pathParam("affiliateId") affiliateId: string,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.rotateAffiliateKey(
      id,
      affiliateId,
      this.getActor(),
    );

    if (!result.result) {
      return {
        success: false,
        message: "Failed to rotate affiliate campaign key",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Affiliate campaign key rotated",
      data: result.data,
    };
  }

  @DELETE("/:id/affiliates/:affiliateId")
  @produces("application/json")
  async deleteAffiliate(
    @pathParam("id") id: string,
    @pathParam("affiliateId") affiliateId: string,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.deleteAffiliate(
      id,
      affiliateId,
      this.getActor(),
    );

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

  @GET("/:id")
  @produces("application/json")
  async getCampaign(@pathParam("id") id: string): Promise<RestApiResponse> {
    const result = await this.campaignService.getCampaign(id);

    if (!result.result) {
      return {
        success: false,
        message: "Campaign not found",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Campaign retrieved successfully",
      data: result.data,
    };
  }

  @DELETE("/:id")
  @produces("application/json")
  async deleteCampaign(
    @pathParam("id") id: string,
    @queryParam("permanent") permanent?: string,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.deleteCampaign(
      id,
      { permanent: permanent === "true" || permanent === "1" },
      this.getActor(),
    );

    if (!result.result) {
      return {
        success: false,
        message: "Failed to delete campaign",
        error: result.error,
      };
    }

    return {
      success: true,
      message:
        permanent === "true" || permanent === "1"
          ? "Campaign permanently deleted"
          : "Campaign soft-deleted successfully",
      data: result.data,
    };
  }

  @PUT("/:id/status")
  @produces("application/json")
  async updateStatus(
    @pathParam("id") id: string,
    @body payload: UpdateCampaignStatusRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.updateStatus(
      id,
      payload,
      this.getActor(),
    );

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
    const result = await this.campaignService.updatePlugins(
      id,
      payload,
      this.getActor(),
    );

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
