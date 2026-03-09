/**
 * Affiliate-facing rejection and acceptance messages.
 *
 * All wording lives here — update these string values to rephrase any message
 * without touching the service or controller logic.
 */

// ── Rejection messages ────────────────────────────────────────────────────────

/** Fired when a lead with matching criteria already exists for this campaign. */
export const REJECTION_DUPLICATE =
  "A matching lead has already been received for this contact.";

/** Fired when the submitting affiliate is DISABLED for the campaign. */
export const REJECTION_AFFILIATE_DISABLED =
  "This submission could not be accepted at this time. Please contact your account manager.";

/** Fired when TrustedForm certificate validation returns a generic failure or error. */
export const REJECTION_TRUSTED_FORM_INVALID =
  "The form certificate could not be verified. Please ensure the form was completed correctly and resubmit.";

/** Fired when TrustedForm returns an expired certificate. */
export const REJECTION_TRUSTED_FORM_EXPIRED =
  "The form certificate has expired. Please have the contact complete the form again and resubmit.";

/** Fired when TrustedForm certificate has already been claimed by a prior submission. */
export const REJECTION_TRUSTED_FORM_ALREADY_CLAIMED =
  "This form certificate has already been used. Please have the contact complete the form again.";

/**
 * Label used for the IPQS phone check when building a rejection message.
 * Keep this lowercase — it is interpolated into a sentence.
 */
export const REJECTION_IPQS_PHONE = "phone number";

/**
 * Label used for the IPQS email check when building a rejection message.
 * Keep this lowercase — it is interpolated into a sentence.
 */
export const REJECTION_IPQS_EMAIL = "email address";

/**
 * Label used for the IPQS IP check when building a rejection message.
 * Keep this lowercase — it is interpolated into a sentence.
 */
export const REJECTION_IPQS_IP = "IP address";

// ── Acceptance messages ───────────────────────────────────────────────────────

/** Returned to affiliates when a live lead is accepted. */
export const LEAD_ACCEPTED_MESSAGE =
  "Your lead has been received and accepted.";

/** Returned to affiliates when a test lead is accepted. */
export const LEAD_ACCEPTED_TEST_MESSAGE =
  "Your test lead has been received and accepted.";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Builds a human-readable IPQS rejection message listing all failed check labels.
 *
 * @example
 * buildIpqsRejectionMessage([REJECTION_IPQS_PHONE, REJECTION_IPQS_EMAIL])
 * // → "The phone number and email address provided did not pass our quality checks."
 */
export function buildIpqsRejectionMessage(failedChecks: string[]): string {
  if (failedChecks.length === 0) {
    return "This lead did not pass our quality checks. Please review the submission and try again.";
  }
  if (failedChecks.length === 1) {
    return `The ${failedChecks[0]} provided did not pass our quality checks.`;
  }
  const last = failedChecks[failedChecks.length - 1];
  const rest = failedChecks.slice(0, -1);
  return `The ${rest.join(", ")} and ${last} provided did not pass our quality checks.`;
}
