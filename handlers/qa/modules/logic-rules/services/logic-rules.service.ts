import { inject, injectable } from "inversify";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { Logger } from "@shared/services/logger.util";
import { LogicRulesConstants } from "../constants/logic-rules.constants";
import { LogicRulesResponse } from "../interfaces/ILogicRules.interface";
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

      const enabledRules = (campaign.logic_rules ?? []).filter(
        (r) => r.enabled,
      );

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
            const rejectionReason = `Lead does not meet campaign requirements: ${rule.name}`;
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
      // If there are only "fail" rules and none fired, the lead is allowed.
      const hasPassRules = enabledRules.some((r) => r.action === "pass");
      if (hasPassRules) {
        return {
          result: true,
          data: {
            passed: false,
            rejection_reason:
              "Lead does not meet campaign intake requirements.",
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
      v.includes(",") ? v.split(",").map((s) => s.trim()).filter(Boolean) : [v],
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
