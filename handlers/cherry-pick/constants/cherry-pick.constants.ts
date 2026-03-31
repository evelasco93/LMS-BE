import { injectable } from "inversify";

@injectable()
export class CherryPickConstants {
  public readonly LEADS_TABLE_NAME: string;
  public readonly CAMPAIGNS_TABLE_NAME: string;
  public readonly CLIENTS_TABLE_NAME: string;
  public readonly AUDIT_LOGS_TABLE_NAME: string;
  public readonly TRUSTED_FORM_LAMBDA_NAME: string;
  public readonly TENANT_SETTINGS_TABLE_NAME: string;

  constructor() {
    this.LEADS_TABLE_NAME = process.env.LEADS_TABLE_NAME ?? "";
    this.CAMPAIGNS_TABLE_NAME = process.env.CAMPAIGNS_TABLE_NAME ?? "";
    this.CLIENTS_TABLE_NAME = process.env.CLIENTS_TABLE_NAME ?? "";
    this.AUDIT_LOGS_TABLE_NAME = process.env.AUDIT_LOGS_TABLE_NAME ?? "";
    this.TRUSTED_FORM_LAMBDA_NAME = process.env.TRUSTED_FORM_LAMBDA_NAME ?? "";
    this.TENANT_SETTINGS_TABLE_NAME =
      process.env.TENANT_SETTINGS_TABLE_NAME ?? "";
  }
}
