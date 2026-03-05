# LMS v2 - Lead Management System

Production-ready CDK infrastructure with multi-tenant support, Cognito-based authentication, participant audit history, and campaign key rotation following ARCHITECTURE_V2.md specifications.

## 📁 Project Structure

```
LMS-BE/
├── cdk/                              # AWS CDK infrastructure
│   ├── bin/
│   │   └── app.ts                   # CDK app entry point
│   ├── config/
│   │   └── base.config.ts           # Multi-tenant base config
│   ├── shared/
│   │   ├── resource-names.ts        # Tenant-aware resource name builder
│   │   └── arn-builder.ts           # ARN construction helpers
│   ├── stacks/
│   │   ├── api/
│   │   │   ├── api.stack.ts         # Root API stack (assembles sub-stacks)
│   │   │   ├── internal-api.stack.ts  # Cognito-protected REST API (all services)
│   │   │   └── external-leads-api.stack.ts  # Public API key-protected leads intake
│   │   ├── data/                    # DynamoDB tables
│   │   │   ├── clients-data.stack.ts
│   │   │   ├── affiliates-data.stack.ts
│   │   │   ├── campaigns-data.stack.ts
│   │   │   ├── leads-data.stack.ts
│   │   │   └── config/data.config.ts
│   │   ├── iam/                     # Lambda execution roles
│   │   └── services/                # Lambda function definitions
│   │       ├── clients-service.stack.ts
│   │       ├── affiliates-service.stack.ts
│   │       ├── campaigns-service.stack.ts
│   │       ├── leads-service.stack.ts
│   │       ├── tenant-config-service.stack.ts
│   │       ├── qa-duplicate-check-service.stack.ts
│   │       └── qa-orchestrator-service.stack.ts
│   └── types/
├── handlers/                         # Lambda function source code
│   ├── auth/                        # Login + token refresh (Cognito)
│   ├── users/                       # User management (admin-only, Cognito-backed)
│   ├── clients/                     # Client CRUD
│   ├── affiliates/                  # Affiliate CRUD
│   ├── campaigns/                   # Campaign CRUD + participant management
│   ├── leads/                       # Lead intake and management
│   ├── tenant-config/               # Tenant credential store
│   └── qa/
│       ├── modules/duplicate-check/ # QA duplicate detection module
│       └── orchestrator/            # QA pipeline orchestrator
├── shared/                           # Cross-handler utilities
│   ├── clients/                     # AWS SDK client wrappers (DynamoDB, S3)
│   ├── decorators/
│   ├── enums/
│   ├── generators/                  # ID + key generators
│   ├── services/
│   └── utils/
├── api/
│   └── openapi.json                 # OpenAPI 3.0 spec
├── docs/
│   └── frontend-api-guide.md        # Frontend integration guide
├── scripts/
│   ├── env-dev.sh / env-qa.sh       # Environment variable loaders
│   ├── deploy.sh                    # Deployment script
│   ├── run-handler-tests.sh         # Runs tests across all handler packages
│   ├── test-api.sh                  # Manual API smoke tests
│   └── create-cognito-user.sh       # Helper to provision a Cognito user
├── cdk.json
├── tsconfig.json
├── vitest.config.ts
└── package.json
```

## 🛠️ Key Technologies

| Technology    | Version | Role                                           |
| ------------- | ------- | ---------------------------------------------- |
| AWS CDK       | 2.160.0 | Infrastructure as Code                         |
| TypeScript    | 5.6     | Type-safe development                          |
| Node.js       | 20      | Lambda runtime                                 |
| Inversify     | 6.0.2   | Dependency Injection                           |
| ts-lambda-api | 2.5.3   | Lambda handler decorators                      |
| Vitest        | 2.1     | Testing framework with v8 coverage             |
| AWS SDK       | v3      | DynamoDB, S3, Secrets Manager, Lambda, Cognito |

## 🚀 Quick Start

### Installation

```bash
npm install
```

### Environment Setup

```bash
source scripts/env-dev.sh   # Sets TENANT, ENVIRONMENT=dev, SYSTEM=lms
```

### Build

```bash
npm run build              # Compile CDK + Lambda handlers
npm run build:handlers     # Handlers only
npm run build:clients      # clients handler
npm run build:affiliates   # affiliates handler
```

### Testing

```bash
npm test                              # Run all handler test suites
./scripts/run-handler-tests.sh        # Same — discovers handler packages automatically
./scripts/run-handler-tests.sh --pattern campaigns  # Single handler
./scripts/run-handler-tests.sh --cmd "npm run test:unit"  # No coverage
```

### Deployment

```bash
# 1. Load environment
source scripts/env-dev.sh

# 2. Synthesize CloudFormation
npx cdk synth

# 3. Deploy all stacks
./scripts/deploy.sh
```

