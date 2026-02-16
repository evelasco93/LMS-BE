# LMS v2 - Lead Management System (Lead Intake Prototype)

Production-ready CDK infrastructure with multi-tenant support, comprehensive test-driven development, and API consolidation following ARCHITECTURE_V2.md specifications.

## 📁 Project Structure

```
prototype_lead_intake/
├── cdk/                              # AWS CDK Infrastructure
│   ├── bin/
│   │   └── app.ts                   # CDK app entry point
│   ├── stacks/
│   │   ├── data/                    # Data layer (DynamoDB tables)
│   │   │   ├── config/
│   │   │   │   └── data.config.ts
│   │   │   └── data.stack.ts
│   │   ├── iam/                     # IAM roles and policies
│   │   │   ├── config/
│   │   │   │   └── iam.config.ts
│   │   │   └── iam.stack.ts
│   │   ├── services/                # Lambda function definitions
│   │   │   ├── config/
│   │   │   │   └── services.config.ts
│   │   │   ├── clients-service.stack.ts
│   │   │   ├── affiliates-service.stack.ts
│   │   │   └── services.stack.ts
│   │   └── api/                     # Unified REST API Gateway
│   │       ├── config/
│   │       │   └── api.config.ts
│   │       ├── types/
│   │       │   └── api.types.ts
│   │       ├── internal-api.stack.ts  # Unified internal API
│   │       └── api.stack.ts
│   ├── config/
│   │   └── base.config.ts           # Multi-tenant configuration
│   ├── shared/
│   │   ├── resource-names.ts        # Tenant-aware naming builder
│   │   └── arn-builder.ts           # ARN construction
│   ├── types/
│   │   └── index.ts
│   └── cdk.json                     # CDK configuration
├── handlers/                         # Lambda function handlers
│   ├── clients/
│   │   ├── src/
│   │   │   ├── app.ts               # Lambda handler entry
│   │   │   ├── main.ts              # Handler setup
│   │   │   ├── controllers/         # Request handlers
│   │   │   ├── services/            # Business logic
│   │   │   ├── interfaces/          # Domain types
│   │   │   ├── enums/               # Status enums
│   │   │   ├── modules/             # DI modules
│   │   │   ├── constants/           # Constants
│   │   │   └── types/               # TypeScript types
│   │   ├── tests/
│   │   │   ├── setup.ts             # Test setup with mocks
│   │   │   ├── fixtures/            # Mock data
│   │   │   └── unit/                # Unit tests
│   │   ├── vitest.config.ts         # Vitest configuration
│   │   ├── tsconfig.json
│   │   └── package.json
│   └── affiliates/                  # Mirror structure for affiliates
│       └── ...
├── shared/                           # Shared code
│   ├── types/                       # Shared type definitions
│   ├── interfaces/                  # Shared interfaces
│   ├── enums/                       # Shared enums
│   ├── services/                    # Shared services
│   ├── modules/                     # Shared modules
│   └── constants/                   # Shared constants
├── scripts/
│   ├── env-dev.sh                   # Development environment setup
│   ├── env-qa.sh                    # QA environment setup
│   ├── env-prod.sh                  # Production environment setup
│   └── deploy.sh                    # Unified deployment script
├── dist/                            # Compiled output
├── cdk.json                         # CDK configuration
├── vitest.config.ts                 # Root vitest configuration
├── tsconfig.json                    # Root TypeScript configuration
├── package.json                     # Root package.json
└── README.md                        # This file
```

## 🛠️ Key Technologies

- **AWS CDK 2.160.0** - Infrastructure as Code
- **TypeScript 5.6** - Type-safe development
- **Node.js 20** - Lambda runtime
- **Inversify 6.0.2** - Dependency Injection
- **Vitest 2.1** - Modern testing framework with v8 coverage
- **AWS SDK v3** - Latest AWS SDK with modular architecture
- **ts-lambda-api 2.5.3** - Lambda handler decorators

## 🚀 Quick Start

### Installation

```bash
npm install
```

### Build

```bash
npm run build              # Build TypeScript (CDK + handlers)
npm run build:handlers     # Build only Lambda handlers
npm run build:clients      # Build only clients handler
npm run build:affiliates   # Build only affiliates handler
```

### Testing

```bash
npm test                   # Run all tests with coverage
npm run test:unit          # Run tests without coverage
npm run test:clients       # Run clients handler tests
npm run test:affiliates    # Run affiliates handler tests
npm run test:clients:unit  # Clients tests without coverage
npm run test:affiliates:unit  # Affiliates tests without coverage
```

### Deployment

