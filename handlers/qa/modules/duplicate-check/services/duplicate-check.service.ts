import { inject, injectable } from "inversify";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { Logger } from "@shared/services/logger.util";
import { DuplicateCheckConstants } from "../constants/duplicate-check.constants";
import {
  DuplicateCheckResponse,
  LeadRecord,
} from "../interfaces/IDuplicateCheck.interface";
import { DuplicateCheckEvent } from "../types/duplicate-check-event.types";
import { ServiceResult } from "../types/common.types";

const ALLOWED_CRITERIA = ["phone", "email"];
const DEFAULT_CRITERIA = ["phone", "email"];

@injectable()
export class DuplicateCheckService {
  constructor(
    @inject("DynamoDBUtil") private readonly dynamoDBUtil: DynamoDBUtil,
    @inject("Logger") private readonly logger: Logger,
    @inject("DuplicateCheckConstants")
    private readonly constants: DuplicateCheckConstants,
  ) {}

  async execute(
    event: DuplicateCheckEvent,
  ): Promise<ServiceResult<DuplicateCheckResponse>> {
    try {
      const criteria = Array.from(
        new Set(
          (Array.isArray(event.criteria)
            ? event.criteria
            : DEFAULT_CRITERIA
          ).filter((field) => ALLOWED_CRITERIA.includes(field)),
        ),
      );

      if (criteria.length === 0) {
        return { result: true, data: this.defaultResponse() };
      }

      const incomingPayload = event.payload ?? {};
      const incomingValues = Object.fromEntries(
        criteria.map((field) => [
          field,
          this.normalizeValue(field, incomingPayload[field]),
        ]),
      );

      const hasComparableValue = criteria.some(
        (field) => incomingValues[field],
      );
      if (!hasComparableValue) {
        return { result: true, data: this.defaultResponse() };
      }

      const leads = await this.dynamoDBUtil.scanAll<LeadRecord>({
        TableName: this.constants.LEADS_TABLE_NAME,
        FilterExpression: "#campaign_id = :campaign_id",
        ExpressionAttributeNames: {
          "#campaign_id": "campaign_id",
        },
        ExpressionAttributeValues: {
          ":campaign_id": event.campaign_id,
        },
      });

      const matchingLeadIds = leads
        .filter((lead) => {
          const leadPayload = lead.payload ?? {};

          return criteria.every((field) => {
            const incoming = incomingValues[field];
            if (!incoming) {
              return false;
            }

            const existing = this.normalizeValue(field, leadPayload[field]);
            return Boolean(existing) && existing === incoming;
          });
        })
        .map((lead) => lead.id);

      return {
        result: true,
        data: {
          duplicate: matchingLeadIds.length > 0,
          duplicate_matches: {
            lead_ids: matchingLeadIds,
          },
        },
      };
    } catch (error: any) {
      this.logger.error("Duplicate check failed", error);
      return {
        result: false,
        error: error.message || "Duplicate check failed",
      };
    }
  }

  private defaultResponse(): DuplicateCheckResponse {
    return {
      duplicate: false,
      duplicate_matches: {
        lead_ids: [],
      },
    };
  }

  private normalizeValue(field: string, value: unknown): string | null {
    if (field === "email") {
      return this.normalizeEmail(value);
    }

    if (field === "phone") {
      return this.normalizePhone(value);
    }

    return null;
  }

  private normalizeEmail(value: unknown): string | null {
    if (typeof value !== "string") {
      return null;
    }

    const normalized = value.trim().toLowerCase();
    return normalized.length > 0 ? normalized : null;
  }

  private normalizePhone(value: unknown): string | null {
    if (typeof value !== "string" && typeof value !== "number") {
      return null;
    }

    const normalized = String(value).replace(/\D/g, "");
    return normalized.length > 0 ? normalized : null;
  }
}
