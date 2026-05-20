import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthController } from "../../controllers/auth.controller";

describe("AuthController status and correlation", () => {
  let service: {
    login: ReturnType<typeof vi.fn>;
    refresh: ReturnType<typeof vi.fn>;
  };
  let controller: AuthController;
  let statusSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = {
      login: vi.fn(),
      refresh: vi.fn(),
    };

    controller = new AuthController(service as never);
    statusSpy = vi.fn();

    (controller as any).request = {
      headers: {
        "x-correlation-id": "corr-auth-1",
      },
    };
    (controller as any).response = { status: statusSpy };
  });

  it("returns success login envelope with correlation_id", async () => {
    service.login.mockResolvedValue({
      result: true,
      data: { access_token: "tok" },
    });

    const result = await controller.login({} as never);

    expect(result.success).toBe(true);
    expect(result.correlation_id).toBe("corr-auth-1");
  });

  it("returns 401 on login failure", async () => {
    service.login.mockResolvedValue({
      result: false,
      error: "Invalid credentials",
    });

    const result = await controller.login({} as never);

    expect(statusSpy).toHaveBeenCalledWith(401);
    expect(result.success).toBe(false);
    expect(result.correlation_id).toBe("corr-auth-1");
  });

  it("returns 401 on refresh failure", async () => {
    service.refresh.mockResolvedValue({
      result: false,
      error: "Refresh token expired",
    });

    const result = await controller.refresh({} as never);

    expect(statusSpy).toHaveBeenCalledWith(401);
    expect(result.success).toBe(false);
    expect(result.correlation_id).toBe("corr-auth-1");
  });
});
