import { NestedStack, NestedStackProps, RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import { Table, AttributeType, BillingMode, ProjectionType, StreamViewType } from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { ITableConfig } from './types/data.types';

export interface IDynamoDBTableProps extends NestedStackProps {
  config: ITableConfig;
  removalPolicy?: RemovalPolicy;
}

/**
 * Nested stack for a single DynamoDB table
 */
export class DynamoDBTableStack extends NestedStack {
  public readonly table: Table;

  constructor(scope: Construct, id: string, props: IDynamoDBTableProps) {
    super(scope, id);

    const { config, removalPolicy = RemovalPolicy.DESTROY } = props;

    // Create the table
    this.table = new Table(this, 'Table', {
      tableName: config.tableName,
      partitionKey: {
        name: config.partitionKey.name,
        type: this.getAttributeType(config.partitionKey.type),
      },
      sortKey: config.sortKey
        ? {
            name: config.sortKey.name,
            type: this.getAttributeType(config.sortKey.type),
          }
        : undefined,
      billingMode: BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: config.pointInTimeRecovery ? { pointInTimeRecoveryEnabled: true } : undefined,
      deletionProtection: config.deletionProtection || false,
      removalPolicy,
    });

    // Add Global Secondary Indexes
    if (config.gsi) {
      config.gsi.forEach((gsiConfig) => {
        this.table.addGlobalSecondaryIndex({
          indexName: gsiConfig.indexName,
          partitionKey: {
            name: gsiConfig.partitionKey.name,
            type: this.getAttributeType(gsiConfig.partitionKey.type),
          },
          sortKey: gsiConfig.sortKey
            ? {
                name: gsiConfig.sortKey.name,
                type: this.getAttributeType(gsiConfig.sortKey.type),
              }
            : undefined,
          projectionType: this.getProjectionType(gsiConfig.projectionType),
          nonKeyAttributes: gsiConfig.nonKeyAttributes,
        });
      });
    }

    // Outputs
    new CfnOutput(this, 'TableName', {
      value: this.table.tableName,
      description: `DynamoDB table name for ${config.tableName}`,
    });

    new CfnOutput(this, 'TableArn', {
      value: this.table.tableArn,
      description: `DynamoDB table ARN for ${config.tableName}`,
    });
  }

  private getAttributeType(type: 'S' | 'N' | 'B'): AttributeType {
    switch (type) {
      case 'S':
        return AttributeType.STRING;
      case 'N':
        return AttributeType.NUMBER;
      case 'B':
        return AttributeType.BINARY;
      default:
        return AttributeType.STRING;
    }
  }

  private getProjectionType(
    type?: 'ALL' | 'KEYS_ONLY' | 'INCLUDE'
  ): ProjectionType {
    switch (type) {
      case 'KEYS_ONLY':
        return ProjectionType.KEYS_ONLY;
      case 'INCLUDE':
        return ProjectionType.INCLUDE;
      case 'ALL':
      default:
        return ProjectionType.ALL;
    }
  }
}
