import 'reflect-metadata';
import { ApiRequest } from 'ts-lambda-api';
import { createApp } from './app';
import { Context } from 'aws-lambda';

export async function handler(event: any, context: Context) {
  const app = await createApp();
  console.log('Incoming event:', JSON.stringify(event));
  
  // Parse body if it's a string (from API Gateway)
  if (event.body && typeof event.body === 'string') {
    try {
      event.body = JSON.parse(event.body);
    } catch (e) {
      console.error('Failed to parse body:', e);
    }
  }
  
  const response = await app.run(event, context);
  
  return {
    ...response,
    headers: {
      ...(response?.headers || {}),
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    },
  };
}
