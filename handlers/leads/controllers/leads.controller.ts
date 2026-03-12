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
  UpdateLeadRequest,
} from "../types/lead-request.types";
import {
  LeadRejectionResponse,
  LeadSubmissionResponse,
  RestApiResponse,
} from "../types/common.types";
import { extractRequestActorFromHeaders } from "@shared/utils/request-audit.util";
import {
  LEAD_ACCEPTED_MESSAGE,
  LEAD_ACCEPTED_TEST_MESSAGE,
} from "@shared/constants/rejection-messages.constants";

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

  @POST("/")
  @produces("application/json")
  async createLead(
    @body payload: CreateLeadRequest,
  ): Promise<RestApiResponse | LeadRejectionResponse> {
    const result = await this.service.createLead(
      payload,
      false,
      this.getActor(),
    );

    if (!result.result) {
      return {
        success: false,
        message: "Lead rejected",
        error: result.error,
      };
    }

    const lead = result.data!;
    const isRejected = lead.rejected ?? false;

    if (isRejected) {
      return {
        result: "failed",
        lead_id: lead.id,
        msg: "Lead Rejected",
        errors:
          lead.rejection_errors ??
          (lead.rejection_reason ? [lead.rejection_reason] : []),
      };
    }

    const submissionResponse: LeadSubmissionResponse = {
      id: lead.id,
      test: lead.test,
      duplicate: lead.duplicate ?? false,
      rejected: false,
      rejection_reason: null,
      message: LEAD_ACCEPTED_MESSAGE,
    };

    return {
      success: true,
      message: "Lead accepted",
      data: submissionResponse,
    };
  }

  @POST("/test")
  @produces("application/json")
  async createTestLead(
    @body payload: CreateLeadRequest,
  ): Promise<RestApiResponse | LeadRejectionResponse> {
    const result = await this.service.createLead(
      payload,
      true,
      this.getActor(),
    );

    if (!result.result) {
      return {
        success: false,
        message: "Test lead rejected",
        error: result.error,
      };
    }

    const lead = result.data!;
    const isRejected = lead.rejected ?? false;

    if (isRejected) {
      return {
        result: "failed",
        lead_id: lead.id,
        msg: "Lead Rejected",
        errors:
          lead.rejection_errors ??
          (lead.rejection_reason ? [lead.rejection_reason] : []),
      };
    }

    const submissionResponse: LeadSubmissionResponse = {
      id: lead.id,
      test: lead.test,
      duplicate: lead.duplicate ?? false,
      rejected: false,
      rejection_reason: null,
      message: LEAD_ACCEPTED_TEST_MESSAGE,
    };

    return {
      success: true,
      message: "Test lead accepted",
      data: submissionResponse,
    };
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
