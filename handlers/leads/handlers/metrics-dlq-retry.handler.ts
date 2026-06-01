import "reflect-metadata";
import type { SQSBatchResponse, SQSEvent, SQSRecord } from "aws-lambda";
import { container } from "../modules/leads.module";
import { MetricsService } from "../services/metrics.service";
import { Logger } from "@shared/services/logger.util";
import type { LeadOutcomeEvent } from "../types/lead-outcome-event.types";
import type { MetricsDlqMessage } from "../services/metrics-dlq.client";

/**
 * CR-001 — Metrics emit DLQ retry consumer.
 *
 * Triggered by the metrics DLQ. Each record carries a `MetricsDlqMessage`
 * (see `metrics-dlq.client.ts`). The handler re-invokes
 * `MetricsService.recordLeadOutcomeFromEvent(event)`. Idempotency is
 * preserved by the conditional `idempotency#lead_outcome:{lead_id}` put
 * inside the TransactWrite, so replays after partial success are no-ops.
 *
 * Uses `reportBatchItemFailures` semantics: individual record failures are
 * returned to SQS so the message remains in-flight until the redrive policy
 * (maxReceiveCount = 5) sends it to the terminal parking queue. Successful
 * records are implicitly deleted by SQS.
 *
 * Parse failures are treated as terminal — the message body is unrecoverable
 * and re-trying will keep failing. We log and ack (do NOT add to
 * batchItemFailures) so the bad record drains to CloudWatch logs.
 */
const metricsService = container.get<MetricsService>("MetricsService");
const logger = container.get<Logger>("Logger");

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];

  for (const record of event.Records) {
    try {
      const parsed = parseRecord(record);
      if (!parsed) {
        // Unparseable — drain (do NOT add to batchItemFailures).
        continue;
      }
      await metricsService.recordLeadOutcomeFromEvent(parsed.event);
    } catch (err: any) {
      logger.error("Metrics DLQ retry failed", {
        messageId: record.messageId,
        error: err?.message,
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};

function parseRecord(record: SQSRecord): { event: LeadOutcomeEvent } | null {
  let body: MetricsDlqMessage;
  try {
    body = JSON.parse(record.body) as MetricsDlqMessage;
  } catch (parseErr: any) {
    logger.error("Metrics DLQ retry: invalid JSON body — draining", {
      messageId: record.messageId,
      error: parseErr?.message,
    });
    return null;
  }
  if (!body || typeof body !== "object" || !body.event || !body.event.lead_id) {
    logger.error("Metrics DLQ retry: missing event payload — draining", {
      messageId: record.messageId,
    });
    return null;
  }
  return { event: body.event };
}
