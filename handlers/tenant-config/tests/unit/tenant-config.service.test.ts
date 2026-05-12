import { beforeEach, describe, expect, it } from "vitest";
import { TenantConfigService } from "../../services/tenant-config.service";
import { getMockDynamoDBUtil, getTestContainer } from "../setup";

describe("TenantConfigService", () => {
  let service: TenantConfigService;
  let mockDynamoDBUtil: any;

  beforeEach(() => {
    const container = getTestContainer();
    container.bind("TenantConfigService").to(TenantConfigService);
    service = container.get<TenantConfigService>("TenantConfigService");
    mockDynamoDBUtil = getMockDynamoDBUtil();
  });

  it("creates an api_key credential and returns decrypted data", async () => {
    mockDynamoDBUtil.put.mockResolvedValueOnce(undefined);

    const result = await service.createCredential({
      provider: "ipqs",
      name: "IPQS API Key",
      credential_type: "api_key",
      credentials: { apiKey: "abc123" },
    });

    expect(result.result).toBe(true);
    expect(mockDynamoDBUtil.put).toHaveBeenCalledTimes(1);
    expect(result.data?.provider).toBe("ipqs");
    expect(result.data?.credentials.apiKey).toBe("abc123");
  });

  it("fails when provider is missing", async () => {
    const result = await service.createCredential({
      provider: "",
      name: "Test",
      credential_type: "api_key",
      credentials: { apiKey: "abc123" },
    });

    expect(result.result).toBe(false);
    expect(result.error).toContain("provider is required");
    expect(mockDynamoDBUtil.put).not.toHaveBeenCalled();
  });

  it("fails when basic_auth password is missing", async () => {
    const result = await service.createCredential({
      provider: "trusted_form",
      name: "TF Creds",
      credential_type: "basic_auth",
      credentials: { username: "user" } as any,
    });

    expect(result.result).toBe(false);
    expect(result.error).toContain(
      "credentials.username and credentials.password",
    );
    expect(mockDynamoDBUtil.put).not.toHaveBeenCalled();
  });

  it("gets a credential by id and returns decrypted data", async () => {
    // Simulate a stored record with an encrypted apiKey
    // We pre-encrypt using the test key from constants mock so decrypt works
    const { encrypt } = await import("@shared/utils/crypto.util");
    const TEST_KEY =
      "0000000000000000000000000000000000000000000000000000000000000000";
    const encryptedApiKey = encrypt("secret-key-999", TEST_KEY);

    mockDynamoDBUtil.get.mockResolvedValueOnce({
      id: "crd-001",
      type: "credential",
      provider: "external_leads_api",
      name: "External API",
      credential_type: "api_key",
      credentials: { apiKey: encryptedApiKey },
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });

    const result = await service.getCredential("crd-001");

    expect(result.result).toBe(true);
    expect(result.data?.provider).toBe("external_leads_api");
    expect(result.data?.credentials.apiKey).toBe("secret-key-999");
  });

  it("returns error when credential is not found", async () => {
    mockDynamoDBUtil.get.mockResolvedValueOnce(null);

    const result = await service.getCredential("nonexistent-id");

    expect(result.result).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("lists credentials from DynamoDB", async () => {
    mockDynamoDBUtil.queryAll.mockResolvedValueOnce([
      {
        id: "crd-002",
        type: "credential",
        provider: "ipqs",
        name: "IPQS",
        credential_type: "api_key",
        credentials: {},
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ]);

    const result = await service.listCredentials();

    expect(result.result).toBe(true);
    expect(result.data).toHaveLength(1);
    expect(result.data?.[0].provider).toBe("ipqs");
  });

  it("deletes a credential by id", async () => {
    mockDynamoDBUtil.get.mockResolvedValueOnce({
      id: "crd-003",
      type: "credential",
      provider: "ipqs",
      name: "IPQS",
      credential_type: "api_key",
      credentials: {},
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    });
    mockDynamoDBUtil.queryAll.mockResolvedValueOnce([]);
    mockDynamoDBUtil.put.mockResolvedValueOnce(undefined);

    const result = await service.deleteCredential("crd-003");

    expect(result.result).toBe(true);
    expect(mockDynamoDBUtil.put).toHaveBeenCalledTimes(1);
  });
});
