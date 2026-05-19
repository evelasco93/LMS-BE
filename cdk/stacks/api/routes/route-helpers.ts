import {
  AuthorizationType,
  CognitoUserPoolsAuthorizer,
  IResource,
  LambdaIntegration,
} from "aws-cdk-lib/aws-apigateway";
import { IFunction } from "aws-cdk-lib/aws-lambda";
import { Stack } from "aws-cdk-lib";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AddProtectedMethodFn = (
  resource: IResource,
  httpMethod: string,
  integration: LambdaIntegration,
  scopes: string[],
) => void;

export interface SharedRouteProps {
  v2Resource: IResource;
  authorizer: CognitoUserPoolsAuthorizer;
  requireScopeChecks: boolean;
  readScope: string;
  writeScope: string;
}

// ─── Helper factories ─────────────────────────────────────────────────────────

/**
 * Returns a closure that adds Cognito-protected methods to an API Gateway resource.
 */
export function makeProtectedMethodAdder(
  authorizer: CognitoUserPoolsAuthorizer,
  requireScopeChecks: boolean,
): AddProtectedMethodFn {
  return (resource, httpMethod, integration, scopes) => {
    const opts: any = {
      authorizationType: AuthorizationType.COGNITO,
      authorizer,
    };
    if (requireScopeChecks) opts.authorizationScopes = scopes;
    resource.addMethod(httpMethod, integration, opts);
  };
}

/**
 * Monkey-patches `fn.addPermission` so that all API Gateway route-level
 * Lambda::Permission resources (one per route added by CDK's LambdaIntegration)
 * are collapsed into a single wildcard permission. This prevents exceeding the
 * 20 KB Lambda resource-based policy size limit on Lambdas with many routes.
 *
 * MUST be called BEFORE any `resource.addMethod(...)` calls that use `fn`.
 */
export function consolidateLambdaApiPermissions(fn: IFunction): void {
  let permGranted = false;
  const origAddPermission = (fn as any).addPermission.bind(fn);

  (fn as any).addPermission = (id: string, perm: any) => {
    const svc: string =
      typeof perm?.principal?.service === "string"
        ? perm.principal.service
        : "";
    if (id.startsWith("ApiPermission") || svc.includes("apigateway")) {
      if (!permGranted) {
        permGranted = true;
        origAddPermission("ApiGateway-InvokeAll", {
          principal: perm.principal,
          sourceAccount: Stack.of(fn).account,
        });
      }
      return;
    }

    origAddPermission(id, perm);
  };
}
