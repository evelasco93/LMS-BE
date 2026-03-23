export type CreateLeadRequest = {
  campaign_id: string;
  campaign_key: string;
  payload?: Record<string, unknown>;
  test?: boolean;
};

export type UpdateLeadRequest = {
  payload?: Record<string, unknown>;
};

export type ListLeadsQuery = {
  campaign_id?: string;
  test?: boolean;
  limit?: number;
  lastEvaluatedKey?: string;
  includeDeleted?: boolean;
};

export type ListIntakeLogsQuery = {
  campaign_id?: string;
  status?: "accepted" | "rejected" | "test";
  from_date?: string;
  to_date?: string;
  limit?: number;
  lastEvaluatedKey?: string;
};
