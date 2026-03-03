import { injectable } from "inversify";

@injectable()
export class DuplicateCheckConstants {
  public readonly LEADS_TABLE_NAME: string;

  constructor() {
    this.LEADS_TABLE_NAME = process.env.LEADS_TABLE_NAME ?? "";

    if (!this.LEADS_TABLE_NAME) {
      throw new Error("LEADS_TABLE_NAME env var is required");
    }
  }
}
