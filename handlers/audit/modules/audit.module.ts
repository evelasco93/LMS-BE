import "reflect-metadata";
import { Container } from "inversify";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { S3Util } from "@shared/clients/s3.util";
import { Logger } from "@shared/services/logger.util";
import { AuditConstants } from "../constants/audit.constants";
import { AuditService } from "../services/audit.service";
import { AuditController } from "../controllers/audit.controller";

const container = new Container();

// Bind utilities
container
  .bind<DynamoDBUtil>("DynamoDBUtil")
  .to(DynamoDBUtil)
  .inSingletonScope();
container.bind<Logger>("Logger").toConstantValue(Logger.getInstance());
container.bind<S3Util>("S3Util").toConstantValue(new S3Util());

// Bind constants
container
  .bind<AuditConstants>("AuditConstants")
  .to(AuditConstants)
  .inSingletonScope();

// Bind services
container.bind<AuditService>("AuditService").to(AuditService);

// Bind controllers with class identifiers so ts-lambda-api can resolve them
container.bind<AuditController>(AuditController).toSelf();

export { container };
