import "reflect-metadata";
import { container } from "./modules/trusted-form.module";
import { TrustedFormService } from "./services/trusted-form.service";
import { TrustedFormEvent } from "./types/trusted-form-event.types";

export async function handler(event: TrustedFormEvent) {
  const service = container.get<TrustedFormService>("TrustedFormService");
  const result = await service.execute(event);

  if (!result.result) {
    throw new Error(result.error || "TrustedForm execution failed");
  }

  return result.data;
}
