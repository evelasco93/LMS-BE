import "reflect-metadata";
import { injectable, inject } from "inversify";
import {
  apiController,
  GET,
  produces,
  Controller,
  pathParam,
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
    @queryParam("affiliate_id") affiliate_id?: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.getMetricsSummary({
      from_date,
      to_date,
      campaign_id,
      campaign_key,
      affiliate_id,
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
    @queryParam("affiliate_id") affiliate_id?: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.getMetricsTimeseries({
      from_date,
      to_date,
      campaign_id,
      campaign_key,
      affiliate_id,
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

  @GET("/timeseries/by-source")
  @produces("application/json")
  async timeseriesBySource(
    @queryParam("from_date") from_date?: string,
    @queryParam("to_date") to_date?: string,
    @queryParam("campaign_id") campaign_id?: string,
    @queryParam("affiliate_id") affiliate_id?: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.getMetricsTimeseriesBySource({
      from_date,
      to_date,
      campaign_id,
      affiliate_id,
    });
    if (!result.result) {
      return this.fail(
        "Failed to retrieve metrics timeseries by source",
        result.error,
        400,
      );
    }
    return this.withCorrelation({
      success: true,
      message: "Metrics timeseries by source retrieved successfully",
      data: result.data,
    });
  }

  @GET("/timeseries/hourly")
  @produces("application/json")
  async timeseriesHourly(
    @queryParam("from_date") from_date?: string,
    @queryParam("to_date") to_date?: string,
    @queryParam("campaign_id") campaign_id?: string,
    @queryParam("affiliate_id") affiliate_id?: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.getMetricsHourly({
      from_date,
      to_date,
      campaign_id,
      affiliate_id,
    });
    if (!result.result) {
      return this.fail(
        "Failed to retrieve metrics hourly rollup",
        result.error,
        400,
      );
    }
    return this.withCorrelation({
      success: true,
      message: "Metrics hourly rollup retrieved successfully",
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
    @queryParam("affiliate_id") affiliate_id?: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.getMetricsBreakdown({
      from_date,
      to_date,
      campaign_id,
      campaign_key,
      affiliate_id,
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
    @queryParam("affiliate_id") affiliate_id?: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.getMetricsContracts({
      from_date,
      to_date,
      campaign_id,
      affiliate_id,
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

  @GET("/by-affiliate/:affiliate_id")
  @produces("application/json")
  async byAffiliate(
    @pathParam("affiliate_id") affiliate_id: string,
    @queryParam("from_date") from_date?: string,
    @queryParam("to_date") to_date?: string,
    @queryParam("campaign_id") campaign_id?: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.getMetricsByAffiliate(affiliate_id, {
      from_date,
      to_date,
      campaign_id,
    });
    if (!result.result) {
      return this.fail(
        "Failed to retrieve metrics by affiliate",
        result.error,
        400,
      );
    }
    return this.withCorrelation({
      success: true,
      message: "Metrics by affiliate retrieved successfully",
      data: result.data,
    });
  }

  @GET("/by-affiliate/:affiliate_id/campaigns")
  @produces("application/json")
  async byAffiliateCampaigns(
    @pathParam("affiliate_id") affiliate_id: string,
    @queryParam("from_date") from_date?: string,
    @queryParam("to_date") to_date?: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.getMetricsByAffiliateCampaigns(
      affiliate_id,
      { from_date, to_date },
    );
    if (!result.result) {
      return this.fail(
        "Failed to retrieve metrics by affiliate campaigns",
        result.error,
        400,
      );
    }
    return this.withCorrelation({
      success: true,
      message: "Metrics by affiliate campaigns retrieved successfully",
      data: result.data,
    });
  }

  @GET("/by-affiliate/:affiliate_id/keys")
  @produces("application/json")
  async byAffiliateKeys(
    @pathParam("affiliate_id") affiliate_id: string,
    @queryParam("from_date") from_date?: string,
    @queryParam("to_date") to_date?: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.getMetricsByAffiliateKeys(affiliate_id, {
      from_date,
      to_date,
    });
    if (!result.result) {
      return this.fail(
        "Failed to retrieve metrics by affiliate keys",
        result.error,
        400,
      );
    }
    return this.withCorrelation({
      success: true,
      message: "Metrics by affiliate keys retrieved successfully",
      data: result.data,
    });
  }

  @GET("/by-campaign/:campaign_id/affiliates")
  @produces("application/json")
  async byCampaignAffiliates(
    @pathParam("campaign_id") campaign_id: string,
    @queryParam("from_date") from_date?: string,
    @queryParam("to_date") to_date?: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.getMetricsByCampaignAffiliates(
      campaign_id,
      { from_date, to_date },
    );
    if (!result.result) {
      return this.fail(
        "Failed to retrieve metrics by campaign affiliates",
        result.error,
        400,
      );
    }
    return this.withCorrelation({
      success: true,
      message: "Metrics by campaign affiliates retrieved successfully",
      data: result.data,
    });
  }

  @GET("/ipqs")
  @produces("application/json")
  async ipqs(
    @queryParam("from_date") from_date?: string,
    @queryParam("to_date") to_date?: string,
    @queryParam("campaign_id") campaign_id?: string,
    @queryParam("campaign_key") campaign_key?: string,
    @queryParam("affiliate_id") affiliate_id?: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.getMetricsIpqs({
      from_date,
      to_date,
      campaign_id,
      campaign_key,
      affiliate_id,
    });
    if (!result.result) {
      return this.fail("Failed to retrieve metrics ipqs", result.error, 400);
    }
    return this.withCorrelation({
      success: true,
      message: "Metrics ipqs retrieved successfully",
      data: result.data,
    });
  }

  @GET("/quality")
  @produces("application/json")
  async quality(
    @queryParam("from_date") from_date?: string,
    @queryParam("to_date") to_date?: string,
    @queryParam("campaign_id") campaign_id?: string,
    @queryParam("campaign_key") campaign_key?: string,
    @queryParam("affiliate_id") affiliate_id?: string,
  ): Promise<RestApiResponse> {
    const result = await this.service.getMetricsQuality({
      from_date,
      to_date,
      campaign_id,
      campaign_key,
      affiliate_id,
    });
    if (!result.result) {
      return this.fail("Failed to retrieve metrics quality", result.error, 400);
    }
    return this.withCorrelation({
      success: true,
      message: "Metrics quality retrieved successfully",
      data: result.data,
    });
  }
}
