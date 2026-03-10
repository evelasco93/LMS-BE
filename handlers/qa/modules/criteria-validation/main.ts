import "reflect-metadata";
import { container } from "./modules/criteria-validation.module";
import { CriteriaValidationService } from "./services/criteria-validation.service";
import { CriteriaValidationEvent } from "./types/criteria-validation-event.types";

export async function handler(event: CriteriaValidationEvent) {
  const service = container.get<CriteriaValidationService>(
    "CriteriaValidationService",
  );
  const result = await service.execute(event);

  if (!result.result || !result.data) {
    throw new Error(result.error || "Criteria validation execution failed");
  }

  return result.data;
}