## 🏗️ Infrastructure

### Multi-Tenant Resource Naming

```
Pattern: {TENANT}-{SYSTEM}-{RESOURCE}-{ENVIRONMENT}

edgar-lms-clients-dev           # DynamoDB table
edgar-lms-internal-api-dev      # REST API Gateway
edgar-lms-campaigns-lambda-dev  # Lambda function
edgar-lms-clients-role-dev      # IAM role
```

### DynamoDB Tables

| Table                    | Partition Key | GSI                 |
| ------------------------ | ------------- | ------------------- |
| `{t}-lms-clients-{e}`    | `id`          | email               |
| `{t}-lms-affiliates-{e}` | `id`          | email               |
| `{t}-lms-campaigns-{e}`  | `id`          | status + created_at |
| `{t}-lms-leads-{e}`      | `id`          | —                   |

All tables have point-in-time recovery enabled.

### API Gateways

**Internal API** — Cognito JWT-protected (`lms/read`, `lms/write` scopes)

All routes are prefixed `/v2`.

**External Leads API** — API key-protected (affiliate lead intake only)

Routes are prefixed `/v2`.

### CloudFormation Stack Hierarchy

```
{tenant}-lms-{env}-IamStack
{tenant}-lms-{env}-DataStack         (clients, affiliates, campaigns, leads tables)
{tenant}-lms-{env}-ServicesStack      (all Lambda functions)
{tenant}-lms-{env}-ApiStack
  ├── InternalApiStack                (Cognito-protected, all internal routes)
  └── ExternalLeadsApiStack           (public leads intake)
```

## 📚 API Reference

### Authentication (Internal API — public)

| Method | Path               | Description                                 |
| ------ | ------------------ | ------------------------------------------- |
| POST   | `/v2/auth/login`   | Exchange email + password for tokens        |
| POST   | `/v2/auth/refresh` | Exchange refresh token for new access token |

### Users (Internal API — `lms/write` or `lms/read` scope)

| Method | Path                      | Description                 |
| ------ | ------------------------- | --------------------------- |
| POST   | `/v2/users`               | Create user (admin only)    |
| GET    | `/v2/users`               | List users                  |
| GET    | `/v2/users/{id}`          | Get user                    |
| PUT    | `/v2/users/{id}`          | Update role                 |
| PUT    | `/v2/users/{id}/password` | Reset password              |
| PUT    | `/v2/users/{id}/enable`   | Re-enable soft-deleted user |
| DELETE | `/v2/users/{id}`          | Soft-delete user            |

### Clients (Internal API)

| Method | Path               | Description   |
| ------ | ------------------ | ------------- |
| POST   | `/v2/clients`      | Create client |
| GET    | `/v2/clients`      | List clients  |
| GET    | `/v2/clients/{id}` | Get client    |
| PUT    | `/v2/clients/{id}` | Update client |
| DELETE | `/v2/clients/{id}` | Delete client |

### Affiliates (Internal API)

| Method | Path                  | Description      |
| ------ | --------------------- | ---------------- |
| POST   | `/v2/affiliates`      | Create affiliate |
| GET    | `/v2/affiliates`      | List affiliates  |
| GET    | `/v2/affiliates/{id}` | Get affiliate    |
| PUT    | `/v2/affiliates/{id}` | Update affiliate |
| DELETE | `/v2/affiliates/{id}` | Delete affiliate |

### Campaigns (Internal API)

| Method | Path                                                     | Description                                           |
| ------ | -------------------------------------------------------- | ----------------------------------------------------- |
| POST   | `/v2/campaigns`                                          | Create campaign                                       |
| GET    | `/v2/campaigns`                                          | List campaigns (filterable by status)                 |
| GET    | `/v2/campaigns/{id}`                                     | Get campaign                                          |
| PUT    | `/v2/campaigns/{id}`                                     | Update campaign                                       |
| DELETE | `/v2/campaigns/{id}`                                     | Soft-delete (`?permanent=true` for hard delete)       |
| PUT    | `/v2/campaigns/{id}/status`                              | Update campaign status                                |
| PUT    | `/v2/campaigns/{id}/plugins`                             | Update campaign plugin config                         |
| POST   | `/v2/campaigns/{id}/clients`                             | Link client to campaign                               |
| PUT    | `/v2/campaigns/{id}/clients/{clientId}`                  | Update linked client status                           |
| DELETE | `/v2/campaigns/{id}/clients/{clientId}`                  | Remove client from campaign                           |
| POST   | `/v2/campaigns/{id}/affiliates`                          | Link affiliate to campaign (generates `campaign_key`) |
| PUT    | `/v2/campaigns/{id}/affiliates/{affiliateId}`            | Update linked affiliate status                        |
| DELETE | `/v2/campaigns/{id}/affiliates/{affiliateId}`            | Remove affiliate from campaign                        |
| POST   | `/v2/campaigns/{id}/affiliates/{affiliateId}/rotate-key` | Rotate affiliate `campaign_key`                       |

