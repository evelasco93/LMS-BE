import 'reflect-metadata';
import { AppConfig, ApiLambdaApp } from 'ts-lambda-api';
import './modules/affiliate.module';
import * as path from 'path';

export async function createApp() {
  const appConfig = new AppConfig();
  appConfig.name = 'Affiliate Management Handler';
  appConfig.version = 'v2';
  appConfig.base = '/v2';
  
  const app = new ApiLambdaApp([path.join(__dirname, 'controllers')], appConfig);

  return app;
}
