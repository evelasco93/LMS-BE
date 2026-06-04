/** Unified response returned to affiliates on every lead submission attempt */
export type LeadIntakeResponse = {
  result: "passed" | "failed";
  message: string;
  /** Present on pre-validation failures — explains why the request was rejected before a lead was stored */
  error?: string;
  /** Present when a lead was stored (soft-rejected or accepted) */
  lead_id?: string;
  /** Per-field/reason errors when the lead was soft-rejected */
  errors?: string[];
  /** Present only when the lead is accepted */
  data?: {
    lead_id: string;
  };
  correlation_id?: string;
};

export type ServiceResult<T = any> = {
  result: boolean;
  data?: T;
  error?: string;
};

export type RestApiResponse<T = any> = {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
  count?: number;
  page_count?: number;
  total_count?: number;
  total?: number;
  nextToken?: string;
  lastEvaluatedKey?: string;
  pagination?: {
    total?: number;
    totalCount?: number;
    returnedCount?: number;
    hasMore?: boolean;
    totalKnown: boolean;
    sortField?: "created_at" | "received_at";
    sortDirection?: "asc" | "desc";
    orderScope?: "global" | "page";
    note?: string;
  };
  correlation_id?: string;
};

export type PaginatedData<T> = {
  items: T[];
  count: number;
  page_count?: number;
  total_count?: number;
  nextToken?: string;
  lastEvaluatedKey?: string;
  pagination?: {
    total?: number;
    totalCount?: number;
    returnedCount?: number;
    hasMore?: boolean;
    totalKnown: boolean;
    sortField?: "created_at";
    sortDirection?: "asc" | "desc";
    orderScope?: "global" | "page";
    note?: string;
  };
};

export type PaginatedRestApiResponse<T> = {
  success: boolean;
  message?: string;
  data?: PaginatedData<T>;
  error?: string;
  correlation_id?: string;
};
