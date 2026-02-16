import { Stack, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Table, AttributeType, BillingMode, ProjectionType } from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { IDataStackProps } from './types/data.types';
import { DynamoDBTableStack } from './dynamodb-table.stack';

/**
 * Main Data Stack
 * Contains all DynamoDB tables as nested stacks
 */
export class DataStack extends Stack {
  public readonly clientsTable: Table;
  public readonly affiliatesTable: Table;

  constructor(scope: Construct, id: string, props: IDataStackProps) {
    super(scope, id, props);

    const { config, dataConfig } = props;

    // Create Clients table
    const clientsTableStack = new DynamoDBTableStack(this, `${config.appPrefix}-ClientsTable`, {
      config: dataConfig.tables.clients,
    });

    // Create Affiliates table
    const affiliatesTableStack = new DynamoDBTableStack(
      this,
      `${config.appPrefix}-AffiliatesTable`,
      {
        config: dataConfig.tables.affiliates,
      }
    );

    // Expose tables
    this.clientsTable = clientsTableStack.table;
    this.affiliatesTable = affiliatesTableStack.table;

    // Stack outputs
    new CfnOutput(this, `${config.appPrefix}-ClientsTableName`, {
      value: this.clientsTable.tableName,
      exportName: `${config.appPrefix}-clients-table-name`,
    });

    new CfnOutput(this, `${config.appPrefix}-AffiliatesTableName`, {
      value: this.affiliatesTable.tableName,
      exportName: `${config.appPrefix}-affiliates-table-name`,
    });

    // Tags
    if (config.tags) {
      Object.entries(config.tags).forEach(([key, value]) => {
        this.tags.setTag(key, value);
      });
    }
  }
}
