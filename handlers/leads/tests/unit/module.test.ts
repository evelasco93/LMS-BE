import { beforeAll, describe, expect, it } from "vitest";
import { container } from "../../modules/leads.module";
import { LeadsService } from "../../services/leads.service";
import { LeadsController } from "../../controllers/leads.controller";
import { MetricsController } from "../../controllers/metrics.controller";

class FakeDynamoDBUtil {}
const fakeConstants = {
  LEADS_TABLE_NAME: "leads-table",
  CAMPAIGNS_TABLE_NAME: "campaigns-table",
  METRICS_TABLE_NAME: "metrics-table",
  METRICS_TABLE_PARTITION_KEY: "pk",
  METRICS_TABLE_SORT_KEY: "sk",
  METRICS_TABLE_ITEM_TYPE_ATTRIBUTE: "item_type",
  METRICS_TABLE_BUCKET_START_ATTRIBUTE: "bucket_start",
  METRICS_ITEM_TYPE_BUCKET_START_INDEX_NAME: "metrics-item-type-bucket-start-index",
  METRICS_ITEM_TYPE_BUCKET_START_INDEX_PARTITION_KEY: "item_type",
  METRICS_ITEM_TYPE_BUCKET_START_INDEX_SORT_KEY: "bucket_start",
};

beforeAll(() => {
  container.rebind("DynamoDBUtil").toConstantValue(new FakeDynamoDBUtil());
  container.rebind("LeadsConstants").toConstantValue(fakeConstants);
});

describe("Leads module container", () => {
  it("resolves service with injected dependencies", () => {
    const service = container.get<LeadsService>("LeadsService");
    expect(service).toBeInstanceOf(LeadsService);
  });

  it("resolves controller", () => {
    const controller = container.get<LeadsController>(LeadsController);
    expect(controller).toBeInstanceOf(LeadsController);
  });

  it("resolves metrics controller", () => {
    const controller = container.get<MetricsController>(MetricsController);
    expect(controller).toBeInstanceOf(MetricsController);
  });

  it("uses overridden constants", () => {
    const constants = container.get<typeof fakeConstants>("LeadsConstants");
    expect(constants).toBe(fakeConstants);
  });
});
