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
    queryAll: vi.fn(),
    scan: vi.fn(),
    scanAll: vi.fn(),
    update: vi.fn().mockResolvedValue(undefined),
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
    LEADS_CAMPAIGN_CREATED_AT_INDEX_NAME:
      "test-leads-table-campaign-created-at-index",
    LEADS_GLOBAL_CREATED_AT_INDEX_NAME:
      "test-leads-table-entity-type-created-at-index",
    LEADS_ENTITY_TYPE: "lead",
    CAMPAIGNS_TABLE_NAME: "test-campaigns-table",
    // Empty string disables intake log writes so put call counts stay predictable
    LEAD_INTAKE_LOGS_TABLE_NAME: "",
    QA_ORCHESTRATOR_LAMBDA_NAME: "",
    AWS_REGION: "us-east-1",
    EXTERNAL_LEADS_API_NAME: "",
    EXTERNAL_LEADS_API_STAGE: "",
  };
}

export function createMockAuditWriterService() {
  return {
    writeAuditEvent: vi.fn().mockResolvedValue(undefined),
  };
}

export function createMockLeadDeliveryService() {
  return {
    deliverLead: vi.fn().mockResolvedValue({
      delivered: true,
      statusCode: 200,
      attempts: 1,
    }),
    passesLogicRules: vi.fn().mockReturnValue(true),
  };
}

export function createMockMetricsService() {
  return {
    recordLeadOutcome: vi.fn().mockResolvedValue(undefined),
    recordLeadOutcomeFromEvent: vi.fn().mockResolvedValue(undefined),
    getSummary: vi.fn(),
    getDashboard: vi.fn(),
    getTimeseries: vi.fn(),
    getBreakdown: vi.fn(),
    getContracts: vi.fn(),
    getHealth: vi.fn(),
    getByAffiliate: vi.fn(),
    getByAffiliateCampaigns: vi.fn(),
    getByAffiliateKeys: vi.fn(),
    getByCampaignAffiliates: vi.fn(),
    getIpqs: vi.fn(),
    getQuality: vi.fn(),
  };
}

export function createMockMetricsDlqClient() {
  return {
    enqueue: vi.fn().mockResolvedValue(true),
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  testContainer = new Container();

  const mockDynamoDBUtil = createMockDynamoDBUtil();
  const mockLogger = createMockLogger();
  const mockLambdaInvokeUtil = createMockLambdaInvokeUtil();
  const mockConstants = createMockConstants();
  const mockAuditWriterService = createMockAuditWriterService();
  const mockLeadDeliveryService = createMockLeadDeliveryService();
  const mockMetricsService = createMockMetricsService();
  const mockMetricsDlqClient = createMockMetricsDlqClient();

  testContainer.bind("DynamoDBUtil").toConstantValue(mockDynamoDBUtil);
  testContainer.bind("Logger").toConstantValue(mockLogger);
  testContainer.bind("LambdaInvokeUtil").toConstantValue(mockLambdaInvokeUtil);
  testContainer.bind("LeadsConstants").toConstantValue(mockConstants);
  testContainer
    .bind("AuditWriterService")
    .toConstantValue(mockAuditWriterService);
  testContainer
    .bind("LeadDeliveryService")
    .toConstantValue(mockLeadDeliveryService);
  testContainer.bind("MetricsService").toConstantValue(mockMetricsService);
  testContainer.bind("MetricsDlqClient").toConstantValue(mockMetricsDlqClient);
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

export function getMockLeadDeliveryService() {
  return testContainer.get("LeadDeliveryService");
}

export function getMockMetricsService() {
  return testContainer.get("MetricsService");
}

export function getMockMetricsDlqClient() {
  return testContainer.get("MetricsDlqClient");
}
