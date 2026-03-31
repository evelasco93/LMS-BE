export type ExecuteCherryPickRequest = {
  /** ID of the client to deliver the lead to */
  target_client_id: string;
  /** Campaign to look up delivery config from. Defaults to the lead's source campaign. */
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

export type ListEligibleClientsQuery = {
  lead_id: string;
};
