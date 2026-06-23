import { injectable } from "inversify";

@injectable()
export class DispositionConstants {
  public readonly DISPOSITIONS_TABLE_NAME: string;
  public readonly DISPOSITION_ROWS_TABLE_NAME: string;
  public readonly PUBLIC_DASHBOARDS_TABLE_NAME: string;
  public readonly LEADS_TABLE_NAME: string;
  public readonly CAMPAIGNS_TABLE_NAME: string;
  public readonly AFFILIATES_TABLE_NAME: string;

  constructor() {
    this.DISPOSITIONS_TABLE_NAME =
      process.env.DISPOSITIONS_TABLE_NAME ?? "dispositions";
    this.DISPOSITION_ROWS_TABLE_NAME =
      process.env.DISPOSITION_ROWS_TABLE_NAME ?? "disposition_rows";
    this.PUBLIC_DASHBOARDS_TABLE_NAME =
      process.env.PUBLIC_DASHBOARDS_TABLE_NAME ?? "public_dashboards";
    this.LEADS_TABLE_NAME = process.env.LEADS_TABLE_NAME ?? "leads";
    this.CAMPAIGNS_TABLE_NAME = process.env.CAMPAIGNS_TABLE_NAME ?? "campaigns";
    this.AFFILIATES_TABLE_NAME =
      process.env.AFFILIATES_TABLE_NAME ?? "affiliates";
  }
}
