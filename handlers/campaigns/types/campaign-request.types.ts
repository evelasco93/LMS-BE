import { CampaignStatus } from "../enums/campaign-status.enum";
import { CampaignParticipantStatus } from "../enums/campaign-participant-status.enum";
import {
  BaseCriteriaDataType,
  DuplicateCheckCriteriaField,
  IDuplicateCheckPluginConfig,
  IFieldOption,
  IIpqsPluginConfig,
  ITrustedFormPluginConfig,
  IValueMapping,
  LogicRuleOperator,
  DashboardWidgetChartType,
} from "../interfaces/ICampaign.interface";

export type CreateCampaignRequest = {
  name: string;
  tags?: string[];
};

export type LinkContractRequest = {
  client_id: string;
  contract_id?: string;
  contract_name?: string;
};

export type LinkAffiliateRequest = {
  affiliate_id: string;
};

export type UpdateParticipantStatusRequest = {
  status: CampaignParticipantStatus;
};

export type UpdateContractRequest = {
  status?: CampaignParticipantStatus;
  contract_name?: string;
};

export type UpdateCampaignStatusRequest = {
  status: CampaignStatus;
};

export type UpdateCampaignRequest = {
  name: string;
};

export type UpdateCampaignPluginsRequest = {
  duplicate_check?: Partial<IDuplicateCheckPluginConfig> & {
    criteria?: DuplicateCheckCriteriaField[];
  };
  trusted_form?: Partial<ITrustedFormPluginConfig>;
  ipqs?: Partial<IIpqsPluginConfig>;
  validation_bypass?: import("../interfaces/ICampaign.interface").ICampaignValidationBypassConfig;
};

export type ListCampaignsQuery = {
  status?: CampaignStatus;
  limit?: number;
  lastEvaluatedKey?: string;
  includeDeleted?: boolean;
};

export type DashboardWidgetLayoutRequest = {
  size: "small" | "medium" | "large" | "full";
  order: number;
};

export type CreateDashboardWidgetRequest = {
  title: string;
  criteria_field_name: string;
  chart_type: DashboardWidgetChartType;
  color: string;
  label_colors?: Record<string, string>;
  value_colors?: Record<string, string>;
  layout: DashboardWidgetLayoutRequest;
  affiliate_id?: string;
  campaign_key?: string;
};

export type UpdateDashboardWidgetRequest =
  Partial<CreateDashboardWidgetRequest>;

export type DashboardWidgetDataQuery = {
  from_date: string;
  to_date: string;
};

export type DashboardWidgetDataBucket = {
  value: string;
  label: string;
  counters: {
    received: number;
    accepted: number;
    sold: number;
    accepted_not_sold: number;
    rejected: number;
    cherry_picked: number;
  };
};

export type DashboardWidgetDataResponse = {
  widget_id: string;
  campaign_id: string;
  criteria_field_name: string;
  range: {
    from_date: string;
    to_date: string;
  };
  filters: {
    affiliate_id?: string;
    campaign_key?: string;
  };
  buckets: DashboardWidgetDataBucket[];
  totals: DashboardWidgetDataBucket["counters"];
};

export type AddCriteriaFieldRequest = {
  field_label: string;
  field_name: string;
  data_type: BaseCriteriaDataType;
  required?: boolean;
  description?: string;
  options?: IFieldOption[];
  value_mappings?: IValueMapping[];
  /** Built-in state normalisation direction: "abbr_to_name" (CA→California) or "name_to_abbr" (California→CA). Omit to disable. */
  state_mapping?: "abbr_to_name" | "name_to_abbr";
  client_override?: boolean;
  affiliate_override?: boolean;
};

export type UpdateCriteriaFieldRequest = {
  field_label?: string;
  field_name?: string;
  data_type?: BaseCriteriaDataType;
  required?: boolean;
  description?: string;
  options?: IFieldOption[];
  value_mappings?: IValueMapping[];
  /** Built-in state normalisation direction: "abbr_to_name" (CA→California) or "name_to_abbr" (California→CA). Omit or pass null to disable. */
  state_mapping?: "abbr_to_name" | "name_to_abbr" | null;
  client_override?: boolean;
  affiliate_override?: boolean;
};

export type SetValueMappingsRequest = {
  /** Full replacement list of value mappings for a field. Send an empty array to clear all mappings. */
  value_mappings: IValueMapping[];
  /** Built-in state normalisation direction: "abbr_to_name" (CA→California) or "name_to_abbr" (California→CA). Omit to leave unchanged; pass null to clear. */
  state_mapping?: "abbr_to_name" | "name_to_abbr" | null;
};

export type ReorderCriteriaRequest = {
  /** Array of field IDs in the desired display order (1-based position = index+1) */
  order: string[];
};

// ── Logic Rules ───────────────────────────────────────────────────────────────

