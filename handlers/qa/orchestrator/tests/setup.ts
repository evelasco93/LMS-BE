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

export function createMockConstants() {
  return {
    DUPLICATE_CHECK_LAMBDA_NAME: "test-qa-duplicate-check",
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
    .bind("OrchestratorConstants")
    .toConstantValue(createMockConstants());
});

export function getMockLogger() {
  return testContainer.get("Logger");
}

export function getMockLambdaInvokeUtil() {
  return testContainer.get("LambdaInvokeUtil");
}

export function getMockConstants() {
  return testContainer.get("OrchestratorConstants");
}
