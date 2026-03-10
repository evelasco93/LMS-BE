export interface CriteriaValidationResponse {
  /** True when all required fields are present */
  valid: boolean;
  /** Populated when valid=false; lists missing required field names */
  missing_fields?: string[];
  /** Human-readable rejection reason for the affiliate */
  rejection_reason?: string;
}
