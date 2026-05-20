export type ServiceResult<T = any> = {
  result: boolean;
  data?: T;
  error?: string;
};

export type RestApiResponse = {
  success: boolean;
  message: string;
  data?: any;
  count?: number;
  error?: string;
  correlation_id?: string;
};
