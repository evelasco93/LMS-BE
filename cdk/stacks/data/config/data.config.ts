import { IDataStackConfig } from '../types/data.types';
import { nameBuilder } from '../../../config/base.config';

export const dataConfig: IDataStackConfig = {
  tables: {
    clients: {
      tableName: nameBuilder.table('clients'),
      partitionKey: { name: 'id', type: 'S' },
      gsi: [
        {
          indexName: nameBuilder.index('clients', 'email'),
          partitionKey: { name: 'email', type: 'S' },
          projectionType: 'ALL',
        },
        // NOTE: Can only add one GSI per deployment - uncomment and deploy one at a time
        // {
        //   indexName: nameBuilder.index('clients', 'status'),
        //   partitionKey: { name: 'status', type: 'S' },
        //   sortKey: { name: 'created_at', type: 'S' },
        //   projectionType: 'ALL',
        // },
      ],
      pointInTimeRecovery: true,
      deletionProtection: false,
    },
    affiliates: {
      tableName: nameBuilder.table('affiliates'),
      partitionKey: { name: 'id', type: 'S' },
      gsi: [
        {
          indexName: nameBuilder.index('affiliates', 'email'),
          partitionKey: { name: 'email', type: 'S' },
          projectionType: 'ALL',
        },
        // NOTE: Can only add one GSI per deployment - uncomment and deploy one at a time
        // {
        //   indexName: nameBuilder.index('affiliates', 'status'),
        //   partitionKey: { name: 'status', type: 'S' },
        //   sortKey: { name: 'created_at', type: 'S' },
        //   projectionType: 'ALL',
        // },
      ],
      pointInTimeRecovery: true,
      deletionProtection: false,
    },
  },
};
