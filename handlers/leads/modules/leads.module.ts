import "reflect-metadata";
import { Container } from "inversify";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { Logger } from "@shared/services/logger.util";
import { LambdaInvokeUtil } from "@shared/services/lambda-invoke.util";
import { AuditWriterService } from "@shared/services";
import { LeadsConstants } from "../constants/leads.constants";
import { LeadsService } from "../services/leads.service";
import { LeadsController } from "../controllers/leads.controller";

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
  .bind<LeadsConstants>("LeadsConstants")
  .to(LeadsConstants)
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
container.bind<LeadsService>("LeadsService").to(LeadsService);
container.bind<LeadsController>(LeadsController).toSelf();

export { container };
