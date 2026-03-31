export type ServiceResult<T = any> = {
  result: boolean;
  data?: T;
  error?: string;
};

export type RestApiResponse = {
  success: boolean;
  message: string;
  data?: unknown;
  count?: number;
  error?: string;
};
