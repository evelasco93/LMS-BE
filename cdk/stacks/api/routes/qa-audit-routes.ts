import { Construct } from "constructs";
import {
  AuthorizationType,
  LambdaIntegration,
} from "aws-cdk-lib/aws-apigateway";
import { IFunction } from "aws-cdk-lib/aws-lambda";
import { makeProtectedMethodAdder, SharedRouteProps } from "./route-helpers";

export interface QaAuditCherryPickRoutesProps extends SharedRouteProps {
  qaOrchestratorLambda: IFunction;
  auditLambda: IFunction;
  cherryPickLambda: IFunction;
}

export class QaAuditCherryPickRoutes extends Construct {
  constructor(
    scope: Construct,
    id: string,
    props: QaAuditCherryPickRoutesProps,
  ) {
    super(scope, id);

    const {
      v2Resource,
      qaOrchestratorLambda,
      auditLambda,
      cherryPickLambda,
      authorizer,
      requireScopeChecks,
      readScope,
      writeScope,
    } = props;

    const protect = makeProtectedMethodAdder(authorizer, requireScopeChecks);

    // ── QA Orchestrator ───────────────────────────────────────────────────────
    const qaIntegration = new LambdaIntegration(qaOrchestratorLambda, {
      proxy: true,
      allowTestInvoke: false,
    });

    const qaResource = v2Resource.addResource("qa");

    protect(
      qaResource.addResource("trusted-form").addResource("validate"),
      "POST",
      qaIntegration,
      [writeScope],
    );

    protect(
      qaResource.addResource("ipqs").addResource("check"),
      "POST",
      qaIntegration,
      [writeScope],
    );

    // ── Audit ─────────────────────────────────────────────────────────────────
    const auditIntegration = new LambdaIntegration(auditLambda, {
      proxy: true,
      allowTestInvoke: false,
    });

    const auditResource = v2Resource.addResource("audit");
    protect(auditResource, "GET", auditIntegration, [readScope]);

    // Declare static sub-resources BEFORE {entityId} to avoid route shadowing
    protect(auditResource.addResource("activity"), "GET", auditIntegration, [
      readScope,
    ]);
    protect(auditResource.addResource("export"), "POST", auditIntegration, [
      writeScope,
    ]);

    protect(auditResource.addResource("{entityId}"), "GET", auditIntegration, [
      readScope,
    ]);

    // ── Cherry Pick ───────────────────────────────────────────────────────────
    const cherryPickIntegration = new LambdaIntegration(cherryPickLambda, {
      proxy: true,
      allowTestInvoke: false,
    });

    const cherryPickResource = v2Resource.addResource("cherry-pick");

    protect(
      cherryPickResource.addResource("eligible-clients"),
      "GET",
      cherryPickIntegration,
      [readScope],
    );

    const cherryPickByLeadIdResource =
      cherryPickResource.addResource("{leadId}");
    protect(
      cherryPickByLeadIdResource.addResource("pickability"),
      "PATCH",
      cherryPickIntegration,
      [writeScope],
    );
    protect(
      cherryPickByLeadIdResource.addResource("execute"),
      "POST",
      cherryPickIntegration,
      [writeScope],
    );
  }
}
