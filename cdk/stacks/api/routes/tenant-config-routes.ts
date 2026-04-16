import { Construct } from "constructs";
import { LambdaIntegration } from "aws-cdk-lib/aws-apigateway";
import { IFunction } from "aws-cdk-lib/aws-lambda";
import { makeProtectedMethodAdder, SharedRouteProps } from "./route-helpers";

export interface TenantConfigRoutesProps extends SharedRouteProps {
  tenantConfigLambda: IFunction;
}

export class TenantConfigRoutes extends Construct {
  constructor(scope: Construct, id: string, props: TenantConfigRoutesProps) {
    super(scope, id);

    const {
      v2Resource,
      tenantConfigLambda,
      authorizer,
      requireScopeChecks,
      readScope,
      writeScope,
    } = props;

    const protect = makeProtectedMethodAdder(authorizer, requireScopeChecks);

    const integration = new LambdaIntegration(tenantConfigLambda, {
      proxy: true,
      allowTestInvoke: false,
    });

    const tenantConfigResource = v2Resource.addResource("tenant-config");

    // ── Tag Definitions ───────────────────────────────────────────────────────
    const tagDefinitionsResource =
      tenantConfigResource.addResource("tag-definitions");
    protect(tagDefinitionsResource, "GET", integration, [readScope]);
    protect(tagDefinitionsResource, "POST", integration, [writeScope]);

    const tagDefinitionByIdResource =
      tagDefinitionsResource.addResource("{id}");
    protect(tagDefinitionByIdResource, "PUT", integration, [writeScope]);
    protect(tagDefinitionByIdResource, "DELETE", integration, [writeScope]);

    // ── Credentials ───────────────────────────────────────────────────────────
    const credentialsResource = tenantConfigResource.addResource("credentials");
    protect(credentialsResource, "POST", integration, [writeScope]);
    protect(credentialsResource, "GET", integration, [readScope]);

    const credentialByIdResource = credentialsResource.addResource("{id}");
    protect(credentialByIdResource, "GET", integration, [readScope]);
    protect(credentialByIdResource, "PUT", integration, [writeScope]);
    protect(credentialByIdResource, "DELETE", integration, [writeScope]);

    protect(credentialByIdResource.addResource("restore"), "PUT", integration, [
      writeScope,
    ]);
    protect(credentialByIdResource.addResource("disable"), "PUT", integration, [
      writeScope,
    ]);
    protect(credentialByIdResource.addResource("enable"), "PUT", integration, [
      writeScope,
    ]);

    // ── Credential Schemas ────────────────────────────────────────────────────
    const credSchemasResource =
      tenantConfigResource.addResource("credential-schemas");
    protect(credSchemasResource, "POST", integration, [writeScope]);
    protect(credSchemasResource, "GET", integration, [readScope]);

    const credSchemaByIdResource = credSchemasResource.addResource("{id}");
    protect(credSchemaByIdResource, "GET", integration, [readScope]);
    protect(credSchemaByIdResource, "PUT", integration, [writeScope]);
    protect(credSchemaByIdResource, "DELETE", integration, [writeScope]);
    protect(credSchemaByIdResource.addResource("restore"), "PUT", integration, [
      writeScope,
    ]);

    // ── Plugins registry ──────────────────────────────────────────────────────
    protect(tenantConfigResource.addResource("plugins"), "GET", integration, [
      readScope,
    ]);

    // ── Plugin Settings ───────────────────────────────────────────────────────
    const pluginSettingsResource =
      tenantConfigResource.addResource("plugin-settings");
    protect(pluginSettingsResource, "GET", integration, [readScope]);

    const pluginSettingByProviderResource =
      pluginSettingsResource.addResource("{provider}");
    protect(pluginSettingByProviderResource, "GET", integration, [readScope]);
    protect(pluginSettingByProviderResource, "PUT", integration, [writeScope]);
    protect(pluginSettingByProviderResource, "DELETE", integration, [
      writeScope,
    ]);

    protect(
      pluginSettingByProviderResource.addResource("update"),
      "PUT",
      integration,
      [writeScope],
    );
    protect(
      pluginSettingByProviderResource.addResource("disable"),
      "PUT",
      integration,
      [writeScope],
    );
    protect(
      pluginSettingByProviderResource.addResource("enable"),
      "PUT",
      integration,
      [writeScope],
    );
    protect(
      pluginSettingByProviderResource.addResource("restore"),
      "PUT",
      integration,
      [writeScope],
    );

    // ── Platform Presets ──────────────────────────────────────────────────────
    const platformPresetsResource =
      tenantConfigResource.addResource("platform-presets");
    protect(platformPresetsResource, "GET", integration, [readScope]);

    const platformPresetByIdResource =
      platformPresetsResource.addResource("{id}");
    protect(platformPresetByIdResource, "GET", integration, [readScope]);
    protect(platformPresetByIdResource, "PUT", integration, [writeScope]);

    // ── Tenant Presets ────────────────────────────────────────────────────────
    const presetsResource = tenantConfigResource.addResource("presets");
    protect(presetsResource, "GET", integration, [readScope]);
    protect(presetsResource, "POST", integration, [writeScope]);

    const presetByIdResource = presetsResource.addResource("{id}");
    protect(presetByIdResource, "GET", integration, [readScope]);
    protect(presetByIdResource, "PUT", integration, [writeScope]);
    protect(presetByIdResource, "DELETE", integration, [writeScope]);
  }
}
