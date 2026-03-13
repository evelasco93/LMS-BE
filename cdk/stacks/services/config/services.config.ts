import { IServicesStackConfig } from "../types/services.types";
import { nameBuilder, arnBuilder } from "../../../config/base.config";
import * as path from "path";

export const servicesConfig: IServicesStackConfig = {
  clients: {
    lambda: {
      functionName: nameBuilder.lambda("clients"),
      entry: path.join(__dirname, "../../../../handlers/clients/main.ts"),
      handler: "handler",
      memorySize: 512,
      timeout: 30,
      environment: {
        CLIENTS_TABLE_NAME: nameBuilder.table("clients"),
        CAMPAIGNS_TABLE_NAME: nameBuilder.table("campaigns"),
        LEADS_TABLE_NAME: nameBuilder.table("leads"),
        AUDIT_LOGS_TABLE_NAME: nameBuilder.table("audit-logs"),
        NODE_ENV: "production",
      },
      roleName: nameBuilder.role("clients-lambda"),
    },
    tableName: nameBuilder.table("clients"),
    tableArn: arnBuilder.dynamoTable(nameBuilder.table("clients")),
  },
  affiliates: {
    lambda: {
      functionName: nameBuilder.lambda("affiliates"),
      entry: path.join(__dirname, "../../../../handlers/affiliates/main.ts"),
      handler: "handler",
      memorySize: 512,
      timeout: 30,
      environment: {
        AFFILIATES_TABLE_NAME: nameBuilder.table("affiliates"),
        CAMPAIGNS_TABLE_NAME: nameBuilder.table("campaigns"),
        LEADS_TABLE_NAME: nameBuilder.table("leads"),
        AUDIT_LOGS_TABLE_NAME: nameBuilder.table("audit-logs"),
        NODE_ENV: "production",
      },
      roleName: nameBuilder.role("affiliates-lambda"),
    },
    tableName: nameBuilder.table("affiliates"),
    tableArn: arnBuilder.dynamoTable(nameBuilder.table("affiliates")),
  },
  campaigns: {
    lambda: {
      functionName: nameBuilder.lambda("campaigns"),
      entry: path.join(__dirname, "../../../../handlers/campaigns/main.ts"),
      handler: "handler",
      memorySize: 512,
      timeout: 30,
      environment: {
        CAMPAIGNS_TABLE_NAME: nameBuilder.table("campaigns"),
        CLIENTS_TABLE_NAME: nameBuilder.table("clients"),
        AFFILIATES_TABLE_NAME: nameBuilder.table("affiliates"),
        LEADS_TABLE_NAME: nameBuilder.table("leads"),
        TENANT_SETTINGS_TABLE_NAME: nameBuilder.table("tenant-settings"),
        AUDIT_LOGS_TABLE_NAME: nameBuilder.table("audit-logs"),
        LEADS_BASE_URL:
          "https://a1tu1h2ev8.execute-api.us-east-1.amazonaws.com/dev/v2/leads",
        NODE_ENV: "production",
      },
      roleName: nameBuilder.role("campaigns-lambda"),
    },
    tableName: nameBuilder.table("campaigns"),
    tableArn: arnBuilder.dynamoTable(nameBuilder.table("campaigns")),
  },
  leads: {
    lambda: {
      functionName: nameBuilder.lambda("leads"),
      entry: path.join(__dirname, "../../../../handlers/leads/main.ts"),
      handler: "handler",
      memorySize: 512,
      timeout: 30,
      environment: {
        LEADS_TABLE_NAME: nameBuilder.table("leads"),
        CAMPAIGNS_TABLE_NAME: nameBuilder.table("campaigns"),
        AUDIT_LOGS_TABLE_NAME: nameBuilder.table("audit-logs"),
        QA_ORCHESTRATOR_LAMBDA_NAME: nameBuilder.lambda("qa-orchestrator"),
        CRITERIA_VALIDATION_LAMBDA_NAME: nameBuilder.lambda(
          "qa-criteria-validation",
        ),
        LOGIC_RULES_LAMBDA_NAME: nameBuilder.lambda("qa-logic-rules"),
        EXTERNAL_LEADS_API_URL:
          "https://u1jn88al42.execute-api.us-east-1.amazonaws.com/dev/v2/leads",
        NODE_ENV: "production",
      },
      roleName: nameBuilder.role("leads-lambda"),
    },
    tableName: nameBuilder.table("leads"),
    tableArn: arnBuilder.dynamoTable(nameBuilder.table("leads")),
  },
  tenantConfig: {
    lambda: {
      functionName: nameBuilder.lambda("tenant-config"),
      entry: path.join(__dirname, "../../../../handlers/tenant-config/main.ts"),
      handler: "handler",
      memorySize: 512,
      timeout: 30,
      environment: {
        TENANT_SETTINGS_TABLE_NAME: nameBuilder.table("tenant-settings"),
        CREDENTIALS_ENCRYPTION_KEY:
          "9a58cde97e3fb1426006314ab9e9c68e7c9ba4a2d8f1f95a1ce4dcc1fc7b97f5",
        CAMPAIGNS_TABLE_NAME: nameBuilder.table("campaigns"),
        AUDIT_LOGS_TABLE_NAME: nameBuilder.table("audit-logs"),
        NODE_ENV: "production",
      },
      roleName: nameBuilder.role("tenant-config-lambda"),
    },
    tableName: nameBuilder.table("tenant-settings"),
    tableArn: arnBuilder.dynamoTable(nameBuilder.table("tenant-settings")),
  },
  qaOrchestrator: {
    lambda: {
      functionName: nameBuilder.lambda("qa-orchestrator"),
      entry: path.join(
        __dirname,
        "../../../../handlers/qa/orchestrator/main.ts",
      ),
      handler: "handler",
      memorySize: 512,
      timeout: 30,
      environment: {
        DUPLICATE_CHECK_LAMBDA_NAME: nameBuilder.lambda("qa-duplicate-check"),
        TRUSTED_FORM_LAMBDA_NAME: nameBuilder.lambda("qa-trusted-form"),
        IPQS_LAMBDA_NAME: nameBuilder.lambda("qa-ipqs"),
        TENANT_SETTINGS_TABLE_NAME: nameBuilder.table("tenant-settings"),
        CREDENTIALS_ENCRYPTION_KEY:
          "9a58cde97e3fb1426006314ab9e9c68e7c9ba4a2d8f1f95a1ce4dcc1fc7b97f5",
        NODE_ENV: "production",
      },
      roleName: nameBuilder.role("qa-orchestrator-lambda"),
    },
    tableName: nameBuilder.table("leads"),
    tableArn: arnBuilder.dynamoTable(nameBuilder.table("leads")),
  },
  qaDuplicateCheck: {
    lambda: {
      functionName: nameBuilder.lambda("qa-duplicate-check"),
      entry: path.join(
        __dirname,
        "../../../../handlers/qa/modules/duplicate-check/main.ts",
      ),
      handler: "handler",
      memorySize: 512,
      timeout: 30,
      environment: {
        LEADS_TABLE_NAME: nameBuilder.table("leads"),
        NODE_ENV: "production",
      },
      roleName: nameBuilder.role("qa-duplicate-check-lambda"),
    },
    tableName: nameBuilder.table("leads"),
    tableArn: arnBuilder.dynamoTable(nameBuilder.table("leads")),
  },
  qaTrustedForm: {
    lambda: {
      functionName: nameBuilder.lambda("qa-trusted-form"),
      entry: path.join(
        __dirname,
        "../../../../handlers/qa/modules/trusted-form/main.ts",
      ),
      handler: "handler",
      memorySize: 512,
      timeout: 30,
      environment: {
        TENANT_SETTINGS_TABLE_NAME: nameBuilder.table("tenant-settings"),
        CREDENTIALS_ENCRYPTION_KEY:
          "9a58cde97e3fb1426006314ab9e9c68e7c9ba4a2d8f1f95a1ce4dcc1fc7b97f5",
        NODE_ENV: "production",
      },
      roleName: nameBuilder.role("qa-trusted-form-lambda"),
    },
    tableName: nameBuilder.table("tenant-settings"),
    tableArn: arnBuilder.dynamoTable(nameBuilder.table("tenant-settings")),
  },
  qaIpqs: {
    lambda: {
      functionName: nameBuilder.lambda("qa-ipqs"),
      entry: path.join(
        __dirname,
        "../../../../handlers/qa/modules/ipqs/main.ts",
      ),
      handler: "handler",
      memorySize: 512,
      timeout: 30,
      environment: {
        TENANT_SETTINGS_TABLE_NAME: nameBuilder.table("tenant-settings"),
        CREDENTIALS_ENCRYPTION_KEY:
          "9a58cde97e3fb1426006314ab9e9c68e7c9ba4a2d8f1f95a1ce4dcc1fc7b97f5",
        NODE_ENV: "production",
      },
      roleName: nameBuilder.role("qa-ipqs-lambda"),
    },
    tableName: nameBuilder.table("tenant-settings"),
    tableArn: arnBuilder.dynamoTable(nameBuilder.table("tenant-settings")),
  },
  qaCriteriaValidation: {
    lambda: {
      functionName: nameBuilder.lambda("qa-criteria-validation"),
      entry: path.join(
        __dirname,
        "../../../../handlers/qa/modules/criteria-validation/main.ts",
      ),
      handler: "handler",
      memorySize: 512,
      timeout: 30,
      environment: {
        CAMPAIGNS_TABLE_NAME: nameBuilder.table("campaigns"),
        NODE_ENV: "production",
      },
      roleName: nameBuilder.role("qa-criteria-validation-lambda"),
    },
    tableName: nameBuilder.table("campaigns"),
    tableArn: arnBuilder.dynamoTable(nameBuilder.table("campaigns")),
  },
  qaLogicRules: {
    lambda: {
      functionName: nameBuilder.lambda("qa-logic-rules"),
      entry: path.join(
        __dirname,
        "../../../../handlers/qa/modules/logic-rules/main.ts",
      ),
      handler: "handler",
      memorySize: 512,
      timeout: 30,
      environment: {
        CAMPAIGNS_TABLE_NAME: nameBuilder.table("campaigns"),
        NODE_ENV: "production",
      },
      roleName: nameBuilder.role("qa-logic-rules-lambda"),
    },
    tableName: nameBuilder.table("campaigns"),
    tableArn: arnBuilder.dynamoTable(nameBuilder.table("campaigns")),
  },
  audit: {
    lambda: {
      functionName: nameBuilder.lambda("audit"),
      entry: path.join(__dirname, "../../../../handlers/audit/main.ts"),
      handler: "handler",
      memorySize: 512,
      timeout: 60,
      environment: {
        AUDIT_LOGS_TABLE_NAME: nameBuilder.table("audit-logs"),
        AUDIT_LOGS_S3_BUCKET:
          `${nameBuilder.table("audit-logs-bucket")}`.toLowerCase(),
        NODE_ENV: "production",
      },
      roleName: nameBuilder.role("audit-lambda"),
    },
    tableName: nameBuilder.table("audit-logs"),
    tableArn: arnBuilder.dynamoTable(nameBuilder.table("audit-logs")),
  },
};
