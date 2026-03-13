import { injectable, inject } from "inversify";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { Logger } from "@shared/services/logger.util";
import { AuditWriterService } from "@shared/services";
import { AuditChange } from "@shared/interfaces";
import { IdGenerator } from "@shared/generators/id.generator";
import { AffiliateConstants } from "../constants/affiliate.constants";
import { IAffiliate } from "../interfaces/IAffiliate.interface";
import { AffiliateStatus } from "../enums/affiliate-status.enum";
import { CampaignParticipantStatus } from "../../campaigns/enums/campaign-participant-status.enum";
import {
  CreateAffiliateRequest,
  UpdateAffiliateRequest,
  ListAffiliatesQuery,
} from "../types/affiliate-request.types";
import { ServiceResult } from "../types/common.types";
import { validateAllowedFields } from "@shared/utils/payload-validation.util";
import { RequestActor } from "@shared/utils/request-audit.util";

@injectable()
export class AffiliateService {
  constructor(
    @inject("DynamoDBUtil") private readonly dynamoDBUtil: DynamoDBUtil,
    @inject("Logger") private readonly logger: Logger,
    @inject("AffiliateConstants")
    private readonly constants: AffiliateConstants,
    @inject("AuditWriterService")
    private readonly auditWriterService: AuditWriterService,
  ) {}

  async createAffiliate(
    request: CreateAffiliateRequest,
    actor?: RequestActor,
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
        created_by: actor,
        updated_by: actor,
        is_deleted: false,
        active: true,
      };

      await this.dynamoDBUtil.put({
        TableName: this.constants.AFFILIATES_TABLE_NAME,
        Item: affiliate,
      });

