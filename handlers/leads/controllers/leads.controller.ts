import "reflect-metadata";
import { injectable, inject } from "inversify";
import {
  apiController,
  POST,
  GET,
  PUT,
  DELETE,
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
  ListIntakeLogsQuery,
  UpdateLeadRequest,
} from "../types/lead-request.types";
import { LeadIntakeResponse, RestApiResponse } from "../types/common.types";
import { extractRequestActorFromHeaders } from "@shared/utils/request-audit.util";

@injectable()
@apiController("/leads")
export class LeadsController extends Controller {
  constructor(@inject("LeadsService") private readonly service: LeadsService) {
    super();
  }

  private getActor() {
    return extractRequestActorFromHeaders(
      this.request.headers as Record<string, string | string[] | undefined>,
    );
  }

  @GET("/")
  @produces("application/json")
  async listLeads(
    @queryParam("campaign_id") campaign_id?: string,
    @queryParam("test") test?: string,
    @queryParam("limit") limit?: string,
    @queryParam("lastEvaluatedKey") lastEvaluatedKey?: string,
    @queryParam("includeDeleted") includeDeleted?: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.listLeads({
      campaign_id,
      test: typeof test === "string" ? test === "true" : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      lastEvaluatedKey,
      includeDeleted:
        includeDeleted === "true" || includeDeleted === "1" || false,
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

  @GET("/intake-logs")
  @produces("application/json")
  async listIntakeLogs(
    @queryParam("campaign_id") campaign_id?: string,
    @queryParam("status") status?: string,
    @queryParam("from_date") from_date?: string,
    @queryParam("to_date") to_date?: string,
    @queryParam("limit") limit?: string,
    @queryParam("lastEvaluatedKey") lastEvaluatedKey?: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.listIntakeLogs({
      campaign_id,
      status: status as ListIntakeLogsQuery["status"],
      from_date,
      to_date,
      limit: limit ? parseInt(limit, 10) : undefined,
      lastEvaluatedKey,
    });

    if (!result.result) {
      return {
        success: false,
        message: "Failed to list intake logs",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Intake logs retrieved successfully",
      count: result.data?.count,
      data: result.data?.items,
      lastEvaluatedKey: result.data?.lastEvaluatedKey,
    };
  }

  @POST("/")
  @produces("application/json")
  async createLead(
    @body payload: CreateLeadRequest,
  ): Promise<LeadIntakeResponse> {
    return this.service.createLead(
      payload,
      false,
      this.getActor(),
      this.request.headers as Record<string, string | string[] | undefined>,
    );
  }

  @POST("/test")
  @produces("application/json")
  async createTestLead(
    @body payload: CreateLeadRequest,
  ): Promise<LeadIntakeResponse> {
    return this.service.createLead(
      payload,
      true,
      this.getActor(),
      this.request.headers as Record<string, string | string[] | undefined>,
    );
  }

  @PUT("/:id")
  @produces("application/json")
  async updateLead(
    @pathParam("id") id: string,
    @body payload: UpdateLeadRequest,
  ): Promise<RestApiResponse> {
    const result = await this.service.updateLead(id, payload, this.getActor());

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

  @DELETE("/:id")
  @produces("application/json")
  async deleteLead(
    @pathParam("id") id: string,
    @queryParam("permanent") permanent?: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.deleteLead(
      id,
      { permanent: permanent === "true" || permanent === "1" },
      this.getActor(),
    );

    if (!result.result) {
      return {
        success: false,
        message: "Failed to delete lead",
        error: result.error,
      };
    }

    return {
      success: true,
      message:
        permanent === "true" || permanent === "1"
          ? "Lead permanently deleted"
          : "Lead deleted successfully",
    };
  }
}
