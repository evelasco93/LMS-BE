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
        INTERNAL_API_AUTH_TOKEN_SECRET_NAME: nameBuilder.secret(
          "internal-api-auth-token",
        ),
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
        INTERNAL_API_AUTH_TOKEN_SECRET_NAME: nameBuilder.secret(
          "internal-api-auth-token",
        ),
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
        INTERNAL_API_AUTH_TOKEN_SECRET_NAME: nameBuilder.secret(
          "internal-api-auth-token",
        ),
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
        QA_ORCHESTRATOR_LAMBDA_NAME: nameBuilder.lambda("qa-orchestrator"),
        INTERNAL_API_AUTH_TOKEN_SECRET_NAME: nameBuilder.secret(
          "internal-api-auth-token",
        ),
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
        CREDENTIALS_TABLE_NAME: nameBuilder.table("credentials"),
        CREDENTIALS_ENCRYPTION_KEY: process.env.CREDENTIALS_ENCRYPTION_KEY ?? "",
        PLUGIN_SCHEMAS_TABLE_NAME: nameBuilder.table("plugin-schemas"),
        NODE_ENV: "production",
      },
      roleName: nameBuilder.role("tenant-config-lambda"),
    },
    tableName: nameBuilder.table("credentials"),
    tableArn: arnBuilder.dynamoTable(nameBuilder.table("credentials")),
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
        CREDENTIALS_TABLE_NAME: nameBuilder.table("credentials"),
        CREDENTIALS_ENCRYPTION_KEY: process.env.CREDENTIALS_ENCRYPTION_KEY ?? "",
        NODE_ENV: "production",
      },
      roleName: nameBuilder.role("qa-trusted-form-lambda"),
    },
    tableName: nameBuilder.table("credentials"),
    tableArn: arnBuilder.dynamoTable(nameBuilder.table("credentials")),
  },
};
