import "reflect-metadata";
import { injectable, inject } from "inversify";
import {
  apiController,
  GET,
  POST,
  pathParam,
  queryParam,
  body,
  produces,
  Controller,
} from "ts-lambda-api";
import { AuditService } from "../services/audit.service";

interface RestApiResponse {
  success: boolean;
  message: string;
  data?: unknown;
  error?: string;
}

@injectable()
@apiController("/audit")
export class AuditController extends Controller {
  constructor(
    @inject("AuditService") private readonly auditService: AuditService,
  ) {
    super();
  }

  /**
   * GET /v2/audit
   * Full table scan — returns all audit records with cursor-based pagination.
   * No filters required. Use limit + cursor to page through the entire table.
   */
  @GET("/")
  @produces("application/json")
  async getAllRecords(
    @queryParam("limit") limitStr?: string,
    @queryParam("cursor") cursor?: string,
  ): Promise<RestApiResponse> {
    const limit = limitStr ? parseInt(limitStr, 10) : 50;
    const result = await this.auditService.getAllRecords(limit, cursor);

    if (!result.result) {
      return {
        success: false,
        message: "Failed to retrieve audit records",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Audit records retrieved successfully",
      data: result.data,
    };
  }

  /**
   * GET /v2/audit/activity
   * Cross-entity activity feed — query by entity_type or actor_sub with optional date range.
   * Must be declared before /:entityId so the static path wins.
   */
  @GET("/activity")
  @produces("application/json")
  async getActivityFeed(
    @queryParam("entity_type") entity_type?: string,
    @queryParam("actor_sub") actor_sub?: string,
    @queryParam("from") from?: string,
    @queryParam("to") to?: string,
    @queryParam("limit") limitStr?: string,
    @queryParam("cursor") cursor?: string,
  ): Promise<RestApiResponse> {
    const limit = limitStr ? parseInt(limitStr, 10) : 50;
    const result = await this.auditService.getActivityFeed({
      entity_type,
      actor_sub,
      from,
      to,
      limit,
      cursor,
    });

    if (!result.result) {
      return {
        success: false,
        message: "Failed to retrieve activity feed",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Activity feed retrieved successfully",
      data: result.data,
    };
  }

  /**
   * GET /v2/audit/:entityId
   * Returns paginated audit history for a specific entity.
   */
  @GET("/:entityId")
  @produces("application/json")
  async getEntityHistory(
    @pathParam("entityId") entityId: string,
    @queryParam("limit") limitStr?: string,
    @queryParam("cursor") cursor?: string,
  ): Promise<RestApiResponse> {
    const limit = limitStr ? parseInt(limitStr, 10) : 50;
    const result = await this.auditService.getEntityHistory(
      entityId,
      limit,
      cursor,
    );

    if (!result.result) {
      return {
        success: false,
        message: "Failed to retrieve audit history",
        error: result.error,
      };
    }

    return {
      success: true,
      message: "Audit history retrieved successfully",
      data: result.data,
    };
  }

  /**
   * POST /v2/audit/export
   * Manually triggers an S3 export for a given date.
   * Body: { "date": "YYYY-MM-DD" }
   */
  @POST("/export")
  @produces("application/json")
  async triggerExport(
    @body payload: { date: string },
  ): Promise<RestApiResponse> {
    if (!payload?.date || !/^\d{4}-\d{2}-\d{2}$/.test(payload.date)) {
      return {
        success: false,
        message: "Invalid request",
        error: "date must be YYYY-MM-DD",
      };
    }

    const result = await this.auditService.exportToS3(payload.date);

    if (!result.result) {
      return { success: false, message: "Export failed", error: result.error };
    }

    return {
      success: true,
      message: "Export completed successfully",
      data: { s3Key: result.s3Key, count: result.count },
    };
  }
}
