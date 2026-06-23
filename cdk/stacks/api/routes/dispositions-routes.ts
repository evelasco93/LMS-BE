import { Construct } from "constructs";
import { LambdaIntegration } from "aws-cdk-lib/aws-apigateway";
import { IFunction } from "aws-cdk-lib/aws-lambda";
import { makeProtectedMethodAdder, SharedRouteProps } from "./route-helpers";

export interface DispositionsRoutesProps extends SharedRouteProps {
  dispositionsLambda: IFunction;
}

export class DispositionsRoutes extends Construct {
  constructor(scope: Construct, id: string, props: DispositionsRoutesProps) {
    super(scope, id);

    const {
      v2Resource,
      dispositionsLambda,
      authorizer,
      requireScopeChecks,
      readScope,
      writeScope,
    } = props;

    const protect = makeProtectedMethodAdder(authorizer, requireScopeChecks);

    const integration = new LambdaIntegration(dispositionsLambda, {
      proxy: true,
      allowTestInvoke: false,
    });

    const dispositionsResource = v2Resource.addResource("dispositions");
    protect(dispositionsResource, "GET", integration, [readScope]);
    protect(dispositionsResource, "POST", integration, [writeScope]);

    const dispositionById = dispositionsResource.addResource("{id}");
    protect(dispositionById, "GET", integration, [readScope]);
    protect(dispositionById, "PUT", integration, [writeScope]);
    protect(dispositionById, "DELETE", integration, [writeScope]);

    protect(
      dispositionById.addResource("incoming-statuses"),
      "GET",
      integration,
      [readScope],
    );
    protect(
      dispositionById.addResource("candidate-leads"),
      "GET",
      integration,
      [readScope],
    );
    protect(dispositionById.addResource("rows"), "PUT", integration, [
      writeScope,
    ]);
    protect(dispositionById.addResource("refresh"), "POST", integration, [
      writeScope,
    ]);
    protect(dispositionById.addResource("summary"), "GET", integration, [
      readScope,
    ]);

    const publicDashboard = dispositionById.addResource("public-dashboard");
    protect(publicDashboard, "GET", integration, [readScope]);
    protect(publicDashboard, "PUT", integration, [writeScope]);

    protect(dispositionById.addResource("publish"), "POST", integration, [
      writeScope,
    ]);
    protect(dispositionById.addResource("unpublish"), "POST", integration, [
      writeScope,
    ]);
  }
}
