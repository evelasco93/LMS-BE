export type ServiceResult<T = any> = {
  result: boolean;
  data?: T;
  error?: string;
};
