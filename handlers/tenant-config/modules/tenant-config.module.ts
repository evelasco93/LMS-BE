import "reflect-metadata";
import { Container } from "inversify";
import { DynamoDBUtil } from "@shared/services/dynamodb.util";
import { Logger } from "@shared/services/logger.util";
import { TenantConfigConstants } from "../constants/tenant-config.constants";
import { TenantConfigService } from "../services/tenant-config.service";
import { TenantConfigController } from "../controllers/tenant-config.controller";

const container = new Container();

container.bind<Logger>("Logger").toConstantValue(Logger.getInstance());
container
  .bind<DynamoDBUtil>("DynamoDBUtil")
  .to(DynamoDBUtil)
  .inSingletonScope();
container
  .bind<TenantConfigConstants>("TenantConfigConstants")
  .to(TenantConfigConstants)
  .inSingletonScope();
container
  .bind<TenantConfigService>("TenantConfigService")
  .to(TenantConfigService);
container.bind<TenantConfigController>(TenantConfigController).toSelf();

export { container };
