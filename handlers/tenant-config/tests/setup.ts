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

export function createMockAuditWriterService() {
  return {
    writeAuditEvent: vi.fn().mockResolvedValue(undefined),
  };
}

export function createMockConstants() {
  return {
    TENANT_SETTINGS_TABLE_NAME: "test-tenant-settings-table",
    CREDENTIALS_ENCRYPTION_KEY:
      "0000000000000000000000000000000000000000000000000000000000000000",
    CAMPAIGNS_TABLE_NAME: "test-campaigns-table",
    AUDIT_LOGS_TABLE_NAME: "test-audit-logs-table",
    PRESETS_TABLE_NAME: "test-presets-table",
    PLATFORM_PRESETS_TABLE_NAME: "test-platform-presets-table",
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
  testContainer
    .bind("AuditWriterService")
    .toConstantValue(createMockAuditWriterService());
});

export function getMockDynamoDBUtil() {
  return testContainer.get("DynamoDBUtil");
}
