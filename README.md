# Lead Intake Prototype

AWS-based lead intake system using API Gateway, Lambda, and DynamoDB with IPQS and TrustedForm validation.

## Project Structure

```
prototype_lead_intake/
├── cdk/                           # AWS CDK Infrastructure
│   ├── stacks/
│   │   ├── dataStack.ts          # DynamoDB table with GSI indexes
│   │   ├── iamStack.ts           # IAM roles and policies
│   │   ├── servicesStack.ts      # Lambda functions (NodejsFunction)
│   │   └── apiStack.ts           # API Gateway REST API
│   └── app.ts                    # CDK App entry point
├── common/                        # Shared utilities
│   ├── clients/
│   │   ├── ipqs.ts               # IPQS fraud detection client
│   │   └── trustedForms.ts       # TrustedForm certificate validation
│   └── utils/
│       ├── dynamoDbUtil.ts       # DynamoDB wrapper with GSI support
│       └── resourceNameBuilder.ts # Consistent resource naming
├── handler/                       # Lambda function code
│   ├── controllers/
│   │   └── leadController.ts     # API route handlers (@apiController)
│   ├── services/
│   │   └── leadService.ts        # Business logic & validation
│   ├── modules/
│   │   └── lead.module.ts        # Inversify DI container
│   ├── types/
│   │   └── index.ts              # TypeScript interfaces
│   ├── app.ts                    # ApiLambdaApp configuration
│   └── index.ts                  # Lambda entry point
├── scripts/
│   ├── build.sh                  # Build TypeScript & package
│   ├── deploy.sh                 # CDK deployment script
│   └── env-dev.sh                # Environment variables
├── package.json
├── tsconfig.json                 # TypeScript config for CDK
└── tsconfig.handler.json         # TypeScript config for Lambda
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

Base URL: `https://{api-id}.execute-api.us-east-1.amazonaws.com/prod`

### POST /smashorbit/prototype/lead
Create a new lead with validation. The system checks for duplicates, validates with IPQS and TrustedForm, then stores the lead in DynamoDB.

**Request Body:**
```json
{
  "first_name": "John",
  "last_name": "Doe",
  "email": "john@example.com",
  "phone": "1234567890",
  "ip_address": "1.2.3.4",
  "trusted_form_cert_id": "abc123def456",
  "state": "TX",
  "message": "I need help",
  "rideshare_abuse": true,
  "rideshare_company": "Uber",
  "campaign_id": "campaign-001",
  "utm_source": "google",
  "utm_campaign": "rideshare-2024"
}
```

**Success Response (Lead Accepted):**
```json
{
  "result": true,
  "message": "lead accepted"
}
```

**Error Responses:**

*Duplicate Lead:*
```json
{
  "result": false,
  "message": "duplicate lead rejected"
}
```

*TrustedForm Validation Failed:*
```json
{
  "result": false,
  "message": "TrustedForm validation failed",
  "details": {
    "outcome": "error",
    "reason": "Malformed certificate id"
  }
}
```

*TrustedForm API Error:*
```json
{
  "result": false,
  "message": "TrustedForm validation failed",
  "details": {
    "error": "TrustedForm certificate not found. The certificate ID 'abc123' is invalid, malformed, or does not exist.",
    "certId": "abc123"
  }
}
```

*IPQS Validation Failed:*
```json
{
  "result": false,
  "message": "IPQS validation failed",
  "details": {
    "ip": "High fraud score, Proxy detected, VPN detected",
    "phone": "VOIP number, Risky number",
    "email": "Disposable email, Low deliverability"
  }
}
```

*Missing Fields:*
```json
{
  "result": false,
  "message": "lead rejected",
  "error": "Missing required fields: email, phone, or ip_address"
}
```

### GET /smashorbit/prototype/lead
Retrieve all leads sorted by timestamp (oldest first, newest last).

