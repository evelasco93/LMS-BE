import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import { ResourceNameBuilder } from '../../common/utils/resourceNameBuilder';

export interface IamStackProps extends cdk.StackProps {
  resourceNameBuilder: ResourceNameBuilder;
  leadsTableArn: string;
}

export class IamStack extends cdk.Stack {
  public readonly lambdaExecutionRole: iam.Role;

  constructor(scope: Construct, id: string, props: IamStackProps) {
    super(scope, id, props);

    const { resourceNameBuilder, leadsTableArn } = props;

    // Lambda Execution Role
    this.lambdaExecutionRole = new iam.Role(this, 'LambdaExecutionRole', {
      roleName: resourceNameBuilder.buildRoleName('lead-intake-lambda'),
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Execution role for Lead Intake Lambda',
    });

    // CloudWatch Logs Policy
    this.lambdaExecutionRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
    );

    // DynamoDB Read/Write Policy
    const dynamoDbPolicy = new iam.Policy(this, 'DynamoDbPolicy', {
      policyName: resourceNameBuilder.buildPolicyName('dynamodb-access'),
      statements: [
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'dynamodb:PutItem',
            'dynamodb:GetItem',
            'dynamodb:Scan',
            'dynamodb:Query',
            'dynamodb:UpdateItem',
            'dynamodb:DeleteItem',
            'dynamodb:BatchWriteItem',
            'dynamodb:BatchGetItem',
          ],
          resources: [
            leadsTableArn,
            `${leadsTableArn}/index/*`,
          ],
        }),
      ],
    });

    this.lambdaExecutionRole.attachInlinePolicy(dynamoDbPolicy);

    // Output the role ARN
    new cdk.CfnOutput(this, 'LambdaExecutionRoleArn', {
      value: this.lambdaExecutionRole.roleArn,
      description: 'Lambda Execution Role ARN',
    });
  }
}
