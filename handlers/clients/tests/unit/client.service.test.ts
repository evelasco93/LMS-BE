import { describe, it, expect, beforeEach, vi } from "vitest";
import { ClientService } from "../../services/client.service";
import { CreateClientRequest } from "../../types/client-request.types";
import { ClientStatus } from "../../enums/client-status.enum";
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
        email: "test@example.com",
      };

      mockDynamoDBUtil.query.mockResolvedValueOnce({
        items: [],
        count: 0,
      });

      mockDynamoDBUtil.put.mockResolvedValueOnce(undefined);

      const result = await clientService.createClient(request);

      expect(result.result).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data?.name).toBe(request.name);
      expect(result.data?.email).toBe(request.email);
      expect(result.data?.status).toBe(ClientStatus.ACTIVE);
      expect(result.data?.id).toMatch(/^CL[A-Z0-9]{8}$/);
      expect(mockDynamoDBUtil.put).toHaveBeenCalledTimes(1);
    });

    it("should return error if email already exists", async () => {
      const request: CreateClientRequest = {
        name: "Test Client",
        email: "existing@example.com",
      };

      mockDynamoDBUtil.query.mockResolvedValueOnce({
        items: [mockExistingClient],
        count: 1,
      });

      const result = await clientService.createClient(request);

      expect(result.result).toBe(false);
      expect(result.error).toContain("already exists");
      expect(mockDynamoDBUtil.put).not.toHaveBeenCalled();
    });

    it("rejects extra fields", async () => {
      const result = await clientService.createClient({
        name: "Bad Client",
        email: "bad@example.com",
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
      vi.spyOn(clientService as any, "getClientByEmail").mockResolvedValue({
        result: false,
      });
      mockDynamoDBUtil.buildUpdateExpression.mockReturnValue({
        UpdateExpression: "set #name = :name",
        ExpressionAttributeNames: { "#name": "name" },
        ExpressionAttributeValues: { ":name": "Updated" },
      });
      mockDynamoDBUtil.update.mockResolvedValueOnce({
        ...mockClient,
        name: "Updated",
      });

      const result = await clientService.updateClient("CL1", {
        name: "Updated",
      });

      expect(result.result).toBe(true);
      expect(result.data?.name).toBe("Updated");
      expect(mockDynamoDBUtil.update).toHaveBeenCalled();
    });

    it("rejects when email already used", async () => {
      vi.spyOn(clientService as any, "getClient").mockResolvedValue({
        result: true,
        data: mockClient,
      });
      vi.spyOn(clientService as any, "getClientByEmail").mockResolvedValue({
        result: true,
        data: mockClient,
      });

      const result = await clientService.updateClient("CL1", {
        email: "new@example.com",
      });

      expect(result.result).toBe(false);
      expect(result.error).toContain("already exists");
    });

    it("rejects when client missing", async () => {
      vi.spyOn(clientService as any, "getClient").mockResolvedValue({
        result: false,
      });

      const result = await clientService.updateClient("CL404", {
        name: "Nope",
      });

      expect(result.result).toBe(false);
      expect(result.error).toContain("not found");
      expect(mockDynamoDBUtil.update).not.toHaveBeenCalled();
    });
  });

  describe("deleteClient", () => {
    it("deletes when found", async () => {
      vi.spyOn(clientService as any, "getClient").mockResolvedValue({
        result: true,
        data: mockClient,
      });
      mockDynamoDBUtil.delete.mockResolvedValueOnce(undefined);

      const result = await clientService.deleteClient("CL1");

      expect(result.result).toBe(true);
      expect(mockDynamoDBUtil.delete).toHaveBeenCalled();
    });

    it("returns error when missing", async () => {
      vi.spyOn(clientService as any, "getClient").mockResolvedValue({
        result: false,
      });

      const result = await clientService.deleteClient("CL404");

      expect(result.result).toBe(false);
      expect(result.error).toContain("not found");
      expect(mockDynamoDBUtil.delete).not.toHaveBeenCalled();
    });
  });
});
