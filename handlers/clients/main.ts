import 'reflect-metadata';
import { Context, APIGatewayProxyResult } from 'aws-lambda';
import { createApp } from './app';

export async function handler(event: any, context: Context): Promise<APIGatewayProxyResult> {
  const app = await createApp();
  
  const response = await app.run(event, context);
  
  return {
    ...response,
    headers: {
      ...(response?.headers || {}),
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    },
  } as APIGatewayProxyResult;
}
