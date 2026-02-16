import { IIamStackConfig } from '../types/iam.types';
import { nameBuilder } from '../../../config/base.config';

export const iamConfig: IIamStackConfig = {
  lambdaRoles: {
    clients: {
      name: nameBuilder.role('clients-lambda'),
      description: 'Execution role for Clients Lambda',
      servicePrincipal: 'lambda.amazonaws.com',
      managedPolicies: ['service-role/AWSLambdaBasicExecutionRole'],
      inlinePolicies: [],
    },
    affiliates: {
      name: nameBuilder.role('affiliates-lambda'),
      description: 'Execution role for Affiliates Lambda',
      servicePrincipal: 'lambda.amazonaws.com',
      managedPolicies: ['service-role/AWSLambdaBasicExecutionRole'],
      inlinePolicies: [],
    },
  },
};
