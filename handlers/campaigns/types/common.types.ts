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
  submit_url_test?: string;
  error?: string;
  count?: number;
  lastEvaluatedKey?: string;
};
