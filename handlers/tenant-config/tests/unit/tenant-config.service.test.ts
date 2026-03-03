import { beforeEach, describe, expect, it } from "vitest";
import { TenantConfigService } from "../../services/tenant-config.service";
import { getMockSecretsManagerUtil, getTestContainer } from "../setup";

describe("TenantConfigService", () => {
  let service: TenantConfigService;
  let mockSecretsManagerUtil: any;

  beforeEach(() => {
    const container = getTestContainer();
    container.bind("TenantConfigService").to(TenantConfigService);
    service = container.get<TenantConfigService>("TenantConfigService");
    mockSecretsManagerUtil = getMockSecretsManagerUtil();
  });

  it("upserts ipqs api key credential", async () => {
    mockSecretsManagerUtil.upsertJsonSecret.mockResolvedValueOnce(undefined);

    const result = await service.upsertCredential({
      provider: "ipqs",
      type: "api_key",
      credentials: {
        apiKey: "abc123",
      },
    });

    expect(result.result).toBe(true);
    expect(mockSecretsManagerUtil.upsertJsonSecret).toHaveBeenCalledTimes(1);
    expect(result.data?.provider).toBe("ipqs");
  });

  it("fails when required credentials are missing", async () => {
    const result = await service.upsertCredential({
      provider: "trusted_forms",
      type: "basic_auth",
      credentials: {
        username: "trusted-user",
      },
    } as any);

    expect(result.result).toBe(false);
    expect(result.error).toContain(
      "credentials.username and credentials.password",
    );
    expect(mockSecretsManagerUtil.upsertJsonSecret).not.toHaveBeenCalled();
  });

  it("gets credential by provider", async () => {
    mockSecretsManagerUtil.getJsonSecret.mockResolvedValueOnce({
      provider: "ipqs",
      type: "api_key",
      credentials: {
        apiKey: "abc123",
      },
      updated_at: "2026-02-19T00:00:00.000Z",
    });

    const result = await service.getCredential("ipqs");

    expect(result.result).toBe(true);
    expect(result.data?.provider).toBe("ipqs");
  });

  it("upserts external leads api key credential", async () => {
    mockSecretsManagerUtil.upsertJsonSecret.mockResolvedValueOnce(undefined);

    const result = await service.upsertCredential({
      provider: "external_leads_api",
      type: "api_key",
      credentials: {
        apiKey: "external-key-123",
      },
    });

    expect(result.result).toBe(true);
    expect(result.data?.provider).toBe("external_leads_api");
    expect(mockSecretsManagerUtil.upsertJsonSecret).toHaveBeenCalledTimes(1);
  });

  it("deletes credential by provider", async () => {
    mockSecretsManagerUtil.deleteSecret.mockResolvedValueOnce(undefined);

    const result = await service.deleteCredential("trusted_forms");

    expect(result.result).toBe(true);
    expect(mockSecretsManagerUtil.deleteSecret).toHaveBeenCalledTimes(1);
  });
});
