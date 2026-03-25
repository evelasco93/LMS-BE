import { injectable } from "inversify";

@injectable()
export class UsersConstants {
  public readonly COGNITO_USER_POOL_ID: string;
  public readonly REGION: string;
  public readonly AUDIT_LOGS_TABLE_NAME: string;
  public readonly USER_TABLE_PREFERENCES_TABLE_NAME: string;

  constructor() {
    this.COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID ?? "";
    this.REGION = process.env.AWS_REGION ?? "us-east-1";
    this.AUDIT_LOGS_TABLE_NAME = process.env.AUDIT_LOGS_TABLE_NAME ?? "";
    this.USER_TABLE_PREFERENCES_TABLE_NAME =
      process.env.USER_TABLE_PREFERENCES_TABLE_NAME ?? "";
  }
}