> **Note:** The `rotate-key` route is implemented in the controller and service but is not yet wired into the CDK `internal-api.stack.ts`. Add it when deploying.

### Leads (Internal API)

| Method | Path             | Description |
| ------ | ---------------- | ----------- |
| GET    | `/v2/leads`      | List leads  |
| GET    | `/v2/leads/{id}` | Get lead    |
| PUT    | `/v2/leads/{id}` | Update lead |
| DELETE | `/v2/leads/{id}` | Delete lead |

### Leads — External Intake (External Leads API)

| Method | Path             | Description                                   |
| ------ | ---------------- | --------------------------------------------- |
| POST   | `/v2/leads`      | Submit a lead (requires valid `campaign_key`) |
| POST   | `/v2/leads/test` | Submit a test lead (dry-run)                  |

### Tenant Config (Internal API)

| Method | Path                                       | Description                    |
| ------ | ------------------------------------------ | ------------------------------ |
| GET    | `/v2/tenant-config/credentials`            | List all provider credentials  |
| GET    | `/v2/tenant-config/credentials/{provider}` | Get credentials for a provider |
| PUT    | `/v2/tenant-config/credentials`            | Upsert provider credentials    |
| DELETE | `/v2/tenant-config/credentials/{provider}` | Delete provider credentials    |

## 🔑 Campaign Key & Participant History

Affiliates are linked to campaigns with a generated `campaign_key` (12-digit numeric string). This key is used by the External Leads API to authenticate lead submissions. Only the current key on the affiliate record is valid — rotating it immediately invalidates the previous key.

Every change to a campaign participant (affiliate or client) is recorded in a `history[]` array embedded in the participant object:

```json
{
  "affiliate_id": "aff_abc123",
  "campaign_key": "987654321098",
  "status": "live",
  "history": [
    {
      "event": "linked",
      "field": "status",
      "from": null,
      "to": "live",
      "changed_at": "2026-01-10T12:00:00.000Z",
      "changed_by": { "id": "user_xyz", "email": "admin@example.com" }
    },
    {
      "event": "key_rotated",
      "field": "campaign_key",
      "from": "111111111111",
      "to": "987654321098",
      "changed_at": "2026-03-04T09:15:00.000Z",
      "changed_by": { "id": "user_xyz", "email": "admin@example.com" }
    }
  ]
}
```

Event types: `linked`, `status_changed`, `key_rotated` (affiliates only).

Removed participants (clients/affiliates unlinked from a campaign) are preserved in `removed_clients[]` / `removed_affiliates[]` on the campaign document for audit purposes.

## 🧪 Testing

Each handler has its own `package.json` and Vitest config. The root `scripts/run-handler-tests.sh` discovers and runs all of them automatically.

Handlers with test suites (coverage via v8):

- `affiliates`
- `campaigns`
- `clients`
- `leads`
- `tenant-config`
- `qa/orchestrator`
- `qa/modules/duplicate-check`

```bash
# Run all suites
npm test

# Run one handler's suite
./scripts/run-handler-tests.sh --pattern campaigns

# Run without coverage
./scripts/run-handler-tests.sh --cmd "npm run test:unit"
```

## 🔧 Environment Variables

```bash
TENANT=edgar                    # Required — tenant identifier
SYSTEM=lms                      # Resource name system segment
ENVIRONMENT=dev                 # dev / qa / prod

AWS_REGION=us-east-1
CDK_DEFAULT_REGION=us-east-1
CDK_DEFAULT_ACCOUNT=<account-id>
```

## 📋 Post-Deployment Verification

```bash
# Retrieve the internal API endpoint
API_ID=$(aws apigateway get-rest-apis \
  --query "items[?contains(name, 'edgar-lms-internal-api-dev')].id" \
  --output text --region us-east-1)

API_BASE="https://${API_ID}.execute-api.us-east-1.amazonaws.com/dev"

# Get tokens
curl -X POST "$API_BASE/v2/auth/login" \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"..."}'

# Use token for protected endpoints
curl -H "Authorization: Bearer <token>" "$API_BASE/v2/campaigns"
```

## 📚 Documentation

- [ARCHITECTURE_V2.md](./ARCHITECTURE_V2.md) — Full system architecture
- [api/openapi.json](./api/openapi.json) — OpenAPI 3.0 spec
- [docs/frontend-api-guide.md](./docs/frontend-api-guide.md) — Frontend integration guide

