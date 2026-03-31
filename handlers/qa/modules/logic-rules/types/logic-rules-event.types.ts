export interface LogicRulesEvent {
  campaign_id: string;
  payload: Record<string, unknown>;
  /** When set, affiliate-level logic_rules from campaign.affiliate_overrides[affiliate_id] are
   *  evaluated instead of the campaign-level logic_rules, giving the affiliate an independent
   *  accept/reject ruleset that supersedes the campaign default. */
  affiliate_id?: string;
}
