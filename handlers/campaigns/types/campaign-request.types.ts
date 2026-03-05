import { CampaignStatus } from "../enums/campaign-status.enum";
import { CampaignParticipantStatus } from "../enums/campaign-participant-status.enum";
import {
  DuplicateCheckCriteriaField,
  IDuplicateCheckPluginConfig,
  ITrustedFormPluginConfig,
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
};

export type ListCampaignsQuery = {
  status?: CampaignStatus;
  limit?: number;
  lastEvaluatedKey?: string;
  includeDeleted?: boolean;
};
