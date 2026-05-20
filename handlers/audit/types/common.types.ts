export interface RestApiResponse {
  success: boolean;
  message: string;
  data?: unknown;
  error?: string;
  correlation_id?: string;
}
