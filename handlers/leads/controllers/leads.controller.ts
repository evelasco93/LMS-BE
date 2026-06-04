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
import {
  LeadIntakeResponse,
  PaginatedRestApiResponse,
  RestApiResponse,
} from "../types/common.types";
import { ILead } from "../interfaces/ILead.interface";
import {
  extractRequestActorFromHeaders,
  mapServiceErrorToHttpStatus,
  withCorrelationId,
} from "@shared/utils";

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

  private withCorrelation<T extends Record<string, unknown>>(
    response: T,
  ): T & { correlation_id?: string } {
    return withCorrelationId(
      response,
      this.request.headers as Record<string, string | string[] | undefined>,
    );
  }

  private fail(
    message: string,
    error?: string,
    fallbackStatus = 400,
  ): RestApiResponse {
    this.response.status(mapServiceErrorToHttpStatus(error, fallbackStatus));
    return this.withCorrelation({
      success: false,
      message,
      error,
    });
  }

  @GET("/")
  @produces("application/json")
  async listLeads(
    @queryParam("campaign_id") campaign_id?: string,
    @queryParam("test") test?: string,
    @queryParam("include_test") include_test?: string,
    @queryParam("limit") limit?: string,
    @queryParam("nextToken") nextToken?: string,
    @queryParam("lastEvaluatedKey") lastEvaluatedKey?: string,
    @queryParam("includeDeleted") includeDeleted?: string,
    @queryParam("include_trace") include_trace?: string,
  ): Promise<PaginatedRestApiResponse<ILead>> {
    const parsedIncludeTest =
      typeof include_test === "string"
        ? include_test === "true" || include_test === "1"
        : undefined;

    const result = await this.service.listLeads({
      campaign_id,
      test: typeof test === "string" ? test === "true" : undefined,
      include_test: parsedIncludeTest,
      limit: limit ? parseInt(limit, 10) : undefined,
      nextToken,
      lastEvaluatedKey,
      includeDeleted:
        includeDeleted === "true" || includeDeleted === "1" || false,
      include_trace: include_trace === "true" || include_trace === "1" || false,
    } satisfies ListLeadsQuery);

    if (!result.result) {
      return this.fail("Failed to list leads", result.error, 400);
    }

    return this.withCorrelation({
      success: true,
      message: "Leads retrieved successfully",
      data: {
        items: result.data?.items ?? [],
        count: result.data?.count ?? 0,
        page_count:
          result.data?.pagination?.returnedCount ?? result.data?.count ?? 0,
        total_count:
          result.data?.pagination?.totalCount ?? result.data?.pagination?.total,
        ...(result.data?.nextToken ? { nextToken: result.data.nextToken } : {}),
        ...(result.data?.pagination
          ? { pagination: result.data.pagination }
          : {}),
        ...(result.data?.lastEvaluatedKey
          ? { lastEvaluatedKey: result.data.lastEvaluatedKey }
          : {}),
      },
    });
  }

  @GET("/:id")
  @produces("application/json")
  async getLead(
    @pathParam("id") id: string,
    @queryParam("include_trace") include_trace?: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.getLead(
      id,
      include_trace === "true" || include_trace === "1",
    );

    if (!result.result || !result.data) {
      return this.fail("Lead not found", result.error, 404);
    }

    return this.withCorrelation({
      success: true,
      message: "Lead retrieved successfully",
      data: result.data,
    });
  }

  @GET("/intake-logs")
  @produces("application/json")
  async listIntakeLogs(
    @queryParam("campaign_id") campaign_id?: string,
    @queryParam("status") status?: string,
    @queryParam("include_test") include_test?: string,
    @queryParam("from_date") from_date?: string,
    @queryParam("to_date") to_date?: string,
    @queryParam("limit") limit?: string,
    @queryParam("lastEvaluatedKey") lastEvaluatedKey?: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.listIntakeLogs({
      campaign_id,
      status: status as ListIntakeLogsQuery["status"],
      include_test: include_test === "true" || include_test === "1" || false,
      from_date,
      to_date,
      limit: limit ? parseInt(limit, 10) : undefined,
      lastEvaluatedKey,
    });

    if (!result.result) {
      return this.fail("Failed to list intake logs", result.error, 400);
    }

    return this.withCorrelation({
      success: true,
      message: "Intake logs retrieved successfully",
      count: result.data?.count,
      total: result.data?.total,
      data: result.data?.items,
      lastEvaluatedKey: result.data?.lastEvaluatedKey,
      pagination: result.data?.pagination,
    });
  }

  @POST("/")
  @produces("application/json")
  async createLead(
    @body payload: CreateLeadRequest,
  ): Promise<LeadIntakeResponse> {
    const response = await this.service.createLead(
      payload,
      this.getActor(),
      this.request.headers as Record<string, string | string[] | undefined>,
    );

    return this.withCorrelation(response) as LeadIntakeResponse;
  }

  @PUT("/:id")
  @produces("application/json")
  async updateLead(
    @pathParam("id") id: string,
    @body payload: UpdateLeadRequest,
  ): Promise<RestApiResponse> {
    const result = await this.service.updateLead(id, payload, this.getActor());

    if (!result.result) {
      return this.fail("Failed to update lead", result.error, 400);
    }

    return this.withCorrelation({
      success: true,
      message: "Lead updated successfully",
      data: result.data,
    });
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
      return this.fail("Failed to delete lead", result.error, 400);
    }

    return this.withCorrelation({
      success: true,
      message:
        permanent === "true" || permanent === "1"
          ? "Lead permanently deleted"
          : "Lead deleted successfully",
    });
  }
}
