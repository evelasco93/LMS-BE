import type { ILead } from "../interfaces/ILead.interface";
import type { RejectionBucket } from "../types/lead-outcome-event.types";
import {
  REJECTION_DUPLICATE,
  REJECTION_AFFILIATE_DISABLED,
  REJECTION_CRITERIA_VALIDATION,
  REJECTION_LOGIC_RULES,
  REJECTION_TRUSTED_FORM_INVALID,
  REJECTION_TRUSTED_FORM_EXPIRED,
  REJECTION_TRUSTED_FORM_ALREADY_CLAIMED,
} from "@shared/constants/rejection-messages.constants";

/**
 * Maps a lead's rejection reason string + IPQS per-check results into the
 * canonical rejection-bucket set used by the metrics counters.
 *
 * Order of matching:
 *   1. Exact constant equality (cheapest, deterministic).
 *   2. Known prefixes for variadic messages (criteria validation, logic rules,
 *      trusted form variants whose runtime text may include detail suffixes).
 *   3. IPQS: emit one bucket per failed per-check object on `ipqs_result`.
 *   4. Fallback: "other".
 *
 * Returns an empty array when `reason` is `undefined` — caller treats that as
 * "lead accepted, no rejection buckets to increment".
 */
export function classifyRejection(
  reason: string | undefined,
  ipqs: ILead["ipqs_result"] | undefined,
): RejectionBucket[] {
  if (reason === undefined) {
    return [];
  }

  const buckets: RejectionBucket[] = [];

  // 1. Exact-constant matches first (these are stable, no detail suffix).
  if (reason === REJECTION_DUPLICATE) buckets.push("duplicate");
  if (reason === REJECTION_AFFILIATE_DISABLED)
    buckets.push("affiliate_disabled");

  // 2. Prefix matches for messages that include a detail suffix at runtime.
  //    REJECTION_CRITERIA_VALIDATION may arrive as
  //    "Missing required fields: First Name, Phone" from the criteria-validation
  //    lambda; otherwise it is the constant. Both cases mean "validation".
  if (
    reason === REJECTION_CRITERIA_VALIDATION ||
    reason.startsWith("Missing required fields")
  ) {
    buckets.push("validation");
  }

  //    Logic rules: constant or "Lead does not meet campaign requirements: ..."
  if (
    reason === REJECTION_LOGIC_RULES ||
    reason.startsWith("Lead does not meet campaign requirements")
  ) {
    buckets.push("logic_rules");
  }

  //    Trusted form: multiple variants, all begin with "The form certificate".
  if (
    reason === REJECTION_TRUSTED_FORM_INVALID ||
    reason === REJECTION_TRUSTED_FORM_EXPIRED ||
    reason === REJECTION_TRUSTED_FORM_ALREADY_CLAIMED ||
    reason.startsWith("The form certificate")
  ) {
    buckets.push("trusted_form");
  }

  // 3. IPQS: inspect per-check `success === false` and emit a bucket per failure.
  if (ipqs) {
    if (ipqs.phone && ipqs.phone.success === false) buckets.push("ipqs_phone");
    if (ipqs.email && ipqs.email.success === false) buckets.push("ipqs_email");
    if (ipqs.ip && ipqs.ip.success === false) buckets.push("ipqs_ip");
  }

  // 4. Fallback: rejection occurred but we couldn't classify it.
  if (buckets.length === 0) {
    buckets.push("other");
  }

  return buckets;
}