      await this.auditWriterService.writeAuditEvent({
        entity_id: affiliate.id,
        entity_type: "affiliate",
        action: "created",
        changes: [],
        actor,
        changed_at: now,
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
      const {
        status,
        limit = 20,
        lastEvaluatedKey,
        includeDeleted = false,
      } = query;

      if (status) {
        const expressionAttributeValues: Record<string, unknown> = {
          ":status": status,
          ...(includeDeleted ? {} : { ":is_deleted_false": false }),
        };

        const queryResult = await this.dynamoDBUtil.query<IAffiliate>({
          TableName: this.constants.AFFILIATES_TABLE_NAME,
          IndexName: "status-index",
          KeyConditionExpression: "#status = :status",
          ...(includeDeleted
            ? {}
            : {
                FilterExpression:
                  "attribute_not_exists(is_deleted) OR is_deleted = :is_deleted_false",
              }),
          ExpressionAttributeNames: {
            "#status": "status",
          },
          ExpressionAttributeValues: expressionAttributeValues,
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
        ...(includeDeleted
          ? {}
          : {
              FilterExpression:
                "attribute_not_exists(is_deleted) OR is_deleted = :is_deleted_false",
              ExpressionAttributeValues: {
                ":is_deleted_false": false,
              },
            }),
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
    actor?: RequestActor,
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

      const now = new Date().toISOString();
      const current = existing.data;
      const tracked: (keyof UpdateAffiliateRequest)[] = [
        "name",
        "email",
        "phone",
        "company",
        "affiliate_code",
        "status",
      ];
      const changes: AuditChange[] = [];
      for (const key of tracked) {
        const prev = current[key as keyof IAffiliate];
        const next = request[key as keyof UpdateAffiliateRequest];
        if (
          next !== undefined &&
          JSON.stringify(prev ?? null) !== JSON.stringify(next ?? null)
        ) {
          changes.push({ field: key, from: prev ?? null, to: next });
        }
      }

      const updated: IAffiliate = {
        ...current,
        ...(request.name !== undefined ? { name: request.name } : {}),
        ...(request.email !== undefined ? { email: request.email } : {}),
        ...(request.phone !== undefined ? { phone: request.phone } : {}),
        ...(request.company !== undefined ? { company: request.company } : {}),
        ...(request.affiliate_code !== undefined
          ? { affiliate_code: request.affiliate_code }
          : {}),
        ...(request.status !== undefined ? { status: request.status } : {}),
        updated_at: now,
        updated_by: actor,
      };

      await this.dynamoDBUtil.put({
        TableName: this.constants.AFFILIATES_TABLE_NAME,
        Item: updated,
      });

      await this.auditWriterService.writeAuditEvent({
        entity_id: id,
        entity_type: "affiliate",
        action: "updated",
        changes,
        actor,
        changed_at: now,
      });

      this.logger.info("Affiliate updated successfully", { affiliateId: id });
      return {
        result: true,
        data: updated,
      };
    } catch (error: any) {
      this.logger.error("Failed to update affiliate", error);
      return {
        result: false,
        error: error.message || "Failed to update affiliate",
      };
    }
  }

  async deleteAffiliate(
    id: string,
    options: { permanent?: boolean } = {},
    actor?: RequestActor,
  ): Promise<ServiceResult<void>> {
    try {
      const existing = await this.getAffiliate(id);
      if (!existing.result || !existing.data) {
        return {
          result: false,
          error: `Affiliate with id ${id} not found`,
        };
      }

      const linkedCampaigns = await this.findCampaignsWithAffiliate(id);
      const activeCampaignLinks = linkedCampaigns.filter((campaign) =>
        (campaign.affiliates ?? []).some(
          (a) =>
            a.affiliate_id === id &&
            a.status !== CampaignParticipantStatus.DISABLED,
        ),
      );

      const hasCampaignLeads = await this.anyCampaignHasLeads(
        linkedCampaigns.map((c) => c.id),
      );

      if (options.permanent) {
        if (linkedCampaigns.length > 0) {
          return {
            result: false,
            error:
              "Cannot hard delete affiliate while linked to campaigns; remove or disable in campaigns first",
          };
        }

        if (hasCampaignLeads) {
          return {
            result: false,
            error: "Cannot hard delete affiliate that has campaign leads",
          };
        }
      } else {
        if (activeCampaignLinks.length > 0) {
          return {
            result: false,
            error:
              "Disable the affiliate in all campaigns before soft deleting the affiliate",
          };
        }
      }

      if (options.permanent) {
        await this.dynamoDBUtil.delete({
          TableName: this.constants.AFFILIATES_TABLE_NAME,
          Key: { id },
        });

        const now = new Date().toISOString();
        await this.auditWriterService.writeAuditEvent({
          entity_id: id,
          entity_type: "affiliate",
          action: "deleted",
          changes: [],
          actor,
          changed_at: now,
        });
        this.logger.info("Affiliate permanently deleted", {
          affiliateId: id,
          actor,
        });
      } else {
        const now = new Date().toISOString();
        const expression = this.dynamoDBUtil.buildUpdateExpression({
          is_deleted: true,
          active: false,
          status: AffiliateStatus.INACTIVE,
          deleted_at: now,
          deleted_by: actor,
          updated_at: now,
          updated_by: actor,
        });

        await this.dynamoDBUtil.update({
          TableName: this.constants.AFFILIATES_TABLE_NAME,
          Key: { id },
          ...expression,
        });

        await this.auditWriterService.writeAuditEvent({
          entity_id: id,
          entity_type: "affiliate",
          action: "soft_deleted",
          changes: [],
          actor,
          changed_at: now,
        });
        this.logger.info("Affiliate soft-deleted", { affiliateId: id, actor });
      }

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

  private async findCampaignsWithAffiliate(affiliateId: string): Promise<
    {
      id: string;
      affiliates?: {
        affiliate_id: string;
        status?: CampaignParticipantStatus;
      }[];
    }[]
  > {
    const scanResult = await this.dynamoDBUtil.scan<{
      id: string;
      affiliates?: {
        affiliate_id: string;
        status?: CampaignParticipantStatus;
      }[];
    }>({
      TableName: this.constants.CAMPAIGNS_TABLE_NAME,
    });

    return (scanResult.items ?? []).filter((campaign) =>
      (campaign.affiliates ?? []).some((a) => a.affiliate_id === affiliateId),
    );
  }

  private async campaignHasLeads(campaignId: string): Promise<boolean> {
    const scanResult = await this.dynamoDBUtil.scan<{ id: string } | any>({
      TableName: this.constants.LEADS_TABLE_NAME,
      Limit: 1,
      FilterExpression: "#campaign_id = :campaign_id",
      ExpressionAttributeNames: { "#campaign_id": "campaign_id" },
      ExpressionAttributeValues: { ":campaign_id": campaignId },
    });

    return (scanResult.items?.length ?? 0) > 0;
  }

  private async anyCampaignHasLeads(campaignIds: string[]): Promise<boolean> {
    for (const campaignId of campaignIds) {
      if (await this.campaignHasLeads(campaignId)) {
        return true;
      }
    }
    return false;
  }
}
