import { injectable, inject } from "inversify";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { Logger } from "@shared/services/logger.util";
import { IdGenerator } from "@shared/generators/id.generator";
import { ClientConstants } from "../constants/client.constants";
import { IClient } from "../interfaces/IClient.interface";
import { ClientStatus } from "../enums/client-status.enum";
import {
  CreateClientRequest,
  UpdateClientRequest,
  ListClientsQuery,
} from "../types/client-request.types";
import { ServiceResult } from "../types/common.types";
import { validateAllowedFields } from "@shared/utils/payload-validation.util";

@injectable()
export class ClientService {
  constructor(
    @inject("DynamoDBUtil") private readonly dynamoDBUtil: DynamoDBUtil,
    @inject("Logger") private readonly logger: Logger,
    @inject("ClientConstants") private readonly constants: ClientConstants,
  ) {}

  async createClient(
    request: CreateClientRequest,
  ): Promise<ServiceResult<IClient>> {
    try {
      const { ok, extras, sanitized } = validateAllowedFields(
        request as Record<string, unknown>,
        ["name", "email", "phone", "client_code"],
      );
      if (!ok) {
        return {
          result: false,
          error: `Invalid fields: ${extras.join(", ")}`,
        };
      }

      const sanitizedRequest: CreateClientRequest =
        sanitized as CreateClientRequest;

      const existing = await this.getClientByEmail(request.email);
      if (existing.result && existing.data) {
        return {
          result: false,
          error: `Client with email ${request.email} already exists`,
        };
      }

      const now = new Date().toISOString();
      const client: IClient = {
        id: IdGenerator.generateClientId(),
        ...sanitizedRequest,
        status: ClientStatus.ACTIVE,
        client_code: request.client_code,
        created_at: now,
        updated_at: now,
      };

      await this.dynamoDBUtil.put({
        TableName: this.constants.CLIENTS_TABLE_NAME,
        Item: client,
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

  async getClient(id: string): Promise<ServiceResult<IClient>> {
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
      const { status, limit = 20, lastEvaluatedKey } = query;

      if (status) {
        const queryResult = await this.dynamoDBUtil.query<IClient>({
          TableName: this.constants.CLIENTS_TABLE_NAME,
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

      const scanResult = await this.dynamoDBUtil.scan<IClient>({
        TableName: this.constants.CLIENTS_TABLE_NAME,
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
  ): Promise<ServiceResult<IClient>> {
    try {
      const existing = await this.getClient(id);
      if (!existing.result || !existing.data) {
        return {
          result: false,
          error: `Client with id ${id} not found`,
        };
      }

      if (request.email && request.email !== existing.data.email) {
        const emailExists = await this.getClientByEmail(request.email);
        if (emailExists.result && emailExists.data) {
          return {
            result: false,
            error: `Client with email ${request.email} already exists`,
          };
        }
      }

      const updates = {
        ...request,
        updated_at: new Date().toISOString(),
      };

      const expression = this.dynamoDBUtil.buildUpdateExpression(updates);

      const updateResult = await this.dynamoDBUtil.update({
        TableName: this.constants.CLIENTS_TABLE_NAME,
        Key: { id },
        ...expression,
        ReturnValues: "ALL_NEW",
      });

      this.logger.info("Client updated successfully", { clientId: id });
      return {
        result: true,
        data: updateResult as IClient,
      };
    } catch (error: any) {
      this.logger.error("Failed to update client", error);
      return {
        result: false,
        error: error.message || "Failed to update client",
      };
    }
  }

  async deleteClient(id: string): Promise<ServiceResult<void>> {
    try {
      const existing = await this.getClient(id);
      if (!existing.result || !existing.data) {
        return {
          result: false,
          error: `Client with id ${id} not found`,
        };
      }

      await this.dynamoDBUtil.delete({
        TableName: this.constants.CLIENTS_TABLE_NAME,
        Key: { id },
      });

      this.logger.info("Client deleted successfully", { clientId: id });
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
}
