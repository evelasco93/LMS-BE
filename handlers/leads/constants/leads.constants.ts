import { injectable } from "inversify";

@injectable()
export class LeadsConstants {
  public readonly LEADS_TABLE_NAME: string;
  public readonly CAMPAIGNS_TABLE_NAME: string;
  public readonly QA_ORCHESTRATOR_LAMBDA_NAME: string;
  public readonly CRITERIA_VALIDATION_LAMBDA_NAME: string;

  constructor() {
    this.LEADS_TABLE_NAME = process.env.LEADS_TABLE_NAME ?? "";
    this.CAMPAIGNS_TABLE_NAME = process.env.CAMPAIGNS_TABLE_NAME ?? "";
    this.QA_ORCHESTRATOR_LAMBDA_NAME =
      process.env.QA_ORCHESTRATOR_LAMBDA_NAME ?? "";
    this.CRITERIA_VALIDATION_LAMBDA_NAME =
      process.env.CRITERIA_VALIDATION_LAMBDA_NAME ?? "";

    if (!this.LEADS_TABLE_NAME) {
      throw new Error("LEADS_TABLE_NAME env var is required");
    }
    if (!this.CAMPAIGNS_TABLE_NAME) {
      throw new Error("CAMPAIGNS_TABLE_NAME env var is required");
    }
  }
}
