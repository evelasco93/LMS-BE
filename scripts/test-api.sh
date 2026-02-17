#!/bin/bash

# API smoke script: create client + affiliate (valid + invalid payloads)
# Usage: ./scripts/test-api.sh [BASE_URL]
# Example: ./scripts/test-api.sh https://knc901awc8.execute-api.us-east-1.amazonaws.com/dev/v2

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
BASE_URL="${1:-https://knc901awc8.execute-api.us-east-1.amazonaws.com/dev/v2}"
TIMESTAMP=$(date +%s%N)
VERBOSE="${VERBOSE:-false}"

# Headers
HEADERS=(-H "Content-Type: application/json")

# Test data with unique identifiers
CLIENT_EMAIL="test-client-${TIMESTAMP}@example.com"
AFFILIATE_EMAIL="test-affiliate-${TIMESTAMP}@example.com"

echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  API Test Suite - Lead Intake System${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "Base URL: ${BASE_URL}"
echo -e "Timestamp: ${TIMESTAMP}\n"

# Function to print section headers
print_section() {
    echo -e "\n${BLUE}──────────────────────────────────────────────────────────${NC}"
    echo -e "${YELLOW}→ $1${NC}"
    echo -e "${BLUE}──────────────────────────────────────────────────────────${NC}\n"
}

# Function to print test result
print_result() {
    local status=$1
    local message=$2
    if [ "$status" -eq 0 ]; then
        echo -e "${GREEN}✓ $message${NC}"
    else
        echo -e "${RED}✗ $message${NC}"
    fi
}

# Function to print JSON response pretty
print_json() {
    echo "$1" | python3 -m json.tool 2>/dev/null || echo "$1"
}

test_endpoint() {
    local method=$1
    local endpoint=$2
    local description=$3
    local data=$4

    echo -e "${CYAN}${method}${NC} $endpoint"
    echo -e "${YELLOW}$description${NC}"

    local output=$(curl -s -w "\n%{http_code}" -X "$method" "$BASE_URL$endpoint" \
          "${HEADERS[@]}" \
          ${data:+-d "$data"})

    local http_status=$(echo "$output" | tail -n1)
    local response=$(echo "$output" | head -n-1)

    echo -e "HTTP Status: ${CYAN}$http_status${NC}\n"

    if [ "$VERBOSE" = "true" ]; then
        echo -e "Full Response:\n"
        print_json "$response"
        echo ""
    fi

    echo "$response"
}

# ============================================================================
# CLIENTS ENDPOINTS
# ============================================================================

print_section "CREATE CLIENT (valid)"
VALID_CLIENT_PAYLOAD=$(cat <<EOF
{"email":"$CLIENT_EMAIL","name":"Test Client","phone":"+1234567890","client_code":"CLCODE-123"}
EOF
)
CLIENT_CREATE=$(test_endpoint "POST" "/clients" "Create client with optional client_code" "$VALID_CLIENT_PAYLOAD")

print_section "CREATE CLIENT (invalid extra field)"
INVALID_CLIENT_PAYLOAD=$(cat <<EOF
{"email":"invalid-client-$TIMESTAMP@example.com","name":"Bad Client","phone":"+1999999999","company":"BadCo"}
EOF
)
CLIENT_CREATE_INVALID=$(test_endpoint "POST" "/clients" "Client with disallowed field 'company'" "$INVALID_CLIENT_PAYLOAD")

print_section "CREATE AFFILIATE (valid)"
VALID_AFFILIATE_PAYLOAD=$(cat <<EOF
{"email":"$AFFILIATE_EMAIL","name":"Test Affiliate","phone":"+1111111111","affiliate_code":"AFFCODE-987"}
EOF
)
AFFILIATE_CREATE=$(test_endpoint "POST" "/affiliates" "Create affiliate with optional affiliate_code" "$VALID_AFFILIATE_PAYLOAD")

print_section "CREATE AFFILIATE (invalid extra field)"
INVALID_AFFILIATE_PAYLOAD=$(cat <<EOF
{"email":"invalid-affiliate-$TIMESTAMP@example.com","name":"Bad Affiliate","phone":"+1222222222","commissionRate":0.2}
EOF
)
AFFILIATE_CREATE_INVALID=$(test_endpoint "POST" "/affiliates" "Affiliate with disallowed field 'commissionRate'" "$INVALID_AFFILIATE_PAYLOAD")

echo -e "\n${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✓ Test run complete${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}\n"

echo -e "${YELLOW}Responses:${NC}"
echo -e "  • Client (valid):"; print_json "$CLIENT_CREATE"; echo ""
echo -e "  • Client (invalid extras):"; print_json "$CLIENT_CREATE_INVALID"; echo ""
echo -e "  • Affiliate (valid):"; print_json "$AFFILIATE_CREATE"; echo ""
echo -e "  • Affiliate (invalid extras):"; print_json "$AFFILIATE_CREATE_INVALID"; echo ""
echo -e "${YELLOW}Base URL:${NC} ${CYAN}$BASE_URL${NC}\n"

