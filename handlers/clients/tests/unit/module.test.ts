import { beforeAll, describe, expect, it } from "vitest";
import { container } from "../../modules/client.module";
import { ClientService } from "../../services/client.service";
import { ClientController } from "../../controllers/client.controller";

class FakeDynamoDBUtil {}
const fakeConstants = { CLIENTS_TABLE_NAME: "clients-table" };

beforeAll(() => {
  container.rebind("DynamoDBUtil").toConstantValue(new FakeDynamoDBUtil());
  container.rebind("ClientConstants").toConstantValue(fakeConstants);
});

describe("Client module container", () => {
  it("resolves service with injected dependencies", () => {
    const service = container.get<ClientService>("ClientService");
    expect(service).toBeInstanceOf(ClientService);
  });

  it("resolves controller", () => {
    const controller = container.get<ClientController>(ClientController);
    expect(controller).toBeInstanceOf(ClientController);
  });

  it("uses overridden constants", () => {
    const constants = container.get<typeof fakeConstants>("ClientConstants");
    expect(constants).toBe(fakeConstants);
  });
});
