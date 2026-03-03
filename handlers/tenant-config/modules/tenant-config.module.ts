import "reflect-metadata";
import { Container } from "inversify";
import { Logger } from "@shared/services/logger.util";
import { SecretsManagerUtil } from "@shared/services/secrets-manager.util";
import { TenantConfigConstants } from "../constants/tenant-config.constants";
import { TenantConfigService } from "../services/tenant-config.service";
import { TenantConfigController } from "../controllers/tenant-config.controller";

const container = new Container();

container.bind<Logger>("Logger").toConstantValue(Logger.getInstance());
container
  .bind<SecretsManagerUtil>("SecretsManagerUtil")
  .to(SecretsManagerUtil)
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
