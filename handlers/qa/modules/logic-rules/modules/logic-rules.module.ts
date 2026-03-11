import "reflect-metadata";
import { Container } from "inversify";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { Logger } from "@shared/services/logger.util";
import { LogicRulesConstants } from "../constants/logic-rules.constants";
import { LogicRulesService } from "../services/logic-rules.service";

const container = new Container();

container
  .bind<DynamoDBUtil>("DynamoDBUtil")
  .to(DynamoDBUtil)
  .inSingletonScope();
container.bind<Logger>("Logger").toConstantValue(Logger.getInstance());
container
  .bind<LogicRulesConstants>("LogicRulesConstants")
  .to(LogicRulesConstants)
  .inSingletonScope();
container.bind<LogicRulesService>("LogicRulesService").to(LogicRulesService);

export { container };
