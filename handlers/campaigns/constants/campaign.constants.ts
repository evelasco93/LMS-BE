import { injectable } from "inversify";

@injectable()
export class CampaignConstants {
  public readonly CAMPAIGNS_TABLE_NAME: string;
  public readonly CLIENTS_TABLE_NAME: string;
  public readonly AFFILIATES_TABLE_NAME: string;

  constructor() {
    this.CAMPAIGNS_TABLE_NAME = process.env.CAMPAIGNS_TABLE_NAME ?? "";
    this.CLIENTS_TABLE_NAME = process.env.CLIENTS_TABLE_NAME ?? "";
    this.AFFILIATES_TABLE_NAME = process.env.AFFILIATES_TABLE_NAME ?? "";

    if (!this.CAMPAIGNS_TABLE_NAME) {
      throw new Error("CAMPAIGNS_TABLE_NAME env var is required");
    }
  }
}
