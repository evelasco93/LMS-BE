import { Construct } from "constructs";
import { LambdaIntegration } from "aws-cdk-lib/aws-apigateway";
import { IFunction } from "aws-cdk-lib/aws-lambda";
import { makeProtectedMethodAdder, SharedRouteProps } from "./route-helpers";

export interface ClientsAffiliatesRoutesProps extends SharedRouteProps {
  clientsLambda: IFunction;
  affiliatesLambda: IFunction;
}

export class ClientsAffiliatesRoutes extends Construct {
  constructor(
    scope: Construct,
    id: string,
    props: ClientsAffiliatesRoutesProps,
  ) {
    super(scope, id);

    const {
      v2Resource,
      clientsLambda,
      affiliatesLambda,
      authorizer,
      requireScopeChecks,
      readScope,
      writeScope,
    } = props;

    const protect = makeProtectedMethodAdder(authorizer, requireScopeChecks);

    // ── Clients ──────────────────────────────────────────────────────────────
    const clientsIntegration = new LambdaIntegration(clientsLambda, {
      proxy: true,
      allowTestInvoke: false,
    });

    const clientsResource = v2Resource.addResource("clients");
    protect(clientsResource, "POST", clientsIntegration, [writeScope]);
    protect(clientsResource, "GET", clientsIntegration, [readScope]);

    const clientResource = clientsResource.addResource("{id}");
    protect(clientResource, "GET", clientsIntegration, [readScope]);
    protect(clientResource, "PUT", clientsIntegration, [writeScope]);
    protect(clientResource, "DELETE", clientsIntegration, [writeScope]);

    // ── Affiliates ────────────────────────────────────────────────────────────
    const affiliatesIntegration = new LambdaIntegration(affiliatesLambda, {
      proxy: true,
      allowTestInvoke: false,
    });

    const affiliatesResource = v2Resource.addResource("affiliates");
    protect(affiliatesResource, "POST", affiliatesIntegration, [writeScope]);
    protect(affiliatesResource, "GET", affiliatesIntegration, [readScope]);

    const affiliateResource = affiliatesResource.addResource("{id}");
    protect(affiliateResource, "GET", affiliatesIntegration, [readScope]);
    protect(affiliateResource, "PUT", affiliatesIntegration, [writeScope]);
    protect(affiliateResource, "DELETE", affiliatesIntegration, [writeScope]);
  }
}
