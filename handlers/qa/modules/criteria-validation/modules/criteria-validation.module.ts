import "reflect-metadata";
import { Container } from "inversify";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { Logger } from "@shared/services/logger.util";
import { CriteriaValidationConstants } from "../constants/criteria-validation.constants";
import { CriteriaValidationService } from "../services/criteria-validation.service";

const container = new Container();

container
  .bind<DynamoDBUtil>("DynamoDBUtil")
  .to(DynamoDBUtil)
  .inSingletonScope();
container.bind<Logger>("Logger").toConstantValue(Logger.getInstance());
container
  .bind<CriteriaValidationConstants>("CriteriaValidationConstants")
  .to(CriteriaValidationConstants)
  .inSingletonScope();
container
  .bind<CriteriaValidationService>("CriteriaValidationService")
  .to(CriteriaValidationService);

export { container };
