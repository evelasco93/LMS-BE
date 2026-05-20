export interface RestApiResponse<T = unknown> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
  correlation_id?: string;
}

export interface ServiceResult<T = unknown> {
  result: boolean;
  data?: T;
  error?: string;
}
