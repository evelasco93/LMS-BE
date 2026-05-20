import "reflect-metadata";
import { injectable, inject } from "inversify";
import {
  apiController,
  GET,
  produces,
  Controller,
  queryParam,
} from "ts-lambda-api";
import { LeadsService } from "../services/leads.service";
import { RestApiResponse } from "../types/common.types";
import { mapServiceErrorToHttpStatus, withCorrelationId } from "@shared/utils";

@injectable()
@apiController("/metrics")
export class MetricsController extends Controller {
  constructor(@inject("LeadsService") private readonly service: LeadsService) {
    super();
  }

  private withCorrelation<T extends RestApiResponse>(response: T): T {
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

  @GET("/summary")
  @produces("application/json")
  async summary(
    @queryParam("from_date") from_date?: string,
    @queryParam("to_date") to_date?: string,
    @queryParam("campaign_id") campaign_id?: string,
    @queryParam("campaign_key") campaign_key?: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.getMetricsSummary({
      from_date,
      to_date,
      campaign_id,
      campaign_key,
    });

    if (!result.result) {
      return this.fail("Failed to retrieve metrics summary", result.error, 400);
    }

    return this.withCorrelation({
      success: true,
      message: "Metrics summary retrieved successfully",
      data: result.data,
    });
  }

  @GET("/timeseries")
  @produces("application/json")
  async timeseries(
    @queryParam("from_date") from_date?: string,
    @queryParam("to_date") to_date?: string,
    @queryParam("campaign_id") campaign_id?: string,
    @queryParam("campaign_key") campaign_key?: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.getMetricsTimeseries({
      from_date,
      to_date,
      campaign_id,
      campaign_key,
    });

    if (!result.result) {
      return this.fail(
        "Failed to retrieve metrics timeseries",
        result.error,
        400,
      );
    }

    return this.withCorrelation({
      success: true,
      message: "Metrics timeseries retrieved successfully",
      data: result.data,
    });
  }

  @GET("/campaign-by-source")
  @produces("application/json")
  async breakdown(
    @queryParam("from_date") from_date?: string,
    @queryParam("to_date") to_date?: string,
    @queryParam("campaign_id") campaign_id?: string,
    @queryParam("campaign_key") campaign_key?: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.getMetricsBreakdown({
      from_date,
      to_date,
      campaign_id,
      campaign_key,
    });

    if (!result.result) {
      return this.fail(
        "Failed to retrieve metrics breakdown",
        result.error,
        400,
      );
    }

    return this.withCorrelation({
      success: true,
      message: "Metrics breakdown retrieved successfully",
      data: result.data,
    });
  }

  @GET("/contracts")
  @produces("application/json")
  async contracts(
    @queryParam("from_date") from_date?: string,
    @queryParam("to_date") to_date?: string,
    @queryParam("campaign_id") campaign_id?: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.getMetricsContracts({
      from_date,
      to_date,
      campaign_id,
    });

    if (!result.result) {
      return this.fail(
        "Failed to retrieve contract metrics",
        result.error,
        400,
      );
    }

    return this.withCorrelation({
      success: true,
      message: "Contract metrics retrieved successfully",
      data: result.data,
    });
  }

  @GET("/health")
  @produces("application/json")
  async health(
    @queryParam("from_date") from_date?: string,
    @queryParam("to_date") to_date?: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.getMetricsHealth({
      from_date,
      to_date,
    });

    if (!result.result) {
      return this.fail("Failed to retrieve metrics health", result.error, 400);
    }

    return this.withCorrelation({
      success: true,
      message: "Metrics health retrieved successfully",
      data: result.data,
    });
  }
}
