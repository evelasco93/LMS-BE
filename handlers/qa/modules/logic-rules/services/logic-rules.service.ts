import { inject, injectable } from "inversify";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { Logger } from "@shared/services/logger.util";
import { LogicRulesConstants } from "../constants/logic-rules.constants";
import {
  LogicRuleConditionFailure,
  LogicRulesResponse,
} from "../interfaces/ILogicRules.interface";
import { LogicRulesEvent } from "../types/logic-rules-event.types";
import { CommonServiceResult } from "../types/common.types";

type LogicRuleOperator =
  | "is"
  | "is_not"
  | "contains"
  | "does_not_contain"
  | "starts_with"
  | "ends_with"
  | "greater_than"
  | "less_than"
  | "is_empty"
  | "is_not_empty";

interface ILogicRuleCondition {
  id: string;
  field_name: string;
  operator: LogicRuleOperator;
  value?: string | string[];
}

interface ILogicRuleGroup {
  id: string;
  conditions: ILogicRuleCondition[];
}

interface ILogicRule {
  id: string;
  name: string;
  action: "pass" | "fail";
  enabled: boolean;
  groups: ILogicRuleGroup[];
}

interface CampaignRecord {
  id: string;
  is_deleted?: boolean;
  logic_rules?: ILogicRule[];
  affiliate_overrides?: Record<string, { logic_rules?: ILogicRule[] }>;
}

@injectable()
export class LogicRulesService {
  constructor(
    @inject("DynamoDBUtil") private readonly dynamoDBUtil: DynamoDBUtil,
    @inject("Logger") private readonly logger: Logger,
    @inject("LogicRulesConstants")
    private readonly constants: LogicRulesConstants,
  ) {}

