import { injectable, inject } from "inversify";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { Logger } from "@shared/services/logger.util";
import { IdGenerator } from "@shared/generators/id.generator";
import { AffiliateConstants } from "../constants/affiliate.constants";
import { IAffiliate } from "../interfaces/IAffiliate.interface";
import { AffiliateStatus } from "../enums/affiliate-status.enum";
import {
  CreateAffiliateRequest,
  UpdateAffiliateRequest,
  ListAffiliatesQuery,
} from "../types/affiliate-request.types";
import { ServiceResult } from "../types/common.types";
import { validateAllowedFields } from "@shared/utils/payload-validation.util";

@injectable()
export class AffiliateService {
  constructor(
    @inject("DynamoDBUtil") private readonly dynamoDBUtil: DynamoDBUtil,
    @inject("Logger") private readonly logger: Logger,
    @inject("AffiliateConstants")
    private readonly constants: AffiliateConstants,
  ) {}

  async createAffiliate(
    request: CreateAffiliateRequest,
  ): Promise<ServiceResult<IAffiliate>> {
    try {
      const { ok, extras, sanitized } = validateAllowedFields(
        request as Record<string, unknown>,
        ["name", "email", "phone", "company", "affiliate_code"],
      );
      if (!ok) {
        return {
          result: false,
          error: `Invalid fields: ${extras.join(", ")}`,
        };
      }

      const sanitizedRequest: CreateAffiliateRequest =
        sanitized as CreateAffiliateRequest;

      const existing = await this.getAffiliateByEmail(request.email);
      if (existing.result && existing.data) {
        return {
          result: false,
          error: `Affiliate with email ${request.email} already exists`,
        };
      }

      const now = new Date().toISOString();
      const affiliate: IAffiliate = {
        id: IdGenerator.generateAffiliateId(),
        ...sanitizedRequest,
        status: AffiliateStatus.ACTIVE,
        affiliate_code: request.affiliate_code,
        created_at: now,
        updated_at: now,
      };

      await this.dynamoDBUtil.put({
        TableName: this.constants.AFFILIATES_TABLE_NAME,
        Item: affiliate,
      });

      this.logger.info("Affiliate created successfully", {
        affiliateId: affiliate.id,
      });
      return {
        result: true,
        data: affiliate,
      };
    } catch (error: any) {
      this.logger.error("Failed to create affiliate", error);
      return {
        result: false,
        error: error.message || "Failed to create affiliate",
      };
    }
  }

  async getAffiliate(id: string): Promise<ServiceResult<IAffiliate>> {
    try {
      const affiliate = await this.dynamoDBUtil.get<IAffiliate>({
        TableName: this.constants.AFFILIATES_TABLE_NAME,
        Key: { id },
      });

      if (!affiliate) {
        return {
          result: false,
          error: `Affiliate with id ${id} not found`,
        };
      }

      return {
        result: true,
        data: affiliate,
      };
    } catch (error: any) {
      this.logger.error("Failed to get affiliate", error);
      return {
        result: false,
        error: error.message || "Failed to get affiliate",
      };
    }
  }

  async getAffiliateByEmail(email: string): Promise<ServiceResult<IAffiliate>> {
    try {
      const queryResult = await this.dynamoDBUtil.query<IAffiliate>({
        TableName: this.constants.AFFILIATES_TABLE_NAME,
        IndexName: "email-index",
        KeyConditionExpression: "email = :email",
        ExpressionAttributeValues: {
          ":email": email,
        },
        Limit: 1,
      });

      const affiliate = queryResult.items[0] || null;
      return {
        result: !!affiliate,
        data: affiliate || undefined,
      };
    } catch (error: any) {
      this.logger.error("Failed to get affiliate by email", error);
      return {
        result: false,
        error: error.message || "Failed to get affiliate by email",
      };
    }
  }

