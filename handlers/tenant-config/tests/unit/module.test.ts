import { describe, expect, it, vi } from "vitest";
import { TenantConfigService } from "../../services/tenant-config.service";
import { TenantConfigController } from "../../controllers/tenant-config.controller";

describe("Tenant config module container", () => {
  async function loadContainer() {
    process.env.CREDENTIALS_TABLE_NAME ??= "test-credentials-table";
    process.env.CREDENTIALS_ENCRYPTION_KEY ??=
      "0000000000000000000000000000000000000000000000000000000000000000";
    process.env.PLUGIN_SCHEMAS_TABLE_NAME ??= "test-plugin-schemas-table";
    process.env.TENANT_SETTINGS_TABLE_NAME ??= "test-tenant-settings-table";
    process.env.AUDIT_LOGS_TABLE_NAME ??= "test-audit-logs-table";

    const module = await import("../../modules/tenant-config.module");
    return module.container;
  }

  it("resolves service", async () => {
    const container = await loadContainer();
    const service = container.get<TenantConfigService>("TenantConfigService");
    expect(service).toBeInstanceOf(TenantConfigService);
  });

  it("resolves controller", async () => {
    const container = await loadContainer();
    const controller = container.get<TenantConfigController>(
      TenantConfigController,
    );
    expect(controller).toBeInstanceOf(TenantConfigController);
  });
});
