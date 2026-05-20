import { beforeEach, describe, expect, it, vi } from "vitest";
import { TenantConfigController } from "../../controllers/tenant-config.controller";

describe("TenantConfigController status mapping", () => {
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let controller: TenantConfigController;
  let statusSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = {
      createCredential: vi.fn(),
      listCredentials: vi.fn(),
      getCredential: vi.fn(),
      updateCredential: vi.fn(),
      deleteCredential: vi.fn(),
      restoreCredential: vi.fn(),
      disableCredential: vi.fn(),
      enableCredential: vi.fn(),
      createCredentialSchema: vi.fn(),
      listCredentialSchemas: vi.fn(),
      getCredentialSchema: vi.fn(),
      updateCredentialSchema: vi.fn(),
      deleteCredentialSchema: vi.fn(),
      restoreCredentialSchema: vi.fn(),
    };

    controller = new TenantConfigController(service as never);
    statusSpy = vi.fn();

    (controller as any).request = {
      headers: {
        "x-correlation-id": "corr-tenant-config-1",
      },
    };
    (controller as any).response = { status: statusSpy };
  });

  it("sets 201 when creating credentials", async () => {
    service.createCredential.mockResolvedValue({
      result: true,
      data: { id: "CR123" },
    });

    const result = await controller.createCredential({} as never);

    expect(statusSpy).toHaveBeenCalledWith(201);
    expect(result.success).toBe(true);
    expect(result.correlation_id).toBe("corr-tenant-config-1");
  });

  it("sets 404 when credential lookup fails with not found", async () => {
    service.getCredential.mockResolvedValue({
      result: false,
      error: "Credential not found",
    });

    const result = await controller.getCredential("CR404");

    expect(statusSpy).toHaveBeenCalledWith(404);
    expect(result.success).toBe(false);
    expect(result.correlation_id).toBe("corr-tenant-config-1");
  });

  it("uses 500 fallback when list credentials fails with unknown error", async () => {
    service.listCredentials.mockResolvedValue({
      result: false,
      error: "Storage timeout",
    });

    const result = await controller.listCredentials();

    expect(statusSpy).toHaveBeenCalledWith(500);
    expect(result.success).toBe(false);
    expect(result.correlation_id).toBe("corr-tenant-config-1");
  });

  it("maps conflict-style errors to 409", async () => {
    service.updateCredential.mockResolvedValue({
      result: false,
      error: "Cannot update a deleted credential",
    });

    const result = await controller.updateCredential("CR1", {} as never);

    expect(statusSpy).toHaveBeenCalledWith(409);
    expect(result.success).toBe(false);
    expect(result.message).toBe("Failed to update credential");
    expect(result.correlation_id).toBe("corr-tenant-config-1");
  });
});
