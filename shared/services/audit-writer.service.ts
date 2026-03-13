import { DynamoDBUtil } from "./dynamodb.util";
import { AuditLogEvent, AuditLogItem } from "../interfaces/IAuditLog.interface";
import { randomBytes } from "crypto";

/**
 * Generates a time-sortable unique log ID.
 * Format: <13-char ms timestamp base32> + <10-char random base32>
 * Lexicographically ordered — identical semantics to ULID without an external dep.
 */
function generateLogId(): string {
  const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const now = Date.now();
  let timeStr = "";
  let t = now;
  for (let i = 9; i >= 0; i--) {
    timeStr = ENCODING[t % 32] + timeStr;
    t = Math.floor(t / 32);
  }
  const rand = randomBytes(10);
  let randStr = "";
  for (let i = 0; i < rand.length; i++) {
    randStr += ENCODING[rand[i] % 32];
  }
  return timeStr + randStr;
}

export class AuditWriterService {
  constructor(
    private readonly dynamoDBUtil: DynamoDBUtil,
    private readonly tableName: string,
  ) {}

  async writeAuditEvent(event: AuditLogEvent): Promise<void> {
    // Skip if there are no meaningful changes (e.g. a no-op update)
    if (event.action === "updated" && event.changes.length === 0) return;

    const log_id = generateLogId();
    const date = event.changed_at.slice(0, 10); // "YYYY-MM-DD"
    const actor_sub = event.actor?.sub ?? event.actor?.email ?? "system";

    const item: AuditLogItem = {
      ...event,
      log_id,
      date,
      actor_sub,
    };

    await this.dynamoDBUtil.put({
      TableName: this.tableName,
      Item: item,
    });
  }
}
