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
  LogicRuleAction,
  LogicRuleOperator,
} from "../interfaces/ICampaign.interface";

export type CreateCampaignRequest = {
  name: string;
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

export type CreateLogicRuleGroupRequest = {
  conditions: CreateLogicRuleConditionRequest[];
};

export type CreateLogicRuleRequest = {
  name: string;
  action: LogicRuleAction;
  enabled?: boolean;
  groups: CreateLogicRuleGroupRequest[];
};

export type UpdateLogicRuleConditionRequest = {
  id?: string;
  field_name: string;
  operator: LogicRuleOperator;
  value?: string | string[];
};

export type UpdateLogicRuleGroupRequest = {
  id?: string;
  conditions: UpdateLogicRuleConditionRequest[];
};

export type UpdateLogicRuleRequest = {
  name?: string;
  action?: LogicRuleAction;
  enabled?: boolean;
  groups?: UpdateLogicRuleGroupRequest[];
};
