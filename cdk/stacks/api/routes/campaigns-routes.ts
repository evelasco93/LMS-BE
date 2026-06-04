import { Construct } from "constructs";
import { LambdaIntegration } from "aws-cdk-lib/aws-apigateway";
import { IFunction } from "aws-cdk-lib/aws-lambda";
import { makeProtectedMethodAdder, SharedRouteProps } from "./route-helpers";

export interface CampaignsRoutesProps extends SharedRouteProps {
  campaignsLambda: IFunction;
}

export class CampaignsRoutes extends Construct {
  constructor(scope: Construct, id: string, props: CampaignsRoutesProps) {
    super(scope, id);

    const {
      v2Resource,
      campaignsLambda,
      authorizer,
      requireScopeChecks,
      readScope,
      writeScope,
    } = props;

    const protect = makeProtectedMethodAdder(authorizer, requireScopeChecks);

    const integration = new LambdaIntegration(campaignsLambda, {
      proxy: true,
      allowTestInvoke: false,
    });

    // ── Campaign CRUD ─────────────────────────────────────────────────────────
    const campaignsResource = v2Resource.addResource("campaigns");
    protect(campaignsResource, "POST", integration, [writeScope]);
    protect(campaignsResource, "GET", integration, [readScope]);

    const campaignResource = campaignsResource.addResource("{id}");
    protect(campaignResource, "GET", integration, [readScope]);
    protect(campaignResource, "PUT", integration, [writeScope]);
    protect(campaignResource, "DELETE", integration, [writeScope]);

    // ── Campaign dashboard widgets (CR-003 canonical) ───────────────────────
    const campaignDashboardResource = campaignResource.addResource("dashboard");
    const campaignDashboardWidgetsResource =
      campaignDashboardResource.addResource("widgets");
    protect(campaignDashboardWidgetsResource, "GET", integration, [readScope]);
    protect(campaignDashboardWidgetsResource, "POST", integration, [
      writeScope,
    ]);

    const campaignDashboardWidgetResource =
      campaignDashboardWidgetsResource.addResource("{widgetId}");
    protect(campaignDashboardWidgetResource, "GET", integration, [readScope]);
    protect(campaignDashboardWidgetResource, "PUT", integration, [writeScope]);
    protect(campaignDashboardWidgetResource, "DELETE", integration, [
      writeScope,
    ]);
    protect(
      campaignDashboardWidgetResource.addResource("data"),
      "GET",
      integration,
      [readScope],
    );

    // ── Campaign dashboard widgets (legacy FE compatibility) ────────────────
    const campaignDashboardWidgetsLegacyResource =
      campaignResource.addResource("dashboard-widgets");
    protect(campaignDashboardWidgetsLegacyResource, "GET", integration, [
      readScope,
    ]);
    protect(campaignDashboardWidgetsLegacyResource, "POST", integration, [
      writeScope,
    ]);

    const campaignDashboardWidgetLegacyResource =
      campaignDashboardWidgetsLegacyResource.addResource("{widgetId}");
    protect(campaignDashboardWidgetLegacyResource, "GET", integration, [
      readScope,
    ]);
    protect(campaignDashboardWidgetLegacyResource, "PUT", integration, [
      writeScope,
    ]);
    protect(campaignDashboardWidgetLegacyResource, "DELETE", integration, [
      writeScope,
    ]);
    const campaignDashboardWidgetLegacyQueryResource =
      campaignDashboardWidgetLegacyResource.addResource("query");
    protect(campaignDashboardWidgetLegacyQueryResource, "GET", integration, [
      readScope,
    ]);
    protect(campaignDashboardWidgetLegacyQueryResource, "POST", integration, [
      readScope,
    ]);

    // ── Campaign status / plugins / distribution ──────────────────────────────
    protect(campaignResource.addResource("status"), "PUT", integration, [
      writeScope,
    ]);
    protect(campaignResource.addResource("plugins"), "PUT", integration, [
      writeScope,
    ]);
    protect(campaignResource.addResource("distribution"), "PUT", integration, [
      writeScope,
    ]);

    // ── Campaign tags ─────────────────────────────────────────────────────────
    protect(campaignResource.addResource("tags"), "PUT", integration, [
      writeScope,
    ]);

    // ── Campaign-level logic apply-catalog ────────────────────────────────────
    const campaignLogicResource = campaignResource.addResource("logic");
    protect(
      campaignLogicResource.addResource("apply-catalog"),
      "POST",
      integration,
      [writeScope],
    );

    // ── Campaign posting instructions ─────────────────────────────────────────
    protect(
      campaignResource
        .addResource("posting-instructions")
        .addResource("generate"),
      "POST",
      integration,
      [writeScope],
    );

    // ── Campaign contracts ────────────────────────────────────────────────────
    const campaignContractsResource = campaignResource.addResource("contracts");
    protect(campaignContractsResource, "POST", integration, [writeScope]);

    const campaignContractResource =
      campaignContractsResource.addResource("{contractId}");
    protect(campaignContractResource, "PUT", integration, [writeScope]);
    protect(campaignContractResource, "DELETE", integration, [writeScope]);

    // ── Contract destinations ────────────────────────────────────────────────
    const campaignContractDestinationsResource =
      campaignContractResource.addResource("destinations");
    protect(campaignContractDestinationsResource, "GET", integration, [
      readScope,
    ]);
    protect(campaignContractDestinationsResource, "POST", integration, [
      writeScope,
    ]);

    const campaignContractDestinationResource =
      campaignContractDestinationsResource.addResource("{destId}");
    protect(campaignContractDestinationResource, "GET", integration, [
      readScope,
    ]);
    protect(campaignContractDestinationResource, "PUT", integration, [
      writeScope,
    ]);
    protect(campaignContractDestinationResource, "DELETE", integration, [
      writeScope,
    ]);

    // Contract-level response validation
    const campaignContractResponseValidationResource =
      campaignContractResource.addResource("response-validation");
    protect(campaignContractResponseValidationResource, "GET", integration, [
      readScope,
    ]);
    protect(campaignContractResponseValidationResource, "PUT", integration, [
      writeScope,
    ]);

    // Per-contract logic rule overrides
    const campaignContractLogicRulesResource =
      campaignContractResource.addResource("logic-rules");
    protect(campaignContractLogicRulesResource, "GET", integration, [
      readScope,
    ]);
    protect(campaignContractLogicRulesResource, "POST", integration, [
      writeScope,
    ]);

    const campaignContractLogicRuleResource =
      campaignContractLogicRulesResource.addResource("{ruleId}");
    protect(campaignContractLogicRuleResource, "PUT", integration, [
      writeScope,
    ]);
    protect(campaignContractLogicRuleResource, "DELETE", integration, [
      writeScope,
    ]);

    // POST /v2/campaigns/{id}/contracts/{contractId}/logic/apply-catalog
    // POST /v2/campaigns/{id}/contracts/{contractId}/logic/sync-to-campaign
    const campaignContractLogicResource =
      campaignContractResource.addResource("logic");
    protect(
      campaignContractLogicResource.addResource("apply-catalog"),
      "POST",
      integration,
      [writeScope],
    );
    protect(
      campaignContractLogicResource.addResource("sync-to-campaign"),
      "POST",
      integration,
      [writeScope],
    );

    // ── Campaign affiliates ───────────────────────────────────────────────────
    const campaignAffiliatesResource =
      campaignResource.addResource("affiliates");
    protect(campaignAffiliatesResource, "POST", integration, [writeScope]);

    const campaignAffiliateResource =
      campaignAffiliatesResource.addResource("{affiliateId}");
    protect(campaignAffiliateResource, "PUT", integration, [writeScope]);
    protect(campaignAffiliateResource, "DELETE", integration, [writeScope]);

    // rotate affiliate campaign key
    protect(
      campaignAffiliateResource.addResource("rotate-key"),
      "POST",
      integration,
      [writeScope],
    );
    // affiliate lead cap
    protect(campaignAffiliateResource.addResource("cap"), "PUT", integration, [
      writeScope,
    ]);
    // affiliate sold pixel
    protect(
      campaignAffiliateResource.addResource("pixel"),
      "PUT",
      integration,
      [writeScope],
    );
    // affiliate validation bypass
    protect(
      campaignAffiliateResource.addResource("validation-bypass"),
      "PUT",
      integration,
      [writeScope],
    );

    // Per-affiliate logic rule overrides
    const campaignAffiliateLogicRulesResource =
      campaignAffiliateResource.addResource("logic-rules");
    protect(campaignAffiliateLogicRulesResource, "GET", integration, [
      readScope,
    ]);
    protect(campaignAffiliateLogicRulesResource, "POST", integration, [
      writeScope,
    ]);

    const campaignAffiliateLogicRuleResource =
      campaignAffiliateLogicRulesResource.addResource("{ruleId}");
    protect(campaignAffiliateLogicRuleResource, "PUT", integration, [
      writeScope,
    ]);
    protect(campaignAffiliateLogicRuleResource, "DELETE", integration, [
      writeScope,
    ]);

    // POST /v2/campaigns/{id}/affiliates/{affiliateId}/logic/apply-catalog
    protect(
      campaignAffiliateResource
        .addResource("logic")
        .addResource("apply-catalog"),
      "POST",
      integration,
      [writeScope],
    );

    // Per-affiliate pixel criteria
    const campaignAffiliatePixelCriteriaResource =
      campaignAffiliateResource.addResource("pixel-criteria");
    protect(campaignAffiliatePixelCriteriaResource, "GET", integration, [
      readScope,
    ]);
    protect(campaignAffiliatePixelCriteriaResource, "POST", integration, [
      writeScope,
    ]);

    const campaignAffiliatePixelCriterionResource =
      campaignAffiliatePixelCriteriaResource.addResource("{ruleId}");
    protect(campaignAffiliatePixelCriterionResource, "PUT", integration, [
      writeScope,
    ]);
    protect(campaignAffiliatePixelCriterionResource, "DELETE", integration, [
      writeScope,
    ]);

    // Per-affiliate sold criteria
    const campaignAffiliateSoldCriteriaResource =
      campaignAffiliateResource.addResource("sold-criteria");
    protect(campaignAffiliateSoldCriteriaResource, "GET", integration, [
      readScope,
    ]);
    protect(campaignAffiliateSoldCriteriaResource, "POST", integration, [
      writeScope,
    ]);

    const campaignAffiliateSoldCriterionResource =
      campaignAffiliateSoldCriteriaResource.addResource("{ruleId}");
    protect(campaignAffiliateSoldCriterionResource, "PUT", integration, [
      writeScope,
    ]);
    protect(campaignAffiliateSoldCriterionResource, "DELETE", integration, [
      writeScope,
    ]);

    // ── Campaign criteria ─────────────────────────────────────────────────────
    const campaignCriteriaResource = campaignResource.addResource("criteria");
    protect(campaignCriteriaResource, "GET", integration, [readScope]);
    protect(campaignCriteriaResource, "POST", integration, [writeScope]);

    // Declare static sub-resources BEFORE {fieldId} to avoid route shadowing
    protect(
      campaignCriteriaResource.addResource("base-fields"),
      "POST",
      integration,
      [writeScope],
    );
    protect(
      campaignCriteriaResource.addResource("reorder"),
      "PUT",
      integration,
      [writeScope],
    );
    protect(
      campaignCriteriaResource.addResource("history"),
      "GET",
      integration,
      [readScope],
    );
    protect(
      campaignCriteriaResource.addResource("apply-catalog"),
      "POST",
      integration,
      [writeScope],
    );

    const campaignCriteriaFieldResource =
      campaignCriteriaResource.addResource("{fieldId}");
    protect(campaignCriteriaFieldResource, "GET", integration, [readScope]);
    protect(campaignCriteriaFieldResource, "PUT", integration, [writeScope]);
    protect(campaignCriteriaFieldResource, "DELETE", integration, [writeScope]);
    protect(
      campaignCriteriaFieldResource.addResource("mappings"),
      "PUT",
      integration,
      [writeScope],
    );

    // ── Campaign logic rules ──────────────────────────────────────────────────
    const campaignLogicRulesResource =
      campaignResource.addResource("logic-rules");
    protect(campaignLogicRulesResource, "GET", integration, [readScope]);
    protect(campaignLogicRulesResource, "POST", integration, [writeScope]);

    const campaignLogicRuleResource =
      campaignLogicRulesResource.addResource("{ruleId}");
    protect(campaignLogicRuleResource, "GET", integration, [readScope]);
    protect(campaignLogicRuleResource, "PUT", integration, [writeScope]);
    protect(campaignLogicRuleResource, "DELETE", integration, [writeScope]);

    // ── Logic catalog (shared, at /v2/campaigns/logic-catalog) ───────────────
    const logicCatalogResource = campaignsResource.addResource("logic-catalog");
    protect(logicCatalogResource, "GET", integration, [readScope]);
    protect(logicCatalogResource, "POST", integration, [writeScope]);

    const logicCatalogBySetIdResource =
      logicCatalogResource.addResource("{setId}");
    protect(logicCatalogBySetIdResource, "GET", integration, [readScope]);
    protect(logicCatalogBySetIdResource, "PUT", integration, [writeScope]);
    protect(logicCatalogBySetIdResource, "DELETE", integration, [writeScope]);

    const logicCatalogVersionResource = logicCatalogBySetIdResource
      .addResource("versions")
      .addResource("{version}");
    protect(logicCatalogVersionResource, "GET", integration, [readScope]);
    protect(logicCatalogVersionResource, "DELETE", integration, [writeScope]);

    // ── Criteria catalog (shared, at /v2/campaigns/criteria-catalog) ──────────
    const criteriaCatalogResource =
      campaignsResource.addResource("criteria-catalog");
    protect(criteriaCatalogResource, "GET", integration, [readScope]);
    protect(criteriaCatalogResource, "POST", integration, [writeScope]);

    const criteriaCatalogBySetIdResource =
      criteriaCatalogResource.addResource("{setId}");
    protect(criteriaCatalogBySetIdResource, "GET", integration, [readScope]);
    protect(criteriaCatalogBySetIdResource, "PUT", integration, [writeScope]);
    protect(criteriaCatalogBySetIdResource, "DELETE", integration, [
      writeScope,
    ]);

    const criteriaCatalogVersionResource = criteriaCatalogBySetIdResource
      .addResource("versions")
      .addResource("{version}");
    protect(criteriaCatalogVersionResource, "GET", integration, [readScope]);
    protect(criteriaCatalogVersionResource, "DELETE", integration, [
      writeScope,
    ]);
  }
}
