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

# Local secrets file (gitignored by .env.local rule)
LOCAL_SECRETS_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.env.local"
if [[ -f "$LOCAL_SECRETS_FILE" ]]; then
	# shellcheck disable=SC1090
	source "$LOCAL_SECRETS_FILE"
fi

export CREDENTIALS_ENCRYPTION_KEY_SSM_PARAM="${CREDENTIALS_ENCRYPTION_KEY_SSM_PARAM:-/${TENANT}/${SYSTEM}/${ENVIRONMENT}/credentials-encryption-key}"

if [[ -z "${CREDENTIALS_ENCRYPTION_KEY:-}" ]] && command -v aws >/dev/null 2>&1; then
	CREDENTIALS_ENCRYPTION_KEY="$(aws ssm get-parameter --name "$CREDENTIALS_ENCRYPTION_KEY_SSM_PARAM" --with-decryption --query 'Parameter.Value' --output text 2>/dev/null || true)"
	if [[ -n "$CREDENTIALS_ENCRYPTION_KEY" ]] && [[ "$CREDENTIALS_ENCRYPTION_KEY" != "None" ]]; then
		export CREDENTIALS_ENCRYPTION_KEY
	fi
fi

if [[ -z "${CREDENTIALS_ENCRYPTION_KEY:-}" ]]; then
	if command -v openssl >/dev/null 2>&1; then
		export CREDENTIALS_ENCRYPTION_KEY="$(openssl rand -hex 32)"
		{
			echo ""
			echo "# Auto-generated local credentials encryption key"
			echo "export CREDENTIALS_ENCRYPTION_KEY=${CREDENTIALS_ENCRYPTION_KEY}"
			echo "export CREDENTIALS_ENCRYPTION_KEY_SSM_PARAM=${CREDENTIALS_ENCRYPTION_KEY_SSM_PARAM}"
		} >> "$LOCAL_SECRETS_FILE"
	else
		echo "Error: openssl is required to generate CREDENTIALS_ENCRYPTION_KEY"
		return 1
	fi
fi

if [[ ! "$CREDENTIALS_ENCRYPTION_KEY" =~ ^[0-9a-fA-F]{64}$ ]]; then
	echo "Error: CREDENTIALS_ENCRYPTION_KEY must be a 64-character hex string"
	return 1
fi


echo "✓ Development environment variables loaded"
echo "  ENVIRONMENT: $ENVIRONMENT"
echo "  TENANT: $TENANT"
echo "  SYSTEM: $SYSTEM"
echo "  AWS Account: $CDK_DEFAULT_ACCOUNT"
echo "  AWS Region: $AWS_REGION"
echo "  CREDENTIALS_ENCRYPTION_KEY: loaded"
echo "  CREDENTIALS_ENCRYPTION_KEY_SSM_PARAM: $CREDENTIALS_ENCRYPTION_KEY_SSM_PARAM"
