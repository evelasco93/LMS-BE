import "reflect-metadata";
import { Container } from "inversify";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { Logger } from "@shared/services/logger.util";
import { DuplicateCheckConstants } from "../constants/duplicate-check.constants";
import { DuplicateCheckService } from "../services/duplicate-check.service";

const container = new Container();

container
  .bind<DynamoDBUtil>("DynamoDBUtil")
  .to(DynamoDBUtil)
  .inSingletonScope();
container.bind<Logger>("Logger").toConstantValue(Logger.getInstance());
container
  .bind<DuplicateCheckConstants>("DuplicateCheckConstants")
  .to(DuplicateCheckConstants)
  .inSingletonScope();
container
  .bind<DuplicateCheckService>("DuplicateCheckService")
  .to(DuplicateCheckService);

export { container };
