import { injectable } from "inversify";

@injectable()
export class LeadsConstants {
  public readonly LEADS_TABLE_NAME: string;
  public readonly LEADS_CAMPAIGN_CREATED_AT_INDEX_NAME: string;
  public readonly METRICS_TABLE_NAME: string;
  public readonly METRICS_TABLE_PARTITION_KEY: string;
  public readonly METRICS_TABLE_SORT_KEY: string;
  public readonly METRICS_TABLE_ITEM_TYPE_ATTRIBUTE: string;
  public readonly METRICS_TABLE_BUCKET_START_ATTRIBUTE: string;
  public readonly METRICS_ITEM_TYPE_BUCKET_START_INDEX_NAME: string;
  public readonly METRICS_ITEM_TYPE_BUCKET_START_INDEX_PARTITION_KEY: string;
  public readonly METRICS_ITEM_TYPE_BUCKET_START_INDEX_SORT_KEY: string;
  // CR-001 GSI2: affiliate-as-source pivot.
  public readonly METRICS_AFFILIATE_ID_BUCKET_START_COMPOSITE_INDEX_NAME: string;
  public readonly METRICS_AFFILIATE_ID_BUCKET_START_COMPOSITE_INDEX_PARTITION_KEY: string;
  public readonly METRICS_AFFILIATE_ID_BUCKET_START_COMPOSITE_INDEX_SORT_KEY: string;
  // CR-001 DLQ: leads-lambda → metrics-dlq on emit failure.
  public readonly METRICS_DLQ_URL: string;
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
  public readonly TRUSTED_FORM_LAMBDA_NAME: string;
  public readonly TENANT_SETTINGS_TABLE_NAME: string;

  constructor() {
    this.LEADS_TABLE_NAME = process.env.LEADS_TABLE_NAME ?? "";
    this.LEADS_CAMPAIGN_CREATED_AT_INDEX_NAME =
      process.env.LEADS_CAMPAIGN_CREATED_AT_INDEX_NAME ??
      `${this.LEADS_TABLE_NAME}-campaign-created-at-index`;
    this.METRICS_TABLE_NAME = process.env.METRICS_TABLE_NAME ?? "";
    this.METRICS_TABLE_PARTITION_KEY =
      process.env.METRICS_TABLE_PARTITION_KEY ?? "pk";
    this.METRICS_TABLE_SORT_KEY = process.env.METRICS_TABLE_SORT_KEY ?? "sk";
    this.METRICS_TABLE_ITEM_TYPE_ATTRIBUTE =
      process.env.METRICS_TABLE_ITEM_TYPE_ATTRIBUTE ?? "item_type";
    this.METRICS_TABLE_BUCKET_START_ATTRIBUTE =
      process.env.METRICS_TABLE_BUCKET_START_ATTRIBUTE ?? "bucket_start";
    this.METRICS_ITEM_TYPE_BUCKET_START_INDEX_NAME =
      process.env.METRICS_ITEM_TYPE_BUCKET_START_INDEX_NAME ?? "";
    this.METRICS_ITEM_TYPE_BUCKET_START_INDEX_PARTITION_KEY =
      process.env.METRICS_ITEM_TYPE_BUCKET_START_INDEX_PARTITION_KEY ??
      "item_type";
    this.METRICS_ITEM_TYPE_BUCKET_START_INDEX_SORT_KEY =
      process.env.METRICS_ITEM_TYPE_BUCKET_START_INDEX_SORT_KEY ??
      "bucket_start";
    this.METRICS_AFFILIATE_ID_BUCKET_START_COMPOSITE_INDEX_NAME =
      process.env.METRICS_AFFILIATE_ID_BUCKET_START_COMPOSITE_INDEX_NAME ?? "";
    this.METRICS_AFFILIATE_ID_BUCKET_START_COMPOSITE_INDEX_PARTITION_KEY =
      process.env
        .METRICS_AFFILIATE_ID_BUCKET_START_COMPOSITE_INDEX_PARTITION_KEY ??
      "affiliate_id";
    this.METRICS_AFFILIATE_ID_BUCKET_START_COMPOSITE_INDEX_SORT_KEY =
      process.env.METRICS_AFFILIATE_ID_BUCKET_START_COMPOSITE_INDEX_SORT_KEY ??
      "bucket_start_composite";
    this.METRICS_DLQ_URL = process.env.METRICS_DLQ_URL ?? "";
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
    this.TRUSTED_FORM_LAMBDA_NAME = process.env.TRUSTED_FORM_LAMBDA_NAME ?? "";
    this.TENANT_SETTINGS_TABLE_NAME =
      process.env.TENANT_SETTINGS_TABLE_NAME ?? "";

    if (!this.LEADS_TABLE_NAME) {
      throw new Error("LEADS_TABLE_NAME env var is required");
    }
    if (!this.CAMPAIGNS_TABLE_NAME) {
      throw new Error("CAMPAIGNS_TABLE_NAME env var is required");
    }
    if (!this.METRICS_TABLE_NAME) {
      throw new Error("METRICS_TABLE_NAME env var is required");
    }
  }
}
