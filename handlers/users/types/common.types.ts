export interface ServiceResult<T = void> {
  result: boolean;
  data?: T;
  error?: string;
}

export interface RestApiResponse {
  success: boolean;
  message: string;
  data?: any;
  error?: string;
  correlation_id?: string;
}
