export type ServiceResult<T = any> = {
  result: boolean;
  data?: T;
  error?: string;
};

export type RestApiResponse<T = any> = {
  success: boolean;
  message?: string;
  data?: T;
  submit_url?: string;
  error?: string;
  count?: number;
  lastEvaluatedKey?: string;
};
