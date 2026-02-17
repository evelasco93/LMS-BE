import "reflect-metadata";
import { Container } from "inversify";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { Logger } from "@shared/services/logger.util";
import { ClientConstants } from "../constants/client.constants";
import { ClientService } from "../services/client.service";
import { ClientController } from "../controllers/client.controller";

const container = new Container();

// Bind utilities
container
  .bind<DynamoDBUtil>("DynamoDBUtil")
  .to(DynamoDBUtil)
  .inSingletonScope();
container.bind<Logger>("Logger").toConstantValue(Logger.getInstance());

// Bind constants
container
  .bind<ClientConstants>("ClientConstants")
  .to(ClientConstants)
  .inSingletonScope();

// Bind services
container.bind<ClientService>("ClientService").to(ClientService);

// Bind controllers with class identifiers so ts-lambda-api can resolve them
container.bind<ClientController>(ClientController).toSelf();

export { container };