```bash
# Load development environment
source scripts/env-dev.sh   # Sets TENANT=edgar, ENVIRONMENT=dev, SYSTEM=lms

# Synthesize CloudFormation templates
npx cdk synth

# Deploy all stacks
scripts/deploy.sh

# View deployment status
aws cloudformation list-stacks --region us-east-1
```

### Development

```bash
# Watch TypeScript compilation
npx tsc --watch

# Synthesize templates without deployment
npx cdk synth

# Show deployment diff
npx cdk diff
```

## ✅ Current Implementation Status

### Completed Components

1. **✅ Data Stack** - DynamoDB tables with GSI
   - Clients table: `{TENANT}-lms-clients-{ENVIRONMENT}` (e.g., edgar-lms-clients-dev)
   - Affiliates table: `{TENANT}-lms-affiliates-{ENVIRONMENT}`
   - Both with email GSI for email-based lookups

2. **✅ IAM Stack** - Roles and Policies
   - Clients Lambda execution role with DynamoDB permissions
   - Affiliates Lambda execution role with DynamoDB permissions
   - Scoped permissions per table

3. **✅ Services Stack** - Lambda Functions
   - Clients function: `{TENANT}-lms-clients-function-{ENVIRONMENT}`
   - Affiliates function: `{TENANT}-lms-affiliates-function-{ENVIRONMENT}`
   - Bundled with esbuild, includes all dependencies

4. **✅ Unified API Stack** - Single REST API Gateway
   - Internal API: `{TENANT}-lms-internal-api-{ENVIRONMENT}`
   - `/v2/clients` route → Clients Lambda integration
   - `/v2/affiliates` route → Affiliates Lambda integration
   - CORS enabled for all origins
   - CloudWatch metrics enabled
   - Stage: `{ENVIRONMENT}` (dev/qa/prod)

5. **✅ Dependency Injection** - Inversify Container
   - ClientService with CRUD operations
   - AffiliateService with CRUD operations
   - Proper DI setup in handler tests
   - Mock factories for testing

6. **✅ Unit Tests** - Vitest with v8 Coverage
   - Clients handler: 4/4 tests passing
   - Affiliates handler: 6/6 tests passing
   - Per-handler vitest configuration
   - Test fixtures with mock data
   - Mock DI container in setup.ts

7. **✅ Multi-Tenant Support**
   - Resource naming includes tenant: `{TENANT}-{SYSTEM}-{RESOURCE}-{ENVIRONMENT}`
   - Environment variable validation (TENANT required)
   - Deployment scripts enforce TENANT specification
   - Ready for multiple tenant deployments

8. **✅ Environment Management**
   - `scripts/env-dev.sh` - Development variables
   - `scripts/env-qa.sh` - QA variables
   - `scripts/env-prod.sh` - Production variables
   - Unified deployment script with validation

## 🏗️ Architecture Highlights

### Multi-Tenant Resource Naming

All AWS resources include the tenant in their name:

```typescript
// Resource Name Pattern: {TENANT}-{SYSTEM}-{RESOURCE}-{ENVIRONMENT}
edgar-lms-clients-dev           // DynamoDB table
edgar-lms-internal-api-dev      // REST API
edgar-lms-clients-lambda-dev    // Lambda function
edgar-lms-clients-role-dev      // IAM role
```

### Unified REST API

Single REST API with route-based service separation:

```
Internal API (edgar-lms-internal-api-dev)
├── /v2/clients
│   ├── POST   - Create client
│   ├── GET    - List clients
│   └── /{id}
│       ├── GET    - Get client by ID
│       ├── PUT    - Update client
│       └── DELETE - Delete client
└── /v2/affiliates
    ├── POST   - Create affiliate
    ├── GET    - List affiliates
    └── /{id}
        ├── GET    - Get affiliate by ID
        ├── PUT    - Update affiliate
        └── DELETE - Delete affiliate
```

### Dependency Injection Pattern

```typescript
// handlers/clients/src/modules/clients.module.ts
container.bind<ClientService>(TYPES.ClientService).to(ClientService);

// handlers/clients/src/main.ts
const service = container.get<ClientService>(TYPES.ClientService);
const response = await service.createClient(request);
```

### Test Setup with Mocks

```typescript
// handlers/clients/tests/setup.ts
const mockService = {
  createClient: vi.fn(),
  getClient: vi.fn(),
};
container.rebind<ClientService>(TYPES.ClientService).toConstantValue(mockService);
```

## 📚 API Endpoints

### Base URL
```
https://{api-id}.execute-api.us-east-1.amazonaws.com/{ENVIRONMENT}
```

