import { inject, injectable } from "inversify";
import { LambdaInvokeUtil } from "@shared/services/lambda-invoke.util";
import { Logger } from "@shared/services/logger.util";
import { OrchestratorConstants } from "../constants/orchestrator.constants";
import {
  DuplicateCheckResult,
  OrchestratorResponse,
} from "../interfaces/IOrchestrator.interface";
import { OrchestratorEvent } from "../types/orchestrator-event.types";
import { ServiceResult } from "../types/common.types";

@injectable()
export class OrchestratorService {
  constructor(
    @inject("Logger") private readonly logger: Logger,
    @inject("LambdaInvokeUtil")
    private readonly lambdaInvokeUtil: LambdaInvokeUtil,
    @inject("OrchestratorConstants")
    private readonly constants: OrchestratorConstants,
  ) {}

  async execute(
    event: OrchestratorEvent,
  ): Promise<ServiceResult<OrchestratorResponse>> {
    const duplicatePlugin = event.plugins?.duplicate_check;
    const duplicateEnabled = duplicatePlugin?.enabled ?? true;

    if (!duplicateEnabled) {
      return { result: true, data: this.defaultResponse(false) };
    }

    if (!this.constants.DUPLICATE_CHECK_LAMBDA_NAME) {
      this.logger.warn("DUPLICATE_CHECK_LAMBDA_NAME is not configured");
      return { result: true, data: this.defaultResponse(true) };
    }

    try {
      const duplicateResult = await this.lambdaInvokeUtil.invokeJson<
        Partial<DuplicateCheckResult>
      >({
        functionName: this.constants.DUPLICATE_CHECK_LAMBDA_NAME,
        payload: {
          campaign_id: event.campaign_id,
          payload: event.payload ?? {},
          criteria: duplicatePlugin?.criteria ?? ["phone", "email"],
        },
      });

      const matchedLeadIds = Array.isArray(
        duplicateResult?.duplicate_matches?.lead_ids,
      )
        ? duplicateResult.duplicate_matches?.lead_ids.filter(
            (leadId): leadId is string => typeof leadId === "string",
          )
        : [];

      const duplicate =
        matchedLeadIds.length > 0 || duplicateResult?.duplicate === true;

      return {
        result: true,
        data: {
          duplicate,
          duplicate_matches: {
            lead_ids: matchedLeadIds,
          },
          plugin_results: {
            duplicate_check: {
              enabled: true,
              duplicate,
              matched_lead_ids: matchedLeadIds,
            },
          },
        },
      };
    } catch (error) {
      this.logger.error("QA orchestrator failed to run duplicate plugin", {
        error,
        campaignId: event.campaign_id,
      });

      return {
        result: true,
        data: this.defaultResponse(true),
      };
    }
  }

  private defaultResponse(enabled: boolean): OrchestratorResponse {
    return {
      duplicate: false,
      duplicate_matches: {
        lead_ids: [],
      },
      plugin_results: {
        duplicate_check: {
          enabled,
          duplicate: false,
          matched_lead_ids: [],
        },
      },
    };
  }
}
