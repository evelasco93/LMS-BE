export type AuditEntityType =
  | "lead"
  | "campaign"
  | "client"
  | "affiliate"
  | "credential"
  | "credential_schema"
  | "plugin_setting"
  | "user"
  | "criteria_catalog"
  | "logic_catalog"
  | "user_table_preference";

export type AuditAction =
  | "created"
  | "updated"
  | "deleted"
  | "soft_deleted"
  | "restored"
  | "status_changed"
  | "key_rotated"
  | "participant_linked"
  | "participant_updated"
  | "participant_removed"
  | "criteria_field_added"
  | "criteria_field_updated"
  | "criteria_field_deleted"
  | "criteria_fields_reordered"
  | "logic_rule_added"
  | "logic_rule_updated"
  | "logic_rule_deleted"
  | "mappings_updated"
  | "plugins_updated"
  | "hard_deleted"
  | "credential_disabled"
  | "credential_enabled"
  | "plugin_setting_disabled"
  | "plugin_setting_enabled"
  | "password_reset"
  | "posting_instructions_generated"
  | "value_mapped"
  | "lead_delivered"
  | "delivery_config_updated"
  | "lead_cap_updated"
  | "delivery_skipped"
  | "cert_claimed"
  | "distribution_updated"
  | "client_linked"
  | "client_status_updated"
  | "client_deleted"
  | "affiliate_linked"
  | "affiliate_status_updated"
  | "affiliate_pixel_updated"
  | "affiliate_pixel_fired"
  | "affiliate_pixel_failed"
  | "affiliate_deleted"
  | "affiliate_key_rotated"
  | "original_source_set"
  | "order_number_normalized"
  | "criteria_catalog_created"
  | "criteria_catalog_updated"
  | "criteria_catalog_assigned"
  | "criteria_catalog_deleted"
  | "criteria_catalog_version_deleted"
  | "cherry_pick_executed"
  | "cherry_pick_pickability_updated"
  | "table_preference_saved"
  | "table_preference_deleted"
  | "campaign_tags_updated"
  | "affiliate_validation_bypass_updated"
  | "affiliate_logic_rule_added"
  | "affiliate_logic_rule_updated"
  | "affiliate_logic_rule_deleted"
  | "affiliate_logic_catalog_applied"
  | "client_logic_rule_added"
  | "client_logic_rule_updated"
  | "client_logic_rule_deleted"
  | "client_logic_catalog_applied"
  | "logic_catalog_created"
  | "logic_catalog_updated"
  | "logic_catalog_deleted"
  | "logic_catalog_version_deleted"
  | "logic_catalog_assigned";

export interface AuditChange {
  field: string;
  from: unknown;
  to: unknown;
}

/**
 * Event shape passed to AuditWriterService.writeAuditEvent().
 * The service derives log_id, date, and actor_sub before writing.
 */
export interface AuditLogEvent {
  entity_id: string;
  entity_type: AuditEntityType;
  action: AuditAction;
  changes: AuditChange[];
  actor?: {
    sub?: string;
    username?: string;
    email?: string;
    first_name?: string;
    last_name?: string;
    full_name?: string;
  };
  /** ISO timestamp of the mutation — caller supplies so it matches the entity's updated_at */
  changed_at: string;
}

/**
 * Item stored in DynamoDB (AuditLogEvent plus the derived keys).
 */
export interface AuditLogItem extends AuditLogEvent {
  /** ULID — partition sort key; lexicographically ordered by time */
  log_id: string;
  /** YYYY-MM-DD — GSI partition key for daily S3 export */
  date: string;
  /** Cognito sub of the actor — GSI partition key for per-user activity feed */
  actor_sub: string;
}
