export type ServiceResult<T> =
  | { result: true; data: T }
  | { result: false; error: string };
