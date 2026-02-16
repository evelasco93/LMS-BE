export interface StackConfig {
  stackName: string;
  description: string;
  tags?: Record<string, string>;
}

/**
 * Data Stack Types
 */
export interface DynamoDBTableConfig {
  tableName: string;
  partitionKey: {
    name: string;
    type: 'S' | 'N' | 'B';
  };
  sortKey?: {
    name: string;
    type: 'S' | 'N' | 'B';
  };
  gsi?: GlobalSecondaryIndexConfig[];
  streamEnabled?: boolean;
  pointInTimeRecovery?: boolean;
  deletionProtection?: boolean;
}

export interface GlobalSecondaryIndexConfig {
  indexName: string;
  partitionKey: {
    name: string;
    type: 'S' | 'N' | 'B';
  };
  sortKey?: {
    name: string;
    type: 'S' | 'N' | 'B';
  };
  projectionType?: 'ALL' | 'KEYS_ONLY' | 'INCLUDE';
  nonKeyAttributes?: string[];
}

export interface DataStackConfig extends StackConfig {
  tables: {
    clients: DynamoDBTableConfig;
    affiliates: DynamoDBTableConfig;
    campaigns?: DynamoDBTableConfig;
    leads?: DynamoDBTableConfig;
  };
}

/**
 * IAM Stack Types
 */
export interface IAMRoleConfig {
  roleName: string;
  description: string;
  managedPolicies?: string[];
  inlinePolicies?: Record<string, any>;
}

export interface IAMStackConfig extends StackConfig {
  roles: {
    lambdaExecution: IAMRoleConfig;
  };
}

/**
 * Services Stack Types
 */
export interface LambdaFunctionConfig {
  functionName: string;
  handler: string;
  runtime: string;
  timeout: number;
  memorySize: number;
  environment?: Record<string, string>;
  layers?: string[];
  bundling?: {
    minify?: boolean;
    sourceMap?: boolean;
    target?: string;
    externalModules?: string[];
  };
}

export interface ServicesStackConfig extends StackConfig {
  functions: {
    clients: {
      create: LambdaFunctionConfig;
      get: LambdaFunctionConfig;
      list: LambdaFunctionConfig;
      update: LambdaFunctionConfig;
      delete: LambdaFunctionConfig;
    };
    affiliates: {
      create: LambdaFunctionConfig;
      get: LambdaFunctionConfig;
      list: LambdaFunctionConfig;
      update: LambdaFunctionConfig;
      delete: LambdaFunctionConfig;
    };
  };
}

/**
 * API Stack Types
 */
export interface ApiEndpointConfig {
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  functionName: string;
  authorization?: boolean;
  cors?: boolean;
}

export interface ApiStackConfig extends StackConfig {
  apiName: string;
  endpoints: {
    clients: ApiEndpointConfig[];
    affiliates: ApiEndpointConfig[];
  };
}
