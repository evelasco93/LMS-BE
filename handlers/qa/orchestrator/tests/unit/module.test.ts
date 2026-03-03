import { beforeAll, describe, expect, it } from "vitest";
import { container } from "../../modules/orchestrator.module";
import { OrchestratorService } from "../../services/orchestrator.service";

class FakeLambdaInvokeUtil {}
const fakeConstants = {
  DUPLICATE_CHECK_LAMBDA_NAME: "qa-dup-check",
};

beforeAll(() => {
  container
    .rebind("LambdaInvokeUtil")
    .toConstantValue(new FakeLambdaInvokeUtil());
  container.rebind("OrchestratorConstants").toConstantValue(fakeConstants);
});

describe("QA orchestrator module container", () => {
  it("resolves service", () => {
    const service = container.get<OrchestratorService>("OrchestratorService");
    expect(service).toBeInstanceOf(OrchestratorService);
  });

  it("resolves constants override", () => {
    const constants = container.get<typeof fakeConstants>(
      "OrchestratorConstants",
    );
    expect(constants).toBe(fakeConstants);
  });
});
