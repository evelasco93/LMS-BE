import { Construct } from "constructs";
import { LambdaIntegration } from "aws-cdk-lib/aws-apigateway";
import { IFunction } from "aws-cdk-lib/aws-lambda";
import { makeProtectedMethodAdder, SharedRouteProps } from "./route-helpers";

export interface LeadsRoutesProps extends SharedRouteProps {
  leadsLambda: IFunction;
}

export class LeadsRoutes extends Construct {
  constructor(scope: Construct, id: string, props: LeadsRoutesProps) {
    super(scope, id);

    const {
      v2Resource,
      leadsLambda,
      authorizer,
      requireScopeChecks,
      readScope,
      writeScope,
    } = props;

    const protect = makeProtectedMethodAdder(authorizer, requireScopeChecks);

    const integration = new LambdaIntegration(leadsLambda, {
      proxy: true,
      allowTestInvoke: false,
    });

    const leadsResource = v2Resource.addResource("leads");
    protect(leadsResource, "GET", integration, [readScope]);

    protect(leadsResource.addResource("intake-logs"), "GET", integration, [
      readScope,
    ]);

    const leadByIdResource = leadsResource.addResource("{id}");
    protect(leadByIdResource, "GET", integration, [readScope]);
    protect(leadByIdResource, "PUT", integration, [writeScope]);
    protect(leadByIdResource, "DELETE", integration, [writeScope]);
  }
}
