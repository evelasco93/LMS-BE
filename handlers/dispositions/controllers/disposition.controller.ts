import "reflect-metadata";
import { inject, injectable } from "inversify";
import {
  apiController,
  body,
  Controller,
  DELETE,
  GET,
  pathParam,
  POST,
  produces,
  PUT,
  queryParam,
} from "ts-lambda-api";
import {
  extractRequestActorFromHeaders,
  mapServiceErrorToHttpStatus,
  withCorrelationId,
} from "@shared/utils";
import { DispositionService } from "../services/disposition.service";
import {
  CandidateLeadsQuery,
  CreateDispositionRequest,
  ListDispositionsQuery,
  PutDispositionRowsRequest,
  UpdateDispositionRequest,
  UpsertPublicDashboardRequest,
} from "../types/disposition-request.types";
import { RestApiResponse } from "../types/common.types";

@injectable()
@apiController("/v2/dispositions")
export class DispositionController extends Controller {
  constructor(
    @inject("DispositionService")
    private readonly dispositionService: DispositionService,
  ) {
    super();
  }

  private withCorrelation<T extends Record<string, unknown>>(response: T): T {
    return withCorrelationId(
      response,
      this.request.headers as Record<string, string | string[] | undefined>,
    ) as T;
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
  async listDispositions(
    @queryParam("source_key") sourceKey?: string,
    @queryParam("includeDeleted") includeDeleted?: string,
  ): Promise<RestApiResponse> {
    const result = await this.dispositionService.listDispositions({
      source_key: sourceKey,
      includeDeleted:
        includeDeleted === "true" || includeDeleted === "1" || false,
    } satisfies ListDispositionsQuery);

    if (!result.result) {
      return this.fail("Failed to list dispositions", result.error, 500);
    }

    return this.withCorrelation({
      success: true,
      message: "Dispositions retrieved successfully",
      count: result.data?.length ?? 0,
      data: result.data,
    });
  }

  @POST("/")
  @produces("application/json")
  async createDisposition(
    @body payload: CreateDispositionRequest,
  ): Promise<RestApiResponse> {
    const result = await this.dispositionService.createDisposition(payload);

    if (!result.result) {
      return this.fail("Failed to create disposition", result.error, 400);
    }

    return this.withCorrelation({
      success: true,
      message: "Disposition created successfully",
      data: result.data,
    });
  }

  @GET("/:id")
  @produces("application/json")
  async getDisposition(@pathParam("id") id: string): Promise<RestApiResponse> {
    const result = await this.dispositionService.getDispositionById(id);

    if (!result.result) {
      return this.fail("Disposition not found", result.error, 404);
    }

    return this.withCorrelation({
      success: true,
      message: "Disposition retrieved successfully",
      data: result.data,
    });
  }

  @PUT("/:id")
  @produces("application/json")
  async updateDisposition(
    @pathParam("id") id: string,
    @body payload: UpdateDispositionRequest,
  ): Promise<RestApiResponse> {
    const result = await this.dispositionService.updateDisposition(id, payload);

    if (!result.result) {
      return this.fail("Failed to update disposition", result.error, 400);
    }

    return this.withCorrelation({
      success: true,
      message: "Disposition updated successfully",
      data: result.data,
    });
  }

  @DELETE("/:id")
  @produces("application/json")
  async deleteDisposition(
    @pathParam("id") id: string,
  ): Promise<RestApiResponse> {
    const result = await this.dispositionService.deleteDisposition(id);

    if (!result.result) {
      return this.fail("Failed to delete disposition", result.error, 404);
    }

    return this.withCorrelation({
      success: true,
      message: "Disposition deleted successfully",
    });
  }

  @GET("/:id/incoming-statuses")
  @produces("application/json")
  async getIncomingStatuses(
    @pathParam("id") id: string,
  ): Promise<RestApiResponse> {
    const result = await this.dispositionService.getIncomingStatuses(id);

    if (!result.result) {
      return this.fail("Failed to load incoming statuses", result.error, 404);
    }

    return this.withCorrelation({
      success: true,
      message: "Incoming statuses retrieved",
      data: { statuses: result.data },
    });
  }

  @GET("/:id/candidate-leads")
  @produces("application/json")
  async getCandidateLeads(
    @pathParam("id") id: string,
    @queryParam("included") included?: string,
    @queryParam("limit") limit?: string,
  ): Promise<RestApiResponse> {
    const includedFilter =
      included === undefined
        ? undefined
        : included === "true" || included === "1";

    const result = await this.dispositionService.getCandidateLeads(id, {
      included: includedFilter,
      limit: limit ? parseInt(limit, 10) : undefined,
    } satisfies CandidateLeadsQuery);

    if (!result.result) {
      return this.fail("Failed to list candidate leads", result.error, 404);
    }

    return this.withCorrelation({
      success: true,
      message: "Candidate leads retrieved",
      count: result.data?.count,
      data: {
        items: result.data?.items ?? [],
        total: result.data?.count ?? 0,
        page_size: result.data?.count ?? 0,
      },
    });
  }

  @PUT("/:id/rows")
  @produces("application/json")
  async putRows(
    @pathParam("id") id: string,
    @body payload: PutDispositionRowsRequest,
  ): Promise<RestApiResponse> {
    const result = await this.dispositionService.putRows(id, payload);

    if (!result.result) {
      return this.fail("Failed to update rows", result.error, 404);
    }

    return this.withCorrelation({
      success: true,
      message: "Rows updated successfully",
      data: result.data,
    });
  }

  @POST("/:id/refresh")
  @produces("application/json")
  async refresh(@pathParam("id") id: string): Promise<RestApiResponse> {
    const result = await this.dispositionService.refreshDisposition(id);

    if (!result.result) {
      return this.fail("Failed to refresh disposition", result.error, 404);
    }

    return this.withCorrelation({
      success: true,
      message: "Disposition refreshed",
      data: result.data,
    });
  }

  @GET("/:id/summary")
  @produces("application/json")
  async summary(@pathParam("id") id: string): Promise<RestApiResponse> {
    const result = await this.dispositionService.getSummary(id);

    if (!result.result) {
      return this.fail("Failed to summarize disposition", result.error, 404);
    }

    const data = result.data;
    return this.withCorrelation({
      success: true,
      message: "Disposition summary retrieved",
      data: {
        ...data,
        cpa: {
          signed: data?.signed ?? 0,
          total: data?.total ?? 0,
          conversion_pct: data?.conversion_percent ?? 0,
          cost_per_signed: data?.cost_per_signed ?? 0,
        },
      },
    });
  }

  @GET("/:id/public-dashboard")
  @produces("application/json")
  async getPublicDashboard(
    @pathParam("id") id: string,
  ): Promise<RestApiResponse> {
    const result = await this.dispositionService.getPublicDashboard(id);

    if (!result.result) {
      return this.fail("Public dashboard not found", result.error, 404);
    }

    return this.withCorrelation({
      success: true,
      message: "Public dashboard retrieved",
      data: result.data,
    });
  }

  @PUT("/:id/public-dashboard")
  @produces("application/json")
  async putPublicDashboard(
    @pathParam("id") id: string,
    @body payload: UpsertPublicDashboardRequest,
  ): Promise<RestApiResponse> {
    const result = await this.dispositionService.upsertPublicDashboard(
      id,
      payload,
    );

    if (!result.result) {
      return this.fail("Failed to update public dashboard", result.error, 400);
    }

    return this.withCorrelation({
      success: true,
      message: "Public dashboard updated",
      data: result.data,
    });
  }

  @POST("/:id/publish")
  @produces("application/json")
  async publish(@pathParam("id") id: string): Promise<RestApiResponse> {
    const result = await this.dispositionService.publishDisposition(id);

    if (!result.result) {
      return this.fail("Failed to publish disposition", result.error, 404);
    }

    return this.withCorrelation({
      success: true,
      message: "Disposition published",
      data: result.data,
    });
  }

  @POST("/:id/unpublish")
  @produces("application/json")
  async unpublish(@pathParam("id") id: string): Promise<RestApiResponse> {
    const result = await this.dispositionService.unpublishDisposition(id);

    if (!result.result) {
      return this.fail("Failed to unpublish disposition", result.error, 500);
    }

    this.response.status(200);
    return this.withCorrelation({
      success: true,
      message: "Disposition unpublished",
      data: result.data,
    });
  }
}