export type CreateLogicRuleConditionRequest = {
  field_name: string;
  operator: LogicRuleOperator;
  value?: string | string[];
};

export type CreateLogicRuleRequest = {
  name: string;
  enabled?: boolean;
  conditions: CreateLogicRuleConditionRequest[];
};

export type UpdateLogicRuleConditionRequest = {
  id?: string;
  field_name: string;
  operator: LogicRuleOperator;
  value?: string | string[];
};

export type UpdateLogicRuleRequest = {
  name?: string;
  enabled?: boolean;
  conditions?: UpdateLogicRuleConditionRequest[];
};

// ── Posting Instructions ──────────────────────────────────────────────────────

export type GeneratePostingInstructionsRequest = {
  affiliate_id: string;
};

export type PostingInstructionsCriteriaField = {
  field_name: string;
  field_label: string;
  data_type: string;
  required: boolean;
  description?: string;
  options?: { label: string; value: string }[];
  state_mapping?: "abbr_to_name" | "name_to_abbr";
  order: number;
};

export type PostingInstructionsResult = {
  campaign: {
    id: string;
    name: string;
    status: string;
    submit_url: string;
  };
  affiliate: {
    id: string;
    name: string;
    campaign_key: string;
    link_status: string;
  };
  criteria_fields: PostingInstructionsCriteriaField[];
  generated_at: string;
};

// ── Delivery ──────────────────────────────────────────────────────────────────

export {
  IAffiliateSoldPixelConfig,
  IClientDeliveryConfig,
  IWebhookFieldMapping,
  IWebhookAcceptanceRule,
  ILeadDistributionConfig,
  IDestination,
} from "../interfaces/IClientDelivery.interface";

/** Body for PUT /campaigns/{id}/distribution */
export type SetDistributionRequest = {
  mode: "round_robin" | "weighted";
  enabled: boolean;
};

/** Body for PUT /campaigns/{id}/affiliates/{affiliateId}/cap */
export type SetAffiliateCapRequest = {
  /** Positive integer to cap this affiliate's live lead submissions. null removes the cap */
  lead_cap: number | null;
};

/** Body for PUT /campaigns/{id}/tags */
export type SetCampaignTagsRequest = {
  tags: string[];
};

/** Body for PUT /campaigns/{id}/affiliates/{affiliateId}/validation-bypass */
export type SetAffiliateValidationBypassRequest = {
  validation_bypass?: import("../interfaces/ICampaign.interface").ICampaignValidationBypassConfig;
  outbound_response?: import("../interfaces/ICampaign.interface").IAffiliateOutboundResponseOverride;
};

/** Body for PUT /campaigns/{id}/affiliates/{affiliateId}/pixel */
export type SetAffiliateSoldPixelRequest =
  import("../interfaces/IClientDelivery.interface").IAffiliateSoldPixelConfig;

// ── Criteria Catalog ─────────────────────────────────────────────────────────

export type {
  CreateCriteriaCatalogRequest,
  UpdateCriteriaCatalogRequest,
  ApplyCriteriaCatalogRequest,
  CreateLogicCatalogRequest,
  UpdateLogicCatalogRequest,
  ApplyLogicCatalogRequest,
} from "../interfaces/ICriteriaCatalog.interface";

// ── Destinations ──────────────────────────────────────────────────────────────

import type { DestinationType } from "../interfaces/IClientDelivery.interface";
import type {
  IWebhookFieldMapping as WFM,
  IWebhookAcceptanceRule as WAR,
} from "../interfaces/IClientDelivery.interface";

/** Body for POST /campaigns/{id}/contracts/{contractId}/destinations */
export type CreateDestinationRequest = {
  name: string;
  type: DestinationType;
  url: string;
  method: "POST" | "GET" | "PUT" | "PATCH";
  headers?: Record<string, string>;
  payload_mapping: WFM[];
  acceptance_rules?: WAR[];
  state_mapping_override?: Record<
    string,
    "abbr_to_name" | "name_to_abbr" | null
  >;
  is_primary?: boolean;
  non_webhook_delivery_action?: "passed" | "failed";
  claim_trusted_form?: boolean;
  require_successful_claim?: boolean;
};

/** Body for PUT /campaigns/{id}/contracts/{contractId}/destinations/{destId} */
export type UpdateDestinationRequest = Partial<CreateDestinationRequest>;

// ── Response Validation ───────────────────────────────────────────────────────

import type { IValidationRule as VR } from "../interfaces/IClientDelivery.interface";

export {
  IContractResponseValidation,
  IValidationRule,
  IClientResponseValidation,
  IValidationCondition,
  IValidationGroup,
} from "../interfaces/IClientDelivery.interface";

/** Body for PUT /campaigns/{id}/contracts/{contractId}/response-validation */
export type SetResponseValidationRequest = {
  rules: VR[];
};
