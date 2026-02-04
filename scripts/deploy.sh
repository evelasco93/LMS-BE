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
CDK_ENV="${CDK_ENV:-dev}"

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
  local tenant="${CDK_TENANT:-smashorbit}"
  local system="${CDK_SYSTEM:-prototype-lms}"
  
  case "$stack_type" in
    all)
      echo "${tenant}-${system}-data-${env}-stack ${tenant}-${system}-iam-${env}-stack ${tenant}-${system}-services-${env}-stack ${tenant}-${system}-api-${env}-stack"
      ;;
    data)
      echo "${tenant}-${system}-data-${env}-stack"
      ;;
    iam)
      echo "${tenant}-${system}-iam-${env}-stack"
      ;;
    svc)
      echo "${tenant}-${system}-services-${env}-stack"
      ;;
    api)
      echo "${tenant}-${system}-api-${env}-stack"
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
  echo "Environment: $CDK_ENV"
  echo "Tenant: ${CDK_TENANT:-smashorbit}"
  echo "System: ${CDK_SYSTEM:-prototype-lms}"
  echo "Stack: $STACK"
  echo "Action: $ACTION"
  echo ""
  
  # Export environment variable for CDK
  export CDK_ENV="$CDK_ENV"
  
  # Get the stack names
  STACK_NAMES=$(get_stack_names "$STACK" "$CDK_ENV")
  
  # Execute the CDK command
  execute_cdk "$ACTION" "$STACK_NAMES" "$CDK_ENV"
  
  echo ""
  echo -e "${GREEN}Done!${NC}"
}

# Show help if requested
if [[ "$STACK" == "-h" ]] || [[ "$STACK" == "--help" ]]; then
  print_usage
  exit 0
fi

main
