import "reflect-metadata";
import { beforeEach, vi } from "vitest";
import { Container } from "inversify";

let testContainer: Container;

export function getTestContainer(): Container {
  return testContainer;
}

export function createMockLogger() {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

export function createMockSecretsManagerUtil() {
  return {
    upsertJsonSecret: vi.fn(),
    getJsonSecret: vi.fn(),
    deleteSecret: vi.fn(),
  };
}

export function createMockConstants() {
  return {
    IPQS_SECRET_NAME: "test-ipqs-secret",
    TRUSTED_FORMS_SECRET_NAME: "test-trusted-forms-secret",
    SECRET_PREFIX: "test-tenant-config",
    INTERNAL_API_AUTH_TOKEN_SECRET_NAME: "test-internal-auth-secret",
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  testContainer = new Container();
  testContainer.bind("Logger").toConstantValue(createMockLogger());
  testContainer
    .bind("SecretsManagerUtil")
    .toConstantValue(createMockSecretsManagerUtil());
  testContainer
    .bind("TenantConfigConstants")
    .toConstantValue(createMockConstants());
});

export function getMockSecretsManagerUtil() {
  return testContainer.get("SecretsManagerUtil");
}
