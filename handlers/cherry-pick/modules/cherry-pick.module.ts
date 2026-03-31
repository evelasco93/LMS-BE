import "reflect-metadata";
import { Container } from "inversify";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { Logger } from "@shared/services/logger.util";
import { LambdaInvokeUtil } from "@shared/services/lambda-invoke.util";
import { AuditWriterService } from "@shared/services";
import { CherryPickConstants } from "../constants/cherry-pick.constants";
import { CherryPickService } from "../services/cherry-pick.service";
import { CherryPickController } from "../controllers/cherry-pick.controller";

const container = new Container();

container
  .bind<DynamoDBUtil>("DynamoDBUtil")
  .to(DynamoDBUtil)
  .inSingletonScope();
container.bind<Logger>("Logger").toConstantValue(Logger.getInstance());
container
  .bind<LambdaInvokeUtil>("LambdaInvokeUtil")
  .to(LambdaInvokeUtil)
  .inSingletonScope();
container
  .bind<CherryPickConstants>("CherryPickConstants")
  .to(CherryPickConstants)
  .inSingletonScope();
container
  .bind<AuditWriterService>("AuditWriterService")
  .toDynamicValue(
    () =>
      new AuditWriterService(
        container.get<DynamoDBUtil>("DynamoDBUtil"),
        process.env.AUDIT_LOGS_TABLE_NAME!,
      ),
  );
container
  .bind<CherryPickService>("CherryPickService")
  .to(CherryPickService)
  .inSingletonScope();
container.bind<CherryPickController>(CherryPickController).toSelf();

export { container };
