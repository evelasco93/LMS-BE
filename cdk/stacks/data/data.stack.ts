import { Stack, CfnOutput } from "aws-cdk-lib";
import { Table } from "aws-cdk-lib/aws-dynamodb";
import { Construct } from "constructs";
import { IDataStackProps } from "./types/data.types";
import { ClientsDataStack } from "./clients-data.stack";
import { AffiliatesDataStack } from "./affiliates-data.stack";
import { CampaignsDataStack } from "./campaigns-data.stack";
import { LeadsDataStack } from "./leads-data.stack";
import { CredentialsDataStack } from "./credentials-data.stack";
import { PluginSchemasDataStack } from "./plugin-schemas-data.stack";

/**
 * Main Data Stack
 */
export class DataStack extends Stack {
  public readonly clientsTable: Table;
  public readonly affiliatesTable: Table;
  public readonly campaignsTable: Table;
  public readonly leadsTable: Table;
  public readonly credentialsTable: Table;
  public readonly pluginSchemasTable: Table;

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

    const credentialsDataStack = new CredentialsDataStack(
      this,
      `${config.appPrefix}-CredentialsData`,
      {
        tableConfig: dataConfig.tables.credentials,
        logicalIdPrefix: config.appPrefix,
      },
    );

    const pluginSchemasDataStack = new PluginSchemasDataStack(
      this,
      `${config.appPrefix}-PluginSchemasData`,
      {
        tableConfig: dataConfig.tables.pluginSchemas,
        logicalIdPrefix: config.appPrefix,
      },
    );

    this.clientsTable = clientsDataStack.table;
    this.affiliatesTable = affiliatesDataStack.table;
    this.campaignsTable = campaignsDataStack.table;
    this.leadsTable = leadsDataStack.table;
    this.credentialsTable = credentialsDataStack.table;
    this.pluginSchemasTable = pluginSchemasDataStack.table;

    new CfnOutput(this, `${config.appPrefix}-CredentialsTableName`, {
      value: this.credentialsTable.tableName,
      description: "Credentials DynamoDB table name",
      exportName: `${config.appPrefix}-credentials-table-name`,
    });

    new CfnOutput(this, `${config.appPrefix}-PluginSchemasTableName`, {
      value: this.pluginSchemasTable.tableName,
      description: "Plugin Schemas DynamoDB table name",
      exportName: `${config.appPrefix}-plugin-schemas-table-name`,
    });

    if (config.tags) {
      Object.entries(config.tags).forEach(([key, value]) => {
        this.tags.setTag(key, value);
      });
    }
  }
}
