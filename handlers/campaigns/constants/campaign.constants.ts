import { injectable } from "inversify";
import { BaseCriteriaDataType } from "../interfaces/ICampaign.interface";

/**
 * Shape of a single entry in BASE_CRITERIA_FIELDS.
 * Add new fields here to extend the preset — no other changes required.
 */
export interface IBaseCriteriaFieldDef {
  field_label: string;
  field_name: string;
  data_type: BaseCriteriaDataType;
  required: true;
}

/**
 * Preset fields applied when a campaign is seeded with base criteria.
 * To add a new base field: append an entry here — nothing else needs to change.
 */
export const BASE_CRITERIA_FIELDS: ReadonlyArray<IBaseCriteriaFieldDef> = [
  {
    field_label: "First Name",
    field_name: "first_name",
    data_type: "Text",
    required: true,
  },
  {
    field_label: "Last Name",
    field_name: "last_name",
    data_type: "Text",
    required: true,
  },
  {
    field_label: "Phone",
    field_name: "phone",
    data_type: "Text",
    required: true,
  },
  {
    field_label: "State",
    field_name: "state",
    data_type: "US State",
    required: true,
  },
  {
    field_label: "Email",
    field_name: "email",
    data_type: "Text",
    required: true,
  },
  {
    field_label: "IP Address",
    field_name: "ip_address",
    data_type: "Text",
    required: true,
  },
  {
    field_label: "Marketing Source",
    field_name: "marketing_source",
    data_type: "Text",
    required: true,
  },
  {
    field_label: "Pub ID",
    field_name: "pub_id",
    data_type: "Text",
    required: true,
  },
  {
    field_label: "Campaign ID",
    field_name: "campaign_id",
    data_type: "Text",
    required: true,
  },
  {
    field_label: "Campaign Key",
    field_name: "campaign_key",
    data_type: "Text",
    required: true,
  },
] as const;

@injectable()
export class CampaignConstants {
  public readonly CAMPAIGNS_TABLE_NAME: string;
  public readonly CLIENTS_TABLE_NAME: string;
  public readonly AFFILIATES_TABLE_NAME: string;
  public readonly LEADS_TABLE_NAME: string;
  /** Optional: guards campaign plugin enable against the global tenant-config setting */
  public readonly TENANT_SETTINGS_TABLE_NAME: string;
  /** Base URL for the external leads submission endpoint, returned in affiliate link responses */
  public readonly LEADS_BASE_URL: string;
  public readonly AUDIT_LOGS_TABLE_NAME: string;

  constructor() {
    this.CAMPAIGNS_TABLE_NAME = process.env.CAMPAIGNS_TABLE_NAME ?? "";
    this.CLIENTS_TABLE_NAME = process.env.CLIENTS_TABLE_NAME ?? "";
    this.AFFILIATES_TABLE_NAME = process.env.AFFILIATES_TABLE_NAME ?? "";
    this.LEADS_TABLE_NAME = process.env.LEADS_TABLE_NAME ?? "";
    this.TENANT_SETTINGS_TABLE_NAME =
      process.env.TENANT_SETTINGS_TABLE_NAME ?? "";
    this.LEADS_BASE_URL =
      process.env.LEADS_BASE_URL ??
      "https://a1tu1h2ev8.execute-api.us-east-1.amazonaws.com/dev/v2/leads";
    this.AUDIT_LOGS_TABLE_NAME = process.env.AUDIT_LOGS_TABLE_NAME ?? "";

    if (!this.CAMPAIGNS_TABLE_NAME) {
      throw new Error("CAMPAIGNS_TABLE_NAME env var is required");
    }

    if (!this.LEADS_TABLE_NAME) {
      throw new Error("LEADS_TABLE_NAME env var is required");
    }
  }
}
