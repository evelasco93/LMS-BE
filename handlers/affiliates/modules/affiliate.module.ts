import "reflect-metadata";
import { Container } from "inversify";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { Logger } from "@shared/services/logger.util";
import { AuditWriterService } from "@shared/services";
import { AffiliateConstants } from "../constants/affiliate.constants";
import { AffiliateService } from "../services/affiliate.service";
import { AffiliateController } from "../controllers/affiliate.controller";

const container = new Container();

// Bind utilities
container
  .bind<DynamoDBUtil>("DynamoDBUtil")
  .to(DynamoDBUtil)
  .inSingletonScope();
container.bind<Logger>("Logger").toConstantValue(Logger.getInstance());

// Bind constants
container
  .bind<AffiliateConstants>("AffiliateConstants")
  .to(AffiliateConstants)
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
container.bind<AffiliateService>("AffiliateService").to(AffiliateService);

// Bind controllers with class identifiers so ts-lambda-api can resolve them
container.bind<AffiliateController>(AffiliateController).toSelf();

export { container };
