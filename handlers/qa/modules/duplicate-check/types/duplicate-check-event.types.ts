export interface DuplicateCheckEvent {
  campaign_id: string;
  payload?: Record<string, unknown>;
  criteria?: string[];
}
