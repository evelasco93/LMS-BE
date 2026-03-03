import { injectable } from "inversify";

@injectable()
export class AuthConstants {
  public readonly COGNITO_USER_POOL_ID: string;
  public readonly COGNITO_CLIENT_ID: string;
  public readonly REGION: string;

  constructor() {
    this.COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID ?? "";
    this.COGNITO_CLIENT_ID = process.env.COGNITO_CLIENT_ID ?? "";
    this.REGION = process.env.AWS_REGION ?? "us-east-1";
  }
}
