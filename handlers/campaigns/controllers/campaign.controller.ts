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
  AddCriteriaFieldRequest,
  UpdateCriteriaFieldRequest,
  ReorderCriteriaRequest,
  SetValueMappingsRequest,
  CreateLogicRuleRequest,
  UpdateLogicRuleRequest,
  GeneratePostingInstructionsRequest,
  SetClientDeliveryRequest,
  CreateDestinationRequest,
  UpdateDestinationRequest,
  SetDistributionRequest,
  SetAffiliateCapRequest,
  SetAffiliateValidationBypassRequest,
  SetAffiliateSoldPixelRequest,
  SetCampaignTagsRequest,
  CreateCriteriaCatalogRequest,
  UpdateCriteriaCatalogRequest,
  ApplyCriteriaCatalogRequest,
  CreateLogicCatalogRequest,
  UpdateLogicCatalogRequest,
  ApplyLogicCatalogRequest,
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

  @PUT("/:id/clients/:clientId/delivery")
  @produces("application/json")
  async setClientDelivery(
    @pathParam("id") id: string,
    @pathParam("clientId") clientId: string,
    @body payload: SetClientDeliveryRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.setClientDelivery(
      id,
      clientId,
      payload,
      this.getActor(),
    );

    if (!result.result) {
      return {
        success: false,
        message: "Failed to set client delivery config",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Client delivery config updated",
      data: result.data,
    };
  }

  // ── Destination CRUD ──────────────────────────────────────────────────────

  @GET("/:id/clients/:clientId/destinations")
  @produces("application/json")
  async listDestinations(
    @pathParam("id") id: string,
    @pathParam("clientId") clientId: string,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.listDestinations(id, clientId);

    if (!result.result) {
      return {
        success: false,
        message: "Failed to list destinations",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Destinations retrieved",
      data: result.data,
    };
  }

  @GET("/:id/clients/:clientId/destinations/:destId")
  @produces("application/json")
  async getDestination(
    @pathParam("id") id: string,
    @pathParam("clientId") clientId: string,
    @pathParam("destId") destId: string,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.getDestination(
      id,
      clientId,
      destId,
    );

    if (!result.result) {
      return {
        success: false,
        message: "Failed to get destination",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Destination retrieved",
      data: result.data,
    };
  }

  @POST("/:id/clients/:clientId/destinations")
  @produces("application/json")
  async addDestination(
    @pathParam("id") id: string,
    @pathParam("clientId") clientId: string,
    @body payload: CreateDestinationRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.addDestination(
      id,
      clientId,
      payload,
      this.getActor(),
    );

    if (!result.result) {
      return {
        success: false,
        message: "Failed to add destination",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Destination added",
      data: result.data,
    };
  }

  @PUT("/:id/clients/:clientId/destinations/:destId")
  @produces("application/json")
  async updateDestination(
    @pathParam("id") id: string,
    @pathParam("clientId") clientId: string,
    @pathParam("destId") destId: string,
    @body payload: UpdateDestinationRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.updateDestination(
      id,
      clientId,
      destId,
      payload,
      this.getActor(),
    );

    if (!result.result) {
      return {
        success: false,
        message: "Failed to update destination",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Destination updated",
      data: result.data,
    };
  }

  @DELETE("/:id/clients/:clientId/destinations/:destId")
  @produces("application/json")
  async deleteDestination(
    @pathParam("id") id: string,
    @pathParam("clientId") clientId: string,
    @pathParam("destId") destId: string,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.deleteDestination(
      id,
      clientId,
      destId,
      this.getActor(),
    );

    if (!result.result) {
      return {
        success: false,
        message: "Failed to delete destination",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Destination deleted",
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
      data: result.data?.campaign,
      submit_url: result.data?.submit_url,
    };
  }

  @PUT("/:id/affiliates/:affiliateId/cap")
  @produces("application/json")
  async setAffiliateCap(
    @pathParam("id") id: string,
    @pathParam("affiliateId") affiliateId: string,
    @body payload: SetAffiliateCapRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.setAffiliateCap(
      id,
      affiliateId,
      payload,
      this.getActor(),
    );

    if (!result.result) {
      return {
        success: false,
        message: "Failed to set affiliate lead cap",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Affiliate lead cap updated",
      data: result.data,
    };
  }

  @PUT("/:id/affiliates/:affiliateId/validation-bypass")
  @produces("application/json")
  async setAffiliateValidationBypass(
    @pathParam("id") id: string,
    @pathParam("affiliateId") affiliateId: string,
    @body payload: SetAffiliateValidationBypassRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.setAffiliateValidationBypass(
      id,
      affiliateId,
      payload,
      this.getActor(),
    );

    if (!result.result) {
      return {
        success: false,
        message: "Failed to set affiliate validation bypass",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Affiliate validation bypass updated",
      data: result.data,
    };
  }

  @PUT("/:id/tags")
  @produces("application/json")
  async setCampaignTags(
    @pathParam("id") id: string,
    @body payload: SetCampaignTagsRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.setCampaignTags(
      id,
      payload,
      this.getActor(),
    );

    if (!result.result) {
      return {
        success: false,
        message: "Failed to update campaign tags",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Campaign tags updated",
      data: result.data,
    };
  }

  @PUT("/:id/affiliates/:affiliateId/pixel")
  @produces("application/json")
  async setAffiliateSoldPixel(
    @pathParam("id") id: string,
    @pathParam("affiliateId") affiliateId: string,
    @body payload: SetAffiliateSoldPixelRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.setAffiliateSoldPixel(
      id,
      affiliateId,
      payload,
      this.getActor(),
    );

    if (!result.result) {
      return {
        success: false,
        message: "Failed to set affiliate sold pixel config",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Affiliate sold pixel config updated",
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

  @PUT("/:id/distribution")
  @produces("application/json")
  async setDistribution(
    @pathParam("id") id: string,
    @body payload: SetDistributionRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.setDistribution(
      id,
      payload,
      this.getActor(),
    );

    if (!result.result) {
      return {
        success: false,
        message: "Failed to set distribution config",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Distribution config updated",
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
      data: result.data?.campaign,
      submit_url: result.data?.submit_url,
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
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
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

  // ── Base Criteria ─────────────────────────────────────────────────────────

  @GET("/:id/criteria")
  @produces("application/json")
  async getCriteria(@pathParam("id") id: string): Promise<RestApiResponse> {
    const result = await this.campaignService.getCriteria(id);
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to get criteria",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Criteria retrieved successfully",
      data: result.data,
    };
  }

  /**
   * POST /:id/criteria/base-fields
   * Seeds the campaign with the standard BASE_CRITERIA_FIELDS preset.
   * Fields that already exist (by field_name) are silently skipped — idempotent.
   */
  @POST("/:id/criteria/base-fields")
  @produces("application/json")
  async addBaseFields(@pathParam("id") id: string): Promise<RestApiResponse> {
    const result = await this.campaignService.addBaseFields(
      id,
      this.getActor(),
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to add base criteria fields",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Base criteria fields added successfully",
      data: result.data,
    };
  }

  @POST("/:id/criteria")
  @produces("application/json")
  async addCriteriaField(
    @pathParam("id") id: string,
    @body payload: AddCriteriaFieldRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.addCriteriaField(
      id,
      payload,
      this.getActor(),
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to add criteria field",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Criteria field added successfully",
      data: result.data,
    };
  }

  /** Must be declared before /:id/criteria/:fieldId to avoid route shadowing */
  @PUT("/:id/criteria/reorder")
  @produces("application/json")
  async reorderCriteriaFields(
    @pathParam("id") id: string,
    @body payload: ReorderCriteriaRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.reorderCriteriaFields(
      id,
      payload,
      this.getActor(),
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to reorder criteria fields",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Criteria fields reordered successfully",
      data: result.data,
    };
  }

  @PUT("/:id/criteria/:fieldId")
  @produces("application/json")
  async updateCriteriaField(
    @pathParam("id") id: string,
    @pathParam("fieldId") fieldId: string,
    @body payload: UpdateCriteriaFieldRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.updateCriteriaField(
      id,
      fieldId,
      payload,
      this.getActor(),
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to update criteria field",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Criteria field updated successfully",
      data: result.data,
    };
  }

  @DELETE("/:id/criteria/:fieldId")
  @produces("application/json")
  async deleteCriteriaField(
    @pathParam("id") id: string,
    @pathParam("fieldId") fieldId: string,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.deleteCriteriaField(
      id,
      fieldId,
      this.getActor(),
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to delete criteria field",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Criteria field deleted successfully",
      data: result.data,
    };
  }

  @GET("/:id/criteria/history")
  @produces("application/json")
  async getCriteriaHistory(
    @pathParam("id") id: string,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.getCriteriaHistory(id);
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to get criteria history",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Criteria history retrieved successfully",
      data: result.data,
    };
  }

  /** Must be declared before /:id/criteria/:fieldId/mappings to avoid route shadowing */
  @GET("/:id/criteria/:fieldId")
  @produces("application/json")
  async getCriteriaField(
    @pathParam("id") id: string,
    @pathParam("fieldId") fieldId: string,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.getCriteriaField(id, fieldId);
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to get criteria field",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Criteria field retrieved successfully",
      data: result.data,
    };
  }

  @PUT("/:id/criteria/:fieldId/mappings")
  @produces("application/json")
  async setValueMappings(
    @pathParam("id") id: string,
    @pathParam("fieldId") fieldId: string,
    @body payload: SetValueMappingsRequest,
  ): Promise<RestApiResponse> {
    const actor = this.getActor();
    const result = await this.campaignService.setValueMappings(
      id,
      fieldId,
      payload,
      actor,
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to set value mappings",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Value mappings updated successfully",
      data: result.data,
    };
  }

  // ── Logic Rules ─────────────────────────────────────────────────────────

  /**
   * GET /:id/logic-rules
   */
  @GET("/:id/logic-rules")
  @produces("application/json")
  async listLogicRules(@pathParam("id") id: string): Promise<RestApiResponse> {
    const result = await this.campaignService.listLogicRules(id);
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to list logic rules",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Logic rules retrieved successfully",
      data: result.data,
    };
  }

  /**
   * GET /:id/logic-rules/:ruleId
   */
  @GET("/:id/logic-rules/:ruleId")
  @produces("application/json")
  async getLogicRule(
    @pathParam("id") id: string,
    @pathParam("ruleId") ruleId: string,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.getLogicRule(id, ruleId);
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to get logic rule",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Logic rule retrieved successfully",
      data: result.data,
    };
  }

  /**
   * POST /:id/logic-rules
   */
  @POST("/:id/logic-rules")
  @produces("application/json")
  async createLogicRule(
    @pathParam("id") id: string,
    @body payload: CreateLogicRuleRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.createLogicRule(
      id,
      payload,
      this.getActor(),
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to create logic rule",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Logic rule created successfully",
      data: result.data,
    };
  }

  /**
   * PUT /:id/logic-rules/:ruleId
   */
  @PUT("/:id/logic-rules/:ruleId")
  @produces("application/json")
  async updateLogicRule(
    @pathParam("id") id: string,
    @pathParam("ruleId") ruleId: string,
    @body payload: UpdateLogicRuleRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.updateLogicRule(
      id,
      ruleId,
      payload,
      this.getActor(),
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to update logic rule",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Logic rule updated successfully",
      data: result.data,
    };
  }

  /**
   * DELETE /:id/logic-rules/:ruleId
   */
  @DELETE("/:id/logic-rules/:ruleId")
  @produces("application/json")
  async deleteLogicRule(
    @pathParam("id") id: string,
    @pathParam("ruleId") ruleId: string,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.deleteLogicRule(
      id,
      ruleId,
      this.getActor(),
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to delete logic rule",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Logic rule deleted successfully",
      data: result.data,
    };
  }

  // ── Posting Instructions ──────────────────────────────────────────────────

  /**
   * POST /:id/posting-instructions/generate
   * Generates posting instructions for a specific affiliate on this campaign.
   */
  @POST("/:id/posting-instructions/generate")
  @produces("application/json")
  async generatePostingInstructions(
    @pathParam("id") id: string,
    @body payload: GeneratePostingInstructionsRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.generatePostingInstructions(
      id,
      payload,
      this.getActor(),
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to generate posting instructions",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Posting instructions generated successfully",
      data: result.data,
    };
  }

  // ── Per-Affiliate Logic Rule Overrides ────────────────────────────────────

  @GET("/:id/affiliates/:affiliateId/logic-rules")
  @produces("application/json")
  async listAffiliateLogicRules(
    @pathParam("id") id: string,
    @pathParam("affiliateId") affiliateId: string,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.listAffiliateLogicRules(
      id,
      affiliateId,
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to list affiliate logic rules",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Affiliate logic rules retrieved",
      data: result.data,
    };
  }

  @POST("/:id/affiliates/:affiliateId/logic-rules")
  @produces("application/json")
  async createAffiliateLogicRule(
    @pathParam("id") id: string,
    @pathParam("affiliateId") affiliateId: string,
    @body payload: CreateLogicRuleRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.createAffiliateLogicRule(
      id,
      affiliateId,
      payload,
      this.getActor(),
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to create affiliate logic rule",
        error: result.error,
      };
    }
    this.response.status(201);
    return {
      success: true,
      message: "Affiliate logic rule created",
      data: result.data,
    };
  }

  @PUT("/:id/affiliates/:affiliateId/logic-rules/:ruleId")
  @produces("application/json")
  async updateAffiliateLogicRule(
    @pathParam("id") id: string,
    @pathParam("affiliateId") affiliateId: string,
    @pathParam("ruleId") ruleId: string,
    @body payload: UpdateLogicRuleRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.updateAffiliateLogicRule(
      id,
      affiliateId,
      ruleId,
      payload,
      this.getActor(),
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to update affiliate logic rule",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Affiliate logic rule updated",
      data: result.data,
    };
  }

  @DELETE("/:id/affiliates/:affiliateId/logic-rules/:ruleId")
  @produces("application/json")
  async deleteAffiliateLogicRule(
    @pathParam("id") id: string,
    @pathParam("affiliateId") affiliateId: string,
    @pathParam("ruleId") ruleId: string,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.deleteAffiliateLogicRule(
      id,
      affiliateId,
      ruleId,
      this.getActor(),
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to delete affiliate logic rule",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Affiliate logic rule deleted",
      data: result.data,
    };
  }

  // ── Per-Affiliate Pixel Criteria ──────────────────────────────────────────

  @GET("/:id/affiliates/:affiliateId/pixel-criteria")
  @produces("application/json")
  async listAffiliatePixelCriteria(
    @pathParam("id") id: string,
    @pathParam("affiliateId") affiliateId: string,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.listAffiliatePixelCriteria(
      id,
      affiliateId,
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to list affiliate pixel criteria",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Affiliate pixel criteria retrieved",
      data: result.data,
    };
  }

  @POST("/:id/affiliates/:affiliateId/pixel-criteria")
  @produces("application/json")
  async createAffiliatePixelCriterion(
    @pathParam("id") id: string,
    @pathParam("affiliateId") affiliateId: string,
    @body payload: CreateLogicRuleRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.createAffiliatePixelCriterion(
      id,
      affiliateId,
      payload,
      this.getActor(),
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to create affiliate pixel criterion",
        error: result.error,
      };
    }
    this.response.status(201);
    return {
      success: true,
      message: "Affiliate pixel criterion created",
      data: result.data,
    };
  }

  @PUT("/:id/affiliates/:affiliateId/pixel-criteria/:ruleId")
  @produces("application/json")
  async updateAffiliatePixelCriterion(
    @pathParam("id") id: string,
    @pathParam("affiliateId") affiliateId: string,
    @pathParam("ruleId") ruleId: string,
    @body payload: UpdateLogicRuleRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.updateAffiliatePixelCriterion(
      id,
      affiliateId,
      ruleId,
      payload,
      this.getActor(),
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to update affiliate pixel criterion",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Affiliate pixel criterion updated",
      data: result.data,
    };
  }

  @DELETE("/:id/affiliates/:affiliateId/pixel-criteria/:ruleId")
  @produces("application/json")
  async deleteAffiliatePixelCriterion(
    @pathParam("id") id: string,
    @pathParam("affiliateId") affiliateId: string,
    @pathParam("ruleId") ruleId: string,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.deleteAffiliatePixelCriterion(
      id,
      affiliateId,
      ruleId,
      this.getActor(),
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to delete affiliate pixel criterion",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Affiliate pixel criterion deleted",
      data: result.data,
    };
  }

  // ── Per-Affiliate Sold Criteria ───────────────────────────────────────────

  @GET("/:id/affiliates/:affiliateId/sold-criteria")
  @produces("application/json")
  async listAffiliateSoldCriteria(
    @pathParam("id") id: string,
    @pathParam("affiliateId") affiliateId: string,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.listAffiliateSoldCriteria(
      id,
      affiliateId,
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to list affiliate sold criteria",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Affiliate sold criteria retrieved",
      data: result.data,
    };
  }

  @POST("/:id/affiliates/:affiliateId/sold-criteria")
  @produces("application/json")
  async createAffiliateSoldCriterion(
    @pathParam("id") id: string,
    @pathParam("affiliateId") affiliateId: string,
    @body payload: CreateLogicRuleRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.createAffiliateSoldCriterion(
      id,
      affiliateId,
      payload,
      this.getActor(),
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to create affiliate sold criterion",
        error: result.error,
      };
    }
    this.response.status(201);
    return {
      success: true,
      message: "Affiliate sold criterion created",
      data: result.data,
    };
  }

  @PUT("/:id/affiliates/:affiliateId/sold-criteria/:ruleId")
  @produces("application/json")
  async updateAffiliateSoldCriterion(
    @pathParam("id") id: string,
    @pathParam("affiliateId") affiliateId: string,
    @pathParam("ruleId") ruleId: string,
    @body payload: UpdateLogicRuleRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.updateAffiliateSoldCriterion(
      id,
      affiliateId,
      ruleId,
      payload,
      this.getActor(),
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to update affiliate sold criterion",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Affiliate sold criterion updated",
      data: result.data,
    };
  }

  @DELETE("/:id/affiliates/:affiliateId/sold-criteria/:ruleId")
  @produces("application/json")
  async deleteAffiliateSoldCriterion(
    @pathParam("id") id: string,
    @pathParam("affiliateId") affiliateId: string,
    @pathParam("ruleId") ruleId: string,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.deleteAffiliateSoldCriterion(
      id,
      affiliateId,
      ruleId,
      this.getActor(),
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to delete affiliate sold criterion",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Affiliate sold criterion deleted",
      data: result.data,
    };
  }

  @PUT("/:id/affiliates/:affiliateId/cherry-pick-override")
  @produces("application/json")
  async updateAffiliateCherryPickOverride(
    @pathParam("id") id: string,
    @pathParam("affiliateId") affiliateId: string,
    @body payload: { value: boolean | null },
  ): Promise<RestApiResponse> {
    if (
      payload?.value !== true &&
      payload?.value !== false &&
      payload?.value !== null
    ) {
      this.response.status(400);
      return {
        success: false,
        message: "value must be true, false, or null",
      };
    }
    const result = await this.campaignService.updateAffiliateCherryPickOverride(
      id,
      affiliateId,
      payload.value,
      this.getActor(),
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to update cherry pick override",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Cherry pick override updated",
      data: this.enrichCampaignForResponse(result.data!),
    };
  }

  @POST("/:id/affiliates/:affiliateId/logic/apply-catalog")
  @produces("application/json")
  async applyLogicCatalogToAffiliate(
    @pathParam("id") id: string,
    @pathParam("affiliateId") affiliateId: string,
    @body payload: ApplyLogicCatalogRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.applyLogicCatalogToAffiliate(
      id,
      affiliateId,
      payload,
      this.getActor(),
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to apply logic catalog to affiliate",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Logic catalog applied to affiliate",
      data: result.data,
    };
  }

  // ── Per-Client Logic Rule Overrides ──────────────────────────────────────

  @GET("/:id/clients/:clientId/logic-rules")
  @produces("application/json")
  async listClientLogicRules(
    @pathParam("id") id: string,
    @pathParam("clientId") clientId: string,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.listClientLogicRules(
      id,
      clientId,
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to list client logic rules",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Client logic rules retrieved",
      data: result.data,
    };
  }

  @POST("/:id/clients/:clientId/logic-rules")
  @produces("application/json")
  async createClientLogicRule(
    @pathParam("id") id: string,
    @pathParam("clientId") clientId: string,
    @body payload: CreateLogicRuleRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.createClientLogicRule(
      id,
      clientId,
      payload,
      this.getActor(),
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to create client logic rule",
        error: result.error,
      };
    }
    this.response.status(201);
    return {
      success: true,
      message: "Client logic rule created",
      data: result.data,
    };
  }

  @PUT("/:id/clients/:clientId/logic-rules/:ruleId")
  @produces("application/json")
  async updateClientLogicRule(
    @pathParam("id") id: string,
    @pathParam("clientId") clientId: string,
    @pathParam("ruleId") ruleId: string,
    @body payload: UpdateLogicRuleRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.updateClientLogicRule(
      id,
      clientId,
      ruleId,
      payload,
      this.getActor(),
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to update client logic rule",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Client logic rule updated",
      data: result.data,
    };
  }

  @DELETE("/:id/clients/:clientId/logic-rules/:ruleId")
  @produces("application/json")
  async deleteClientLogicRule(
    @pathParam("id") id: string,
    @pathParam("clientId") clientId: string,
    @pathParam("ruleId") ruleId: string,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.deleteClientLogicRule(
      id,
      clientId,
      ruleId,
      this.getActor(),
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to delete client logic rule",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Client logic rule deleted",
      data: result.data,
    };
  }

  @POST("/:id/clients/:clientId/logic/apply-catalog")
  @produces("application/json")
  async applyLogicCatalogToClient(
    @pathParam("id") id: string,
    @pathParam("clientId") clientId: string,
    @body payload: ApplyLogicCatalogRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.applyLogicCatalogToClient(
      id,
      clientId,
      payload,
      this.getActor(),
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to apply logic catalog to client",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Logic catalog applied to client",
      data: result.data,
    };
  }

  @POST("/:id/clients/:clientId/logic/sync-to-campaign")
  @produces("application/json")
  async syncClientLogicToCampaign(
    @pathParam("id") id: string,
    @pathParam("clientId") clientId: string,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.syncClientLogicToCampaign(
      id,
      clientId,
      this.getActor(),
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to sync client logic to campaign",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Client logic synced to campaign",
      data: result.data,
    };
  }

  // ── Criteria Catalog ────────────────────────────────────────────────────

  /**
   * POST /:id/criteria/apply-catalog
   * Apply a specific criteria catalog version to this campaign.
   */
  @POST("/:id/criteria/apply-catalog")
  @produces("application/json")
  async applyCriteriaCatalog(
    @pathParam("id") id: string,
    @body payload: ApplyCriteriaCatalogRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.applyCriteriaCatalogToCampaign(
      id,
      payload,
      this.getActor(),
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to apply criteria catalog",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Criteria catalog applied",
      data: result.data,
    };
  }

  /**
   * GET /criteria-catalog
   * List all active criteria catalog sets.
   */
  @GET("/criteria-catalog")
  @produces("application/json")
  async listCriteriaCatalog(): Promise<RestApiResponse> {
    const result = await this.campaignService.listCriteriaCatalog();
    if (!result.result) {
      this.response.status(500);
      return {
        success: false,
        message: "Failed to list criteria catalog",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Criteria catalog sets retrieved",
      data: result.data,
    };
  }

  /**
   * POST /criteria-catalog
   * Create a new criteria catalog set.
   */
  @POST("/criteria-catalog")
  @produces("application/json")
  async createCriteriaCatalogSet(
    @body payload: CreateCriteriaCatalogRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.createCriteriaCatalogSet(
      payload,
      this.getActor(),
    );
    if (!result.result) {
      this.response.status(400);
      return {
        success: false,
        message: "Failed to create criteria catalog set",
        error: result.error,
      };
    }
    this.response.status(201);
    return {
      success: true,
      message: "Criteria catalog set created",
      data: result.data,
    };
  }

  /**
   * GET /criteria-catalog/:setId
   * Get a criteria catalog set with all versions.
   */
  @GET("/criteria-catalog/:setId")
  @produces("application/json")
  async getCriteriaCatalogSet(
    @pathParam("setId") setId: string,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.getCriteriaCatalogSet(setId);
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Criteria catalog set not found",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Criteria catalog set retrieved",
      data: result.data,
    };
  }

  /**
   * GET /criteria-catalog/:setId/versions/:version
   * Get a specific version of a criteria catalog set.
   */
  @GET("/criteria-catalog/:setId/versions/:version")
  @produces("application/json")
  async getCriteriaCatalogVersion(
    @pathParam("setId") setId: string,
    @pathParam("version") version: string,
  ): Promise<RestApiResponse> {
    const versionNum = parseInt(version, 10);
    if (isNaN(versionNum) || versionNum < 1) {
      this.response.status(400);
      return { success: false, message: "version must be a positive integer" };
    }
    const result = await this.campaignService.getCriteriaCatalogVersion(
      setId,
      versionNum,
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Criteria catalog version not found",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Criteria catalog version retrieved",
      data: result.data,
    };
  }

  /**
   * PUT /criteria-catalog/:setId
   * Update a criteria catalog set — creates a new version.
   */
  @PUT("/criteria-catalog/:setId")
  @produces("application/json")
  async updateCriteriaCatalogSet(
    @pathParam("setId") setId: string,
    @body payload: UpdateCriteriaCatalogRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.updateCriteriaCatalogSet(
      setId,
      payload,
      this.getActor(),
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to update criteria catalog set",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Criteria catalog set updated",
      data: result.data,
    };
  }

  /**
   * DELETE /criteria-catalog/:setId/versions/:version
   * Delete a specific version of a criteria catalog set.
   */
  @DELETE("/criteria-catalog/:setId/versions/:version")
  @produces("application/json")
  async deleteCriteriaCatalogVersion(
    @pathParam("setId") setId: string,
    @pathParam("version") version: string,
  ): Promise<RestApiResponse> {
    const versionNum = parseInt(version, 10);
    if (isNaN(versionNum) || versionNum < 1) {
      this.response.status(400);
      return { success: false, message: "version must be a positive integer" };
    }
    const result = await this.campaignService.deleteCriteriaCatalogVersion(
      setId,
      versionNum,
      this.getActor(),
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to delete criteria catalog version",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Criteria catalog version deleted",
    };
  }

  /**
   * DELETE /criteria-catalog/:setId
   * Delete a criteria catalog set and all its versions.
   */
  @DELETE("/criteria-catalog/:setId")
  @produces("application/json")
  async deleteCriteriaCatalogSet(
    @pathParam("setId") setId: string,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.deleteCriteriaCatalogSet(
      setId,
      this.getActor(),
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to delete criteria catalog set",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Criteria catalog set deleted",
    };
  }

  /**
   * POST /:id/logic/apply-catalog
   * Apply a specific logic catalog version to this campaign.
   */
  @POST("/:id/logic/apply-catalog")
  @produces("application/json")
  async applyLogicCatalog(
    @pathParam("id") id: string,
    @body payload: ApplyLogicCatalogRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.applyLogicCatalogToCampaign(
      id,
      payload,
      this.getActor(),
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to apply logic catalog",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Logic catalog applied",
      data: result.data,
    };
  }

  @GET("/logic-catalog")
  @produces("application/json")
  async listLogicCatalog(): Promise<RestApiResponse> {
    const result = await this.campaignService.listLogicCatalog();
    if (!result.result) {
      this.response.status(500);
      return {
        success: false,
        message: "Failed to list logic catalog",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Logic catalog sets retrieved",
      data: result.data,
    };
  }

  @POST("/logic-catalog")
  @produces("application/json")
  async createLogicCatalogSet(
    @body payload: CreateLogicCatalogRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.createLogicCatalogSet(
      payload,
      this.getActor(),
    );
    if (!result.result) {
      this.response.status(400);
      return {
        success: false,
        message: "Failed to create logic catalog set",
        error: result.error,
      };
    }
    this.response.status(201);
    return {
      success: true,
      message: "Logic catalog set created",
      data: result.data,
    };
  }

  @GET("/logic-catalog/:setId")
  @produces("application/json")
  async getLogicCatalogSet(
    @pathParam("setId") setId: string,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.getLogicCatalogSet(setId);
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Logic catalog set not found",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Logic catalog set retrieved",
      data: result.data,
    };
  }

  @GET("/logic-catalog/:setId/versions/:version")
  @produces("application/json")
  async getLogicCatalogVersion(
    @pathParam("setId") setId: string,
    @pathParam("version") version: string,
  ): Promise<RestApiResponse> {
    const versionNum = parseInt(version, 10);
    if (isNaN(versionNum) || versionNum < 1) {
      this.response.status(400);
      return { success: false, message: "version must be a positive integer" };
    }
    const result = await this.campaignService.getLogicCatalogVersion(
      setId,
      versionNum,
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Logic catalog version not found",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Logic catalog version retrieved",
      data: result.data,
    };
  }

  @PUT("/logic-catalog/:setId")
  @produces("application/json")
  async updateLogicCatalogSet(
    @pathParam("setId") setId: string,
    @body payload: UpdateLogicCatalogRequest,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.updateLogicCatalogSet(
      setId,
      payload,
      this.getActor(),
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to update logic catalog set",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Logic catalog set updated",
      data: result.data,
    };
  }

  @DELETE("/logic-catalog/:setId/versions/:version")
  @produces("application/json")
  async deleteLogicCatalogVersion(
    @pathParam("setId") setId: string,
    @pathParam("version") version: string,
  ): Promise<RestApiResponse> {
    const versionNum = parseInt(version, 10);
    if (isNaN(versionNum) || versionNum < 1) {
      this.response.status(400);
      return { success: false, message: "version must be a positive integer" };
    }
    const result = await this.campaignService.deleteLogicCatalogVersion(
      setId,
      versionNum,
      this.getActor(),
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to delete logic catalog version",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Logic catalog version deleted",
    };
  }

  @DELETE("/logic-catalog/:setId")
  @produces("application/json")
  async deleteLogicCatalogSet(
    @pathParam("setId") setId: string,
  ): Promise<RestApiResponse> {
    const result = await this.campaignService.deleteLogicCatalogSet(
      setId,
      this.getActor(),
    );
    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to delete logic catalog set",
        error: result.error,
      };
    }
    return {
      success: true,
      message: "Logic catalog set deleted",
    };
  }
}
