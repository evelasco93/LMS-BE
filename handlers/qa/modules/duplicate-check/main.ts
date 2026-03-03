import "reflect-metadata";
import { container } from "./modules/duplicate-check.module";
import { DuplicateCheckService } from "./services/duplicate-check.service";
import { DuplicateCheckEvent } from "./types/duplicate-check-event.types";

export async function handler(event: DuplicateCheckEvent) {
  const service = container.get<DuplicateCheckService>("DuplicateCheckService");
  const result = await service.execute(event);

  if (!result.result || !result.data) {
    throw new Error(result.error || "Duplicate check execution failed");
  }

  return result.data;
}
