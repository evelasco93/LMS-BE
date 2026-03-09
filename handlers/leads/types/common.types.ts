/** Slim response returned to affiliates on lead submission (POST /leads and POST /leads/test) */
export type LeadSubmissionResponse = {
  id: string;
  test: boolean;
  duplicate: boolean;
  rejected: boolean;
  rejection_reason: string | null;
  /** Present only when the lead is accepted — contains an affiliate-friendly acceptance message */
  message?: string;
};

export type ServiceResult<T = any> = {
  result: boolean;
  data?: T;
  error?: string;
};

export type RestApiResponse<T = any> = {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
  count?: number;
  lastEvaluatedKey?: string;
};
