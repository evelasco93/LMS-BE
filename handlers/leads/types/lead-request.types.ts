export type CreateLeadRequest = {
  campaign_id: string;
  campaign_key: string;
  payload?: Record<string, unknown>;
};

export type UpdateLeadRequest = {
  payload?: Record<string, unknown>;
};

export type ListLeadsQuery = {
  campaign_id?: string;
  test?: boolean;
  limit?: number;
  lastEvaluatedKey?: string;
};
