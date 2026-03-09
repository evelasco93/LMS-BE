import { injectable } from "inversify";

@injectable()
export class CampaignConstants {
  public readonly CAMPAIGNS_TABLE_NAME: string;
  public readonly CLIENTS_TABLE_NAME: string;
  public readonly AFFILIATES_TABLE_NAME: string;
  public readonly LEADS_TABLE_NAME: string;
  /** Optional: guards campaign plugin enable against the global tenant-config setting */
  public readonly TENANT_SETTINGS_TABLE_NAME: string;
  /** Base URL for the external leads submission endpoint, returned in affiliate link responses */
  public readonly LEADS_BASE_URL: string;

  constructor() {
    this.CAMPAIGNS_TABLE_NAME = process.env.CAMPAIGNS_TABLE_NAME ?? "";
    this.CLIENTS_TABLE_NAME = process.env.CLIENTS_TABLE_NAME ?? "";
    this.AFFILIATES_TABLE_NAME = process.env.AFFILIATES_TABLE_NAME ?? "";
    this.LEADS_TABLE_NAME = process.env.LEADS_TABLE_NAME ?? "";
    this.TENANT_SETTINGS_TABLE_NAME =
      process.env.TENANT_SETTINGS_TABLE_NAME ?? "";
    this.LEADS_BASE_URL =
      process.env.LEADS_BASE_URL ??
      "https://a1tu1h2ev8.execute-api.us-east-1.amazonaws.com/dev/v2/leads";

    if (!this.CAMPAIGNS_TABLE_NAME) {
      throw new Error("CAMPAIGNS_TABLE_NAME env var is required");
    }

    if (!this.LEADS_TABLE_NAME) {
      throw new Error("LEADS_TABLE_NAME env var is required");
    }
  }
}
