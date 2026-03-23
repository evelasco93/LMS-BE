export type LeadIntakeStatus = "accepted" | "rejected" | "test";
import type { ILeadDeliveryResult } from "../../campaigns/interfaces/IClientDelivery.interface";
import type { LeadSoldStatus } from "./ILead.interface";

/**
 * Raw intake log written for every lead submission attempt.
 * Captured independently of the processed ILead record so that the full HTTP
 * context (headers, raw body, response summary) is available for diagnostics.
 *
 * DynamoDB layout:
 *   PK: id (same as lead.id)
 *   GSI campaign_id-received_at-index: campaign_id (PK), received_at (SK)
 */
export interface ILeadIntakeLog {
  /** Same as the corresponding ILead.id — generated before any validation */
  id: string;
  campaign_id: string;
  campaign_key?: string;
  /** ISO-8601 timestamp of intake */
  received_at: string;
  status: LeadIntakeStatus;
  method: "POST";
  is_test: boolean;

  // Extracted payload fields for quick table display (all from normalised payload)
  marketing_source?: string;
  pub_id?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  /** Full value of trusted_form_cert_id as submitted */
  trusted_form_cert?: string;

  /** Complete normalised request body */
  raw_body: Record<string, unknown>;
  /** Request headers forwarded from the Lambda event */
  raw_headers?: Record<string, string | string[] | undefined>;

  /** HTTP status code returned to the caller for this submission */
  response_status_code?: number;
  /** Exact API response payload returned to the caller */
  response_body?: Record<string, unknown>;

  /** Whether buyer delivery accepted this lead */
  sold?: boolean;
  /** Derived delivery status for UI convenience */
  sold_status?: LeadSoldStatus;
  /** Client that accepted the lead when sold=true */
  sold_to_client_id?: string;
  /** Full webhook delivery attempt details captured on the lead */
  delivery_result?: ILeadDeliveryResult;

  rejection_reason?: string;
  rejection_errors?: string[];
}
