import { Stack, CfnOutput } from "aws-cdk-lib";
import { Table } from "aws-cdk-lib/aws-dynamodb";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import { IDataStackProps } from "./types/data.types";
import { ClientsDataStack } from "./clients-data.stack";
import { AffiliatesDataStack } from "./affiliates-data.stack";
import { CampaignsDataStack } from "./campaigns-data.stack";
import { LeadsDataStack } from "./leads-data.stack";

/**
 * Main Data Stack
 */
export class DataStack extends Stack {
  public readonly clientsTable: Table;
  public readonly affiliatesTable: Table;
  public readonly campaignsTable: Table;
  public readonly leadsTable: Table;
  public readonly ipqsCredentialsSecret: Secret;
  public readonly trustedFormsCredentialsSecret: Secret;
  public readonly internalApiAuthTokenSecret: Secret;

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

    this.clientsTable = clientsDataStack.table;
    this.affiliatesTable = affiliatesDataStack.table;
    this.campaignsTable = campaignsDataStack.table;
    this.leadsTable = leadsDataStack.table;

    this.ipqsCredentialsSecret = new Secret(
      this,
      `${config.appPrefix}-IpqsCredentialsSecret`,
      {
        secretName: dataConfig.secrets.ipqsCredentials.secretName,
        description: dataConfig.secrets.ipqsCredentials.description,
        generateSecretString: {
          secretStringTemplate: JSON.stringify({ provider: "ipqs" }),
          generateStringKey: "apiKey",
          excludePunctuation: true,
          passwordLength: 48,
        },
      },
    );

    this.trustedFormsCredentialsSecret = new Secret(
      this,
      `${config.appPrefix}-TrustedFormsCredentialsSecret`,
      {
        secretName: dataConfig.secrets.trustedFormsCredentials.secretName,
        description: dataConfig.secrets.trustedFormsCredentials.description,
        generateSecretString: {
          secretStringTemplate: JSON.stringify({ provider: "trusted_forms" }),
          generateStringKey: "password",
          excludePunctuation: true,
          passwordLength: 48,
        },
      },
    );

    this.internalApiAuthTokenSecret = new Secret(
      this,
      `${config.appPrefix}-InternalApiAuthTokenSecret`,
      {
        secretName: dataConfig.secrets.internalApiAuthToken.secretName,
        description: dataConfig.secrets.internalApiAuthToken.description,
        generateSecretString: {
          secretStringTemplate: JSON.stringify({ tokenType: "bearer" }),
          generateStringKey: "token",
          passwordLength: 64,
          excludePunctuation: true,
        },
      },
    );

    new CfnOutput(this, `${config.appPrefix}-IpqsCredentialsSecretName`, {
      value: this.ipqsCredentialsSecret.secretName,
      description: "IPQS credentials secret name",
    });

    new CfnOutput(
      this,
      `${config.appPrefix}-TrustedFormsCredentialsSecretName`,
      {
        value: this.trustedFormsCredentialsSecret.secretName,
        description: "Trusted Forms credentials secret name",
      },
    );

    new CfnOutput(this, `${config.appPrefix}-InternalApiAuthTokenSecretName`, {
      value: this.internalApiAuthTokenSecret.secretName,
      description: "Internal API auth token secret name",
    });

    if (config.tags) {
      Object.entries(config.tags).forEach(([key, value]) => {
        this.tags.setTag(key, value);
      });
    }
  }
}