**Response:**
```json
{
  "success": true,
  "message": "Leads retrieved successfully",
  "count": 2,
  "data": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "timestamp": "2026-02-04T06:30:15.123Z",
      "created_at": "2026-02-04T06:30:15.123Z",
      "date": "2026-02-04",
      "time": "06:30:15",
      "first_name": "John",
      "last_name": "Doe",
      "email": "john@example.com",
      "phone": "1234567890",
      "state": "TX",
      "ip_address": "1.2.3.4",
      "trusted_form_cert_id": "abc123def456",
      "passed_tf_check": true,
      "passed_phone_check": true,
      "passed_email_check": true,
      "passed_ip_check": true,
      "sellable": true,
      "sold": false,
      "cherry_picked": false,
      "trustedform_response": {
        "cert_id": "abc123def456",
        "outcome": "success",
        "reason": "Valid certificate",
        "validated": true,
        "raw_response": {
          "outcome": "success",
          "reason": "Valid certificate"
        },
        "error": null
      },
      "ipqs_response": {
        "phone": {...},
        "email": {...},
        "ip": {...},
        "validated": true,
        "results": {
          "phone": {
            "valid": true,
            "reasons": ""
          },
          "email": {
            "valid": true,
            "reasons": ""
          },
          "ip": {
            "valid": true,
            "reasons": ""
          }
        }
      }
    }
  ]
}
```

## Features

- **Duplicate Detection**: Checks for duplicate leads by phone and email using DynamoDB GSI indexes
- **IPQS Validation**: Validates phone, email, and IP for fraud detection
  - Phone: VOIP detection, spam detection, fraud scoring
  - Email: Disposable email detection, deliverability check, fraud scoring
  - IP: Proxy/VPN/Tor detection, fraud scoring, abuse detection
- **TrustedForm Integration**: Validates leads against TrustedForm certificates
- **Data Persistence**: All leads stored in DynamoDB (even rejected ones) with validation results
- **Detailed Error Messages**: Specific reasons for rejection (duplicate, TrustedForm failed, IPQS failed)
- **API Gateway**: RESTful API with POST (create) and GET (list) endpoints
- **TypeScript**: Fully typed codebase with strict type checking
- **Decorator-based Routing**: Using ts-lambda-api (@apiController, @POST, @GET)
- **Dependency Injection**: Using Inversify for clean architecture
- **Infrastructure as Code**: AWS CDK with 4 separate stacks
- **Resource Naming**: Consistent naming pattern: `{tenant}-{system}-{env}-{type}-{name}`
- **Bundling**: esbuild bundling via NodejsFunction with ARM64 runtime
- **Time Storage**: All timestamps stored in UTC for consistency

## Validation Flow

1. **Duplicate Check**: Query GSI indexes for existing phone/email (rejects without saving)
2. **IPQS Validation**: Parallel validation of IP, phone, and email
3. **TrustedForm Validation**: Certificate validation with phone match
4. **Save to DynamoDB**: Lead always saved (except duplicates) with all validation results
5. **Return Response**: Success or detailed error message with reasons

Leads are marked as `sellable: true` only if they pass all validations. Failed leads are still saved with `sellable: false` for analysis.

## Environment Variables

The Lambda function uses the following environment variables (automatically set by CDK):

- `TENANT`: Tenant identifier (e.g., "smashorbit")
- `SYSTEM`: System identifier (e.g., "prototype-lms")
- `ENVIRONMENT`: Environment (dev/staging/prod)
- `LEADS_TABLE_NAME`: DynamoDB table name
- `AWS_REGION`: AWS region (default: us-east-1)
- `IPQS_BASE_URL`: IPQS API base URL
- `IPQS_API_KEY`: IPQS API key for fraud detection
- `TRUSTEDFORM_USERNAME`: TrustedForm API username (usually "API")
- `TRUSTEDFORM_PASSWORD`: TrustedForm API key

## DynamoDB Schema

**Table Name**: `{tenant}-{system}-{environment}-table-leads`

**Primary Key**:
- Partition Key: `id` (String) - UUID v4
- Sort Key: `timestamp` (String) - ISO timestamp

**Global Secondary Indexes**:
- `phone-index`: Partition key: `phone`, Sort key: `timestamp`
- `email-index`: Partition key: `email`, Sort key: `timestamp`

**Key Attributes**:
- `id`: UUID v4 unique identifier
- `timestamp`, `created_at`: ISO UTC timestamps
- `date`, `time`: UTC date and time (stored as strings)
- `first_name`, `last_name`, `email`, `phone`, `state`: Lead contact info
- `ip_address`, `trusted_form_cert_id`: Validation data
- `passed_tf_check`, `passed_phone_check`, `passed_email_check`, `passed_ip_check`: Boolean validation flags
- `sellable`: Boolean - true only if all validations passed
- `sold`, `cherry_picked`: Boolean sales flags
- `trustedform_response`: Object with cert_id, outcome, reason, validated, raw_response, error
- `ipqs_response`: Object with phone/email/ip validation details and results

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
