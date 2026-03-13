export type AuditEntityType =
  | "lead"
  | "campaign"
  | "client"
  | "affiliate"
  | "credential"
  | "credential_schema"
  | "plugin_setting"
  | "user";

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
  | "password_reset";

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
