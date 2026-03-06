import "reflect-metadata";
import { injectable, inject } from "inversify";
import { apiController, POST, body, produces, Controller } from "ts-lambda-api";
import { OrchestratorService } from "../services/orchestrator.service";
import { Logger } from "@shared/services/logger.util";

interface RestApiResponse {
  success: boolean;
  message?: string;
  data?: unknown;
  error?: string;
}

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
      return { success: false, error: "cert_id is required" };
    }

    try {
      const result = await this.orchestratorService.validateTrustedFormCert(
        payload.cert_id,
      );

      return {
        success: result.outcome === "success",
        message:
          result.outcome === "success"
            ? "Certificate is valid"
            : "Certificate validation failed",
        data: result,
      };
    } catch (error: any) {
      this.logger.error("Failed to validate TrustedForm cert", error);
      return {
        success: false,
        error: error?.message || "TrustedForm validation failed",
      };
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
      return {
        success: false,
        error: "At least one of phone, email, or ip_address is required",
      };
    }

    try {
      const credentialsId =
        await this.orchestratorService.resolveDefaultCredentialsId("ipqs");

      if (!credentialsId) {
        return {
          success: false,
          error:
            "No active IPQS credential found in tenant settings. Configure a plugin setting first.",
        };
      }

      const result = await this.orchestratorService.runIpqsCheck({
        credentials_id: credentialsId,
        phone: payload.phone,
        email: payload.email,
        ip_address: payload.ip_address,
      });

      return {
        success: result.success,
        data: result,
      };
    } catch (error: any) {
      this.logger.error("Failed to run IPQS check", error);
      return {
        success: false,
        error: error?.message || "IPQS check failed",
      };
    }
  }
}
