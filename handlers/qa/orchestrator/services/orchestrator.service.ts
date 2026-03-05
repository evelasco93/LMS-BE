import { inject, injectable } from "inversify";
import { LambdaInvokeUtil } from "@shared/services/lambda-invoke.util";
import { Logger } from "@shared/services/logger.util";
import { OrchestratorConstants } from "../constants/orchestrator.constants";
import {
  DuplicateCheckResult,
  OrchestratorResponse,
  TrustedFormResult,
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
    // ── 1. Duplicate check ────────────────────────────────────────────────────
    const duplicatePlugin = event.plugins?.duplicate_check;
    const duplicateEnabled = duplicatePlugin?.enabled ?? true;

    let duplicateResult: Partial<DuplicateCheckResult> = {
      duplicate: false,
      duplicate_matches: { lead_ids: [] },
    };

    if (duplicateEnabled) {
      if (!this.constants.DUPLICATE_CHECK_LAMBDA_NAME) {
        this.logger.warn("DUPLICATE_CHECK_LAMBDA_NAME is not configured");
      } else {
        try {
          duplicateResult = await this.lambdaInvokeUtil.invokeJson<
            Partial<DuplicateCheckResult>
          >({
            functionName: this.constants.DUPLICATE_CHECK_LAMBDA_NAME,
            payload: {
              campaign_id: event.campaign_id,
              payload: event.payload ?? {},
              criteria: duplicatePlugin?.criteria ?? ["phone", "email"],
            },
          });
        } catch (error) {
          this.logger.error(
            "QA orchestrator failed to run duplicate_check plugin",
            { error, campaignId: event.campaign_id },
          );
        }
      }
    }

    const matchedLeadIds = Array.isArray(
      duplicateResult?.duplicate_matches?.lead_ids,
    )
      ? duplicateResult.duplicate_matches!.lead_ids.filter(
          (id): id is string => typeof id === "string",
        )
      : [];

    const duplicate =
      matchedLeadIds.length > 0 || duplicateResult?.duplicate === true;

    // ── 2. TrustedForm ────────────────────────────────────────────────────────
    const trustedFormPlugin = event.plugins?.trusted_form;
    const trustedFormEnabled = trustedFormPlugin?.enabled ?? false;

    let trustedFormResult: TrustedFormResult | undefined;

    if (trustedFormEnabled && event.cert_id && trustedFormPlugin?.credentials_id) {
      if (!this.constants.TRUSTED_FORM_LAMBDA_NAME) {
        this.logger.warn("TRUSTED_FORM_LAMBDA_NAME is not configured");
      } else {
        try {
          trustedFormResult = await this.lambdaInvokeUtil.invokeJson<
            TrustedFormResult
          >({
            functionName: this.constants.TRUSTED_FORM_LAMBDA_NAME,
            payload: {
              campaign_id: event.campaign_id,
              credentials_id: trustedFormPlugin.credentials_id,
              cert_id: event.cert_id,
              phone: event.phone,
            },
          });
        } catch (error) {
          this.logger.error(
            "QA orchestrator failed to run trusted_form plugin",
            { error, campaignId: event.campaign_id },
          );
          trustedFormResult = {
            success: false,
            cert_id: event.cert_id ?? "",
            error: "TrustedForm lambda invocation failed",
          };
        }
      }
    }

    // ── 3. Assemble response ──────────────────────────────────────────────────
    const response: OrchestratorResponse = {
      duplicate,
      duplicate_matches: {
        lead_ids: matchedLeadIds,
      },
      ...(trustedFormResult ? { trusted_form_result: trustedFormResult } : {}),
      plugin_results: {
        duplicate_check: {
          enabled: duplicateEnabled,
          duplicate,
          matched_lead_ids: matchedLeadIds,
        },
        ...(trustedFormEnabled
          ? {
              trusted_form: {
                enabled: true,
                success: trustedFormResult?.success,
                error: trustedFormResult?.error,
              },
            }
          : {}),
      },
    };

    return { result: true, data: response };
  }
}
