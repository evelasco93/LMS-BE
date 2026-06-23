export type ServiceResult<T = unknown> = {
  result: boolean;
  data?: T;
  error?: string;
};

export type RestApiResponse<T = unknown> = {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
  count?: number;
  correlation_id?: string;
};
