#!/bin/bash

# CDK Deploy Script
# Usage: ./scripts/deploy.sh [stack] [action]
# 
# Stack options: all, iam, svc, api, data
# Action options: synth, deploy, destroy
#
# Examples:
#   ./scripts/deploy.sh all deploy
#   ./scripts/deploy.sh svc synth
#   ./scripts/deploy.sh api destroy

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Default values
STACK="${1:-all}"
ACTION="${2:-deploy}"
ENVIRONMENT="${ENVIRONMENT:-dev}"

# Validate inputs
validate_input() {
  case "$STACK" in
    all|iam|svc|api|data)
      ;;
    *)
      echo -e "${RED}Error: Invalid stack '$STACK'${NC}"
      print_usage
      exit 1
      ;;
  esac

  case "$ACTION" in
    synth|deploy|destroy)
      ;;
    *)
      echo -e "${RED}Error: Invalid action '$ACTION'${NC}"
      print_usage
      exit 1
      ;;
  esac
}

validate_aws_account_guard() {
  if [[ "$ACTION" == "synth" ]]; then
    return
  fi

  if [[ -z "${CDK_DEFAULT_ACCOUNT:-}" ]]; then
    echo -e "${RED}Error: CDK_DEFAULT_ACCOUNT is not set${NC}"
    echo "Run: source ./scripts/env-dev.sh"
    exit 1
  fi

  if ! command -v aws >/dev/null 2>&1; then
    echo -e "${RED}Error: aws CLI is required for account guard${NC}"
    exit 1
  fi

  local current_account
  current_account="$(aws sts get-caller-identity --query Account --output text 2>/dev/null || true)"

  if [[ -z "${current_account}" ]] || [[ "${current_account}" == "None" ]]; then
    echo -e "${RED}Error: unable to resolve current AWS account identity${NC}"
    echo "Check AWS credentials/profile before deploy."
    exit 1
  fi

  if [[ "${current_account}" != "${CDK_DEFAULT_ACCOUNT}" ]]; then
    echo -e "${RED}Error: AWS account mismatch${NC}"
    echo "Expected: ${CDK_DEFAULT_ACCOUNT}"
    echo "Current:  ${current_account}"
    exit 1
  fi
}

validate_encryption_key_format() {
  local key="$1"
  if [[ ! "$key" =~ ^[0-9a-fA-F]{64}$ ]]; then
    echo -e "${RED}Error: CREDENTIALS_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)${NC}"
    exit 1
  fi
}

resolve_credentials_encryption_key() {
  if [[ -n "${CREDENTIALS_ENCRYPTION_KEY:-}" ]]; then
    validate_encryption_key_format "$CREDENTIALS_ENCRYPTION_KEY"
    return
  fi

  if ! command -v aws >/dev/null 2>&1; then
    echo -e "${RED}Error: aws CLI is required to load CREDENTIALS_ENCRYPTION_KEY from SSM${NC}"
    echo "Set CREDENTIALS_ENCRYPTION_KEY manually or install/configure aws CLI credentials."
    exit 1
  fi

  local param_name="${CREDENTIALS_ENCRYPTION_KEY_SSM_PARAM:-/${TENANT}/${SYSTEM:-lms}/${ENVIRONMENT}/credentials-encryption-key}"
  local key
  key="$(aws ssm get-parameter --name "$param_name" --with-decryption --query 'Parameter.Value' --output text 2>/dev/null || true)"

  if [[ -z "$key" ]] || [[ "$key" == "None" ]]; then
    echo -e "${RED}Error: CREDENTIALS_ENCRYPTION_KEY is not set and SSM parameter was not found${NC}"
    echo "Expected parameter: $param_name"
    echo "Run: ./scripts/upsert-credentials-key-ssm.sh"
    exit 1
  fi

  export CREDENTIALS_ENCRYPTION_KEY="$key"
  validate_encryption_key_format "$CREDENTIALS_ENCRYPTION_KEY"
  echo -e "${GREEN}Loaded CREDENTIALS_ENCRYPTION_KEY from SSM parameter: $param_name${NC}"
}

