import "reflect-metadata";
import { injectable, inject } from "inversify";
import {
  apiController,
  GET,
  POST,
  PATCH,
  body,
  pathParam,
  queryParam,
  produces,
  Controller,
} from "ts-lambda-api";
import { CherryPickService } from "../services/cherry-pick.service";
import {
  ExecuteCherryPickRequest,
  UpdatePickabilityRequest,
} from "../types/cherry-pick-request.types";
import { RestApiResponse } from "../types/common.types";
import {
  extractRequestActorFromHeaders,
  withCorrelationId,
} from "@shared/utils/request-audit.util";
import { mapServiceErrorToHttpStatus } from "@shared/utils/http-status.util";

@injectable()
@apiController("/cherry-pick")
export class CherryPickController extends Controller {
  constructor(
    @inject("CherryPickService")
    private readonly cherryPickService: CherryPickService,
  ) {
    super();
  }

  private getActor() {
    return extractRequestActorFromHeaders(
      this.request.headers as Record<string, string | string[] | undefined>,
    );
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

  /**
   * GET /cherry-pick/eligible-clients?lead_id=...
   * List clients available for cherry-picking for the given lead's campaign.
   */
  @GET("/eligible-clients")
  @produces("application/json")
  async listEligibleClients(
    @queryParam("lead_id") leadId?: string,
  ): Promise<RestApiResponse> {
    if (!leadId) {
      return this.fail("lead_id query parameter is required", undefined, 400);
    }

    const result = await this.cherryPickService.listEligibleClients(leadId);

    if (!result.result) {
      return this.fail("Failed to list eligible clients", result.error);
    }

    return this.withCorrelation({
      success: true,
      message: "Eligible clients retrieved",
      data: result.data,
    });
  }

  /**
   * PATCH /cherry-pick/:leadId/pickability
   * Toggle whether a lead is eligible to be cherry-picked.
   */
  @PATCH("/:leadId/pickability")
  @produces("application/json")
  async updatePickability(
    @pathParam("leadId") leadId: string,
    @body payload: UpdatePickabilityRequest,
  ): Promise<RestApiResponse> {
    if (typeof payload?.cherry_pickable !== "boolean") {
      return this.fail("cherry_pickable must be a boolean", undefined, 400);
    }

    const result = await this.cherryPickService.updatePickability(
      leadId,
      payload,
      this.getActor(),
    );

    if (!result.result) {
      return this.fail("Failed to update pickability", result.error);
    }

    return this.withCorrelation({
      success: true,
      message: "Pickability updated",
      data: result.data,
    });
  }

  /**
   * POST /cherry-pick/:leadId/execute
   * Execute a cherry-pick delivery of a lead to a specific client.
   */
  @POST("/:leadId/execute")
  @produces("application/json")
  async executeCherryPick(
    @pathParam("leadId") leadId: string,
    @body payload: ExecuteCherryPickRequest,
  ): Promise<RestApiResponse> {
    if (!payload?.target_client_id) {
      return this.fail("target_client_id is required", undefined, 400);
    }

    if (
      payload.fire_affiliate_pixel !== undefined &&
      typeof payload.fire_affiliate_pixel !== "boolean"
    ) {
      return this.fail(
        "fire_affiliate_pixel must be a boolean",
        undefined,
        400,
      );
    }

    const result = await this.cherryPickService.executeCherryPick(
      leadId,
      payload,
      this.getActor(),
    );

    if (!result.result) {
      return this.fail("Failed to execute cherry-pick", result.error);
    }

    return this.withCorrelation({
      success: true,
      message: "Cherry-pick executed",
      data: result.data,
    });
  }
}
