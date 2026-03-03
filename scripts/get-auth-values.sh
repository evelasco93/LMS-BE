#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  ./scripts/get-auth-values.sh [--stack-name <name>] [--region <aws-region>] [--profile <aws-profile>] [--env-file <path>] [--env-prefix <prefix>]

Description:
  Prints frontend-ready auth/API environment values for the deployed API stack.

Defaults:
  stack name: ${TENANT}-${SYSTEM}-${ENVIRONMENT}-ApiStack
  region: AWS_REGION | AWS_DEFAULT_REGION | us-east-1

Example:
  source ./scripts/env-dev.sh
  ./scripts/get-auth-values.sh
  ./scripts/get-auth-values.sh --env-file .env.local --env-prefix VITE
EOF
}

STACK_NAME=""
REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
PROFILE=""
ENV_FILE=""
ENV_PREFIX="VITE"

while [[ $# -gt 0 ]]; do
  case "$1" in
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
    --env-file)
      ENV_FILE="${2:-}"
      shift 2
      ;;
    --env-prefix)
      ENV_PREFIX="${2:-}"
      shift 2
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

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI not found." >&2
  exit 1
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

if [[ -z "$TENANT" ]]; then
  TENANT=$("${AWS_CMD[@]}" cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].StackName" --output text | awk -F'-' '{print $1}')
fi

PREFIX="${TENANT}-${SYSTEM}-${ENVIRONMENT}"
PREFIX_COMPACT="${PREFIX//-/}"

INTERNAL_API_BASE_URL="$(get_output "${PREFIX_COMPACT}InternalApiEndpoint" "${PREFIX}-InternalApiEndpoint")"
EXTERNAL_LEADS_API_BASE_URL="$(get_output "${PREFIX_COMPACT}ExternalLeadsApiEndpoint" "${PREFIX}-ExternalLeadsApiEndpoint")"
COGNITO_USER_POOL_ID="$(get_output "${PREFIX_COMPACT}InternalApiCognitoUserPoolId" "${PREFIX}-InternalApiCognitoUserPoolId")"
COGNITO_CLIENT_ID="$(get_output "${PREFIX_COMPACT}InternalApiCognitoClientId" "${PREFIX}-InternalApiCognitoClientId")"
COGNITO_DOMAIN_NAME="$(get_output "${PREFIX_COMPACT}InternalApiCognitoDomainName" "${PREFIX}-InternalApiCognitoDomainName")"
EXTERNAL_LEADS_API_ID="$(get_output "${PREFIX_COMPACT}ExternalLeadsApiId" "${PREFIX}-ExternalLeadsApiId")"

API_KEY_NAME="${TENANT}-${SYSTEM}-external-leads-api-${ENVIRONMENT}-api-key"
EXTERNAL_LEADS_API_KEY=$("${AWS_CMD[@]}" apigateway get-api-keys \
  --name-query "$API_KEY_NAME" \
  --include-values \
  --query "items[?name=='${API_KEY_NAME}']|[0].value" \
  --output text 2>/dev/null | sed 's/^None$//')

if [[ -z "$EXTERNAL_LEADS_API_KEY" ]]; then
  USAGE_PLAN_NAME="${TENANT}-${SYSTEM}-external-leads-api-${ENVIRONMENT}-usage-plan"
  USAGE_PLAN_ID=$("${AWS_CMD[@]}" apigateway get-usage-plans \
    --query "items[?name=='${USAGE_PLAN_NAME}']|[0].id" \
    --output text 2>/dev/null | sed 's/^None$//')

  if [[ -n "$USAGE_PLAN_ID" ]]; then
    API_KEY_ID=$("${AWS_CMD[@]}" apigateway get-usage-plan-keys \
      --usage-plan-id "$USAGE_PLAN_ID" \
      --query "items[0].id" \
      --output text 2>/dev/null | sed 's/^None$//')

    if [[ -n "$API_KEY_ID" ]]; then
      EXTERNAL_LEADS_API_KEY=$("${AWS_CMD[@]}" apigateway get-api-key \
        --api-key "$API_KEY_ID" \
        --include-value \
        --query "value" \
        --output text 2>/dev/null | sed 's/^None$//')
    fi
  fi
