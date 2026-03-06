import { describe, expect, it, vi } from "vitest";

import { container } from "../../modules/tenant-config.module";
import { TenantConfigService } from "../../services/tenant-config.service";
import { TenantConfigController } from "../../controllers/tenant-config.controller";

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
