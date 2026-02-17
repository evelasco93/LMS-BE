import "reflect-metadata";
import { AppConfig, ApiLambdaApp } from "ts-lambda-api";
import type { Container as InversifyContainer } from "@inversifyjs/container";
import { container } from "./modules/affiliate.module";

export async function createApp() {
  const appConfig = new AppConfig();
  appConfig.name = "Affiliate Management Handler";
  appConfig.version = "v2";
  appConfig.base = "/v2";

  // Controllers are already bound in the exported container; skip filesystem scanning
  const app = new ApiLambdaApp(
    undefined,
    appConfig,
    false,
    container as unknown as InversifyContainer,
  );

  return app;
}