### Clients

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v2/clients` | Create new client |
| GET | `/v2/clients/{id}` | Get client by ID |
| GET | `/v2/clients` | List clients with filters |
| PUT | `/v2/clients/{id}` | Update client |
| DELETE | `/v2/clients/{id}` | Delete client |

### Affiliates

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/v2/affiliates` | Create new affiliate |
| GET | `/v2/affiliates/{id}` | Get affiliate by ID |
| GET | `/v2/affiliates` | List affiliates with filters |
| PUT | `/v2/affiliates/{id}` | Update affiliate |
| DELETE | `/v2/affiliates/{id}` | Delete affiliate |

## 🔧 Configuration & Environment Variables

### Required Environment Variables

```bash
# Multi-tenancy
TENANT=edgar                    # Tenant identifier (required)
SYSTEM=lms                      # System identifier
ENVIRONMENT=dev                 # Environment (dev/qa/prod)

# AWS
AWS_REGION=us-east-1
CDK_DEFAULT_REGION=us-east-1
CDK_DEFAULT_ACCOUNT=562362324353
```

### Configuration Files

Each stack has typed configuration:

```typescript
// cdk/config/base.config.ts
export const baseConfig = {
  tenant: process.env.TENANT!,
  system: 'lms',
  environment: process.env.ENVIRONMENT!,
  region: 'us-east-1',
  appPrefix: `${tenant}-${system}-${environment}`,
};

// cdk/stacks/data/config/data.config.ts
export const dataConfig: IDataStackConfig = {
  tables: {
    clients: { ... },
    affiliates: { ... },
  },
};
```

## 📋 CloudFormation Stack Hierarchy

```
edgar-lms-dev-IamStack
├── ClientsLambdaRole
└── AffiliatesLambdaRole

edgar-lms-dev-DataStack
├── Clients Table (DynamoDB)
└── Affiliates Table (DynamoDB)

edgar-lms-dev-ServicesStack
├── ClientsServiceStack (Lambda)
└── AffiliatesServiceStack (Lambda)

edgar-lms-dev-ApiStack
└── InternalApiStack (Unified REST API)
    ├── Clients Integration
    └── Affiliates Integration
```

## 📝 Project Progress

### ✅ Completed (Phase 1-3)

**Phase 1: Foundation & Testing Infrastructure**
- ✅ Vitest per-handler configuration with v8 coverage
- ✅ Test setup files with mock factories
- ✅ Test fixtures with complete mock objects
- ✅ Root-level test scripts delegating to handlers

**Phase 2: Multi-Tenant Infrastructure**
- ✅ Environment variable validation (TENANT required)
- ✅ Multi-tenant resource naming with tenant in all resource names
- ✅ Base configuration with nameBuilder and arnBuilder
- ✅ Deployment scripts with TENANT validation

**Phase 3: API Consolidation**
- ✅ Unified Internal API Stack (`internal-api.stack.ts`)
- ✅ Consolidated routes: `/v2/clients` and `/v2/affiliates`
- ✅ Unified API configuration
- ✅ Updated API type definitions
- ✅ Deleted obsolete individual API stack files

**Phase 4: Complete Infrastructure**
- ✅ Data Stack (DynamoDB tables)
- ✅ IAM Stack (Lambda roles)
- ✅ Services Stack (Lambda functions)
- ✅ API Stack (Unified REST API)
- ✅ CDK synthesis successful

**Phase 5: Testing & Validation**
- ✅ 10/10 unit tests passing (4 clients + 6 affiliates)
- ✅ Full test coverage with v8 provider
- ✅ Mock DI container in test setup
- ✅ Build validation (TypeScript compilation)

### 🔄 In Progress

None currently - all core infrastructure complete.

### ⏳ Pending Work

#### 1. **Deployment & Validation** (🔴 High Priority - Start Here)
- Deploy stacks to AWS account
- Verify CloudFormation stacks created successfully
- Retrieve API endpoint from CloudFormation outputs
- Test API endpoints against deployed Lambda functions
- Verify DynamoDB table creation and accessibility
- Set up CloudWatch monitoring and alarms
- **Estimate**: 2-3 hours
- **Starting point**: 
  ```bash
  source scripts/env-dev.sh
  npx cdk synth
  scripts/deploy.sh
  ```

#### 2. **Integration Testing** (🟠 High Priority - Next)
- Create integration tests for API endpoints
- Test actual Lambda invocations via API Gateway
- Verify DynamoDB interactions end-to-end
- Test error handling and edge cases
- Test request/response validation
- **Estimate**: 4-6 hours
- **Starting point**: Create `tests/integration/` directory with endpoint tests

