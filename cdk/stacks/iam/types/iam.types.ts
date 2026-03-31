import { IBaseStackProps } from "../../../types/base.types";

/**
 * IAM Role Configuration
 */
export interface IRoleConfig {
  /** Role name */
  name: string;

  /** Role description */
  description: string;

  /** Service principal (e.g., 'lambda.amazonaws.com') */
  servicePrincipal: string;

  /** Managed policy ARNs to attach */
  managedPolicies?: string[];

  /** Inline policy statements */
  inlinePolicies?: {
    name: string;
    actions: string[];
    resources: string[];
  }[];
}

/**
 * IAM Stack Configuration
 */
export interface IIamStackConfig {
  /** Lambda roles */
  lambdaRoles: {
    clients: IRoleConfig;
    affiliates: IRoleConfig;
    campaigns: IRoleConfig;
    leads: IRoleConfig;
    tenantConfig: IRoleConfig;
    qaOrchestrator: IRoleConfig;
    qaDuplicateCheck: IRoleConfig;
    qaTrustedForm: IRoleConfig;
    qaIpqs: IRoleConfig;
    qaCriteriaValidation: IRoleConfig;
    qaLogicRules: IRoleConfig;
    auth: IRoleConfig;
    users: IRoleConfig;
    audit: IRoleConfig;
    cherryPick: IRoleConfig;
  };
}

/**
 * IAM Stack Props
 */
export interface IIamStackProps extends IBaseStackProps {
  iamConfig: IIamStackConfig;
}
