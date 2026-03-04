#!/bin/bash

# Export AWS Development Environment Variables
# Run this before deploying: source ./scripts/env-dev.sh

export ENVIRONMENT=dev
export TENANT=sel
export SYSTEM=lms
export AWS_REGION=us-east-1
export CDK_DEFAULT_REGION=us-east-1
export CDK_DEFAULT_ACCOUNT=562362324353
export CLIENTS_TABLE_NAME=sel-lms-clients-dev
export AFFILIATES_TABLE_NAME=sel-lms-affiliates-dev
export CAMPAIGNS_TABLE_NAME=sel-lms-campaigns-dev
export LEADS_TABLE_NAME=sel-lms-leads-dev


echo "✓ Development environment variables loaded"
echo "  ENVIRONMENT: $ENVIRONMENT"
echo "  TENANT: $TENANT"
echo "  SYSTEM: $SYSTEM"
echo "  AWS Account: $CDK_DEFAULT_ACCOUNT"
echo "  AWS Region: $AWS_REGION"
