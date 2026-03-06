import "reflect-metadata";
import { Context, APIGatewayProxyResult } from "aws-lambda";
import { container } from "./modules/orchestrator.module";
import { OrchestratorService } from "./services/orchestrator.service";
import { OrchestratorEvent } from "./types/orchestrator-event.types";
import { createApp } from "./app";

export async function handler(
  event:
    | OrchestratorEvent
    | (Record<string, unknown> & { httpMethod?: string }),
  context: Context,
): Promise<OrchestratorEvent | APIGatewayProxyResult> {
  // If the event has httpMethod it came from API Gateway — serve HTTP routes
  if ("httpMethod" in event && event.httpMethod) {
    const app = await createApp();
    const response = await app.run(event as any, context);
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

  // Otherwise it was invoked Lambda-to-Lambda — run the orchestrator pipeline
  const service = container.get<OrchestratorService>("OrchestratorService");
  const result = await service.execute(event as OrchestratorEvent);

  if (!result.result) {
    throw new Error(result.error || "Orchestrator execution failed");
  }

  return result.data as any;
}
