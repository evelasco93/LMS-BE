import { IServicesStackConfig } from '../types/services.types';
import { nameBuilder, arnBuilder } from '../../../config/base.config';
import * as path from 'path';

export const servicesConfig: IServicesStackConfig = {
  clients: {
    lambda: {
      functionName: nameBuilder.lambda('clients'),
      entry: path.join(__dirname, '../../../../handlers/clients/main.ts'),
      handler: 'handler',
      memorySize: 512,
      timeout: 30,
      environment: {
        CLIENTS_TABLE_NAME: nameBuilder.table('clients'),
        NODE_ENV: 'production',
      },
      roleName: nameBuilder.role('clients-lambda'),
    },
    tableName: nameBuilder.table('clients'),
    tableArn: arnBuilder.dynamoTable(nameBuilder.table('clients')),
  },
  affiliates: {
    lambda: {
      functionName: nameBuilder.lambda('affiliates'),
      entry: path.join(__dirname, '../../../../handlers/affiliates/main.ts'),
      handler: 'handler',
      memorySize: 512,
      timeout: 30,
      environment: {
        AFFILIATES_TABLE_NAME: nameBuilder.table('affiliates'),
        NODE_ENV: 'production',
      },
      roleName: nameBuilder.role('affiliates-lambda'),
    },
    tableName: nameBuilder.table('affiliates'),
    tableArn: arnBuilder.dynamoTable(nameBuilder.table('affiliates')),
  },
};
