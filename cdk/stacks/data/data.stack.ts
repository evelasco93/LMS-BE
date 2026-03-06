import { Stack, CfnOutput } from "aws-cdk-lib";
import { Table } from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";
import { IDataStackProps } from "./types/data.types";
import { ClientsDataStack } from "./clients-data.stack";
import { AffiliatesDataStack } from "./affiliates-data.stack";
import { CampaignsDataStack } from "./campaigns-data.stack";
import { LeadsDataStack } from "./leads-data.stack";
import { TenantSettingsDataStack } from "./tenant-settings-data.stack";

/**
 * Main Data Stack
 */
export class DataStack extends Stack {
  public readonly clientsTable: Table;
  public readonly affiliatesTable: Table;
  public readonly campaignsTable: Table;
  public readonly leadsTable: Table;
  /** Consolidated single table for credentials, credential schemas, and plugin settings */
  public readonly tenantSettingsTable: Table;

  constructor(scope: Construct, id: string, props: IDataStackProps) {
    super(scope, id, props);

    const { config, dataConfig } = props;

    const clientsDataStack = new ClientsDataStack(
      this,
      `${config.appPrefix}-ClientsData`,
      {
        tableConfig: dataConfig.tables.clients,
        logicalIdPrefix: config.appPrefix,
      },
    );

    const affiliatesDataStack = new AffiliatesDataStack(
      this,
      `${config.appPrefix}-AffiliatesData`,
      {
        tableConfig: dataConfig.tables.affiliates,
        logicalIdPrefix: config.appPrefix,
      },
    );

    const campaignsDataStack = new CampaignsDataStack(
      this,
      `${config.appPrefix}-CampaignsData`,
      {
        tableConfig: dataConfig.tables.campaigns,
        logicalIdPrefix: config.appPrefix,
      },
    );

    const leadsDataStack = new LeadsDataStack(
      this,
      `${config.appPrefix}-LeadsData`,
      {
        tableConfig: dataConfig.tables.leads,
        logicalIdPrefix: config.appPrefix,
      },
    );

    const tenantSettingsDataStack = new TenantSettingsDataStack(
      this,
      `${config.appPrefix}-TenantSettingsData`,
      {
        tableConfig: dataConfig.tables.tenantSettings,
        logicalIdPrefix: config.appPrefix,
      },
    );

    this.clientsTable = clientsDataStack.table;
    this.affiliatesTable = affiliatesDataStack.table;
    this.campaignsTable = campaignsDataStack.table;
    this.leadsTable = leadsDataStack.table;
    this.tenantSettingsTable = tenantSettingsDataStack.table;

    new CfnOutput(this, `${config.appPrefix}-TenantSettingsTableName`, {
      value: this.tenantSettingsTable.tableName,
      description:
        "Tenant Settings DynamoDB table name (credentials, schemas, plugin settings)",
      exportName: `${config.appPrefix}-tenant-settings-table-name`,
    });

    if (config.tags) {
      Object.entries(config.tags).forEach(([key, value]) => {
        this.tags.setTag(key, value);
      });
    }
  }
}
