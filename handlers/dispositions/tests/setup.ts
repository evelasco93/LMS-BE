import "reflect-metadata";
import { beforeEach, vi } from "vitest";
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
    queryAll: vi.fn(),
    scan: vi.fn(),
    scanAll: vi.fn(),
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

export function createMockConstants() {
  return {
    DISPOSITIONS_TABLE_NAME: "test-dispositions-table",
    DISPOSITION_ROWS_TABLE_NAME: "test-disposition-rows-table",
    PUBLIC_DASHBOARDS_TABLE_NAME: "test-public-dashboards-table",
    LEADS_TABLE_NAME: "test-leads-table",
    CAMPAIGNS_TABLE_NAME: "test-campaigns-table",
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  testContainer = new Container();

  const mockDynamoDBUtil = createMockDynamoDBUtil();
  const mockLogger = createMockLogger();
  const mockConstants = createMockConstants();

  testContainer.bind("DynamoDBUtil").toConstantValue(mockDynamoDBUtil);
  testContainer.bind("Logger").toConstantValue(mockLogger);
  testContainer.bind("DispositionConstants").toConstantValue(mockConstants);

  process.env.DISPOSITIONS_TABLE_NAME = "test-dispositions-table";
  process.env.DISPOSITION_ROWS_TABLE_NAME = "test-disposition-rows-table";
  process.env.PUBLIC_DASHBOARDS_TABLE_NAME = "test-public-dashboards-table";
  process.env.LEADS_TABLE_NAME = "test-leads-table";
  process.env.CAMPAIGNS_TABLE_NAME = "test-campaigns-table";
});

export function getMockDynamoDBUtil() {
  return testContainer.get("DynamoDBUtil");
}

export function getMockLogger() {
  return testContainer.get("Logger");
}

export function getMockConstants() {
  return testContainer.get("DispositionConstants");
}
