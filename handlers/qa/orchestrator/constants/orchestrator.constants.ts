import { injectable } from "inversify";

@injectable()
export class OrchestratorConstants {
  public readonly DUPLICATE_CHECK_LAMBDA_NAME: string;
  public readonly TRUSTED_FORM_LAMBDA_NAME: string;

  constructor() {
    this.DUPLICATE_CHECK_LAMBDA_NAME =
      process.env.DUPLICATE_CHECK_LAMBDA_NAME ?? "";
    this.TRUSTED_FORM_LAMBDA_NAME =
      process.env.TRUSTED_FORM_LAMBDA_NAME ?? "";
  }
}
