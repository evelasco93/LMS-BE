/**
 * Synthesized, transport-safe representation of a lead's metrics-relevant
 * outcome. Built once at write time from an `ILead`, persisted to the metrics
 * DLQ on emit failure, and consumed by the retry consumer Lambda.
 *
 * Keeping this shape decoupled from `ILead` keeps the DLQ payload stable as the
 * lead schema evolves and makes the metrics write path easy to fuzz.
 */

export type RejectionBucket =
  | "duplicate"
  | "validation"
  | "logic_rules"
  | "trusted_form"
  | "ipqs_phone"
  | "ipqs_email"
  | "ipqs_ip"
  | "affiliate_disabled"
  | "other";

export type IpqsCheckOutcome = {
  /** True when the check ran (the per-check result object is present on the lead). */
  ran: boolean;
  /** True when the check ran and passed. Undefined when ran === false. */
  pass?: boolean;
  /** Raw fraud_score from IPQS. Undefined when ran === false or score missing. */
  fraud_score?: number;
};

export type LeadOutcomeEvent = {
  lead_id: string;
  campaign_id: string;
  campaign_key?: string;
  affiliate_id?: string;
  contract_id?: string;
  created_at: string;
  /** Always 1 — every persisted lead counts as received. */
  received: number;
  /** 1 when accepted (not rejected), else 0. */
  accepted: number;
  /** 1 when sold by a client, else 0. */
  sold: number;
  /** 1 when accepted but not sold, else 0. */
  accepted_not_sold: number;
  /** 1 when rejected, else 0. */
  rejected: number;
  /**
   * 1 when this emission represents a cherry-pick action on the lead, else 0.
   * Cherry-pick is orthogonal to the received/accepted/sold/rejected axis: a
   * cherry-pick emission carries `received=accepted=sold=rejected=0` and only
   * bumps the `cherry_picked` counter, while the original lead-outcome emit
   * keeps `cherry_picked=0`. Idempotency on cherry-pick uses a dedicated key
   * (`cherry_pick:<lead_id>`) so it does not collide with `lead_outcome:<…>`.
   */
  cherry_picked: number;
  /** True when the lead was flagged as a duplicate (regardless of gate outcome). */
  duplicate: boolean;
  /**
   * Zero or more rejection buckets. An IPQS rejection may produce multiple
   * entries (one per failed check), hence array (not single value).
   */
  rejection_buckets: RejectionBucket[];
  ipqs: {
    phone: IpqsCheckOutcome;
    email: IpqsCheckOutcome;
    ip: IpqsCheckOutcome;
  };
  /**
   * Deploy-forward criteria answer snapshot from the normalized lead payload.
   * The metrics writer pre-aggregates these into campaign criteria buckets so
   * dashboard widget reads never scan historical leads.
   */
  criteria_answers?: Record<string, string>;
};
