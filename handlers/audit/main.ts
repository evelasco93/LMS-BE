import "reflect-metadata";
import { Context, APIGatewayProxyResult } from "aws-lambda";
import { createApp } from "./app";
import { AuditService } from "./services/audit.service";
import { container } from "./modules/audit.module";

/**
 * Entry point for both API Gateway proxy events and direct EventBridge scheduler
 * invocations (daily S3 export).
 */
export async function handler(
  event: any,
  context: Context,
): Promise<APIGatewayProxyResult | void> {
  // EventBridge Scheduler sends { "source": "aws.scheduler" } or a custom payload
  if (
    event?.source === "aws.scheduler" ||
    event?.["detail-type"] === "ScheduledEvent"
  ) {
    const auditService = container.get<AuditService>("AuditService");
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    const date = yesterday.toISOString().slice(0, 10);
    await auditService.exportToS3(date);
    return;
  }

  const app = await createApp();
  const response = await app.run(event, context);

  return {
    ...response,
    headers: {
      ...(response?.headers || {}),
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "*",
      "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    },
  } as APIGatewayProxyResult;
}
