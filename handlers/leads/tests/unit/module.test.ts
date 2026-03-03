import { beforeAll, describe, expect, it } from "vitest";
import { container } from "../../modules/leads.module";
import { LeadsService } from "../../services/leads.service";
import { LeadsController } from "../../controllers/leads.controller";

class FakeDynamoDBUtil {}
const fakeConstants = {
  LEADS_TABLE_NAME: "leads-table",
  CAMPAIGNS_TABLE_NAME: "campaigns-table",
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

  it("uses overridden constants", () => {
    const constants = container.get<typeof fakeConstants>("LeadsConstants");
    expect(constants).toBe(fakeConstants);
  });
});
