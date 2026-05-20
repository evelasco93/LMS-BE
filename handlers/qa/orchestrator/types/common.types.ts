export type ServiceResult<T = any> = {
  result: boolean;
  data?: T;
  error?: string;
};

export interface RestApiResponse {
  success: boolean;
  message?: string;
  data?: unknown;
  error?: string;
  correlation_id?: string;
}
