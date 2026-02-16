import { IBaseStackProps } from '../../../types/base.types';
import { IFunction } from 'aws-cdk-lib/aws-lambda';

/**
 * Internal API Configuration
 */
export interface IInternalApiConfig {
  /** API name */
  name: string;
  
  /** API description */
  description: string;
  
  /** Stage name */
  stageName: string;
}

/**
 * API Stack Configuration
 */
export interface IApiStackConfig {
  internalApi: IInternalApiConfig;
}

/**
 * API Stack Props
 */
export interface IApiStackProps extends IBaseStackProps {
  apiConfig: IApiStackConfig;
  clientsLambda: IFunction;
  affiliatesLambda: IFunction;
}
