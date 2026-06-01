export type ExecuteCherryPickRequest = {
  /** ID of the contract to deliver the lead to. Preferred over target_client_id. */
  target_contract_id?: string;
  /**
   * @deprecated Prefer target_contract_id. Buyer client_id used to resolve a
   * contract on the campaign when target_contract_id is not provided.
   */
  target_client_id?: string;
  /**
   * Campaign to look up the contract from. Defaults to the contract's parent
   * campaign (when target_contract_id is provided) or the lead's source
   * campaign (legacy target_client_id flow).
   */
  campaign_id?: string;
  /** When true, also dispatch source affiliate sold pixel after a sold cherry-pick. Defaults to false. */
  fire_affiliate_pixel?: boolean;
  /** Override delivery-config's claim_trusted_form flag — do NOT claim TrustedForm for this delivery */
  skip_trusted_form_claim?: boolean;
  /** Acknowledge & proceed even if the lead was flagged as a duplicate */
  skip_duplicate_check?: boolean;
  /** Acknowledge & proceed even if the lead's IPQS phone check failed */
  skip_ipqs_phone?: boolean;
  /** Acknowledge & proceed even if the lead's IPQS email check failed */
  skip_ipqs_email?: boolean;
  /** Acknowledge & proceed even if the lead's IPQS IP check failed */
  skip_ipqs_ip?: boolean;
  /** Optional payload key/value overrides that must win over lead payload values when delivering. */
  payload_overrides?: Record<string, unknown>;
  /** Optional payload keys to remove before delivery mapping is resolved. */
  removed_payload_fields?: string[];
};

export type UpdatePickabilityRequest = {
  cherry_pickable: boolean;
};

export type ListEligibleContractsQuery = {
  lead_id: string;
};

export type EligibleContractEntry = {
  contract_id: string;
  contract_name: string;
  client_id: string;
  client_name: string;
  campaign_id: string;
  campaign_name: string;
  /** Raw contract participant status (LIVE, PAUSED, etc.). */
  contract_status: string;
  /** Raw parent campaign status so the UI can warn on closed/paused campaigns. */
  campaign_status: string;
  /** Display-only delivery URL — never expose secrets/headers. */
  delivery_url?: string;
};
