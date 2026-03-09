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

export function createMockLambdaInvokeUtil() {
  return {
    invokeJson: vi.fn(),
  };
}

export function createMockDynamoDBUtil() {
  return {
    get: vi.fn(),
    put: vi.fn(),
    queryAll: vi.fn().mockResolvedValue([]),
  };
}

export function createMockConstants() {
  return {
    DUPLICATE_CHECK_LAMBDA_NAME: "test-qa-duplicate-check",
    TRUSTED_FORM_LAMBDA_NAME: "test-qa-trusted-form",
    IPQS_LAMBDA_NAME: "test-qa-ipqs",
    TENANT_SETTINGS_TABLE_NAME: "test-tenant-settings",
    CREDENTIALS_ENCRYPTION_KEY: "test-key",
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  testContainer = new Container();
  testContainer.bind("Logger").toConstantValue(createMockLogger());
  testContainer
    .bind("LambdaInvokeUtil")
    .toConstantValue(createMockLambdaInvokeUtil());
  testContainer
    .bind("DynamoDBUtil")
    .toConstantValue(createMockDynamoDBUtil());
  testContainer
    .bind("OrchestratorConstants")
    .toConstantValue(createMockConstants());
});

export function getMockLogger() {
  return testContainer.get("Logger");
}

export function getMockLambdaInvokeUtil() {
  return testContainer.get("LambdaInvokeUtil");
}

export function getMockDynamoDBUtil() {
  return testContainer.get("DynamoDBUtil");
}

export function getMockConstants() {
  return testContainer.get("OrchestratorConstants");
}
