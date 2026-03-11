import "reflect-metadata";
import { container } from "./modules/logic-rules.module";
import { LogicRulesService } from "./services/logic-rules.service";
import { LogicRulesEvent } from "./types/logic-rules-event.types";

export async function handler(event: LogicRulesEvent) {
  const service = container.get<LogicRulesService>("LogicRulesService");
  const result = await service.execute(event);

  if (!result.result) {
    throw new Error(result.error || "Logic rules execution failed");
  }

  return result.data;
}
