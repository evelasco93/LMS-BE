import "reflect-metadata";
import { Container } from "inversify";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { Logger } from "@shared/services/logger.util";
import { DispositionController } from "../controllers/disposition.controller";
import { PublicDispositionController } from "../controllers/public-disposition.controller";
import { DispositionConstants } from "../constants/disposition.constants";
import { DispositionService } from "../services/disposition.service";

const container = new Container();

container
  .bind<DynamoDBUtil>("DynamoDBUtil")
  .to(DynamoDBUtil)
  .inSingletonScope();
container.bind<Logger>("Logger").toConstantValue(Logger.getInstance());
container
  .bind<DispositionConstants>("DispositionConstants")
  .to(DispositionConstants)
  .inSingletonScope();
container.bind<DispositionService>("DispositionService").to(DispositionService);
container.bind<DispositionController>(DispositionController).toSelf();
container
  .bind<PublicDispositionController>(PublicDispositionController)
  .toSelf();

export { container };
