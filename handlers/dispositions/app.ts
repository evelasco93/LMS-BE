import "reflect-metadata";
import { AppConfig, ApiLambdaApp } from "ts-lambda-api";
import { Container as InversifyContainer } from "inversify";
import { container } from "./modules/disposition.module";

export async function createApp() {
  const appConfig = new AppConfig();
  appConfig.name = "Disposition Management Handler";
  appConfig.version = "v2";
  appConfig.base = "";

  const app = new ApiLambdaApp(
    undefined,
    appConfig,
    false,
    container as unknown as InversifyContainer,
  );

  return app;
}
