import "reflect-metadata";
import { AppConfig, ApiLambdaApp } from "ts-lambda-api";
import type { Container as InversifyContainer } from "@inversifyjs/container";
import { container } from "./modules/client.module";

export async function createApp() {
  const appConfig = new AppConfig();
  appConfig.name = "Client Management Handler";
  appConfig.version = "v2";
  appConfig.base = "/v2";

  // Controllers bound in the exported container; bypass filesystem scanning
  const app = new ApiLambdaApp(
    undefined,
    appConfig,
    false,
    container as unknown as InversifyContainer,
  );

  return app;
}
