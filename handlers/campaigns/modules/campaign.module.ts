import "reflect-metadata";
import { Container } from "inversify";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { Logger } from "@shared/services/logger.util";
import { AuditWriterService } from "@shared/services";
import { CampaignConstants } from "../constants/campaign.constants";
import { CampaignService } from "../services/campaign.service";
import { CampaignController } from "../controllers/campaign.controller";

const container = new Container();

container
  .bind<DynamoDBUtil>("DynamoDBUtil")
  .to(DynamoDBUtil)
  .inSingletonScope();
container.bind<Logger>("Logger").toConstantValue(Logger.getInstance());

container
  .bind<CampaignConstants>("CampaignConstants")
  .to(CampaignConstants)
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
container.bind<CampaignService>("CampaignService").to(CampaignService);

// Bind controllers with class identifiers so ts-lambda-api can resolve them
container.bind<CampaignController>(CampaignController).toSelf();

export { container };
