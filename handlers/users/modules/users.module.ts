import "reflect-metadata";
import { Container } from "inversify";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { Logger } from "@shared/services/logger.util";
import { AuditWriterService } from "@shared/services";
import { UsersConstants } from "../constants/users.constants";
import { UsersService } from "../services/users.service";
import { UsersController } from "../controllers/users.controller";

const container = new Container();

// Bind utilities
container
  .bind<DynamoDBUtil>("DynamoDBUtil")
  .to(DynamoDBUtil)
  .inSingletonScope();
container.bind<Logger>("Logger").toConstantValue(Logger.getInstance());

// Bind constants
container
  .bind<UsersConstants>("UsersConstants")
  .to(UsersConstants)
  .inSingletonScope();

// Bind services
container
  .bind<AuditWriterService>("AuditWriterService")
  .toDynamicValue(
    () =>
      new AuditWriterService(
        container.get<DynamoDBUtil>("DynamoDBUtil"),
        process.env.AUDIT_LOGS_TABLE_NAME!,
      ),
  );
container.bind<UsersService>("UsersService").to(UsersService);

// Bind controllers so ts-lambda-api can resolve them
container.bind<UsersController>(UsersController).toSelf();

export { container };
