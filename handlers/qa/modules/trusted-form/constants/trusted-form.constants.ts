import { injectable } from "inversify";

@injectable()
export class TrustedFormConstants {
  public readonly CREDENTIALS_TABLE_NAME: string;
  public readonly CREDENTIALS_ENCRYPTION_KEY: string;

  constructor() {
    this.CREDENTIALS_TABLE_NAME = process.env.CREDENTIALS_TABLE_NAME ?? "";
    this.CREDENTIALS_ENCRYPTION_KEY =
      process.env.CREDENTIALS_ENCRYPTION_KEY ?? "";

    if (!this.CREDENTIALS_TABLE_NAME) {
      throw new Error("CREDENTIALS_TABLE_NAME env var is required");
    }

    if (!this.CREDENTIALS_ENCRYPTION_KEY) {
      throw new Error("CREDENTIALS_ENCRYPTION_KEY env var is required");
    }
  }
}
