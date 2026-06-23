import { IApiStackConfig } from "../types/api.types";
import { nameBuilder, baseConfig } from "../../../config/base.config";

export const apiConfig: IApiStackConfig = {
  internalApi: {
    name: nameBuilder.api("internal"),
    description: "Internal APIs for LMS and admin dashboard",
    stageName: baseConfig.environment,
    callbackUrls: [
      process.env.INTERNAL_API_OAUTH_CALLBACK_URL ||
        "http://localhost:3000/auth/callback",
    ],
    logoutUrls: [
      process.env.INTERNAL_API_OAUTH_LOGOUT_URL ||
        "http://localhost:3000/login",
    ],
    cognitoDomainPrefix: process.env.INTERNAL_API_COGNITO_DOMAIN_PREFIX,
  },
  externalLeadsApi: {
    name: nameBuilder.api("external-leads"),
    description: "External leads intake API (POST-only)",
    stageName: baseConfig.environment,
    rateLimitPerSecond: Number(process.env.EXTERNAL_LEADS_RATE_LIMIT || 100),
    burstLimit: Number(process.env.EXTERNAL_LEADS_BURST_LIMIT || 200),
  },
  publicDispositionsEdge: {
    assetsBucketName:
      process.env.PUBLIC_DISPO_ASSETS_BUCKET_NAME ??
      `${nameBuilder.table("public-dispo-assets")}`.toLowerCase(),
    rateLimitPerFiveMinutes: Number(
      process.env.PUBLIC_DISPO_WAF_RATE_LIMIT || 2000,
    ),
  },
};