  async listAffiliates(query: ListAffiliatesQuery = {}): Promise<
    ServiceResult<{
      items: IAffiliate[];
      count: number;
      lastEvaluatedKey?: string;
    }>
  > {
    try {
      const { status, limit = 20, lastEvaluatedKey } = query;

      if (status) {
        const queryResult = await this.dynamoDBUtil.query<IAffiliate>({
          TableName: this.constants.AFFILIATES_TABLE_NAME,
          IndexName: "status-index",
          KeyConditionExpression: "#status = :status",
          ExpressionAttributeNames: {
            "#status": "status",
          },
          ExpressionAttributeValues: {
            ":status": status,
          },
          Limit: limit,
          ExclusiveStartKey: lastEvaluatedKey
            ? JSON.parse(Buffer.from(lastEvaluatedKey, "base64").toString())
            : undefined,
        });

        return {
          result: true,
          data: {
            items: queryResult.items,
            count: queryResult.items.length,
            lastEvaluatedKey: queryResult.lastEvaluatedKey
              ? Buffer.from(
                  JSON.stringify(queryResult.lastEvaluatedKey),
                ).toString("base64")
              : undefined,
          },
        };
      }

      const scanResult = await this.dynamoDBUtil.scan<IAffiliate>({
        TableName: this.constants.AFFILIATES_TABLE_NAME,
        Limit: limit,
        ExclusiveStartKey: lastEvaluatedKey
          ? JSON.parse(Buffer.from(lastEvaluatedKey, "base64").toString())
          : undefined,
      });

      return {
        result: true,
        data: {
          items: scanResult.items,
          count: scanResult.items.length,
          lastEvaluatedKey: scanResult.lastEvaluatedKey
            ? Buffer.from(JSON.stringify(scanResult.lastEvaluatedKey)).toString(
                "base64",
              )
            : undefined,
        },
      };
    } catch (error: any) {
      this.logger.error("Failed to list affiliates", error);
      return {
        result: false,
        error: error.message || "Failed to list affiliates",
      };
    }
  }

  async updateAffiliate(
    id: string,
    request: UpdateAffiliateRequest,
  ): Promise<ServiceResult<IAffiliate>> {
    try {
      const existing = await this.getAffiliate(id);
      if (!existing.result || !existing.data) {
        return {
          result: false,
          error: `Affiliate with id ${id} not found`,
        };
      }

      if (request.email && request.email !== existing.data.email) {
        const emailExists = await this.getAffiliateByEmail(request.email);
        if (emailExists.result && emailExists.data) {
          return {
            result: false,
            error: `Affiliate with email ${request.email} already exists`,
          };
        }
      }

      const updates = {
        ...request,
        updated_at: new Date().toISOString(),
      };

      const expression = this.dynamoDBUtil.buildUpdateExpression(updates);

      const updateResult = await this.dynamoDBUtil.update({
        TableName: this.constants.AFFILIATES_TABLE_NAME,
        Key: { id },
        ...expression,
        ReturnValues: "ALL_NEW",
      });

      this.logger.info("Affiliate updated successfully", { affiliateId: id });
      return {
        result: true,
        data: updateResult as IAffiliate,
      };
    } catch (error: any) {
      this.logger.error("Failed to update affiliate", error);
      return {
        result: false,
        error: error.message || "Failed to update affiliate",
      };
    }
  }

  async deleteAffiliate(id: string): Promise<ServiceResult<void>> {
    try {
      const existing = await this.getAffiliate(id);
      if (!existing.result || !existing.data) {
        return {
          result: false,
          error: `Affiliate with id ${id} not found`,
        };
      }

      await this.dynamoDBUtil.delete({
        TableName: this.constants.AFFILIATES_TABLE_NAME,
        Key: { id },
      });

      this.logger.info("Affiliate deleted successfully", { affiliateId: id });
      return {
        result: true,
      };
    } catch (error: any) {
      this.logger.error("Failed to delete affiliate", error);
      return {
        result: false,
        error: error.message || "Failed to delete affiliate",
      };
    }
  }
}
