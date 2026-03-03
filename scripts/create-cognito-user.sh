#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./scripts/create-cognito-user.sh --email <user@company.com> --password '<StrongPassword>' [--user-pool-id <id>] [--stack-name <name>] [--region <aws-region>] [--profile <aws-profile>] [--send-invite]

Description:
  Creates (or updates) a Cognito user in the internal API user pool and sets a permanent password.

Defaults:
  user pool id: read from CloudFormation output ${TENANT}-${SYSTEM}-${ENVIRONMENT}-InternalApiCognitoUserPoolId
  stack name: ${TENANT}-${SYSTEM}-${ENVIRONMENT}-ApiStack
  region: AWS_REGION | AWS_DEFAULT_REGION | us-east-1

Example:
  source ./scripts/env-dev.sh
  ./scripts/create-cognito-user.sh --email dev1@company.com --password 'Temp-ChangeMe-123!'
EOF
}

EMAIL=""
PASSWORD=""
USER_POOL_ID=""
STACK_NAME=""
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
PROFILE=""
MESSAGE_ACTION="SUPPRESS"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --email)
      EMAIL="${2:-}"
      shift 2
      ;;
    --password)
      PASSWORD="${2:-}"
      shift 2
      ;;
    --user-pool-id)
      USER_POOL_ID="${2:-}"
      shift 2
      ;;
    --stack-name)
      STACK_NAME="${2:-}"
      shift 2
      ;;
    --region)
      REGION="${2:-}"
      shift 2
      ;;
    --profile)
      PROFILE="${2:-}"
      shift 2
      ;;
    --send-invite)
      MESSAGE_ACTION=""
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ -z "$EMAIL" || -z "$PASSWORD" ]]; then
  echo "--email and --password are required." >&2
  usage
  exit 1
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI not found." >&2
  exit 1
fi

TENANT="${TENANT:-}"
SYSTEM="${SYSTEM:-lms}"
ENVIRONMENT="${ENVIRONMENT:-dev}"

if [[ -z "$STACK_NAME" ]]; then
  if [[ -z "$TENANT" ]]; then
    echo "TENANT is not set. Source ./scripts/env-dev.sh or pass --stack-name." >&2
    exit 1
  fi
  STACK_NAME="${TENANT}-${SYSTEM}-${ENVIRONMENT}-ApiStack"
fi

AWS_CMD=(aws --region "$REGION")
if [[ -n "$PROFILE" ]]; then
  AWS_CMD+=(--profile "$PROFILE")
fi

get_output() {
  local key="$1"
  local export_name="$2"

  local by_key
  by_key=$("${AWS_CMD[@]}" cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='${key}'].OutputValue" \
    --output text 2>/dev/null | sed 's/^None$//')

  if [[ -n "$by_key" ]]; then
    echo "$by_key"
    return 0
  fi

  "${AWS_CMD[@]}" cloudformation list-exports \
    --query "Exports[?Name=='${export_name}'].Value" \
    --output text 2>/dev/null | sed 's/^None$//'
}

if [[ -z "$USER_POOL_ID" ]]; then
  if [[ -z "$TENANT" ]]; then
    TENANT=$("${AWS_CMD[@]}" cloudformation describe-stacks \
      --stack-name "$STACK_NAME" \
      --query "Stacks[0].StackName" --output text | awk -F'-' '{print $1}')
  fi

  PREFIX="${TENANT}-${SYSTEM}-${ENVIRONMENT}"
  PREFIX_COMPACT="${PREFIX//-/}"
  USER_POOL_ID="$(get_output "${PREFIX_COMPACT}InternalApiCognitoUserPoolId" "${PREFIX}-InternalApiCognitoUserPoolId")"
fi

if [[ -z "$USER_POOL_ID" ]]; then
  echo "Could not resolve Cognito user pool id. Pass --user-pool-id or deploy ApiStack first." >&2
  exit 1
fi

USER_EXISTS="false"
if "${AWS_CMD[@]}" cognito-idp admin-get-user --user-pool-id "$USER_POOL_ID" --username "$EMAIL" >/dev/null 2>&1; then
  USER_EXISTS="true"
fi

if [[ "$USER_EXISTS" == "false" ]]; then
  CREATE_ARGS=(
    cognito-idp admin-create-user
    --user-pool-id "$USER_POOL_ID"
    --username "$EMAIL"
    --user-attributes "Name=email,Value=${EMAIL}" "Name=email_verified,Value=true"
  )

  if [[ -n "$MESSAGE_ACTION" ]]; then
    CREATE_ARGS+=(--message-action "$MESSAGE_ACTION")
  fi

  "${AWS_CMD[@]}" "${CREATE_ARGS[@]}" >/dev/null
  echo "Created Cognito user: $EMAIL"
else
  echo "User already exists, updating password: $EMAIL"
fi

"${AWS_CMD[@]}" cognito-idp admin-set-user-password \
  --user-pool-id "$USER_POOL_ID" \
  --username "$EMAIL" \
  --password "$PASSWORD" \
  --permanent >/dev/null

echo "Set permanent password for: $EMAIL"
echo "User pool id: $USER_POOL_ID"
