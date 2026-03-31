import { IBaseStackProps } from "../../../types/base.types";
import { IFunction } from "aws-cdk-lib/aws-lambda";

/**
 * Internal API Configuration
 */
export interface IInternalApiConfig {
  /** API name */
  name: string;

  /** API description */
  description: string;

  /** Stage name */
  stageName: string;

  /** OAuth callback URLs for custom login UI */
  callbackUrls: string[];

  /** OAuth logout URLs for custom login UI */
  logoutUrls: string[];

  /** Optional Cognito domain prefix override */
  cognitoDomainPrefix?: string;
}

/**
 * External Leads API Configuration
 */
export interface IExternalLeadsApiConfig {
  /** API name */
  name: string;

  /** API description */
  description: string;

  /** Stage name */
  stageName: string;

  /** Rate limit per second */
  rateLimitPerSecond: number;

  /** Burst limit */
  burstLimit: number;
}

/**
 * API Stack Configuration
 */
export interface IApiStackConfig {
  internalApi: IInternalApiConfig;
  externalLeadsApi: IExternalLeadsApiConfig;
}

/**
 * API Stack Props
 */
export interface IApiStackProps extends IBaseStackProps {
  apiConfig: IApiStackConfig;
  clientsLambda: IFunction;
  affiliatesLambda: IFunction;
  campaignsLambda: IFunction;
  leadsLambda: IFunction;
  tenantConfigLambda: IFunction;
  qaOrchestratorLambda: IFunction;
  auditLambda: IFunction;
  cherryPickLambda: IFunction;
  authLambdaRoleName: string;
  usersLambdaRoleName: string;
}
