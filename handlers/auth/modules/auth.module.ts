import "reflect-metadata";
import { Container } from "inversify";
import { Logger } from "@shared/services/logger.util";
import { AuthConstants } from "../constants/auth.constants";
import { AuthService } from "../services/auth.service";
import { AuthController } from "../controllers/auth.controller";

const container = new Container();

// Bind utilities
container.bind<Logger>("Logger").toConstantValue(Logger.getInstance());

// Bind constants
container
  .bind<AuthConstants>("AuthConstants")
  .to(AuthConstants)
  .inSingletonScope();

// Bind services
container.bind<AuthService>("AuthService").to(AuthService);

// Bind controllers with class identifiers so ts-lambda-api can resolve them
container.bind<AuthController>(AuthController).toSelf();

export { container };
