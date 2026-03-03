import "reflect-metadata";
import { vi, beforeEach } from "vitest";
import { Container } from "inversify";

let testContainer: Container;

export function getTestContainer(): Container {
  return testContainer;
}

export function createMockDynamoDBUtil() {
  return {
    get: vi.fn(),
    put: vi.fn(),
    query: vi.fn(),
    scan: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    buildUpdateExpression: vi.fn(),
  };
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

export function createMockConstants() {
  return {
    LEADS_TABLE_NAME: "test-leads-table",
    CAMPAIGNS_TABLE_NAME: "test-campaigns-table",
    QA_ORCHESTRATOR_LAMBDA_NAME: "",
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  testContainer = new Container();

  const mockDynamoDBUtil = createMockDynamoDBUtil();
  const mockLogger = createMockLogger();
  const mockLambdaInvokeUtil = createMockLambdaInvokeUtil();
  const mockConstants = createMockConstants();

  testContainer.bind("DynamoDBUtil").toConstantValue(mockDynamoDBUtil);
  testContainer.bind("Logger").toConstantValue(mockLogger);
  testContainer.bind("LambdaInvokeUtil").toConstantValue(mockLambdaInvokeUtil);
  testContainer.bind("LeadsConstants").toConstantValue(mockConstants);
});

export function getMockDynamoDBUtil() {
  return testContainer.get("DynamoDBUtil");
}

export function getMockLogger() {
  return testContainer.get("Logger");
}

export function getMockLambdaInvokeUtil() {
  return testContainer.get("LambdaInvokeUtil");
}

export function getMockConstants() {
  return testContainer.get("LeadsConstants");
}
