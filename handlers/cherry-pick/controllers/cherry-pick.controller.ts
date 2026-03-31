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
import { extractRequestActorFromHeaders } from "@shared/utils/request-audit.util";

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
      this.response.status(400);
      return {
        success: false,
        message: "lead_id query parameter is required",
      };
    }

    const result = await this.cherryPickService.listEligibleClients(leadId);

    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to list eligible clients",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Eligible clients retrieved",
      data: result.data,
    };
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
      this.response.status(400);
      return {
        success: false,
        message: "cherry_pickable must be a boolean",
      };
    }

    const result = await this.cherryPickService.updatePickability(
      leadId,
      payload,
      this.getActor(),
    );

    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to update pickability",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Pickability updated",
      data: result.data,
    };
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
      this.response.status(400);
      return {
        success: false,
        message: "target_client_id is required",
      };
    }

    if (
      payload.fire_affiliate_pixel !== undefined &&
      typeof payload.fire_affiliate_pixel !== "boolean"
    ) {
      this.response.status(400);
      return {
        success: false,
        message: "fire_affiliate_pixel must be a boolean",
      };
    }

    const result = await this.cherryPickService.executeCherryPick(
      leadId,
      payload,
      this.getActor(),
    );

    if (!result.result) {
      const isNotFound = result.error?.includes("not found");
      this.response.status(isNotFound ? 404 : 400);
      return {
        success: false,
        message: "Failed to execute cherry-pick",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Cherry-pick executed",
      data: result.data,
    };
  }
}
