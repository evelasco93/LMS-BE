import { beforeAll, describe, expect, it } from "vitest";
import { container } from "../../modules/duplicate-check.module";
import { DuplicateCheckService } from "../../services/duplicate-check.service";

class FakeDynamoDBUtil {}
const fakeConstants = { LEADS_TABLE_NAME: "leads-table" };

beforeAll(() => {
  container.rebind("DynamoDBUtil").toConstantValue(new FakeDynamoDBUtil());
  container.rebind("DuplicateCheckConstants").toConstantValue(fakeConstants);
});

describe("Duplicate check module container", () => {
  it("resolves service", () => {
    const service = container.get<DuplicateCheckService>(
      "DuplicateCheckService",
    );
    expect(service).toBeInstanceOf(DuplicateCheckService);
  });

  it("resolves constants override", () => {
    const constants = container.get<typeof fakeConstants>(
      "DuplicateCheckConstants",
    );
    expect(constants).toBe(fakeConstants);
  });
});
