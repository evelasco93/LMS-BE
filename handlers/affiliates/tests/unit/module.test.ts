import { beforeAll, describe, expect, it } from "vitest";
import { container } from "../../modules/affiliate.module";
import { AffiliateService } from "../../services/affiliate.service";
import { AffiliateController } from "../../controllers/affiliate.controller";

class FakeDynamoDBUtil {}
const fakeConstants = { AFFILIATES_TABLE_NAME: "affiliates-table" };

beforeAll(() => {
  container.rebind("DynamoDBUtil").toConstantValue(new FakeDynamoDBUtil());
  container.rebind("AffiliateConstants").toConstantValue(fakeConstants);
});

describe("Affiliate module container", () => {
  it("resolves service with injected dependencies", () => {
    const service = container.get<AffiliateService>("AffiliateService");
    expect(service).toBeInstanceOf(AffiliateService);
  });

  it("resolves controller", () => {
    const controller = container.get<AffiliateController>(AffiliateController);
    expect(controller).toBeInstanceOf(AffiliateController);
  });

  it("uses overridden constants", () => {
    const constants = container.get<typeof fakeConstants>("AffiliateConstants");
    expect(constants).toBe(fakeConstants);
  });
});
