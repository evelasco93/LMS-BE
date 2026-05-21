import { injectable } from "inversify";

@injectable()
export class OrchestratorConstants {
  public readonly DUPLICATE_CHECK_LAMBDA_NAME: string;
  public readonly TRUSTED_FORM_LAMBDA_NAME: string;
  public readonly IPQS_LAMBDA_NAME: string;
  public readonly TENANT_SETTINGS_TABLE_NAME: string;
  public readonly CREDENTIALS_ENCRYPTION_KEY: string;

  constructor() {
    this.DUPLICATE_CHECK_LAMBDA_NAME =
      process.env.DUPLICATE_CHECK_LAMBDA_NAME ?? "";
    this.TRUSTED_FORM_LAMBDA_NAME = process.env.TRUSTED_FORM_LAMBDA_NAME ?? "";
    this.IPQS_LAMBDA_NAME = process.env.IPQS_LAMBDA_NAME ?? "";
    this.TENANT_SETTINGS_TABLE_NAME =
      process.env.TENANT_SETTINGS_TABLE_NAME ?? "";
    this.CREDENTIALS_ENCRYPTION_KEY = (
      process.env.CREDENTIALS_ENCRYPTION_KEY ?? ""
    ).trim();
  }
}
