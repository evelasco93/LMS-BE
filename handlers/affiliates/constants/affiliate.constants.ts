import { injectable } from "inversify";

@injectable()
export class AffiliateConstants {
  public readonly AFFILIATES_TABLE_NAME: string;

  constructor() {
    this.AFFILIATES_TABLE_NAME = process.env.AFFILIATES_TABLE_NAME ?? "";

    if (!this.AFFILIATES_TABLE_NAME) {
      throw new Error("AFFILIATES_TABLE_NAME env var is required");
    }
  }
}
