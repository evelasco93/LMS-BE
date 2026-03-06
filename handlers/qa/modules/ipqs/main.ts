import "reflect-metadata";
import { container } from "./modules/ipqs.module";
import { IpqsService } from "./services/ipqs.service";
import { IpqsEvent } from "./types/ipqs-event.types";

export async function handler(event: IpqsEvent) {
  const service = container.get<IpqsService>("IpqsService");
  const result = await service.execute(event);

  if (!result.result) {
    throw new Error(result.error || "IPQS execution failed");
  }

  return result.data;
}
