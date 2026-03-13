import { injectable } from "inversify";

@injectable()
export class AuditConstants {
  public readonly AUDIT_LOGS_TABLE_NAME: string;
  public readonly AUDIT_LOGS_S3_BUCKET: string;

  constructor() {
    this.AUDIT_LOGS_TABLE_NAME = process.env.AUDIT_LOGS_TABLE_NAME ?? "";
    this.AUDIT_LOGS_S3_BUCKET = process.env.AUDIT_LOGS_S3_BUCKET ?? "";

    if (!this.AUDIT_LOGS_TABLE_NAME) {
      throw new Error("AUDIT_LOGS_TABLE_NAME env var is required");
    }

    if (!this.AUDIT_LOGS_S3_BUCKET) {
      throw new Error("AUDIT_LOGS_S3_BUCKET env var is required");
    }
  }
}
