import { injectable, inject } from "inversify";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { Logger } from "@shared/services/logger.util";
import { AuditWriterService } from "@shared/services";
import { AuditChange } from "@shared/interfaces";
import { IdGenerator } from "@shared/generators/id.generator";
import { ClientConstants } from "../constants/client.constants";
import { IClient } from "../interfaces/IClient.interface";
import { ClientStatus } from "../enums/client-status.enum";
import { CampaignParticipantStatus } from "../../campaigns/enums/campaign-participant-status.enum";
import {
  CreateClientRequest,
  UpdateClientRequest,
  ListClientsQuery,
} from "../types/client-request.types";
import { ServiceResult } from "../types/common.types";
import { validateAllowedFields } from "@shared/utils/payload-validation.util";
import { RequestActor } from "@shared/utils/request-audit.util";

@injectable()
export class ClientService {
  constructor(
    @inject("DynamoDBUtil") private readonly dynamoDBUtil: DynamoDBUtil,
    @inject("Logger") private readonly logger: Logger,
    @inject("ClientConstants") private readonly constants: ClientConstants,
    @inject("AuditWriterService")
    private readonly auditWriterService: AuditWriterService,
  ) {}

  async createClient(
    request: CreateClientRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<IClient>> {
    try {
      const { ok, extras, sanitized } = validateAllowedFields(
        request as Record<string, unknown>,
        ["name", "notes", "client_code"],
      );
      if (!ok) {
        return {
          result: false,
          error: `Invalid fields: ${extras.join(", ")}`,
        };
      }

      const sanitizedRequest: CreateClientRequest =
        sanitized as CreateClientRequest;

      const now = new Date().toISOString();
      const client: IClient = {
        id: IdGenerator.generateClientId(),
        ...sanitizedRequest,
        status: ClientStatus.ACTIVE,
        client_code: request.client_code,
        created_at: now,
        updated_at: now,
        created_by: actor,
        updated_by: actor,
        is_deleted: false,
        active: true,
      };

      await this.dynamoDBUtil.put({
        TableName: this.constants.CLIENTS_TABLE_NAME,
        Item: client,
      });

      await this.auditWriterService.writeAuditEvent({
        entity_id: client.id,
        entity_type: "client",
        action: "created",
        changes: [],
        actor,
        changed_at: now,
      });

      this.logger.info("Client created successfully", { clientId: client.id });
      return {
        result: true,
        data: client,
      };
    } catch (error: any) {
      this.logger.error("Failed to create client", error);
      return {
        result: false,
        error: error.message || "Failed to create client",
      };
    }
  }

  async getClient(
    id: string,
    options?: { includeCampaigns?: boolean },
  ): Promise<ServiceResult<IClient>> {
    try {
      const client = await this.dynamoDBUtil.get<IClient>({
        TableName: this.constants.CLIENTS_TABLE_NAME,
        Key: { id },
      });

      if (!client) {
        return {
          result: false,
          error: `Client with id ${id} not found`,
        };
      }

      if (options?.includeCampaigns) {
        client.campaigns = await this.enrichClientWithCampaigns(id);
      }

      return {
        result: true,
        data: client,
      };
    } catch (error: any) {
      this.logger.error("Failed to get client", error);
      return {
        result: false,
        error: error.message || "Failed to get client",
      };
    }
  }

  async getClientByEmail(email: string): Promise<ServiceResult<IClient>> {
    try {
      const queryResult = await this.dynamoDBUtil.query<IClient>({
        TableName: this.constants.CLIENTS_TABLE_NAME,
        IndexName: "email-index",
        KeyConditionExpression: "email = :email",
        ExpressionAttributeValues: {
          ":email": email,
        },
        Limit: 1,
      });

      const client = queryResult.items[0] || null;
      return {
        result: !!client,
        data: client || undefined,
      };
    } catch (error: any) {
      this.logger.error("Failed to get client by email", error);
      return {
        result: false,
        error: error.message || "Failed to get client by email",
      };
    }
  }

  async listClients(query: ListClientsQuery = {}): Promise<
    ServiceResult<{
      items: IClient[];
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
        includeCampaigns = false,
      } = query;

      if (status) {
        const expressionAttributeValues: Record<string, unknown> = {
          ":status": status,
          ...(includeDeleted ? {} : { ":is_deleted_false": false }),
        };

        const queryResult = await this.dynamoDBUtil.query<IClient>({
          TableName: this.constants.CLIENTS_TABLE_NAME,
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

        const statusItems = includeCampaigns
          ? await Promise.all(
              queryResult.items.map(async (c) => {
                c.campaigns = await this.enrichClientWithCampaigns(c.id);
                return c;
              }),
            )
          : queryResult.items;

        return {
          result: true,
          data: {
            items: statusItems,
            count: statusItems.length,
            lastEvaluatedKey: queryResult.lastEvaluatedKey
              ? Buffer.from(
                  JSON.stringify(queryResult.lastEvaluatedKey),
                ).toString("base64")
              : undefined,
          },
        };
      }

      const scanResult = await this.dynamoDBUtil.scan<IClient>({
        TableName: this.constants.CLIENTS_TABLE_NAME,
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

      const items = includeCampaigns
        ? await Promise.all(
            scanResult.items.map(async (c) => {
              c.campaigns = await this.enrichClientWithCampaigns(c.id);
              return c;
            }),
          )
        : scanResult.items;

      return {
        result: true,
        data: {
          items,
          count: items.length,
          lastEvaluatedKey: scanResult.lastEvaluatedKey
            ? Buffer.from(JSON.stringify(scanResult.lastEvaluatedKey)).toString(
                "base64",
              )
            : undefined,
        },
      };
    } catch (error: any) {
      this.logger.error("Failed to list clients", error);
      return {
        result: false,
        error: error.message || "Failed to list clients",
      };
    }
  }

  async updateClient(
    id: string,
    request: UpdateClientRequest,
    actor?: RequestActor,
  ): Promise<ServiceResult<IClient>> {
    try {
      const existing = await this.getClient(id);
      if (!existing.result || !existing.data) {
        return {
          result: false,
          error: `Client with id ${id} not found`,
        };
      }

      const now = new Date().toISOString();
      const current = existing.data;
      const tracked: (keyof UpdateClientRequest)[] = [
        "name",
        "notes",
        "client_code",
        "status",
      ];
      const changes: AuditChange[] = [];
      for (const key of tracked) {
        const prev = current[key as keyof IClient];
        const next = request[key as keyof UpdateClientRequest];
        if (
          next !== undefined &&
          JSON.stringify(prev ?? null) !== JSON.stringify(next ?? null)
        ) {
          changes.push({ field: key, from: prev ?? null, to: next });
        }
      }

      const updated: IClient = {
        ...current,
        ...(request.name !== undefined ? { name: request.name } : {}),
        ...(request.notes !== undefined ? { notes: request.notes } : {}),
        ...(request.client_code !== undefined
          ? { client_code: request.client_code }
          : {}),
        ...(request.status !== undefined ? { status: request.status } : {}),
        updated_at: now,
        updated_by: actor,
      };

      await this.dynamoDBUtil.put({
        TableName: this.constants.CLIENTS_TABLE_NAME,
        Item: updated,
      });

      await this.auditWriterService.writeAuditEvent({
        entity_id: id,
        entity_type: "client",
        action: "updated",
        changes,
        actor,
        changed_at: now,
      });

      this.logger.info("Client updated successfully", { clientId: id });
      return {
        result: true,
        data: updated,
      };
    } catch (error: any) {
      this.logger.error("Failed to update client", error);
      return {
        result: false,
        error: error.message || "Failed to update client",
      };
    }
  }

  async deleteClient(
    id: string,
    options: { permanent?: boolean } = {},
    actor?: RequestActor,
  ): Promise<ServiceResult<void>> {
    try {
      const existing = await this.getClient(id);
      if (!existing.result || !existing.data) {
        return {
          result: false,
          error: `Client with id ${id} not found`,
        };
      }

      const linkedCampaigns = await this.findCampaignsWithClient(id);
      const activeCampaignLinks = linkedCampaigns.filter((campaign) =>
        (campaign.clients ?? []).some(
          (c) =>
            c.client_id === id &&
            c.status !== CampaignParticipantStatus.DISABLED,
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
              "Cannot hard delete client while linked to campaigns; remove or disable in campaigns first",
          };
        }

        if (hasCampaignLeads) {
          return {
            result: false,
            error: "Cannot hard delete client that has campaign leads",
          };
        }
      } else {
        if (activeCampaignLinks.length > 0) {
          return {
            result: false,
            error:
              "Disable the client in all campaigns before soft deleting the client",
          };
        }
      }

      if (options.permanent) {
        await this.dynamoDBUtil.delete({
          TableName: this.constants.CLIENTS_TABLE_NAME,
          Key: { id },
        });

        const now = new Date().toISOString();
        await this.auditWriterService.writeAuditEvent({
          entity_id: id,
          entity_type: "client",
          action: "deleted",
          changes: [],
          actor,
          changed_at: now,
        });
        this.logger.info("Client permanently deleted", {
          clientId: id,
          actor,
        });
      } else {
        const now = new Date().toISOString();
        const expression = this.dynamoDBUtil.buildUpdateExpression({
          is_deleted: true,
          active: false,
          status: ClientStatus.INACTIVE,
          deleted_at: now,
          deleted_by: actor,
          updated_at: now,
          updated_by: actor,
        });

        await this.dynamoDBUtil.update({
          TableName: this.constants.CLIENTS_TABLE_NAME,
          Key: { id },
          ...expression,
        });

        await this.auditWriterService.writeAuditEvent({
          entity_id: id,
          entity_type: "client",
          action: "soft_deleted",
          changes: [],
          actor,
          changed_at: now,
        });
        this.logger.info("Client soft-deleted", { clientId: id, actor });
      }

      return {
        result: true,
      };
    } catch (error: any) {
      this.logger.error("Failed to delete client", error);
      return {
        result: false,
        error: error.message || "Failed to delete client",
      };
    }
  }

  private async findCampaignsWithClient(clientId: string): Promise<
    {
      id: string;
      name: string;
      clients?: { client_id: string; status?: CampaignParticipantStatus }[];
    }[]
  > {
    const scanResult = await this.dynamoDBUtil.scan<{
      id: string;
      name: string;
      clients?: { client_id: string; status?: CampaignParticipantStatus }[];
    }>({
      TableName: this.constants.CAMPAIGNS_TABLE_NAME,
    });

    return (scanResult.items ?? []).filter((campaign) =>
      (campaign.clients ?? []).some((c) => c.client_id === clientId),
    );
  }

  private async enrichClientWithCampaigns(
    clientId: string,
  ): Promise<
    { id: string; name: string; status: CampaignParticipantStatus }[]
  > {
    const campaigns = await this.findCampaignsWithClient(clientId);
    return campaigns.map((campaign) => {
      const link = (campaign.clients ?? []).find(
        (c) => c.client_id === clientId,
      );
      return {
        id: campaign.id,
        name: campaign.name,
        status: link?.status ?? CampaignParticipantStatus.DISABLED,
      };
    });
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