fi

if [[ -n "$COGNITO_DOMAIN_NAME" ]]; then
  COGNITO_ISSUER="https://${COGNITO_DOMAIN_NAME}"
  COGNITO_AUTHORIZE_URL="${COGNITO_ISSUER}/oauth2/authorize"
  COGNITO_TOKEN_URL="${COGNITO_ISSUER}/oauth2/token"
  COGNITO_LOGOUT_URL="${COGNITO_ISSUER}/logout"
else
  COGNITO_ISSUER=""
  COGNITO_AUTHORIZE_URL=""
  COGNITO_TOKEN_URL=""
  COGNITO_LOGOUT_URL=""
fi

cat <<EOF
# Frontend handoff values
# Stack: ${STACK_NAME}
# Region: ${REGION}

INTERNAL_API_BASE_URL=${INTERNAL_API_BASE_URL}
EXTERNAL_LEADS_API_BASE_URL=${EXTERNAL_LEADS_API_BASE_URL}
EXTERNAL_LEADS_API_ID=${EXTERNAL_LEADS_API_ID}

COGNITO_USER_POOL_ID=${COGNITO_USER_POOL_ID}
COGNITO_CLIENT_ID=${COGNITO_CLIENT_ID}
COGNITO_DOMAIN_NAME=${COGNITO_DOMAIN_NAME}
COGNITO_ISSUER=${COGNITO_ISSUER}
COGNITO_AUTHORIZE_URL=${COGNITO_AUTHORIZE_URL}
COGNITO_TOKEN_URL=${COGNITO_TOKEN_URL}
COGNITO_LOGOUT_URL=${COGNITO_LOGOUT_URL}
COGNITO_SCOPES=openid email profile internal-api/read internal-api/write

EXTERNAL_LEADS_API_KEY_NAME=${API_KEY_NAME}
EXTERNAL_LEADS_API_KEY=${EXTERNAL_LEADS_API_KEY}
EOF

if [[ -n "$ENV_FILE" ]]; then
  cat >"$ENV_FILE" <<EOF
${ENV_PREFIX}_INTERNAL_API_BASE_URL=${INTERNAL_API_BASE_URL}
${ENV_PREFIX}_EXTERNAL_LEADS_API_BASE_URL=${EXTERNAL_LEADS_API_BASE_URL}
${ENV_PREFIX}_EXTERNAL_LEADS_API_ID=${EXTERNAL_LEADS_API_ID}
${ENV_PREFIX}_COGNITO_USER_POOL_ID=${COGNITO_USER_POOL_ID}
${ENV_PREFIX}_COGNITO_CLIENT_ID=${COGNITO_CLIENT_ID}
${ENV_PREFIX}_COGNITO_DOMAIN_NAME=${COGNITO_DOMAIN_NAME}
${ENV_PREFIX}_COGNITO_ISSUER=${COGNITO_ISSUER}
${ENV_PREFIX}_COGNITO_AUTHORIZE_URL=${COGNITO_AUTHORIZE_URL}
${ENV_PREFIX}_COGNITO_TOKEN_URL=${COGNITO_TOKEN_URL}
${ENV_PREFIX}_COGNITO_LOGOUT_URL=${COGNITO_LOGOUT_URL}
${ENV_PREFIX}_COGNITO_SCOPES="openid email profile internal-api/read internal-api/write"
${ENV_PREFIX}_EXTERNAL_LEADS_API_KEY=${EXTERNAL_LEADS_API_KEY}
EOF
  echo "Wrote frontend env file: ${ENV_FILE}"
fi

if [[ -z "$INTERNAL_API_BASE_URL" || -z "$EXTERNAL_LEADS_API_BASE_URL" || -z "$COGNITO_USER_POOL_ID" || -z "$COGNITO_CLIENT_ID" || -z "$COGNITO_DOMAIN_NAME" ]]; then
  echo "Warning: One or more CloudFormation outputs are empty. Ensure stack is deployed and up to date." >&2
fi

if [[ -z "$EXTERNAL_LEADS_API_KEY" ]]; then
  echo "Warning: External API key value is empty. Verify API key exists and this IAM principal can read API key values." >&2
fi
