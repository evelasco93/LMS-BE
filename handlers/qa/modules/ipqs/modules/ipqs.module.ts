import "reflect-metadata";
import { Container } from "inversify";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { Logger } from "@shared/services/logger.util";
import { IpqsConstants } from "../constants/ipqs.constants";
import { IpqsService } from "../services/ipqs.service";

const container = new Container();

container
  .bind<DynamoDBUtil>("DynamoDBUtil")
  .to(DynamoDBUtil)
  .inSingletonScope();
container.bind<Logger>("Logger").toConstantValue(Logger.getInstance());
container
  .bind<IpqsConstants>("IpqsConstants")
  .to(IpqsConstants)
  .inSingletonScope();
container.bind<IpqsService>("IpqsService").to(IpqsService);

export { container };
