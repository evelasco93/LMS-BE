export interface DuplicateCheckEvent {
  campaign_id: string;
  /** Whether this is a test lead — only match against leads of the same type */
  test?: boolean;
  payload?: Record<string, unknown>;
  criteria?: string[];
}
