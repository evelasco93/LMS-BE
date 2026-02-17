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
import { AffiliateService } from "../services/affiliate.service";
import {
  CreateAffiliateRequest,
  UpdateAffiliateRequest,
} from "../types/affiliate-request.types";
import { AffiliateStatus } from "../enums/affiliate-status.enum";
import { RestApiResponse } from "../types/common.types";

@injectable()
@apiController("/affiliates")
export class AffiliateController extends Controller {
  constructor(
    @inject("AffiliateService")
    private readonly affiliateService: AffiliateService,
  ) {
    super();
  }

  @POST("/")
  @produces("application/json")
  async createAffiliate(
    @body payload: CreateAffiliateRequest,
  ): Promise<RestApiResponse> {
    const result = await this.affiliateService.createAffiliate(payload);

    if (!result.result) {
      return {
        success: false,
        message: "Failed to create affiliate",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Affiliate created successfully",
      data: result.data,
    };
  }

  @GET("/:id")
  @produces("application/json")
  async getAffiliate(@pathParam("id") id: string): Promise<RestApiResponse> {
    const result = await this.affiliateService.getAffiliate(id);

    if (!result.result) {
      return {
        success: false,
        message: "Affiliate not found",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Affiliate retrieved successfully",
      data: result.data,
    };
  }

  @GET("/")
  @produces("application/json")
  async listAffiliates(
    @queryParam("status") status?: AffiliateStatus,
    @queryParam("limit") limit?: string,
    @queryParam("lastEvaluatedKey") lastEvaluatedKey?: string,
  ): Promise<RestApiResponse> {
    const result = await this.affiliateService.listAffiliates({
      status,
      limit: limit ? parseInt(limit, 10) : undefined,
      lastEvaluatedKey,
    });

    if (!result.result) {
      return {
        success: false,
        message: "Failed to list affiliates",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Affiliates retrieved successfully",
      count: result.data?.count,
      data: result.data?.items,
    };
  }

  @PUT("/:id")
  @produces("application/json")
  async updateAffiliate(
    @pathParam("id") id: string,
    @body payload: UpdateAffiliateRequest,
  ): Promise<RestApiResponse> {
    const result = await this.affiliateService.updateAffiliate(id, payload);

    if (!result.result) {
      return {
        success: false,
        message: "Failed to update affiliate",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Affiliate updated successfully",
      data: result.data,
    };
  }

  @DELETE("/:id")
  @produces("application/json")
  async deleteAffiliate(@pathParam("id") id: string): Promise<RestApiResponse> {
    const result = await this.affiliateService.deleteAffiliate(id);

    if (!result.result) {
      return {
        success: false,
        message: "Failed to delete affiliate",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Affiliate deleted successfully",
    };
  }
}
