import 'reflect-metadata';
import { vi, beforeEach } from 'vitest';
import { Container } from 'inversify';

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

export function createMockConstants() {
  return {
    AFFILIATES_TABLE_NAME: 'test-affiliates-table',
    CAMPAIGNS_TABLE_NAME: 'test-campaigns-table',
    LEADS_TABLE_NAME: 'test-leads-table',
  };
}

export function createMockAuditWriterService() {
  return {
    writeAuditEvent: vi.fn().mockResolvedValue(undefined),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  
  testContainer = new Container();
  
  const mockDynamoDBUtil = createMockDynamoDBUtil();
  const mockLogger = createMockLogger();
  const mockConstants = createMockConstants();
  const mockAuditWriterService = createMockAuditWriterService();
  
  testContainer.bind('DynamoDBUtil').toConstantValue(mockDynamoDBUtil);
  testContainer.bind('Logger').toConstantValue(mockLogger);
  testContainer.bind('AffiliateConstants').toConstantValue(mockConstants);
  testContainer
    .bind('AuditWriterService')
    .toConstantValue(mockAuditWriterService);
  
  process.env.AFFILIATES_TABLE_NAME = 'test-affiliates-table';
});

export function getMockDynamoDBUtil() {
  return testContainer.get('DynamoDBUtil');
}

export function getMockLogger() {
  return testContainer.get('Logger');
}

export function getMockConstants() {
  return testContainer.get('AffiliateConstants');
}

export function getMockAuditWriterService() {
  return testContainer.get('AuditWriterService');
}
