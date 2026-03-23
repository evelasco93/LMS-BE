import { IIamStackConfig } from "../types/iam.types";
import { nameBuilder, arnBuilder } from "../../../config/base.config";

// ── DynamoDB table ARNs ───────────────────────────────────────────────────────
const clientsTableArn = arnBuilder.dynamoTable(nameBuilder.table("clients"));
const affiliatesTableArn = arnBuilder.dynamoTable(
  nameBuilder.table("affiliates"),
);
const campaignsTableArn = arnBuilder.dynamoTable(
  nameBuilder.table("campaigns"),
);
const leadsTableArn = arnBuilder.dynamoTable(nameBuilder.table("leads"));
const tenantSettingsTableArn = arnBuilder.dynamoTable(
  nameBuilder.table("tenant-settings"),
);
const auditLogsTableArn = arnBuilder.dynamoTable(
  nameBuilder.table("audit-logs"),
);
const leadIntakeLogsTableArn = arnBuilder.dynamoTable(
  nameBuilder.table("lead-intake-logs"),
);

// ── Lambda ARNs ───────────────────────────────────────────────────────────────
const qaOrchestratorArn = arnBuilder.lambda(
  nameBuilder.lambda("qa-orchestrator"),
);
const qaDuplicateCheckArn = arnBuilder.lambda(
  nameBuilder.lambda("qa-duplicate-check"),
);
const qaTrustedFormArn = arnBuilder.lambda(
  nameBuilder.lambda("qa-trusted-form"),
);
const qaIpqsArn = arnBuilder.lambda(nameBuilder.lambda("qa-ipqs"));
const qaCriteriaValidationArn = arnBuilder.lambda(
  nameBuilder.lambda("qa-criteria-validation"),
);
const qaLogicRulesArn = arnBuilder.lambda(nameBuilder.lambda("qa-logic-rules"));

// ── S3 ARNs ───────────────────────────────────────────────────────────────────
const auditLogsBucketObjectArn = arnBuilder.s3Object(
  nameBuilder.table("audit-logs-bucket"),
);

