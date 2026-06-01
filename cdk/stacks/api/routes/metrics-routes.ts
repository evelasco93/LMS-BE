import { Construct } from "constructs";
import { LambdaIntegration } from "aws-cdk-lib/aws-apigateway";
import { IFunction } from "aws-cdk-lib/aws-lambda";
import { makeProtectedMethodAdder, SharedRouteProps } from "./route-helpers";

export interface MetricsRoutesProps extends SharedRouteProps {
  metricsLambda: IFunction;
}

export class MetricsRoutes extends Construct {
  constructor(scope: Construct, id: string, props: MetricsRoutesProps) {
    super(scope, id);

    const {
      v2Resource,
      metricsLambda,
      authorizer,
      requireScopeChecks,
      readScope,
    } = props;

    const protect = makeProtectedMethodAdder(authorizer, requireScopeChecks);

    const integration = new LambdaIntegration(metricsLambda, {
      proxy: true,
      allowTestInvoke: false,
    });

    const metricsResource = v2Resource.addResource("metrics");
    protect(metricsResource.addResource("summary"), "GET", integration, [
      readScope,
    ]);
    const timeseriesResource = metricsResource.addResource("timeseries");
    protect(timeseriesResource, "GET", integration, [readScope]);
    protect(timeseriesResource.addResource("by-source"), "GET", integration, [
      readScope,
    ]);
    protect(timeseriesResource.addResource("hourly"), "GET", integration, [
      readScope,
    ]);
    protect(
      metricsResource.addResource("campaign-by-source"),
      "GET",
      integration,
      [readScope],
    );
    protect(metricsResource.addResource("contracts"), "GET", integration, [
      readScope,
    ]);
    protect(metricsResource.addResource("health"), "GET", integration, [
      readScope,
    ]);

    // CR-001 — affiliate-dimensional routes.
    const byAffiliate = metricsResource
      .addResource("by-affiliate")
      .addResource("{affiliate_id}");
    protect(byAffiliate, "GET", integration, [readScope]);
    protect(byAffiliate.addResource("campaigns"), "GET", integration, [
      readScope,
    ]);
    protect(byAffiliate.addResource("keys"), "GET", integration, [readScope]);

    const byCampaign = metricsResource
      .addResource("by-campaign")
      .addResource("{campaign_id}");
    protect(byCampaign.addResource("affiliates"), "GET", integration, [
      readScope,
    ]);

    protect(metricsResource.addResource("ipqs"), "GET", integration, [
      readScope,
    ]);
    protect(metricsResource.addResource("quality"), "GET", integration, [
      readScope,
    ]);
  }
}