# Print usage
print_usage() {
  echo -e "${YELLOW}Usage: ./scripts/deploy.sh [stack] [action]${NC}"
  echo ""
  echo "Stack options:"
  echo "  all  - Deploy all stacks (Data, IAM, Services, API)"
  echo "  data - Deploy Data stack only"
  echo "  iam  - Deploy IAM stack only"
  echo "  svc  - Deploy Services stack only"
  echo "  api  - Deploy API stack only"
  echo ""
  echo "Action options:"
  echo "  synth   - Synthesize CloudFormation templates"
  echo "  deploy  - Deploy stacks to AWS"
  echo "  destroy - Destroy stacks from AWS"
  echo ""
  echo "Examples:"
  echo "  ./scripts/deploy.sh all deploy"
  echo "  ./scripts/deploy.sh svc synth"
  echo "  ./scripts/deploy.sh api destroy"
}

# Map stack shorthand to full stack names
get_stack_names() {
  local stack_type="$1"
  local env="$2"
  local tenant="${TENANT}"
  local system="${SYSTEM:-lms}"
  
  # Build app prefix (tenant-system-env)
  local prefix="${tenant}-${system}-${env}"
  
  case "$stack_type" in
    all)
      echo "${prefix}-IamStack ${prefix}-DataStack ${prefix}-ServicesStack ${prefix}-ApiStack"
      ;;
    data)
      echo "${prefix}-DataStack"
      ;;
    iam)
      echo "${prefix}-IamStack"
      ;;
    svc)
      echo "${prefix}-ServicesStack"
      ;;
    api)
      echo "${prefix}-ApiStack"
      ;;
  esac
}

# Execute CDK command
execute_cdk() {
  local action="$1"
  local stack_names="$2"
  local env="$3"
  
  cd "$(dirname "$0")/.."
  
  echo -e "${GREEN}Executing: cdk ${action} ${stack_names}${NC}"
  echo ""
  
  case "$action" in
    synth)
      npx cdk synth ${stack_names} --require-approval=never
      ;;
    deploy)
      npx cdk deploy ${stack_names} --require-approval=never
      ;;
    destroy)
      npx cdk destroy ${stack_names} --force
      ;;
  esac
}

# Main execution
main() {
  validate_input
  
  echo -e "${GREEN}CDK Deploy Script${NC}"
  echo "Environment: $ENVIRONMENT"
  echo "Tenant: ${TENANT}"
  echo "System: ${SYSTEM:-lms}"
  echo "Stack: $STACK"
  echo "Action: $ACTION"
  echo ""
  
  # Check if required environment variables are set
  if [[ -z "$ENVIRONMENT" ]]; then
    echo -e "${RED}Error: ENVIRONMENT is not set${NC}"
    echo "Run: source ./scripts/env-dev.sh"
    exit 1
  fi
  
  if [[ -z "$TENANT" ]]; then
    echo -e "${RED}Error: TENANT is not set${NC}"
    echo "Run: source ./scripts/env-dev.sh"
    exit 1
  fi

  validate_aws_account_guard
  resolve_credentials_encryption_key
  
  # Get the stack names
  STACK_NAMES=$(get_stack_names "$STACK" "$ENVIRONMENT")
  
  echo -e "${YELLOW}Stack names: $STACK_NAMES${NC}"
  echo ""
  
  # Execute the CDK command
  execute_cdk "$ACTION" "$STACK_NAMES" "$ENVIRONMENT"
  
  echo ""
  echo -e "${GREEN}Done!${NC}"
}

# Show help if requested
if [[ "$STACK" == "-h" ]] || [[ "$STACK" == "--help" ]]; then
  print_usage
  exit 0
fi

main
