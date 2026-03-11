export interface LogicRulesResponse {
  /** True when the lead is allowed through (no fail rule matched, or a pass rule matched first) */
  passed: boolean;
  /** Human-readable reason returned to the affiliate when passed=false */
  rejection_reason?: string;
  /** ID of the first rule that matched and determined the outcome */
  matched_rule_id?: string;
  /** Name of the first rule that matched */
  matched_rule_name?: string;
}
