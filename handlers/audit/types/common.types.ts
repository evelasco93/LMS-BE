export interface RestApiResponse {
  success: boolean;
  message: string;
  data?: unknown;
  error?: string;
}
