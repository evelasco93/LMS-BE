import "reflect-metadata";
import { injectable, inject } from "inversify";
import { apiController, POST, body, produces, Controller } from "ts-lambda-api";
import { OrchestratorService } from "../services/orchestrator.service";
import { Logger } from "@shared/services/logger.util";
import { RestApiResponse } from "../types/common.types";
import {
  extractCorrelationIdFromHeaders,
  mapServiceErrorToHttpStatus,
  withCorrelationId,
} from "@shared/utils";

@injectable()
@apiController("/qa")
export class OrchestratorController extends Controller {
  constructor(
    @inject("OrchestratorService")
    private readonly orchestratorService: OrchestratorService,
    @inject("Logger") private readonly logger: Logger,
  ) {
    super();
  }

  private getCorrelationId(): string | undefined {
    return extractCorrelationIdFromHeaders(
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
   * POST /qa/trusted-form/validate
   *
   * Proxies a TrustedForm certificate validation request to
   * https://cert.trustedform.com/{cert_id}/validate — masking the upstream URL
   * from callers. Credentials are always resolved automatically from the global
   * plugin-setting for "trusted_form" configured in the tenant settings.
   *
   * Body: { cert_id: string }
   */
  @POST("/trusted-form/validate")
  @produces("application/json")
  async validateTrustedFormCert(
    @body payload: { cert_id: string },
  ): Promise<RestApiResponse> {
    if (!payload?.cert_id) {
      return this.fail("Invalid request", "cert_id is required", 400);
    }

    try {
      const result = await this.orchestratorService.validateTrustedFormCert(
        payload.cert_id,
      );

      return this.withCorrelation({
        success: result.outcome === "success",
        message:
          result.outcome === "success"
            ? "Certificate is valid"
            : "Certificate validation failed",
        data: result,
      });
    } catch (error: any) {
      const correlation_id = this.getCorrelationId();
      this.logger.error("Failed to validate TrustedForm cert", {
        correlation_id,
        error,
      });
      return this.fail(
        "Failed to validate TrustedForm cert",
        error?.message || "TrustedForm validation failed",
        500,
      );
    }
  }

  /**
   * POST /qa/ipqs/check
   *
   * Proxy endpoint for running an IPQS (IPQualityScore) check directly,
   * without going through a full lead submission. Credentials are always
   * resolved automatically from the global plugin-setting for "ipqs"
   * configured in the tenant settings.
   *
   * Body: { phone?: string; email?: string; ip_address?: string }
   */
  @POST("/ipqs/check")
  @produces("application/json")
  async checkIpqs(
    @body payload: { phone?: string; email?: string; ip_address?: string },
  ): Promise<RestApiResponse> {
    if (!payload?.phone && !payload?.email && !payload?.ip_address) {
      return this.fail(
        "Invalid request",
        "At least one of phone, email, or ip_address is required",
        400,
      );
    }

    try {
      const credentialsId =
        await this.orchestratorService.resolveDefaultCredentialsId("ipqs");

      if (!credentialsId) {
        return this.fail(
          "Missing IPQS credentials",
          "No active IPQS credential found in tenant settings. Configure a plugin setting first.",
          404,
        );
      }

      const result = await this.orchestratorService.runIpqsCheck({
        credentials_id: credentialsId,
        phone: payload.phone,
        email: payload.email,
        ip_address: payload.ip_address,
      });

      return this.withCorrelation({
        success: result.success,
        message: result.success ? "IPQS check completed" : "IPQS check failed",
        data: result,
      });
    } catch (error: any) {
      const correlation_id = this.getCorrelationId();
      this.logger.error("Failed to run IPQS check", {
        correlation_id,
        error,
      });
      return this.fail(
        "Failed to run IPQS check",
        error?.message || "IPQS check failed",
        500,
      );
    }
  }
}
