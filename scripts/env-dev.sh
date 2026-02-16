#!/bin/bash

# Export AWS Development Environment Variables
# Run this before deploying: source ./scripts/env-dev.sh

export ENVIRONMENT=dev
export TENANT=edgar
export SYSTEM=lms
export AWS_REGION=us-east-1
export CDK_DEFAULT_REGION=us-east-1
export CDK_DEFAULT_ACCOUNT=562362324353


echo "✓ Development environment variables loaded"
echo "  ENVIRONMENT: $ENVIRONMENT"
echo "  TENANT: $TENANT"
echo "  SYSTEM: $SYSTEM"
echo "  AWS Account: $CDK_DEFAULT_ACCOUNT"
echo "  AWS Region: $AWS_REGION"
