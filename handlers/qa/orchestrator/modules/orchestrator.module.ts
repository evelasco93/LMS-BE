import "reflect-metadata";
import { Container } from "inversify";
import { Logger } from "@shared/services/logger.util";
import { LambdaInvokeUtil } from "@shared/services/lambda-invoke.util";
import { OrchestratorConstants } from "../constants/orchestrator.constants";
import { OrchestratorService } from "../services/orchestrator.service";

const container = new Container();

container.bind<Logger>("Logger").toConstantValue(Logger.getInstance());
container
  .bind<LambdaInvokeUtil>("LambdaInvokeUtil")
  .to(LambdaInvokeUtil)
  .inSingletonScope();
container
  .bind<OrchestratorConstants>("OrchestratorConstants")
  .to(OrchestratorConstants)
  .inSingletonScope();
container
  .bind<OrchestratorService>("OrchestratorService")
  .to(OrchestratorService);

export { container };
