export interface LogicRuleConditionFailure {
  field: string;
  operator: string;
  /** The value(s) the rule expected */
  expected: string | string[];
  /** The actual value received in the lead payload */
  received: string;
}

export interface LogicRulesResponse {
  /** True when the lead is allowed through (no fail rule matched, or a pass rule matched first) */
  passed: boolean;
  /** Human-readable reason returned to the affiliate when passed=false */
  rejection_reason?: string;
  /** Detailed list of conditions that were not satisfied (only present when passed=false) */
  condition_failures?: LogicRuleConditionFailure[];
  /** ID of the first rule that matched and determined the outcome */
  matched_rule_id?: string;
  /** Name of the first rule that matched */
  matched_rule_name?: string;
}
