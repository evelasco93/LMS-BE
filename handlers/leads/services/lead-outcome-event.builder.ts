import type { ILead } from "../interfaces/ILead.interface";
import type {
  IpqsCheckOutcome,
  LeadOutcomeEvent,
} from "../types/lead-outcome-event.types";
import { classifyRejection } from "./rejection-classifier";

type IpqsCheckResult = NonNullable<ILead["ipqs_result"]>["phone"];

function extractIpqsCheck(
  check: IpqsCheckResult | undefined,
): IpqsCheckOutcome {
  if (!check) {
    return { ran: false };
  }
  const rawFraudScore = check.raw?.fraud_score;
  const fraudScore =
    typeof rawFraudScore === "number" && Number.isFinite(rawFraudScore)
      ? rawFraudScore
      : undefined;
  const outcome: IpqsCheckOutcome = {
    ran: true,
    pass: check.success === true,
  };
  if (typeof fraudScore === "number" && Number.isFinite(fraudScore)) {
    outcome.fraud_score = fraudScore;
  }
  return outcome;
}

/**
 * Build the transport-safe `LeadOutcomeEvent` for a cherry-pick action. Only
 * `cherry_picked=1` is set; the received/accepted/sold/rejected axis is zero
 * so the cherry-pick emission never double-counts the original lead outcome.
 * Bucketing uses `executedAt` (the cherry-pick action time) rather than
 * `lead.created_at` so date-range views of "Cherry Picked" reflect when the
 * action was taken. Idempotency uses `cherry_pick:<lead_id>` (see
 * `emitLeadOutcomeEvent`). Pure function — no I/O.
 */
export function buildCherryPickEvent(
  lead: ILead,
  executedAt: string,
): LeadOutcomeEvent {
  return {
    lead_id: lead.id,
    campaign_id: lead.campaign_id,
    ...(lead.campaign_key ? { campaign_key: lead.campaign_key } : {}),
    ...(lead.affiliate_id ? { affiliate_id: lead.affiliate_id } : {}),
    // Intentionally NO contract_id: cherry-pick targets a client directly,
    // not a contract, and we do not want to bump contract counters.
    created_at: executedAt,
    received: 0,
    accepted: 0,
    sold: 0,
    accepted_not_sold: 0,
    rejected: 0,
    cherry_picked: 1,
    duplicate: false,
    rejection_buckets: [],
    ipqs: {
      phone: { ran: false },
      email: { ran: false },
      ip: { ran: false },
    },
  };
}

/**
 * Build the transport-safe `LeadOutcomeEvent` consumed by the metrics writer
 * and the DLQ retry consumer. Pure function — no I/O.
 */
export function buildLeadOutcomeEvent(lead: ILead): LeadOutcomeEvent {
  const rejected = lead.rejected === true;
  const sold = lead.sold === true;
  const accepted = rejected ? 0 : 1;
  const acceptedNotSold = accepted === 1 && !sold ? 1 : 0;

  const ipqs = {
    phone: extractIpqsCheck(lead.ipqs_result?.phone),
    email: extractIpqsCheck(lead.ipqs_result?.email),
    ip: extractIpqsCheck(lead.ipqs_result?.ip),
  };

  return {
    lead_id: lead.id,
    campaign_id: lead.campaign_id,
    ...(lead.campaign_key ? { campaign_key: lead.campaign_key } : {}),
    ...(lead.affiliate_id ? { affiliate_id: lead.affiliate_id } : {}),
    ...(lead.sold_to_contract_id
      ? { contract_id: lead.sold_to_contract_id }
      : {}),
    created_at: lead.created_at,
    received: 1,
    accepted,
    sold: sold ? 1 : 0,
    accepted_not_sold: acceptedNotSold,
    rejected: rejected ? 1 : 0,
    cherry_picked: 0,
    duplicate: lead.duplicate === true,
    rejection_buckets: rejected
      ? classifyRejection(lead.rejection_reason, lead.ipqs_result)
      : [],
    ipqs,
  };
}
