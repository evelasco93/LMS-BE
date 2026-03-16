import { injectable } from "inversify";

@injectable()
export class LeadsConstants {
  public readonly LEADS_TABLE_NAME: string;
  public readonly CAMPAIGNS_TABLE_NAME: string;
  public readonly QA_ORCHESTRATOR_LAMBDA_NAME: string;
  public readonly CRITERIA_VALIDATION_LAMBDA_NAME: string;
  public readonly LOGIC_RULES_LAMBDA_NAME: string;
  public readonly EXTERNAL_LEADS_API_URL: string;
  public readonly EXTERNAL_LEADS_API_NAME: string;
  public readonly EXTERNAL_LEADS_API_STAGE: string;
  public readonly AWS_REGION: string;
  public readonly AUDIT_LOGS_TABLE_NAME: string;
  public readonly LEAD_INTAKE_LOGS_TABLE_NAME: string;

  constructor() {
    this.LEADS_TABLE_NAME = process.env.LEADS_TABLE_NAME ?? "";
    this.CAMPAIGNS_TABLE_NAME = process.env.CAMPAIGNS_TABLE_NAME ?? "";
    this.QA_ORCHESTRATOR_LAMBDA_NAME =
      process.env.QA_ORCHESTRATOR_LAMBDA_NAME ?? "";
    this.CRITERIA_VALIDATION_LAMBDA_NAME =
      process.env.CRITERIA_VALIDATION_LAMBDA_NAME ?? "";
    this.LOGIC_RULES_LAMBDA_NAME = process.env.LOGIC_RULES_LAMBDA_NAME ?? "";
    this.EXTERNAL_LEADS_API_URL = process.env.EXTERNAL_LEADS_API_URL ?? "";
    this.EXTERNAL_LEADS_API_NAME = process.env.EXTERNAL_LEADS_API_NAME ?? "";
    this.EXTERNAL_LEADS_API_STAGE = process.env.EXTERNAL_LEADS_API_STAGE ?? "";
    this.AWS_REGION =
      process.env.AWS_REGION ??
      process.env.AWS_DEFAULT_REGION ??
      process.env.CDK_DEFAULT_REGION ??
      "us-east-1";
    this.AUDIT_LOGS_TABLE_NAME = process.env.AUDIT_LOGS_TABLE_NAME ?? "";
    this.LEAD_INTAKE_LOGS_TABLE_NAME =
      process.env.LEAD_INTAKE_LOGS_TABLE_NAME ?? "";

    if (!this.LEADS_TABLE_NAME) {
      throw new Error("LEADS_TABLE_NAME env var is required");
    }
    if (!this.CAMPAIGNS_TABLE_NAME) {
      throw new Error("CAMPAIGNS_TABLE_NAME env var is required");
    }
  }
}
