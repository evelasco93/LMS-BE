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
  SetDistributionRequest,
  SetAffiliateCapRequest,
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
      submit_url_test: result.data?.submit_url_test,
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
      submit_url_test: result.data?.submit_url_test,
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
}
