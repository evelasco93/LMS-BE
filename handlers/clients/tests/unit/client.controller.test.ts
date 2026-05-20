import { beforeEach, describe, expect, it, vi } from "vitest";
import { ClientController } from "../../controllers/client.controller";

describe("ClientController status mapping", () => {
  let service: {
    createClient: ReturnType<typeof vi.fn>;
    getClient: ReturnType<typeof vi.fn>;
    listClients: ReturnType<typeof vi.fn>;
    updateClient: ReturnType<typeof vi.fn>;
    deleteClient: ReturnType<typeof vi.fn>;
  };
  let controller: ClientController;
  let statusSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = {
      createClient: vi.fn(),
      getClient: vi.fn(),
      listClients: vi.fn(),
      updateClient: vi.fn(),
      deleteClient: vi.fn(),
    };

    controller = new ClientController(service as never);
    statusSpy = vi.fn();

    (controller as any).request = {
      headers: {
        "x-correlation-id": "corr-clients-1",
      },
    };
    (controller as any).response = { status: statusSpy };
  });

  it("sets 201 when create succeeds", async () => {
    service.createClient.mockResolvedValue({
      result: true,
      data: { id: "CLT123" },
    });

    const result = await controller.createClient({} as never);

    expect(statusSpy).toHaveBeenCalledWith(201);
    expect(result.success).toBe(true);
    expect(result.correlation_id).toBe("corr-clients-1");
  });

  it("sets 404 when get returns not found", async () => {
    service.getClient.mockResolvedValue({
      result: false,
      error: "Client with id CLT404 not found",
    });

    const result = await controller.getClient("CLT404");

    expect(statusSpy).toHaveBeenCalledWith(404);
    expect(result.success).toBe(false);
    expect(result.correlation_id).toBe("corr-clients-1");
  });

  it("sets 409 when delete hits campaign linkage conflict", async () => {
    service.deleteClient.mockResolvedValue({
      result: false,
      error: "Cannot hard delete client while linked to campaigns",
    });

    const result = await controller.deleteClient("CLT1", "true");

    expect(statusSpy).toHaveBeenCalledWith(409);
    expect(result.success).toBe(false);
    expect(result.correlation_id).toBe("corr-clients-1");
  });

  it("uses 500 fallback for list failures", async () => {
    service.listClients.mockResolvedValue({
      result: false,
      error: "Unexpected storage issue",
    });

    const result = await controller.listClients();

    expect(statusSpy).toHaveBeenCalledWith(500);
    expect(result.success).toBe(false);
    expect(result.correlation_id).toBe("corr-clients-1");
  });
});
