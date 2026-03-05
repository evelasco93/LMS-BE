export type ServiceResult<T = unknown> = {
  result: boolean;
  data?: T;
  error?: string;
};
