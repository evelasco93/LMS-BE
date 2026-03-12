/** Slim response returned to affiliates on lead submission (POST /leads and POST /leads/test) */
export type LeadSubmissionResponse = {
  id: string;
  test: boolean;
  duplicate: boolean;
  rejected: boolean;
  rejection_reason: string | null;
  /** Per-field errors explaining why the lead was rejected (present only when rejected=true) */
  errors?: string[];
  /** Present only when the lead is accepted — contains an affiliate-friendly acceptance message */
  message?: string;
};

/** Response shape returned when a lead is rejected (logic rules or criteria validation) */
export type LeadRejectionResponse = {
  result: "failed";
  lead_id: string;
  msg: string;
  errors: string[];
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
