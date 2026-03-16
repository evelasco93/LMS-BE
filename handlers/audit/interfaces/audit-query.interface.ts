import { AuditLogItem } from "@shared/interfaces/IAuditLog.interface";

export interface AuditQueryResult {
  items: AuditLogItem[];
  nextCursor?: string;
}
