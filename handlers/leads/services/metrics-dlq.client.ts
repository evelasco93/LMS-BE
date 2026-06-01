import { injectable, inject } from "inversify";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { Logger } from "@shared/services/logger.util";
import { LeadsConstants } from "../constants/leads.constants";
import type { LeadOutcomeEvent } from "../types/lead-outcome-event.types";

/**
 * CR-001 — Metrics emit DLQ payload shape.
 *
 * The retry consumer Lambda parses `event` and re-invokes
 * `MetricsService.recordLeadOutcomeFromEvent(event)`. `attempt` is the count
 * of times the producer has enqueued this event (always 1 from the leads
 * lambda; SQS redrive bumps the ApproximateReceiveCount header, not this
 * field). `first_failed_at` / `last_error` are debugging aids only.
 */
export type MetricsDlqMessage = {
  event: LeadOutcomeEvent;
  attempt: number;
  first_failed_at: string;
  last_error: string;
};

/**
 * Thin injectable wrapper around `SendMessageCommand`. Owning a class (vs a
 * raw client) keeps DI uniform with the rest of the leads handler and lets
 * tests stub the enqueue path without mocking the AWS SDK.
 */
@injectable()
export class MetricsDlqClient {
  private readonly client: SQSClient;

  constructor(
    @inject("Logger") private readonly logger: Logger,
    @inject("LeadsConstants") private readonly constants: LeadsConstants,
  ) {
    this.client = new SQSClient({ region: constants.AWS_REGION });
  }

  /**
   * Enqueue a failed metrics emit. Returns true on success, false on enqueue
   * failure. Never throws — callers are already on the failure path and must
   * not amplify the failure mode.
   */
  async enqueue(event: LeadOutcomeEvent, error: unknown): Promise<boolean> {
    const queueUrl = this.constants.METRICS_DLQ_URL;
    if (!queueUrl) {
      this.logger.error(
        "METRICS_DLQ_URL not configured — metrics emit failure will not be retried",
        { leadId: event.lead_id },
      );
      return false;
    }

    const message: MetricsDlqMessage = {
      event,
      attempt: 1,
      first_failed_at: new Date().toISOString(),
      last_error:
        error instanceof Error
          ? error.message
          : typeof error === "string"
            ? error
            : "unknown",
    };

    try {
      await this.client.send(
        new SendMessageCommand({
          QueueUrl: queueUrl,
          MessageBody: JSON.stringify(message),
        }),
      );
      return true;
    } catch (enqueueError: any) {
      // Last-resort log: producer failure path AND DLQ failure path both
      // failed — there is nowhere left to send the message.
      this.logger.error("Failed to enqueue metrics emit failure to DLQ", {
        leadId: event.lead_id,
        originalError:
          error instanceof Error ? error.message : String(error ?? ""),
        dlqError: enqueueError?.message,
      });
      return false;
    }
  }
}
