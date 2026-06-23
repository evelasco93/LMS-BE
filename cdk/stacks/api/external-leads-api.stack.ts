import { NestedStack, NestedStackProps } from "aws-cdk-lib";
import {
  RestApi,
  LambdaIntegration,
  Cors,
  AuthorizationType,
} from "aws-cdk-lib/aws-apigateway";
import { IFunction } from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";
import { IExternalLeadsApiConfig } from "./types/api.types";

export interface IExternalLeadsApiStackProps extends NestedStackProps {
  leadsLambda: IFunction;
  dispositionsLambda: IFunction;
  apiConfig: IExternalLeadsApiConfig;
  logicalIdPrefix: string;
}

/**
 * External Leads API Stack
 * Public API for lead intake only (POST endpoints).
 * Authentication is handled at the application level via campaign_id + campaign_key.
 */
export class ExternalLeadsApiStack extends NestedStack {
  public readonly api: RestApi;

  constructor(
    scope: Construct,
    id: string,
    props: IExternalLeadsApiStackProps,
  ) {
    super(scope, id, props);

    const { leadsLambda, dispositionsLambda, apiConfig, logicalIdPrefix } =
      props;

    this.api = new RestApi(this, `${logicalIdPrefix}-ExternalLeadsApi`, {
      restApiName: apiConfig.name,
      description: apiConfig.description,
      deployOptions: {
        stageName: apiConfig.stageName,
        metricsEnabled: true,
        throttlingRateLimit: apiConfig.rateLimitPerSecond,
        throttlingBurstLimit: apiConfig.burstLimit,
      },
      defaultCorsPreflightOptions: {
        allowOrigins: Cors.ALL_ORIGINS,
        allowMethods: ["GET", "POST", "OPTIONS"],
        allowHeaders: ["Content-Type", "X-Amz-Date"],
      },
    });

    const leadsLambdaIntegration = new LambdaIntegration(leadsLambda, {
      proxy: true,
      allowTestInvoke: false,
    });
    const dispositionsLambdaIntegration = new LambdaIntegration(
      dispositionsLambda,
      {
        proxy: true,
        allowTestInvoke: false,
      },
    );

    const v2Resource = this.api.root.addResource("v2");
    const leadsResource = v2Resource.addResource("leads");

    // Open endpoints - authentication via campaign_id + campaign_key in the request body
    leadsResource.addMethod("POST", leadsLambdaIntegration, {
      authorizationType: AuthorizationType.NONE,
    });

    leadsResource
      .addResource("test")
      .addMethod("POST", leadsLambdaIntegration, {
        authorizationType: AuthorizationType.NONE,
      });

    const publicResource = this.api.root.addResource("public");
    const dispoResource = publicResource.addResource("dispo");
    dispoResource
      .addResource("{uuid}")
      .addMethod("GET", dispositionsLambdaIntegration, {
        authorizationType: AuthorizationType.NONE,
      });
  }
}
