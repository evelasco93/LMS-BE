import { injectable } from "inversify";

@injectable()
export class LogicRulesConstants {
  public readonly CAMPAIGNS_TABLE_NAME: string;

  constructor() {
    this.CAMPAIGNS_TABLE_NAME = process.env.CAMPAIGNS_TABLE_NAME ?? "";

    if (!this.CAMPAIGNS_TABLE_NAME) {
      throw new Error("CAMPAIGNS_TABLE_NAME env var is required");
    }
  }
}
