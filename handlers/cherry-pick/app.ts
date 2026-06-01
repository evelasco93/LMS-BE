import "reflect-metadata";
import { AppConfig, ApiLambdaApp } from "ts-lambda-api";
import { container } from "./modules/cherry-pick.module";

export async function createApp() {
  const appConfig = new AppConfig();
  appConfig.name = "Cherry Pick Handler";
  appConfig.version = "v2";
  appConfig.base = "/v2";

  const app = new ApiLambdaApp(undefined, appConfig, false, container as any);

  return app;
}
