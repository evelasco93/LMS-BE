export interface ServiceResult<T> {
  result: boolean;
  data?: T;
  error?: string;
}
