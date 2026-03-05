import "reflect-metadata";
import { Container } from "inversify";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { Logger } from "@shared/services/logger.util";
import { TrustedFormConstants } from "../constants/trusted-form.constants";
import { TrustedFormService } from "../services/trusted-form.service";

const container = new Container();

container
  .bind<DynamoDBUtil>("DynamoDBUtil")
  .to(DynamoDBUtil)
  .inSingletonScope();
container.bind<Logger>("Logger").toConstantValue(Logger.getInstance());
container
  .bind<TrustedFormConstants>("TrustedFormConstants")
  .to(TrustedFormConstants)
  .inSingletonScope();
container
  .bind<TrustedFormService>("TrustedFormService")
  .to(TrustedFormService);

export { container };
