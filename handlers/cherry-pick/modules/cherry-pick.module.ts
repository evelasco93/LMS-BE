import "reflect-metadata";
import { Container } from "inversify";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { Logger } from "@shared/services/logger.util";
import { LambdaInvokeUtil } from "@shared/services/lambda-invoke.util";
import { AuditWriterService } from "@shared/services";
import { CherryPickConstants } from "../constants/cherry-pick.constants";
import { CherryPickService } from "../services/cherry-pick.service";
import { CherryPickController } from "../controllers/cherry-pick.controller";
import { MetricsService } from "../../leads/services/metrics.service";
import { MetricsDlqClient } from "../../leads/services/metrics-dlq.client";
import { LeadsConstants } from "../../leads/constants/leads.constants";

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
// `MetricsService` reuses `LeadsConstants` to read the metrics-table env vars
// without forcing the cherry-pick handler to maintain a parallel constants
// class. `LeadsConstants` asserts METRICS_TABLE_NAME on construction.
container
  .bind<LeadsConstants>("LeadsConstants")
  .to(LeadsConstants)
  .inSingletonScope();
container
  .bind<MetricsService>("MetricsService")
  .to(MetricsService)
  .inSingletonScope();
// Cherry-pick metrics emit failures are forwarded to the shared metrics DLQ
// (same queue as the leads-lambda outcome emit) for retry by the existing
// `metrics-dlq-retry` consumer. Requires `METRICS_DLQ_URL` env + sqs:SendMessage
// on the cherry-pick lambda role.
container
  .bind<MetricsDlqClient>("MetricsDlqClient")
  .to(MetricsDlqClient)
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
