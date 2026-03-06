import "reflect-metadata";
import { Container } from "inversify";
import { Logger } from "@shared/services/logger.util";
import { LambdaInvokeUtil } from "@shared/services/lambda-invoke.util";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { OrchestratorConstants } from "../constants/orchestrator.constants";
import { OrchestratorService } from "../services/orchestrator.service";
import { OrchestratorController } from "../controllers/orchestrator.controller";

const container = new Container();

container.bind<Logger>("Logger").toConstantValue(Logger.getInstance());
container
  .bind<LambdaInvokeUtil>("LambdaInvokeUtil")
  .to(LambdaInvokeUtil)
  .inSingletonScope();
container
  .bind<DynamoDBUtil>("DynamoDBUtil")
  .to(DynamoDBUtil)
  .inSingletonScope();
container
  .bind<OrchestratorConstants>("OrchestratorConstants")
  .to(OrchestratorConstants)
  .inSingletonScope();
container
  .bind<OrchestratorService>("OrchestratorService")
  .to(OrchestratorService);
container.bind<OrchestratorController>(OrchestratorController).toSelf();

export { container };
