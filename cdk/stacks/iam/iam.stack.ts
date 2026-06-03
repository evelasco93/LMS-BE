import { Construct } from "constructs";
import { Stack } from "aws-cdk-lib";
import {
  Role,
  ServicePrincipal,
  ManagedPolicy,
  PolicyStatement,
  Effect,
} from "aws-cdk-lib/aws-iam";
import { IIamStackProps, IRoleConfig } from "./types/iam.types";

/**
 * IAM Stack
 * Manages all IAM roles and policies for the application
 */
export class IamStack extends Stack {
  public readonly clientsLambdaRole: Role;
  public readonly affiliatesLambdaRole: Role;
  public readonly campaignsLambdaRole: Role;
  public readonly leadsLambdaRole: Role;
  public readonly metricsLambdaRole: Role;
  public readonly tenantConfigLambdaRole: Role;
  public readonly qaOrchestratorLambdaRole: Role;
  public readonly qaDuplicateCheckLambdaRole: Role;
  public readonly qaTrustedFormLambdaRole: Role;
  public readonly qaIpqsLambdaRole: Role;
  public readonly qaCriteriaValidationLambdaRole: Role;
  public readonly qaLogicRulesLambdaRole: Role;
  public readonly authLambdaRole: Role;
  public readonly usersLambdaRole: Role;
  public readonly auditLambdaRole: Role;
  public readonly cherryPickLambdaRole: Role;
  public readonly metricsDlqRetryLambdaRole: Role;

  constructor(scope: Construct, id: string, props: IIamStackProps) {
    super(scope, id, props);

    const { config, iamConfig } = props;

    // Create Clients Lambda Role
    this.clientsLambdaRole = this.createRole(
      `${config.appPrefix}-ClientsLambdaRole`,
      iamConfig.lambdaRoles.clients,
    );

    // Create Affiliates Lambda Role
    this.affiliatesLambdaRole = this.createRole(
      `${config.appPrefix}-AffiliatesLambdaRole`,
      iamConfig.lambdaRoles.affiliates,
    );

    // Create Campaigns Lambda Role
    this.campaignsLambdaRole = this.createRole(
      `${config.appPrefix}-CampaignsLambdaRole`,
      iamConfig.lambdaRoles.campaigns,
    );

    // Create Leads Lambda Role
    this.leadsLambdaRole = this.createRole(
      `${config.appPrefix}-LeadsLambdaRole`,
      iamConfig.lambdaRoles.leads,
    );

    this.metricsLambdaRole = this.createRole(
      `${config.appPrefix}-MetricsLambdaRole`,
      iamConfig.lambdaRoles.metrics,
    );

    this.tenantConfigLambdaRole = this.createRole(
      `${config.appPrefix}-TenantConfigLambdaRole`,
      iamConfig.lambdaRoles.tenantConfig,
    );

    // Create QA Orchestrator Lambda Role
    this.qaOrchestratorLambdaRole = this.createRole(
      `${config.appPrefix}-QaOrchestratorLambdaRole`,
      iamConfig.lambdaRoles.qaOrchestrator,
    );

    // Create QA Duplicate Check Lambda Role
    this.qaDuplicateCheckLambdaRole = this.createRole(
      `${config.appPrefix}-QaDuplicateCheckLambdaRole`,
      iamConfig.lambdaRoles.qaDuplicateCheck,
    );

    // Create QA TrustedForm Lambda Role
    this.qaTrustedFormLambdaRole = this.createRole(
      `${config.appPrefix}-QaTrustedFormLambdaRole`,
      iamConfig.lambdaRoles.qaTrustedForm,
    );

    // Create QA IPQS Lambda Role
    this.qaIpqsLambdaRole = this.createRole(
      `${config.appPrefix}-QaIpqsLambdaRole`,
      iamConfig.lambdaRoles.qaIpqs,
    );

    // Create QA Criteria Validation Lambda Role
    this.qaCriteriaValidationLambdaRole = this.createRole(
      `${config.appPrefix}-QaCriteriaValidationLambdaRole`,
      iamConfig.lambdaRoles.qaCriteriaValidation,
    );

    // Create QA Logic Rules Lambda Role
    this.qaLogicRulesLambdaRole = this.createRole(
      `${config.appPrefix}-QaLogicRulesLambdaRole`,
      iamConfig.lambdaRoles.qaLogicRules,
    );

    // Create Auth Lambda Role
    this.authLambdaRole = this.createRole(
      `${config.appPrefix}-AuthLambdaRole`,
      iamConfig.lambdaRoles.auth,
    );

    // Create Users Lambda Role
    this.usersLambdaRole = this.createRole(
      `${config.appPrefix}-UsersLambdaRole`,
      iamConfig.lambdaRoles.users,
    );

    // Create Audit Lambda Role
    this.auditLambdaRole = this.createRole(
      `${config.appPrefix}-AuditLambdaRole`,
      iamConfig.lambdaRoles.audit,
    );

    // Create Cherry Pick Lambda Role
    this.cherryPickLambdaRole = this.createRole(
      `${config.appPrefix}-CherryPickLambdaRole`,
      iamConfig.lambdaRoles.cherryPick,
    );

    // CR-001: Create Metrics DLQ Retry Consumer Lambda Role
    this.metricsDlqRetryLambdaRole = this.createRole(
      `${config.appPrefix}-MetricsDlqRetryLambdaRole`,
      iamConfig.lambdaRoles.metricsDlqRetry,
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
      roleConfig.managedPolicies.forEach((policyArn) => {
        role.addManagedPolicy(
          ManagedPolicy.fromAwsManagedPolicyName(policyArn),
        );
      });
    }

    // Add inline policies
    if (roleConfig.inlinePolicies) {
      roleConfig.inlinePolicies.forEach((policy) => {
        role.addToPolicy(
          new PolicyStatement({
            effect: Effect.ALLOW,
            actions: policy.actions,
            resources: policy.resources,
          }),
        );
      });
    }

    return role;
  }
}