#### 3. **Local Development Environment** (🟠 High Priority)
- Set up SAM Local for local testing
- Configure DynamoDB Local for local development
- Create docker-compose.yml for full local stack
- Document local setup and debugging
- **Estimate**: 3-4 hours
- **Starting point**: Create `docker-compose.yml`, `samconfig.toml`, and `tests/local/`

#### 4. **Request Validation & Error Handling** (🟡 Medium Priority)
- Add input validation for all endpoints
- Implement consistent error response format
- Add request/response logging
- Handle edge cases and malformed inputs
- **Estimate**: 3-4 hours
- **Starting point**: Create shared validation middleware

#### 5. **CI/CD Pipeline** (🟡 Medium Priority)
- GitHub Actions workflow for automated tests
- Automated deployment on main branch merge
- Pre-deployment validation and security checks
- Code coverage reporting
- **Estimate**: 4-5 hours
- **Starting point**: Create `.github/workflows/test.yml` and `deploy.yml`

#### 6. **Monitoring & Observability** (🟡 Medium Priority)
- CloudWatch log groups and insights
- Lambda error tracking and alerting
- API Gateway performance metrics
- DynamoDB throttling alarms
- Custom business metrics
- **Estimate**: 3-4 hours
- **Starting point**: Add CloudWatch configuration to CDK stacks

#### 7. **API Documentation** (🟡 Medium Priority)
- OpenAPI/Swagger documentation
- Request/response examples
- Authentication and authorization docs
- Error codes and troubleshooting guide
- **Estimate**: 2-3 hours
- **Starting point**: Create `docs/api.md` with examples

#### 8. **Extension to Campaigns & Leads** (🔵 Lower Priority)
- Create Campaigns Lambda handler
- Create Leads Lambda handler
- Add DynamoDB tables for campaigns and leads
- Implement relationships (client → campaign → lead)
- Add API routes for new entities
- **Estimate**: 8-10 hours
- **Starting point**: Mirror clients/affiliates handler structure

## 🚀 Next Steps to Deploy

### Prerequisites
```bash
# Verify AWS credentials
aws sts get-caller-identity

# Verify Node.js version
node --version  # Should be v20+

# Install dependencies
npm install
```

### Deployment Steps
```bash
# 1. Load development environment
source scripts/env-dev.sh
# Expected output:
#   ✓ Development environment variables loaded
#   ENVIRONMENT: dev
#   TENANT: edgar
#   SYSTEM: lms

# 2. Build and validate
npm run build
npm test

# 3. Synthesize CloudFormation templates
npx cdk synth

# 4. Deploy stacks
scripts/deploy.sh
# This will deploy all stacks in order: IAM → Data → Services → API

# 5. Monitor deployment
aws cloudformation describe-stacks \
  --query "Stacks[?contains(StackName, 'edgar-lms-dev')]" \
  --region us-east-1
```

### Post-Deployment Verification
```bash
# Get API endpoint from CloudFormation
API_ID=$(aws apigateway get-rest-apis \
  --query "items[?name=='edgar-lms-internal-api-dev'].id" \
  --output text \
  --region us-east-1)

API_ENDPOINT="https://${API_ID}.execute-api.us-east-1.amazonaws.com/dev"

# Test clients endpoint
curl -X POST "$API_ENDPOINT/v2/clients" \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","name":"Test Client"}'

curl -X GET "$API_ENDPOINT/v2/clients"

# Test affiliates endpoint
curl -X POST "$API_ENDPOINT/v2/affiliates" \
  -H "Content-Type: application/json" \
  -d '{"email":"aff@example.com","name":"Test Affiliate"}'

curl -X GET "$API_ENDPOINT/v2/affiliates"
```

## 📚 Documentation & References

- [ARCHITECTURE_V2.md](./ARCHITECTURE_V2.md) - Complete system architecture
- [API_CONSOLIDATION_SUMMARY.md](./API_CONSOLIDATION_SUMMARY.md) - API consolidation details
- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [AWS CloudFormation User Guide](https://docs.aws.amazon.com/cloudformation/)
- [Inversify Documentation](https://inversify.io/)
- [Vitest Documentation](https://vitest.dev/)
- [AWS SDK for JavaScript v3](https://docs.aws.amazon.com/sdk-for-javascript/v3/)
- [AWS Lambda Developer Guide](https://docs.aws.amazon.com/lambda/)
- [Amazon DynamoDB Developer Guide](https://docs.aws.amazon.com/dynamodb/)
