import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { ResourceNameBuilder } from '../../common/utils/resourceNameBuilder';

export interface DataStackProps extends cdk.StackProps {
  resourceNameBuilder: ResourceNameBuilder;
}

export class DataStack extends cdk.Stack {
  public readonly leadsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);

    const { resourceNameBuilder } = props;

    // DynamoDB Table for Leads
    this.leadsTable = new dynamodb.Table(this, 'LeadsTable', {
      tableName: resourceNameBuilder.buildTableName('leads'),
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // For prototype only
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: false, // For prototype only
      },
    });

    // GSI for phone lookup (duplicate check)
    this.leadsTable.addGlobalSecondaryIndex({
      indexName: 'phone-index',
      partitionKey: {
        name: 'phone',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // GSI for email lookup (duplicate check)
    this.leadsTable.addGlobalSecondaryIndex({
      indexName: 'email-index',
      partitionKey: {
        name: 'email',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'timestamp',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // Output the table name
    new cdk.CfnOutput(this, 'LeadsTableName', {
      value: this.leadsTable.tableName,
      description: 'DynamoDB Leads Table Name',
    });

    // Output the table ARN
    new cdk.CfnOutput(this, 'LeadsTableArn', {
      value: this.leadsTable.tableArn,
      description: 'DynamoDB Leads Table ARN',
    });
  }
}