  async execute(
    event: LogicRulesEvent,
  ): Promise<CommonServiceResult<LogicRulesResponse>> {
    try {
      const campaign = await this.dynamoDBUtil.get<CampaignRecord>({
        TableName: this.constants.CAMPAIGNS_TABLE_NAME,
        Key: { id: event.campaign_id },
      });

      if (!campaign || campaign.is_deleted) {
        this.logger.warn("LogicRules: campaign not found", {
          campaignId: event.campaign_id,
        });
        // Campaign lookup failure is not a logic rules problem — allow through
        return { result: true, data: { passed: true } };
      }

      // Resolve the effective ruleset: affiliate overrides take priority over
      // campaign-level rules when the affiliate has its own logic_rules configured.
      // This lets individual affiliates have accept/reject rules that differ from
      // (and supersede) the campaign default — e.g. a campaign-wide state restrict
      // can be bypassed for a specific affiliate that has its own state whitelist.
      const affiliateOverrideRules =
        event.affiliate_id && campaign.affiliate_overrides
          ? (campaign.affiliate_overrides[event.affiliate_id]?.logic_rules ??
            [])
          : [];

      const effectiveRules =
        affiliateOverrideRules.length > 0
          ? affiliateOverrideRules
          : (campaign.logic_rules ?? []);

      const enabledRules = effectiveRules.filter((r) => r.enabled);

      if (enabledRules.length === 0) {
        return { result: true, data: { passed: true } };
      }

      const payload = event.payload ?? {};

      for (const rule of enabledRules) {
        const ruleMatches = this.evaluateRule(rule, payload);

        if (ruleMatches) {
          if (rule.action === "pass") {
            this.logger.info("LogicRules: pass rule matched — lead allowed", {
              campaignId: event.campaign_id,
              ruleId: rule.id,
              ruleName: rule.name,
            });
            return {
              result: true,
              data: {
                passed: true,
                matched_rule_id: rule.id,
                matched_rule_name: rule.name,
              },
            };
          } else {
            // Fail rule matched — collect the conditions that triggered it,
            // with operators inverted so formatting reads "must not equal X"
            const failures = this.collectMatchedConditions(rule, payload);
            const rejectionReason = this.buildRejectionMessage(
              failures,
              rule.name,
            );
            this.logger.info("LogicRules: fail rule matched — lead rejected", {
              campaignId: event.campaign_id,
              ruleId: rule.id,
              ruleName: rule.name,
            });
            return {
              result: true,
              data: {
                passed: false,
                rejection_reason: rejectionReason,
                condition_failures: failures,
                matched_rule_id: rule.id,
                matched_rule_name: rule.name,
              },
            };
          }
        }
      }

      // No rules matched.
      // If there are any enabled "pass" rules, those define a whitelist — a
      // lead that didn't satisfy any of them must be rejected.
      // Collect every condition from every pass rule that the lead failed.
      const passRules = enabledRules.filter((r) => r.action === "pass");
      if (passRules.length > 0) {
        const allFailures: LogicRuleConditionFailure[] = passRules.flatMap(
          (rule) => this.collectConditionFailures(rule, payload),
        );
        // Deduplicate by field+operator+expected to avoid repeating the same
        // requirement from multiple rules.
        const seen = new Set<string>();
        const uniqueFailures = allFailures.filter((f) => {
          const key = `${f.field}:${f.operator}:${JSON.stringify(f.expected)}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        const rejectionReason = this.buildRejectionMessage(uniqueFailures);
        return {
          result: true,
          data: {
            passed: false,
            rejection_reason: rejectionReason,
            condition_failures: uniqueFailures,
          },
        };
      }

      return { result: true, data: { passed: true } };
    } catch (error: any) {
      this.logger.error("LogicRules: execution failed", error);
      return {
        result: false,
        error: error.message || "Logic rules execution failed",
      };
    }
  }

  /**
   * Collects all conditions in a rule that the lead does NOT satisfy.
   * Used to build a detailed rejection message.
   */
  /**
   * For fail rules: collects conditions that evaluated to TRUE (triggered the
   * rejection) with operators inverted so downstream formatting reads as
   * "must not equal X" rather than "must equal X".
   */
  private collectMatchedConditions(
    rule: ILogicRule,
    payload: Record<string, unknown>,
  ): LogicRuleConditionFailure[] {
    const INVERT: Record<string, string> = {
      is: "is_not",
      is_not: "is",
      contains: "does_not_contain",
      does_not_contain: "contains",
      starts_with: "does_not_start_with",
      ends_with: "does_not_end_with",
      greater_than: "less_than",
      less_than: "greater_than",
      is_empty: "is_not_empty",
      is_not_empty: "is_empty",
    };
    const matches: LogicRuleConditionFailure[] = [];
    for (const group of rule.groups ?? []) {
      for (const condition of group.conditions ?? []) {
        if (this.evaluateCondition(condition, payload)) {
          const raw = payload[condition.field_name];
          const received = raw === undefined || raw === null ? "" : String(raw);
          const conditionValue = condition.value;
          const rawValues: string[] = Array.isArray(conditionValue)
            ? conditionValue.map((v) => String(v).trim())
            : conditionValue !== undefined
              ? [String(conditionValue).trim()]
              : [];
          const expected: string[] = rawValues.flatMap((v) =>
            v.includes(",")
              ? v
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
              : [v],
          );
          matches.push({
            field: condition.field_name,
            operator: INVERT[condition.operator] ?? condition.operator,
            expected: expected.length === 1 ? expected[0] : expected,
            received,
          });
        }
      }
    }
    return matches;
  }

  private collectConditionFailures(
    rule: ILogicRule,
    payload: Record<string, unknown>,
  ): LogicRuleConditionFailure[] {
    const failures: LogicRuleConditionFailure[] = [];
    for (const group of rule.groups ?? []) {
      for (const condition of group.conditions ?? []) {
        if (!this.evaluateCondition(condition, payload)) {
          const raw = payload[condition.field_name];
          const received = raw === undefined || raw === null ? "" : String(raw);
          const conditionValue = condition.value;
          const rawValues: string[] = Array.isArray(conditionValue)
            ? conditionValue.map((v) => String(v).trim())
            : conditionValue !== undefined
              ? [String(conditionValue).trim()]
              : [];
          const expected: string[] = rawValues.flatMap((v) =>
            v.includes(",")
              ? v
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean)
              : [v],
          );
          failures.push({
            field: condition.field_name,
            operator: condition.operator,
            expected: expected.length === 1 ? expected[0] : expected,
            received,
          });
        }
      }
    }
    return failures;
  }

  /**
   * Builds a human-readable rejection message from a list of condition failures.
   */
  private buildRejectionMessage(
    failures: LogicRuleConditionFailure[],
    ruleName?: string,
  ): string {
    if (failures.length === 0) {
      return ruleName
        ? `Lead does not meet campaign requirements: ${ruleName}.`
        : "Lead does not meet campaign intake requirements.";
    }
    const details = failures.map((f) => {
      const field = f.field.replace(/_/g, " ");
      const expected = Array.isArray(f.expected)
        ? f.expected.join(" or ")
        : f.expected;
      switch (f.operator) {
        case "is":
          return `'${field}' must be '${expected}' (received '${f.received}')`;
        case "is_not":
          return `'${field}' must not be '${expected}' (received '${f.received}')`;
        case "contains":
          return `'${field}' must contain '${expected}' (received '${f.received}')`;
        case "does_not_contain":
          return `'${field}' must not contain '${expected}' (received '${f.received}')`;
        case "does_not_start_with":
          return `'${field}' must not start with '${expected}' (received '${f.received}')`;
        case "does_not_end_with":
          return `'${field}' must not end with '${expected}' (received '${f.received}')`;
        case "starts_with":
          return `'${field}' must start with '${expected}' (received '${f.received}')`;
        case "ends_with":
          return `'${field}' must end with '${expected}' (received '${f.received}')`;
        case "greater_than":
          return `'${field}' must be greater than '${expected}' (received '${f.received}')`;
        case "less_than":
          return `'${field}' must be less than '${expected}' (received '${f.received}')`;
        case "is_empty":
          return `'${field}' must be empty (received '${f.received}')`;
        case "is_not_empty":
          return `'${field}' must not be empty`;
        default:
          return `'${field}' did not meet the required condition`;
      }
    });
    const prefix = ruleName
      ? `Lead rejected by rule '${ruleName}': `
      : "Lead does not meet campaign intake requirements: ";
    return prefix + details.join("; ") + ".";
  }

  /**
   * A rule matches when any of its groups match (OR between groups).
   */
  private evaluateRule(
    rule: ILogicRule,
    payload: Record<string, unknown>,
  ): boolean {
    if (!rule.groups || rule.groups.length === 0) return false;
    return rule.groups.some((group) => this.evaluateGroup(group, payload));
  }

  /**
   * A group matches when all of its conditions match (AND between conditions).
   */
  private evaluateGroup(
    group: ILogicRuleGroup,
    payload: Record<string, unknown>,
  ): boolean {
    if (!group.conditions || group.conditions.length === 0) return false;
    return group.conditions.every((condition) =>
      this.evaluateCondition(condition, payload),
    );
  }

  private evaluateCondition(
    condition: ILogicRuleCondition,
    payload: Record<string, unknown>,
  ): boolean {
    const raw = payload[condition.field_name];

    switch (condition.operator) {
      case "is_empty":
        return (
          raw === undefined ||
          raw === null ||
          (typeof raw === "string" && raw.trim() === "")
        );

      case "is_not_empty":
        return !(
          raw === undefined ||
          raw === null ||
          (typeof raw === "string" && raw.trim() === "")
        );

      default:
        return this.evaluateValueCondition(condition, raw);
    }
  }

  private evaluateValueCondition(
    condition: ILogicRuleCondition,
    raw: unknown,
  ): boolean {
    const fieldStr = String(raw ?? "")
      .toLowerCase()
      .trim();
    const conditionValue = condition.value;

    // Normalise condition value(s) to a flat array of lowercase strings.
    // A single string value may be comma-separated (e.g. "California,Georgia")
    // to represent multiple values — split and flatten so each entry is tested
    // individually.
    const rawValues: string[] = Array.isArray(conditionValue)
      ? conditionValue.map((v) => String(v).toLowerCase().trim())
      : conditionValue !== undefined
        ? [String(conditionValue).toLowerCase().trim()]
        : [];
    const values: string[] = rawValues.flatMap((v) =>
      v.includes(",")
        ? v
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [v],
    );

    switch (condition.operator) {
      case "is":
        return values.some((v) => fieldStr === v);

      case "is_not":
        return values.every((v) => fieldStr !== v);

      case "contains":
        return values.some((v) => fieldStr.includes(v));

      case "does_not_contain":
        return values.every((v) => !fieldStr.includes(v));

      case "starts_with":
        return values.some((v) => fieldStr.startsWith(v));

      case "ends_with":
        return values.some((v) => fieldStr.endsWith(v));

      case "greater_than": {
        const num = parseFloat(fieldStr);
        const threshold = parseFloat(values[0] ?? "");
        if (isNaN(num) || isNaN(threshold)) return false;
        return num > threshold;
      }

      case "less_than": {
        const num = parseFloat(fieldStr);
        const threshold = parseFloat(values[0] ?? "");
        if (isNaN(num) || isNaN(threshold)) return false;
        return num < threshold;
      }

      default:
        return false;
    }
  }
}
