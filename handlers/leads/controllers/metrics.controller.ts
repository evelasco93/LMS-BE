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

  @GET("/dashboard")
  @produces("application/json")
  async dashboard(
    @queryParam("from_date") from_date?: string,
    @queryParam("to_date") to_date?: string,
    @queryParam("time_preset") time_preset?: string,
    @queryParam("campaign_id") campaign_id?: string,
    @queryParam("campaign_key") campaign_key?: string,
    @queryParam("affiliate_id") affiliate_id?: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.getMetricsDashboard({
      from_date,
      to_date,
      time_preset,
      campaign_id,
      campaign_key,
      affiliate_id,
    });

    if (!result.result) {
      return this.fail(
        "Failed to retrieve metrics dashboard",
        result.error,
        400,
      );
    }

    return this.withCorrelation({
      success: true,
      message: "Metrics dashboard retrieved successfully",
      data: result.data,
    });
  }
}
