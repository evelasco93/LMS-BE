import { injectable } from "inversify";

@injectable()
export class AffiliateConstants {
  public readonly AFFILIATES_TABLE_NAME: string;
  public readonly CAMPAIGNS_TABLE_NAME: string;
  public readonly LEADS_TABLE_NAME: string;

  constructor() {
    this.AFFILIATES_TABLE_NAME = process.env.AFFILIATES_TABLE_NAME ?? "";
    this.CAMPAIGNS_TABLE_NAME = process.env.CAMPAIGNS_TABLE_NAME ?? "";
    this.LEADS_TABLE_NAME = process.env.LEADS_TABLE_NAME ?? "";

    if (!this.AFFILIATES_TABLE_NAME) {
      throw new Error("AFFILIATES_TABLE_NAME env var is required");
    }

    if (!this.CAMPAIGNS_TABLE_NAME) {
      throw new Error("CAMPAIGNS_TABLE_NAME env var is required");
    }

    if (!this.LEADS_TABLE_NAME) {
      throw new Error("LEADS_TABLE_NAME env var is required");
    }
  }
}
