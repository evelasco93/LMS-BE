import { IApiStackConfig } from '../types/api.types';
import { nameBuilder, baseConfig } from '../../../config/base.config';

export const apiConfig: IApiStackConfig = {
  internalApi: {
    name: nameBuilder.api('internal'),
    description: 'Internal APIs for Clients and Affiliates Management',
    stageName: baseConfig.environment,
  },
};
