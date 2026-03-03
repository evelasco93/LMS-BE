import "reflect-metadata";
import { beforeEach, vi } from "vitest";
import { Container } from "inversify";

let testContainer: Container;

export function getTestContainer(): Container {
  return testContainer;
}

export function createMockDynamoDBUtil() {
  return {
    scanAll: vi.fn(),
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
    LEADS_TABLE_NAME: "test-leads-table",
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  testContainer = new Container();
  testContainer.bind("DynamoDBUtil").toConstantValue(createMockDynamoDBUtil());
  testContainer.bind("Logger").toConstantValue(createMockLogger());
  testContainer
    .bind("DuplicateCheckConstants")
    .toConstantValue(createMockConstants());
});

export function getMockDynamoDBUtil() {
  return testContainer.get("DynamoDBUtil");
}
