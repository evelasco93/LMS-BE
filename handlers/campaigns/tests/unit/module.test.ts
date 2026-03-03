import { beforeAll, describe, expect, it } from "vitest";
import { container } from "../../modules/campaign.module";
import { CampaignService } from "../../services/campaign.service";
import { CampaignController } from "../../controllers/campaign.controller";

class FakeDynamoDBUtil {}
const fakeConstants = {
  CAMPAIGNS_TABLE_NAME: "campaigns-table",
  CLIENTS_TABLE_NAME: "clients-table",
  AFFILIATES_TABLE_NAME: "affiliates-table",
};

beforeAll(() => {
  container.rebind("DynamoDBUtil").toConstantValue(new FakeDynamoDBUtil());
  container.rebind("CampaignConstants").toConstantValue(fakeConstants);
});

describe("Campaign module container", () => {
  it("resolves service with injected dependencies", () => {
    const service = container.get<CampaignService>("CampaignService");
    expect(service).toBeInstanceOf(CampaignService);
  });

  it("resolves controller", () => {
    const controller = container.get<CampaignController>(CampaignController);
    expect(controller).toBeInstanceOf(CampaignController);
  });

  it("uses overridden constants", () => {
    const constants = container.get<typeof fakeConstants>("CampaignConstants");
    expect(constants).toBe(fakeConstants);
  });
});
