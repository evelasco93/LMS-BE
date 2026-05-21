#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -z "${ENVIRONMENT:-}" ]] || [[ -z "${TENANT:-}" ]]; then
  echo "Error: ENVIRONMENT and TENANT are required. Run: source ./scripts/env-dev.sh"
  exit 1
fi

SYSTEM="${SYSTEM:-lms}"
PARAM_NAME="${CREDENTIALS_ENCRYPTION_KEY_SSM_PARAM:-/${TENANT}/${SYSTEM}/${ENVIRONMENT}/credentials-encryption-key}"

if [[ -z "${CREDENTIALS_ENCRYPTION_KEY:-}" ]]; then
  if ! command -v openssl >/dev/null 2>&1; then
    echo "Error: openssl is required to generate CREDENTIALS_ENCRYPTION_KEY"
    exit 1
  fi
  CREDENTIALS_ENCRYPTION_KEY="$(openssl rand -hex 32)"
  export CREDENTIALS_ENCRYPTION_KEY
  echo "Generated new CREDENTIALS_ENCRYPTION_KEY for parameter upload"
fi

if [[ ! "$CREDENTIALS_ENCRYPTION_KEY" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "Error: CREDENTIALS_ENCRYPTION_KEY must be a 64-character hex string"
  exit 1
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "Error: aws CLI is required"
  exit 1
fi

aws ssm put-parameter \
  --name "$PARAM_NAME" \
  --type SecureString \
  --overwrite \
  --value "$CREDENTIALS_ENCRYPTION_KEY" >/dev/null

echo "Stored key in SSM: $PARAM_NAME"
echo "You can now deploy without exporting CREDENTIALS_ENCRYPTION_KEY manually."
