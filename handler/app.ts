import 'reflect-metadata';
import { AppConfig, ApiLambdaApp } from 'ts-lambda-api';
import { LeadModule } from './modules/lead.module';
import * as path from 'path';

export async function createApp() {
  const appConfig = new AppConfig();
  appConfig.name = 'SmashOrbit Lead Intake Handler';
  appConfig.version = '1.0.0';
  
  const container = await LeadModule.getInstance();
  // Use __dirname as controllers path - container will provide the actual controllers
  const app = new ApiLambdaApp(__dirname, appConfig, container);

  return app;
}
