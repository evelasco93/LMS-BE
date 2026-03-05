import { IIamStackConfig } from "../types/iam.types";
import { nameBuilder } from "../../../config/base.config";

export const iamConfig: IIamStackConfig = {
  lambdaRoles: {
    clients: {
      name: nameBuilder.role("clients-lambda"),
      description: "Execution role for Clients Lambda",
      servicePrincipal: "lambda.amazonaws.com",
      managedPolicies: ["service-role/AWSLambdaBasicExecutionRole"],
      inlinePolicies: [],
    },
    affiliates: {
      name: nameBuilder.role("affiliates-lambda"),
      description: "Execution role for Affiliates Lambda",
      servicePrincipal: "lambda.amazonaws.com",
      managedPolicies: ["service-role/AWSLambdaBasicExecutionRole"],
      inlinePolicies: [],
    },
    campaigns: {
      name: nameBuilder.role("campaigns-lambda"),
      description: "Execution role for Campaigns Lambda",
      servicePrincipal: "lambda.amazonaws.com",
      managedPolicies: ["service-role/AWSLambdaBasicExecutionRole"],
      inlinePolicies: [],
    },
    leads: {
      name: nameBuilder.role("leads-lambda"),
      description: "Execution role for Leads Lambda",
      servicePrincipal: "lambda.amazonaws.com",
      managedPolicies: ["service-role/AWSLambdaBasicExecutionRole"],
      inlinePolicies: [],
    },
    tenantConfig: {
      name: nameBuilder.role("tenant-config-lambda"),
      description: "Execution role for Tenant Config Lambda",
      servicePrincipal: "lambda.amazonaws.com",
      managedPolicies: ["service-role/AWSLambdaBasicExecutionRole"],
      inlinePolicies: [],
    },
    qaOrchestrator: {
      name: nameBuilder.role("qa-orchestrator-lambda"),
      description: "Execution role for QA Orchestrator Lambda",
      servicePrincipal: "lambda.amazonaws.com",
      managedPolicies: ["service-role/AWSLambdaBasicExecutionRole"],
      inlinePolicies: [],
    },
    qaDuplicateCheck: {
      name: nameBuilder.role("qa-duplicate-check-lambda"),
      description: "Execution role for QA Duplicate Check Lambda",
      servicePrincipal: "lambda.amazonaws.com",
      managedPolicies: ["service-role/AWSLambdaBasicExecutionRole"],
      inlinePolicies: [],
    },
    qaTrustedForm: {
      name: nameBuilder.role("qa-trusted-form-lambda"),
      description: "Execution role for QA TrustedForm Lambda",
      servicePrincipal: "lambda.amazonaws.com",
      managedPolicies: ["service-role/AWSLambdaBasicExecutionRole"],
      inlinePolicies: [],
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
      inlinePolicies: [],
    },
  },
};
