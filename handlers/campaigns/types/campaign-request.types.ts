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
} from "../interfaces/ICampaign.interface";

export type CreateCampaignRequest = {
  name: string;
  tags?: string[];
};

export type LinkClientRequest = {
  client_id: string;
};

export type LinkAffiliateRequest = {
  affiliate_id: string;
};

export type UpdateParticipantStatusRequest = {
  status: CampaignParticipantStatus;
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
};

export type ListCampaignsQuery = {
  status?: CampaignStatus;
  limit?: number;
  lastEvaluatedKey?: string;
  includeDeleted?: boolean;
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

/** Body for PUT /campaigns/{id}/clients/{clientId}/delivery */
export type SetClientDeliveryRequest = Omit<
  import("../interfaces/IClientDelivery.interface").IClientDeliveryConfig,
  "claim_trusted_form"
> & {
  /**
   * Relative weight for weighted distribution mode (positive integer, default 1).
   * Higher values = proportionally more leads routed to this client.
   * Only meaningful when the campaign distribution mode is "weighted".
   */
  weight?: number;
};

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
  validation_bypass: import("../interfaces/ICampaign.interface").ICampaignValidationBypassConfig;
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

/** Body for POST /campaigns/{id}/clients/{clientId}/destinations */
export type CreateDestinationRequest = {
  name: string;
  type: DestinationType;
  url: string;
  method: "POST" | "GET" | "PUT" | "PATCH";
  headers?: Record<string, string>;
  payload_mapping: WFM[];
  acceptance_rules: WAR[];
  state_mapping_override?: Record<
    string,
    "abbr_to_name" | "name_to_abbr" | null
  >;
  is_primary?: boolean;
  claim_trusted_form?: boolean;
  require_successful_claim?: boolean;
};

/** Body for PUT /campaigns/{id}/clients/{clientId}/destinations/{destId} */
export type UpdateDestinationRequest = Partial<CreateDestinationRequest>;
