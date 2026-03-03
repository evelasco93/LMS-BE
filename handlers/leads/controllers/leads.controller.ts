import "reflect-metadata";
import { injectable, inject } from "inversify";
import {
  apiController,
  POST,
  GET,
  PUT,
  body,
  produces,
  Controller,
  pathParam,
  queryParam,
} from "ts-lambda-api";
import { LeadsService } from "../services/leads.service";
import {
  CreateLeadRequest,
  ListLeadsQuery,
  UpdateLeadRequest,
} from "../types/lead-request.types";
import { RestApiResponse } from "../types/common.types";

@injectable()
@apiController("/leads")
export class LeadsController extends Controller {
  constructor(@inject("LeadsService") private readonly service: LeadsService) {
    super();
  }

  @GET("/")
  @produces("application/json")
  async listLeads(
    @queryParam("campaign_id") campaign_id?: string,
    @queryParam("test") test?: string,
    @queryParam("limit") limit?: string,
    @queryParam("lastEvaluatedKey") lastEvaluatedKey?: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.listLeads({
      campaign_id,
      test: typeof test === "string" ? test === "true" : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      lastEvaluatedKey,
    } satisfies ListLeadsQuery);

    if (!result.result) {
      return {
        success: false,
        message: "Failed to list leads",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Leads retrieved successfully",
      count: result.data?.count,
      data: result.data?.items,
      lastEvaluatedKey: result.data?.lastEvaluatedKey,
    };
  }

  @GET("/:id")
  @produces("application/json")
  async getLead(@pathParam("id") id: string): Promise<RestApiResponse> {
    const result = await this.service.getLead(id);

    if (!result.result || !result.data) {
      return {
        success: false,
        message: "Lead not found",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Lead retrieved successfully",
      data: result.data,
    };
  }

  @POST("/")
  @produces("application/json")
  async createLead(@body payload: CreateLeadRequest): Promise<RestApiResponse> {
    const result = await this.service.createLead(payload, false);

    if (!result.result) {
      return {
        success: false,
        message: "Lead rejected",
        error: result.error,
      };
    }

    return {
      success: true,
      message: result.data?.rejected
        ? "Lead stored but rejected"
        : "Lead accepted",
      data: result.data,
    };
  }

  @POST("/test")
  @produces("application/json")
  async createTestLead(
    @body payload: CreateLeadRequest,
  ): Promise<RestApiResponse> {
    const result = await this.service.createLead(payload, true);

    if (!result.result) {
      return {
        success: false,
        message: "Test lead rejected",
        error: result.error,
      };
    }

    return {
      success: true,
      message: result.data?.rejected
        ? "Lead stored but rejected"
        : "Test lead accepted",
      data: result.data,
    };
  }

  @PUT("/:id")
  @produces("application/json")
  async updateLead(
    @pathParam("id") id: string,
    @body payload: UpdateLeadRequest,
  ): Promise<RestApiResponse> {
    const result = await this.service.updateLead(id, payload);

    if (!result.result) {
      return {
        success: false,
        message: "Failed to update lead",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Lead updated successfully",
      data: result.data,
    };
  }
}
