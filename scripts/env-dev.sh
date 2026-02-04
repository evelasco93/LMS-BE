#!/bin/bash

# Export AWS Development Environment Variables
# Run this before deploying: source ./scripts/env-dev.sh

export CDK_ENV=dev
export CDK_TENANT=smashorbit
export CDK_SYSTEM=prototype-lms
export AWS_REGION=us-east-1
export AWS_ACCOUNT_ID=562362324353


echo "✓ Development environment variables loaded"
echo "  ENV: $CDK_ENV"
echo "  TENANT: $CDK_TENANT"
echo "  SYSTEM: $CDK_SYSTEM"
echo "  AWS Account: $AWS_ACCOUNT_ID"
echo "  AWS Region: $AWS_REGION"
