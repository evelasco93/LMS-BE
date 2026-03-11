export type CommonServiceResult<T> =
  | { result: true; data: T }
  | { result: false; error: string };
