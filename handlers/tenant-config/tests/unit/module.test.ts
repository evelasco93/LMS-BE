import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@shared/services/secrets-manager.util", () => ({
  SecretsManagerUtil: class SecretsManagerUtil {},
}));

import { container } from "../../modules/tenant-config.module";
import { TenantConfigService } from "../../services/tenant-config.service";
import { TenantConfigController } from "../../controllers/tenant-config.controller";

class FakeSecretsManagerUtil {}
const fakeConstants = {
  IPQS_SECRET_NAME: "test-ipqs-secret",
  TRUSTED_FORMS_SECRET_NAME: "test-trusted-forms-secret",
  SECRET_PREFIX: "test-tenant-config",
  INTERNAL_API_AUTH_TOKEN_SECRET_NAME: "test-internal-auth-secret",
};

beforeAll(() => {
  container
    .rebind("SecretsManagerUtil")
    .toConstantValue(new FakeSecretsManagerUtil());
  container.rebind("TenantConfigConstants").toConstantValue(fakeConstants);
});

describe("Tenant config module container", () => {
  it("resolves service", () => {
    const service = container.get<TenantConfigService>("TenantConfigService");
    expect(service).toBeInstanceOf(TenantConfigService);
  });

  it("resolves controller", () => {
    const controller = container.get<TenantConfigController>(
      TenantConfigController,
    );
    expect(controller).toBeInstanceOf(TenantConfigController);
  });
});
