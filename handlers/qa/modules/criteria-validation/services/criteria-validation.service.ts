import { inject, injectable } from "inversify";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { Logger } from "@shared/services/logger.util";
import { CriteriaValidationConstants } from "../constants/criteria-validation.constants";
import { CriteriaValidationResponse } from "../interfaces/ICriteriaValidation.interface";
import { CriteriaValidationEvent } from "../types/criteria-validation-event.types";
import { ServiceResult } from "../types/common.types";

interface BaseCriteriaField {
  id: string;
  field_name: string;
  field_label: string;
  required: boolean;
  state_mapping?: "abbr_to_name" | "name_to_abbr";
}

interface CampaignRecord {
  id: string;
  is_deleted?: boolean;
  base_criteria?: BaseCriteriaField[];
}

@injectable()
export class CriteriaValidationService {
  constructor(
    @inject("DynamoDBUtil") private readonly dynamoDBUtil: DynamoDBUtil,
    @inject("Logger") private readonly logger: Logger,
    @inject("CriteriaValidationConstants")
    private readonly constants: CriteriaValidationConstants,
  ) {}

  async execute(
    event: CriteriaValidationEvent,
  ): Promise<ServiceResult<CriteriaValidationResponse>> {
    try {
      const campaign = await this.dynamoDBUtil.get<CampaignRecord>({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Key: { id: event.campaign_id },
      });

      if (!campaign || campaign.is_deleted) {
        this.logger.warn("CriteriaValidation: campaign not found", {
          campaignId: event.campaign_id,
        });
        // Allow the lead to continue — campaign lookup failure is not a criteria problem
        return { result: true, data: { valid: true } };
      }

      const requiredFields = (campaign.base_criteria ?? []).filter(
        (f) => f.required,
      );

      if (requiredFields.length === 0) {
        return { result: true, data: { valid: true } };
      }

      const payload = event.payload ?? {};
      const missingFields: string[] = [];

      for (const field of requiredFields) {
        const value = payload[field.field_name];
        const isMissing =
          value === undefined ||
          value === null ||
          (typeof value === "string" && value.trim() === "");

        if (isMissing) {
          missingFields.push(field.field_label);
        }
      }

      if (missingFields.length === 0) {
        return { result: true, data: { valid: true } };
      }

      const rejectionReason =
        missingFields.length === 1
          ? `Missing required field: ${missingFields[0]}`
          : `Missing required fields: ${missingFields.join(", ")}`;

      this.logger.info("CriteriaValidation: required fields missing", {
        campaignId: event.campaign_id,
        missingFields,
      });

      return {
        result: true,
        data: {
          valid: false,
          missing_fields: missingFields,
          rejection_reason: rejectionReason,
        },
      };
    } catch (error: any) {
      this.logger.error("CriteriaValidation: execution failed", error);
      return {
        result: false,
        error: error.message || "Criteria validation execution failed",
      };
    }
  }
}
