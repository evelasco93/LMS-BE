import "reflect-metadata";
import { AppConfig, ApiLambdaApp } from "ts-lambda-api";
import type { Container as InversifyContainer } from "@inversifyjs/container";
import { container } from "./modules/orchestrator.module";

export async function createApp() {
  const appConfig = new AppConfig();
  appConfig.name = "QA Orchestrator Handler";
  appConfig.version = "v2";
  appConfig.base = "/v2";

  const app = new ApiLambdaApp(
    undefined,
    appConfig,
    false,
    container as unknown as InversifyContainer,
  );

  return app;
}