export const iamConfig: IIamStackConfig = {
  lambdaRoles: {
    clients: {
      name: nameBuilder.role("clients-lambda"),
      description: "Execution role for Clients Lambda",
      servicePrincipal: "lambda.amazonaws.com",
      managedPolicies: ["service-role/AWSLambdaBasicExecutionRole"],
      inlinePolicies: [
        {
          name: "ClientsTableCrud",
          actions: [
            "dynamodb:GetItem",
            "dynamodb:PutItem",
            "dynamodb:UpdateItem",
            "dynamodb:DeleteItem",
            "dynamodb:Query",
            "dynamodb:Scan",
          ],
          resources: [clientsTableArn, `${clientsTableArn}/index/*`],
        },
        {
          name: "CampaignsLeadsRead",
          actions: ["dynamodb:Scan", "dynamodb:Query"],
          resources: [
            campaignsTableArn,
            `${campaignsTableArn}/index/*`,
            leadsTableArn,
            `${leadsTableArn}/index/*`,
          ],
        },
        {
          name: "AuditLogsWrite",
          actions: ["dynamodb:PutItem"],
          resources: [auditLogsTableArn],
        },
        {
          name: "ApiGatewayRead",
          actions: ["apigateway:GET"],
          resources: ["*"],
        },
      ],
    },
    affiliates: {
      name: nameBuilder.role("affiliates-lambda"),
      description: "Execution role for Affiliates Lambda",
      servicePrincipal: "lambda.amazonaws.com",
      managedPolicies: ["service-role/AWSLambdaBasicExecutionRole"],
      inlinePolicies: [
        {
          name: "AffiliatesTableCrud",
          actions: [
            "dynamodb:GetItem",
            "dynamodb:PutItem",
            "dynamodb:UpdateItem",
            "dynamodb:DeleteItem",
            "dynamodb:Query",
            "dynamodb:Scan",
          ],
          resources: [affiliatesTableArn, `${affiliatesTableArn}/index/*`],
        },
        {
          name: "CampaignsLeadsRead",
          actions: ["dynamodb:Scan", "dynamodb:Query"],
          resources: [
            campaignsTableArn,
            `${campaignsTableArn}/index/*`,
            leadsTableArn,
            `${leadsTableArn}/index/*`,
          ],
        },
        {
          name: "AuditLogsWrite",
          actions: ["dynamodb:PutItem"],
          resources: [auditLogsTableArn],
        },
        {
          name: "ApiGatewayRead",
          actions: ["apigateway:GET"],
          resources: ["*"],
        },
      ],
    },
    campaigns: {
      name: nameBuilder.role("campaigns-lambda"),
      description: "Execution role for Campaigns Lambda",
      servicePrincipal: "lambda.amazonaws.com",
      managedPolicies: ["service-role/AWSLambdaBasicExecutionRole"],
      inlinePolicies: [
        {
          name: "CampaignsTableCrud",
          actions: [
            "dynamodb:GetItem",
            "dynamodb:PutItem",
            "dynamodb:UpdateItem",
            "dynamodb:DeleteItem",
            "dynamodb:Query",
            "dynamodb:Scan",
          ],
          resources: [
            campaignsTableArn,
            `${campaignsTableArn}/index/*`,
            clientsTableArn,
            `${clientsTableArn}/index/*`,
            affiliatesTableArn,
            `${affiliatesTableArn}/index/*`,
            leadsTableArn,
            `${leadsTableArn}/index/*`,
          ],
        },
        {
          name: "TenantSettingsRead",
          actions: ["dynamodb:GetItem", "dynamodb:Query"],
          resources: [
            tenantSettingsTableArn,
            `${tenantSettingsTableArn}/index/*`,
          ],
        },
        {
          name: "AuditLogsWrite",
          actions: ["dynamodb:PutItem"],
          resources: [auditLogsTableArn],
        },
        {
          name: "ApiGatewayRead",
          actions: ["apigateway:GET"],
          resources: ["*"],
        },
      ],
    },
    leads: {
      name: nameBuilder.role("leads-lambda"),
      description: "Execution role for Leads Lambda",
      servicePrincipal: "lambda.amazonaws.com",
      managedPolicies: ["service-role/AWSLambdaBasicExecutionRole"],
      inlinePolicies: [
        {
          name: "LeadsTableCrud",
          actions: [
            "dynamodb:GetItem",
            "dynamodb:PutItem",
            "dynamodb:UpdateItem",
            "dynamodb:DeleteItem",
            "dynamodb:Query",
            "dynamodb:Scan",
          ],
          resources: [
            leadsTableArn,
            `${leadsTableArn}/index/*`,
            campaignsTableArn,
            `${campaignsTableArn}/index/*`,
          ],
        },
        {
          name: "QaLambdaInvoke",
          actions: ["lambda:InvokeFunction"],
          resources: [
            qaOrchestratorArn,
            qaCriteriaValidationArn,
            qaLogicRulesArn,
            qaTrustedFormArn,
          ],
        },
        {
          name: "TenantSettingsRead",
          actions: ["dynamodb:GetItem", "dynamodb:Query"],
          resources: [
            tenantSettingsTableArn,
            `${tenantSettingsTableArn}/index/*`,
          ],
        },
        {
          name: "AuditLogsWrite",
          actions: ["dynamodb:PutItem"],
          resources: [auditLogsTableArn],
        },
        {
          name: "LeadIntakeLogsWrite",
          actions: ["dynamodb:PutItem", "dynamodb:Query", "dynamodb:Scan"],
          resources: [
            leadIntakeLogsTableArn,
            `${leadIntakeLogsTableArn}/index/*`,
          ],
        },
        {
          name: "ApiGatewayRead",
          actions: ["apigateway:GET"],
          resources: ["*"],
        },
      ],
    },
    tenantConfig: {
      name: nameBuilder.role("tenant-config-lambda"),
      description: "Execution role for Tenant Config Lambda",
      servicePrincipal: "lambda.amazonaws.com",
      managedPolicies: ["service-role/AWSLambdaBasicExecutionRole"],
      inlinePolicies: [
        {
          name: "TenantSettingsCrud",
          actions: [
            "dynamodb:GetItem",
            "dynamodb:PutItem",
            "dynamodb:UpdateItem",
            "dynamodb:DeleteItem",
            "dynamodb:Query",
            "dynamodb:Scan",
          ],
          resources: [
            tenantSettingsTableArn,
            `${tenantSettingsTableArn}/index/*`,
          ],
        },
        {
          name: "CampaignsCascade",
          actions: ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:Scan"],
          resources: [campaignsTableArn],
        },
        {
          name: "AuditLogsWrite",
          actions: ["dynamodb:PutItem"],
          resources: [auditLogsTableArn],
        },
      ],
    },
    qaOrchestrator: {
      name: nameBuilder.role("qa-orchestrator-lambda"),
      description: "Execution role for QA Orchestrator Lambda",
      servicePrincipal: "lambda.amazonaws.com",
      managedPolicies: ["service-role/AWSLambdaBasicExecutionRole"],
      inlinePolicies: [
        {
          name: "QaPluginLambdaInvoke",
          actions: ["lambda:InvokeFunction"],
          resources: [qaDuplicateCheckArn, qaTrustedFormArn, qaIpqsArn],
        },
        {
          name: "TenantSettingsRead",
          actions: ["dynamodb:GetItem", "dynamodb:Query"],
          resources: [
            tenantSettingsTableArn,
            `${tenantSettingsTableArn}/index/*`,
          ],
        },
      ],
    },
    qaDuplicateCheck: {
      name: nameBuilder.role("qa-duplicate-check-lambda"),
      description: "Execution role for QA Duplicate Check Lambda",
      servicePrincipal: "lambda.amazonaws.com",
      managedPolicies: ["service-role/AWSLambdaBasicExecutionRole"],
      inlinePolicies: [
        {
          name: "LeadsTableRead",
          actions: ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:Scan"],
          resources: [leadsTableArn, `${leadsTableArn}/index/*`],
        },
      ],
    },
    qaTrustedForm: {
      name: nameBuilder.role("qa-trusted-form-lambda"),
      description: "Execution role for QA TrustedForm Lambda",
      servicePrincipal: "lambda.amazonaws.com",
      managedPolicies: ["service-role/AWSLambdaBasicExecutionRole"],
      inlinePolicies: [
        {
          name: "TenantSettingsRead",
          actions: ["dynamodb:GetItem"],
          resources: [tenantSettingsTableArn],
        },
      ],
    },
    qaIpqs: {
      name: nameBuilder.role("qa-ipqs-lambda"),
      description: "Execution role for QA IPQS Lambda",
      servicePrincipal: "lambda.amazonaws.com",
      managedPolicies: ["service-role/AWSLambdaBasicExecutionRole"],
      inlinePolicies: [
        {
          name: "TenantSettingsRead",
          actions: ["dynamodb:GetItem"],
          resources: [tenantSettingsTableArn],
        },
      ],
    },
    qaCriteriaValidation: {
      name: nameBuilder.role("qa-criteria-validation-lambda"),
      description: "Execution role for QA Criteria Validation Lambda",
      servicePrincipal: "lambda.amazonaws.com",
      managedPolicies: ["service-role/AWSLambdaBasicExecutionRole"],
      inlinePolicies: [
        {
          name: "CampaignsTableRead",
          actions: ["dynamodb:GetItem"],
          resources: [campaignsTableArn],
        },
      ],
    },
    qaLogicRules: {
      name: nameBuilder.role("qa-logic-rules-lambda"),
      description: "Execution role for QA Logic Rules Lambda",
      servicePrincipal: "lambda.amazonaws.com",
      managedPolicies: ["service-role/AWSLambdaBasicExecutionRole"],
      inlinePolicies: [
        {
          name: "CampaignsTableRead",
          actions: ["dynamodb:GetItem"],
          resources: [campaignsTableArn],
        },
      ],
    },
    auth: {
      name: nameBuilder.role("auth-lambda"),
      description: "Execution role for Auth Lambda",
      servicePrincipal: "lambda.amazonaws.com",
      managedPolicies: ["service-role/AWSLambdaBasicExecutionRole"],
      inlinePolicies: [],
    },
    users: {
      name: nameBuilder.role("users-lambda"),
      description: "Execution role for Users Lambda (Cognito admin management)",
      servicePrincipal: "lambda.amazonaws.com",
      managedPolicies: ["service-role/AWSLambdaBasicExecutionRole"],
      inlinePolicies: [
        {
          name: "AuditLogsWrite",
          actions: ["dynamodb:PutItem"],
          resources: [auditLogsTableArn],
        },
      ],
    },
    audit: {
      name: nameBuilder.role("audit-lambda"),
      description: "Execution role for Audit Lambda (query + S3 export)",
      servicePrincipal: "lambda.amazonaws.com",
      managedPolicies: ["service-role/AWSLambdaBasicExecutionRole"],
      inlinePolicies: [
        {
          name: "AuditLogsRead",
          actions: ["dynamodb:GetItem", "dynamodb:Query", "dynamodb:Scan"],
          resources: [auditLogsTableArn, `${auditLogsTableArn}/index/*`],
        },
        {
          name: "AuditLogsBucketWrite",
          actions: ["s3:PutObject"],
          resources: [auditLogsBucketObjectArn],
        },
      ],
    },
  },
};
