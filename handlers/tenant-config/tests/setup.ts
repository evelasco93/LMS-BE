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

export function createMockDynamoDBUtil() {
  return {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    query: vi.fn(),
    queryAll: vi.fn(),
    scan: vi.fn(),
    scanAll: vi.fn(),
  };
}

export function createMockConstants() {
  return {
    CREDENTIALS_TABLE_NAME: "test-credentials-table",
    CREDENTIALS_ENCRYPTION_KEY:
      "0000000000000000000000000000000000000000000000000000000000000000",
    PLUGIN_SCHEMAS_TABLE_NAME: "test-plugin-schemas-table",
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  testContainer = new Container();
  testContainer.bind("Logger").toConstantValue(createMockLogger());
  testContainer.bind("DynamoDBUtil").toConstantValue(createMockDynamoDBUtil());
  testContainer
    .bind("TenantConfigConstants")
    .toConstantValue(createMockConstants());
});

export function getMockDynamoDBUtil() {
  return testContainer.get("DynamoDBUtil");
}
