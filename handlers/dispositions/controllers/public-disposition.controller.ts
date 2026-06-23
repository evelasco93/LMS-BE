import "reflect-metadata";
import { inject, injectable } from "inversify";
import {
  apiController,
  Controller,
  GET,
  pathParam,
  produces,
} from "ts-lambda-api";
import { mapServiceErrorToHttpStatus, withCorrelationId } from "@shared/utils";
import { DispositionService } from "../services/disposition.service";
import { RestApiResponse } from "../types/common.types";

@injectable()
@apiController("/public/dispo")
export class PublicDispositionController extends Controller {
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
    fallbackStatus = 404,
  ): RestApiResponse {
    this.response.status(mapServiceErrorToHttpStatus(error, fallbackStatus));
    return this.withCorrelation({
      success: false,
      message,
      error,
    });
  }

  @GET("/:uuid")
  @produces("application/json")
  async getPublicByUuid(
    @pathParam("uuid") uuid: string,
  ): Promise<RestApiResponse> {
    const result =
      await this.dispositionService.getPublicDispositionByUuid(uuid);

    if (!result.result) {
      return this.fail("Public disposition not found", "not found", 404);
    }

    return this.withCorrelation({
      success: true,
      message: "Public disposition retrieved",
      data: result.data,
    });
  }
}
