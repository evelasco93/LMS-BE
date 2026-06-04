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
  include_test?: boolean;
  limit?: number;
  nextToken?: string;
  lastEvaluatedKey?: string;
  includeDeleted?: boolean;
  include_trace?: boolean;
};

export type ListIntakeLogsQuery = {
  campaign_id?: string;
  status?: "accepted" | "rejected" | "test" | "all";
  include_test?: boolean;
  from_date?: string;
  to_date?: string;
  limit?: number;
  lastEvaluatedKey?: string;
};
