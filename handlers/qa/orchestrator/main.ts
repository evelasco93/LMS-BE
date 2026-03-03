import "reflect-metadata";
import { container } from "./modules/orchestrator.module";
import { OrchestratorService } from "./services/orchestrator.service";
import { OrchestratorEvent } from "./types/orchestrator-event.types";

export async function handler(event: OrchestratorEvent) {
  const service = container.get<OrchestratorService>("OrchestratorService");
  const result = await service.execute(event);

  if (!result.result) {
    throw new Error(result.error || "Orchestrator execution failed");
  }

  return result.data;
}
