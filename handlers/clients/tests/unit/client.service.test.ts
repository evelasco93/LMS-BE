import { describe, it, expect, beforeEach, vi } from "vitest";
import { ClientService } from "../../services/client.service";
import { CreateClientRequest } from "../../types/client-request.types";
import { ClientStatus } from "../../enums/client-status.enum";
import { CampaignParticipantStatus } from "../../../campaigns/enums/campaign-participant-status.enum";
import { getTestContainer, getMockDynamoDBUtil } from "../setup";
import { mockClient, mockExistingClient } from "../fixtures/client.fixtures";

describe("ClientService", () => {
  let clientService: ClientService;
  let mockDynamoDBUtil: any;

  beforeEach(() => {
    const container = getTestContainer();
    container.bind("ClientService").to(ClientService);
    clientService = container.get<ClientService>("ClientService");
    mockDynamoDBUtil = getMockDynamoDBUtil();
  });

  describe("createClient", () => {
    it("should create a new client successfully", async () => {
      const request: CreateClientRequest = {
        name: "Test Client",
        client_code: "CLCODE123",
      };

      mockDynamoDBUtil.put.mockResolvedValueOnce(undefined);

      const result = await clientService.createClient(request);

      expect(result.result).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.name).toBe(request.name);
      expect(result.data?.client_code).toBe(request.client_code);
      expect(result.data?.status).toBe(ClientStatus.ACTIVE);
      expect(result.data?.id).toMatch(/^CL[A-Z0-9]{8}$/);
      expect(mockDynamoDBUtil.put).toHaveBeenCalledTimes(1);
    });

    it("should return error for invalid payload fields", async () => {
      const request: CreateClientRequest = {
        name: "Test Client",
        notes: "Client notes",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any;

      const result = await clientService.createClient({
        ...request,
        extra: "invalid",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);

      expect(result.result).toBe(false);
      expect(result.error).toContain("Invalid fields");
      expect(mockDynamoDBUtil.put).not.toHaveBeenCalled();
    });

    it("rejects extra fields", async () => {
      const result = await clientService.createClient({
        name: "Bad Client",
        client_code: "CLBAD001",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        extra: "nope",
      } as any);

      expect(result.result).toBe(false);
      expect(result.error).toContain("Invalid fields");
      expect(mockDynamoDBUtil.put).not.toHaveBeenCalled();
    });
  });

  describe("getClient", () => {
    it("should retrieve a client by ID", async () => {
      mockDynamoDBUtil.get.mockResolvedValueOnce(mockClient);

      const result = await clientService.getClient("CLABCDEFGHIJ");

      expect(result.result).toBe(true);
      expect(result.data).toEqual(mockClient);
      expect(mockDynamoDBUtil.get).toHaveBeenCalledWith({
        TableName: "test-clients-table",
        Key: { id: "CLABCDEFGHIJ" },
      });
    });

    it("should return error result if client not found", async () => {
      mockDynamoDBUtil.get.mockResolvedValueOnce(null);

      const result = await clientService.getClient("CLZZZZZZZZZZ");

      expect(result.result).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("getClientByEmail", () => {
    it("returns error when query throws", async () => {
      mockDynamoDBUtil.query.mockRejectedValueOnce(new Error("boom"));

      const result = await clientService.getClientByEmail("err@example.com");

      expect(result.result).toBe(false);
      expect(result.error).toContain("boom");
    });
  });

  describe("listClients", () => {
    it("queries by status", async () => {
      mockDynamoDBUtil.query.mockResolvedValueOnce({
        items: [mockClient],
        lastEvaluatedKey: { id: "CL1" },
        count: 1,
      });

      const result = await clientService.listClients({
        status: ClientStatus.ACTIVE,
        limit: 5,
        lastEvaluatedKey: Buffer.from(JSON.stringify({ id: "CL0" })).toString(
          "base64",
        ),
      });

      expect(result.result).toBe(true);
      expect(result.data?.items).toHaveLength(1);
      expect(result.data?.lastEvaluatedKey).toBeTruthy();
    });

    it("scans when no status", async () => {
      mockDynamoDBUtil.scan.mockResolvedValueOnce({
        items: [mockClient],
        lastEvaluatedKey: undefined,
        count: 1,
      });

      const result = await clientService.listClients();

      expect(result.result).toBe(true);
      expect(result.data?.items).toHaveLength(1);
      expect(mockDynamoDBUtil.scan).toHaveBeenCalled();
    });

    it("handles list errors", async () => {
      mockDynamoDBUtil.scan.mockRejectedValueOnce(new Error("scan fail"));

      const result = await clientService.listClients();

      expect(result.result).toBe(false);
      expect(result.error).toContain("scan fail");
    });
  });

  describe("updateClient", () => {
    it("updates client when valid", async () => {
      vi.spyOn(clientService as any, "getClient").mockResolvedValue({
        result: true,
        data: mockClient,
      });
      mockDynamoDBUtil.put.mockResolvedValueOnce(undefined);

      const result = await clientService.updateClient("CL1", {
        name: "Updated",
      });

      expect(result.result).toBe(true);
      expect(result.data?.name).toBe("Updated");
      expect(mockDynamoDBUtil.put).toHaveBeenCalled();
    });

    it("returns not found when client missing", async () => {
      vi.spyOn(clientService as any, "getClient").mockResolvedValue({
        result: false,
      });

      const result = await clientService.updateClient("CL1", {
        name: "Changed",
      });

      expect(result.result).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("updates status when provided", async () => {
      vi.spyOn(clientService as any, "getClient").mockResolvedValue({
        result: true,
        data: mockClient,
      });
      mockDynamoDBUtil.put.mockResolvedValueOnce(undefined);

      const result = await clientService.updateClient("CL1", {
        status: ClientStatus.INACTIVE,
      });

      expect(result.result).toBe(true);
      expect(result.data?.status).toBe(ClientStatus.INACTIVE);
    });
  });

  describe("deleteClient", () => {
    it("soft-deletes when found with no campaign links", async () => {
      vi.spyOn(clientService as any, "getClient").mockResolvedValue({
        result: true,
        data: mockClient,
      });
      mockDynamoDBUtil.scan.mockResolvedValueOnce({
        items: [],
      });
      mockDynamoDBUtil.buildUpdateExpression.mockReturnValue({
        UpdateExpression: "SET #is_deleted = :is_deleted",
        ExpressionAttributeNames: {
          "#is_deleted": "is_deleted",
        },
        ExpressionAttributeValues: {
          ":is_deleted": true,
        },
      });
      mockDynamoDBUtil.update.mockResolvedValueOnce(undefined);

      const result = await clientService.deleteClient("CL1");

      expect(result.result).toBe(true);
      expect(mockDynamoDBUtil.update).toHaveBeenCalled();
    });

    it("returns error when missing", async () => {
      vi.spyOn(clientService as any, "getClient").mockResolvedValue({
        result: false,
      });

      const result = await clientService.deleteClient("CL404");

      expect(result.result).toBe(false);
      expect(result.error).toContain("not found");
      expect(mockDynamoDBUtil.update).not.toHaveBeenCalled();
    });

    it("blocks soft delete when active campaign link exists", async () => {
      vi.spyOn(clientService as any, "getClient").mockResolvedValue({
        result: true,
        data: mockClient,
      });
      mockDynamoDBUtil.scan.mockResolvedValueOnce({
        items: [
          {
            id: "CM1",
            name: "Campaign 1",
            clients: [
              {
                client_id: "CL1",
                status: CampaignParticipantStatus.LIVE,
              },
            ],
          },
        ],
      });
      mockDynamoDBUtil.scan.mockResolvedValueOnce({
        items: [],
      });

      const result = await clientService.deleteClient("CL1");

      expect(result.result).toBe(false);
      expect(result.error).toContain("Disable the client in all campaigns");
    });
  });
});
