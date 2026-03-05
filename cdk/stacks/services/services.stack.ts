import { Stack, CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import { IServicesStackProps } from "./types/services.types";
import { ClientsServiceStack } from "./clients-service.stack";
import { AffiliatesServiceStack } from "./affiliates-service.stack";
import { CampaignsServiceStack } from "./campaigns-service.stack";
import { LeadsServiceStack } from "./leads-service.stack";
import { TenantConfigServiceStack } from "./tenant-config-service.stack";
import { QaOrchestratorServiceStack } from "./qa-orchestrator-service.stack";
import { QaDuplicateCheckServiceStack } from "./qa-duplicate-check-service.stack";
import { QaTrustedFormServiceStack } from "./qa-trusted-form-service.stack";
import { IFunction } from "aws-cdk-lib/aws-lambda";

export class ServicesStack extends Stack {
  public readonly clientsLambda: IFunction;
  public readonly affiliatesLambda: IFunction;
  public readonly campaignsLambda: IFunction;
  public readonly leadsLambda: IFunction;
  public readonly tenantConfigLambda: IFunction;
  public readonly qaOrchestratorLambda: IFunction;
  public readonly qaDuplicateCheckLambda: IFunction;
  public readonly qaTrustedFormLambda: IFunction;

  constructor(scope: Construct, id: string, props: IServicesStackProps) {
    super(scope, id, props);

    const { config, servicesConfig } = props;

    const campaignsServiceStack = new CampaignsServiceStack(
      this,
      `${config.appPrefix}-CampaignsService`,
      {
        lambdaConfig: servicesConfig.campaigns.lambda,
        roleName: servicesConfig.campaigns.lambda.roleName,
        logicalIdPrefix: config.appPrefix,
      },
    );
    this.campaignsLambda = campaignsServiceStack.lambda;

    const leadsServiceStack = new LeadsServiceStack(
      this,
      `${config.appPrefix}-LeadsService`,
      {
        lambdaConfig: servicesConfig.leads.lambda,
        roleName: servicesConfig.leads.lambda.roleName,
        logicalIdPrefix: config.appPrefix,
      },
    );
    this.leadsLambda = leadsServiceStack.lambda;

    const tenantConfigServiceStack = new TenantConfigServiceStack(
      this,
      `${config.appPrefix}-TenantConfigService`,
      {
        lambdaConfig: servicesConfig.tenantConfig.lambda,
        roleName: servicesConfig.tenantConfig.lambda.roleName,
        logicalIdPrefix: config.appPrefix,
      },
    );
    this.tenantConfigLambda = tenantConfigServiceStack.lambda;

    const qaOrchestratorServiceStack = new QaOrchestratorServiceStack(
      this,
      `${config.appPrefix}-QaOrchestratorService`,
      {
        lambdaConfig: servicesConfig.qaOrchestrator.lambda,
        roleName: servicesConfig.qaOrchestrator.lambda.roleName,
        logicalIdPrefix: config.appPrefix,
      },
    );
    this.qaOrchestratorLambda = qaOrchestratorServiceStack.lambda;

    const qaDuplicateCheckServiceStack = new QaDuplicateCheckServiceStack(
      this,
      `${config.appPrefix}-QaDuplicateCheckService`,
      {
        lambdaConfig: servicesConfig.qaDuplicateCheck.lambda,
        roleName: servicesConfig.qaDuplicateCheck.lambda.roleName,
        logicalIdPrefix: config.appPrefix,
      },
    );
    this.qaDuplicateCheckLambda = qaDuplicateCheckServiceStack.lambda;

    const qaTrustedFormServiceStack = new QaTrustedFormServiceStack(
      this,
      `${config.appPrefix}-QaTrustedFormService`,
      {
        lambdaConfig: servicesConfig.qaTrustedForm.lambda,
        roleName: servicesConfig.qaTrustedForm.lambda.roleName,
        logicalIdPrefix: config.appPrefix,
      },
    );
    this.qaTrustedFormLambda = qaTrustedFormServiceStack.lambda;

    const clientsServiceStack = new ClientsServiceStack(
      this,
      `${config.appPrefix}-ClientsService`,
      {
        lambdaConfig: servicesConfig.clients.lambda,
        roleName: servicesConfig.clients.lambda.roleName,
        logicalIdPrefix: config.appPrefix,
      },
    );
    this.clientsLambda = clientsServiceStack.lambda;

    const affiliatesServiceStack = new AffiliatesServiceStack(
      this,
      `${config.appPrefix}-AffiliatesService`,
      {
        lambdaConfig: servicesConfig.affiliates.lambda,
        roleName: servicesConfig.affiliates.lambda.roleName,
        logicalIdPrefix: config.appPrefix,
      },
    );
    this.affiliatesLambda = affiliatesServiceStack.lambda;

    new CfnOutput(this, `${config.appPrefix}-CampaignsLambdaArn`, {
      value: this.campaignsLambda.functionArn,
      description: "Campaigns Lambda Function ARN",
      exportName: `${config.appPrefix}-campaigns-lambda-arn`,
    });

    new CfnOutput(this, `${config.appPrefix}-ClientsLambdaArn`, {
      value: this.clientsLambda.functionArn,
      description: "Clients Lambda Function ARN",
      exportName: `${config.appPrefix}-clients-lambda-arn`,
    });

    new CfnOutput(this, `${config.appPrefix}-AffiliatesLambdaArn`, {
      value: this.affiliatesLambda.functionArn,
      description: "Affiliates Lambda Function ARN",
      exportName: `${config.appPrefix}-affiliates-lambda-arn`,
    });

    new CfnOutput(this, `${config.appPrefix}-LeadsLambdaArn`, {
      value: this.leadsLambda.functionArn,
      description: "Leads Lambda Function ARN",
      exportName: `${config.appPrefix}-leads-lambda-arn`,
    });

    new CfnOutput(this, `${config.appPrefix}-TenantConfigLambdaArn`, {
      value: this.tenantConfigLambda.functionArn,
      description: "Tenant Config Lambda Function ARN",
      exportName: `${config.appPrefix}-tenant-config-lambda-arn`,
    });

    new CfnOutput(this, `${config.appPrefix}-QaOrchestratorLambdaArn`, {
      value: this.qaOrchestratorLambda.functionArn,
      description: "QA Orchestrator Lambda Function ARN",
      exportName: `${config.appPrefix}-qa-orchestrator-lambda-arn`,
    });

    new CfnOutput(this, `${config.appPrefix}-QaDuplicateCheckLambdaArn`, {
      value: this.qaDuplicateCheckLambda.functionArn,
      description: "QA Duplicate Check Lambda Function ARN",
      exportName: `${config.appPrefix}-qa-duplicate-check-lambda-arn`,
    });

    new CfnOutput(this, `${config.appPrefix}-QaTrustedFormLambdaArn`, {
      value: this.qaTrustedFormLambda.functionArn,
      description: "QA TrustedForm Lambda Function ARN",
      exportName: `${config.appPrefix}-qa-trusted-form-lambda-arn`,
    });

    if (config.tags) {
      Object.entries(config.tags).forEach(([key, value]) => {
        this.tags.setTag(key, value);
      });
    }
  }
}
