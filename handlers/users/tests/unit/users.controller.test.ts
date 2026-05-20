import { beforeEach, describe, expect, it, vi } from "vitest";
import { UsersController } from "../../controllers/users.controller";

function makeAuthHeader(groups: string[] = ["admin"]) {
  const header = Buffer.from(
    JSON.stringify({ alg: "none", typ: "JWT" }),
  ).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({
      sub: "user-sub-1",
      "cognito:groups": groups,
    }),
  ).toString("base64url");
  return `Bearer ${header}.${payload}.signature`;
}

describe("UsersController status mapping", () => {
  let service: Record<string, ReturnType<typeof vi.fn>>;
  let controller: UsersController;
  let statusSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    service = {
      createUser: vi.fn(),
      listUsers: vi.fn(),
      getUser: vi.fn(),
      updateUserRole: vi.fn(),
      resetPassword: vi.fn(),
      enableUser: vi.fn(),
      deleteUser: vi.fn(),
      getTablePreference: vi.fn(),
      upsertTablePreference: vi.fn(),
      deleteTablePreference: vi.fn(),
    };

    controller = new UsersController(service as never);
    statusSpy = vi.fn();

    (controller as any).request = {
      headers: {
        authorization: makeAuthHeader(),
        "x-correlation-id": "corr-users-1",
      },
    };
    (controller as any).response = { status: statusSpy };
  });

  it("sets 201 when admin creates a user", async () => {
    service.createUser.mockResolvedValue({
      result: true,
      data: { username: "u1" },
    });

    const result = await controller.createUser({} as never);

    expect(statusSpy).toHaveBeenCalledWith(201);
    expect(result.success).toBe(true);
    expect(result.correlation_id).toBe("corr-users-1");
  });

  it("maps user-not-found to 404", async () => {
    service.getUser.mockResolvedValue({
      result: false,
      error: "User not found",
    });

    const result = await controller.getUser("missing%40example.com");

    expect(statusSpy).toHaveBeenCalledWith(404);
    expect(result.success).toBe(false);
    expect(result.correlation_id).toBe("corr-users-1");
  });

  it("uses 500 fallback for list failures", async () => {
    service.listUsers.mockResolvedValue({
      result: false,
      error: "Cognito timeout",
    });

    const result = await controller.listUsers();

    expect(statusSpy).toHaveBeenCalledWith(500);
    expect(result.success).toBe(false);
    expect(result.correlation_id).toBe("corr-users-1");
  });

  it("returns 403 for non-admin callers", async () => {
    (controller as any).request = {
      headers: {
        authorization: makeAuthHeader(["staff"]),
        "x-correlation-id": "corr-users-1",
      },
    };

    const result = await controller.listUsers();

    expect(statusSpy).toHaveBeenCalledWith(403);
    expect(result.success).toBe(false);
    expect(result.message).toBe("Forbidden");
    expect(result.correlation_id).toBe("corr-users-1");
  });
});
