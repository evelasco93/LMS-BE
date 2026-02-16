import { Construct } from 'constructs';
import { Stack } from 'aws-cdk-lib';
import { Role, ServicePrincipal, ManagedPolicy, PolicyStatement, Effect } from 'aws-cdk-lib/aws-iam';
import { IIamStackProps, IRoleConfig } from './types/iam.types';

/**
 * IAM Stack
 * Manages all IAM roles and policies for the application
 */
export class IamStack extends Stack {
  public readonly clientsLambdaRole: Role;
  public readonly affiliatesLambdaRole: Role;

  constructor(scope: Construct, id: string, props: IIamStackProps) {
    super(scope, id, props);

    const { config, iamConfig } = props;

    // Create Clients Lambda Role
    this.clientsLambdaRole = this.createRole(
      `${config.appPrefix}-ClientsLambdaRole`,
      iamConfig.lambdaRoles.clients
    );

    // Create Affiliates Lambda Role
    this.affiliatesLambdaRole = this.createRole(
      `${config.appPrefix}-AffiliatesLambdaRole`,
      iamConfig.lambdaRoles.affiliates
    );

    // Apply tags
    if (config.tags) {
      Object.entries(config.tags).forEach(([key, value]) => {
        this.tags.setTag(key, value);
      });
    }
  }

  private createRole(id: string, roleConfig: IRoleConfig): Role {
    const role = new Role(this, id, {
      roleName: roleConfig.name,
      description: roleConfig.description,
      assumedBy: new ServicePrincipal(roleConfig.servicePrincipal),
    });

    // Attach managed policies
    if (roleConfig.managedPolicies) {
      roleConfig.managedPolicies.forEach(policyArn => {
        role.addManagedPolicy(ManagedPolicy.fromAwsManagedPolicyName(policyArn));
      });
    }

    // Add inline policies
    if (roleConfig.inlinePolicies) {
      roleConfig.inlinePolicies.forEach(policy => {
        role.addToPolicy(new PolicyStatement({
          effect: Effect.ALLOW,
          actions: policy.actions,
          resources: policy.resources,
        }));
      });
    }

    return role;
  }
}
