# Lead Intake Prototype

AWS-based lead intake system using API Gateway, Lambda, and DynamoDB.

## Project Structure

```
├── cdk/                    # AWS CDK Infrastructure
│   ├── stacks/            # CDK Stack definitions
│   │   ├── dataStack.ts   # DynamoDB tables
│   │   ├── iamStack.ts    # IAM roles and policies
│   │   ├── servicesStack.ts # Lambda functions
│   │   └── apiStack.ts    # API Gateway
│   └── app.ts             # CDK App entry point
├── common/                # Shared utilities
│   ├── clients/          # API clients (IPQS, TrustedForms)
│   └── utils/            # Helper utilities
├── handler/              # Lambda function code
│   ├── controllers/      # Request handlers
│   ├── services/         # Business logic
│   └── types/            # TypeScript types
└── scripts/              # Deployment scripts
```

## Prerequisites

- Node.js 18+
- AWS CLI configured
- AWS CDK CLI installed (`npm install -g aws-cdk`)

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set environment variables:
```bash
source ./scripts/env-dev.sh
```

3. Build the project:
```bash
npm run build
# or
./scripts/build.sh
```

## Deployment

### Deploy all stacks:
```bash
./scripts/deploy.sh all deploy
```

### Deploy specific stack:
```bash
./scripts/deploy.sh data deploy  # DynamoDB only
./scripts/deploy.sh iam deploy   # IAM only
./scripts/deploy.sh svc deploy   # Lambda only
./scripts/deploy.sh api deploy   # API Gateway only
```

### Synthesize CloudFormation templates:
```bash
./scripts/deploy.sh all synth
```

### Destroy stacks:
```bash
./scripts/deploy.sh all destroy
```

## API Endpoints

### POST /smashorbit/prototype/lead
Create a new lead with validation.

**Request Body:**
```json
{
  "first_name": "John",
  "last_name": "Doe",
  "email": "john@example.com",
  "phone": "1234567890",
  "ip_address": "1.2.3.4",
  "trusted_form_cert_id": "abc123",
  "campaign_id": "campaign-001",
  ...
}
```

**Response:**
```json
{
  "success": true,
  "message": "Lead created successfully",
  "data": {
    "id": "lead-123",
    "passed_phone_check": true,
    "passed_email_check": true,
    "passed_ip_check": true,
    "ipqs_raw_data": {...},
    ...
  }
}
```

### GET /smashorbit/prototype/lead
Retrieve all leads.

**Response:**
```json
{
  "success": true,
  "message": "Leads retrieved successfully",
  "count": 10,
  "data": [...]
}
```

## Features

- **Lead Validation**: Validates phone, email, and IP using IPQS API
- **TrustedForm Integration**: Validates leads against TrustedForm certificates
- **Data Storage**: Stores validated leads in DynamoDB
- **API Gateway**: RESTful API with POST and GET endpoints
- **TypeScript**: Fully typed codebase
- **Dependency Injection**: Using Inversify for clean architecture
- **Infrastructure as Code**: AWS CDK for easy deployment

## Environment Variables

The Lambda function uses the following environment variables (automatically set by CDK):

- `TENANT`: Tenant identifier
- `ENVIRONMENT`: Environment (dev/staging/prod)
- `LEADS_TABLE_NAME`: DynamoDB table name
- `AWS_REGION`: AWS region
- `IPQS_BASE_URL`: IPQS API base URL
- `IPQS_API_KEY`: IPQS API key
- `TRUSTEDFORM_USERNAME`: TrustedForm username
- `TRUSTEDFORM_PASSWORD`: TrustedForm password

## Development

### Build TypeScript:
```bash
npm run build
```

### Watch mode:
```bash
npm run watch
```

### CDK Commands:
```bash
npm run cdk -- diff        # Show changes
npm run cdk -- bootstrap   # Bootstrap CDK
npm run synth              # Synthesize templates
```

## Stack Dependencies

The stacks are deployed in the following order:
1. Data Stack (DynamoDB)
2. IAM Stack (depends on Data)
3. Services Stack (depends on IAM)
4. API Stack (depends on Services)

## License

ISC
