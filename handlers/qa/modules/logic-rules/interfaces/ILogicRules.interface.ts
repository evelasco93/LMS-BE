export interface LogicRuleConditionFailure {
  field: string;
  operator: string;
  /** The value(s) the rule expected */
  expected: string | string[];
  /** The actual value received in the lead payload */
  received: string;
}

export interface FailedRuleDetail {
  rule_id: string;
  rule_name: string;
  failed_conditions: LogicRuleConditionFailure[];
}

export interface LogicRulesResponse {
  /** True when the lead passes (at least one enabled rule matched all its conditions) */
  passed: boolean;
  /** Human-readable reason returned to the affiliate when passed=false */
  rejection_reason?: string;
  /** Detailed list of conditions that were not satisfied (only present when passed=false) */
  condition_failures?: LogicRuleConditionFailure[];
  /** ID of the rule that matched (first match wins) */
  matched_rule_id?: string;
  /** Name of the rule that matched */
  matched_rule_name?: string;
  /** When rejected: details of each rule that was evaluated and why it failed */
  failed_rules?: FailedRuleDetail[];
}
