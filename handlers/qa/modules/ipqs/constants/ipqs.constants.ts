import { injectable } from "inversify";

@injectable()
export class IpqsConstants {
  public readonly TENANT_SETTINGS_TABLE_NAME: string;
  public readonly CREDENTIALS_ENCRYPTION_KEY: string;

  constructor() {
    this.TENANT_SETTINGS_TABLE_NAME =
      process.env.TENANT_SETTINGS_TABLE_NAME ?? "";
    this.CREDENTIALS_ENCRYPTION_KEY = (
      process.env.CREDENTIALS_ENCRYPTION_KEY ?? ""
    ).trim();

    if (!this.TENANT_SETTINGS_TABLE_NAME) {
      throw new Error("TENANT_SETTINGS_TABLE_NAME env var is required");
    }

    if (!this.CREDENTIALS_ENCRYPTION_KEY) {
      throw new Error("CREDENTIALS_ENCRYPTION_KEY env var is required");
    }
  }
}
