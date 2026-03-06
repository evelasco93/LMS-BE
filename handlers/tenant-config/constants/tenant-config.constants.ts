import { injectable } from "inversify";

@injectable()
export class TenantConfigConstants {
  public readonly TENANT_SETTINGS_TABLE_NAME: string;
  public readonly CREDENTIALS_ENCRYPTION_KEY: string;
  /** Optional: when set, disabling a plugin cascades disabled=false to all campaigns */
  public readonly CAMPAIGNS_TABLE_NAME: string;

  constructor() {
    this.TENANT_SETTINGS_TABLE_NAME =
      process.env.TENANT_SETTINGS_TABLE_NAME ?? "";
    this.CREDENTIALS_ENCRYPTION_KEY =
      process.env.CREDENTIALS_ENCRYPTION_KEY ?? "";
    this.CAMPAIGNS_TABLE_NAME = process.env.CAMPAIGNS_TABLE_NAME ?? "";

    if (!this.TENANT_SETTINGS_TABLE_NAME) {
      throw new Error("TENANT_SETTINGS_TABLE_NAME env var is required");
    }
    if (!this.CREDENTIALS_ENCRYPTION_KEY) {
      throw new Error("CREDENTIALS_ENCRYPTION_KEY env var is required");
    }
  }
}
