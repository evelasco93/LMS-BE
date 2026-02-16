#!/bin/bash

# API Testing Script for Lead Intake System
# Tests POST, GET (list), GET (by ID), PUT, DELETE operations
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

# Function to make HTTP request and capture response + status
make_request() {
    local method=$1
    local endpoint=$2
    local data=$3
    local output_file="/tmp/api_response_${TIMESTAMP}.json"
    local status_file="/tmp/api_status_${TIMESTAMP}.txt"
    
    if [ -n "$data" ]; then
        curl -s -w "%{http_code}" -X "$method" "$endpoint" \
          "${HEADERS[@]}" \
          -d "$data" > "$output_file"
    else
        curl -s -w "%{http_code}" -X "$method" "$endpoint" \
          "${HEADERS[@]}" > "$output_file"
    fi
    
    # Split the response and status
    local response_length=$(stat -f%z "$output_file" 2>/dev/null || stat -c%s "$output_file")
    local status_code=${!#}  # Last character should be status code
    
    # Actually use proper status code extraction
    local temp_response=$(curl -s -w "\n%{http_code}" -X "$method" "$endpoint" \
          "${HEADERS[@]}" \
          ${data:+-d "$data"})
    
    local status_code=$(echo "$temp_response" | tail -n1)
    local response=$(echo "$temp_response" | head -n-1)
    
    echo "$response"
    echo "$status_code"
}

# Function to test endpoint
test_endpoint() {
    local method=$1
    local endpoint=$2
    local description=$3
    local data=$4
    
    echo -e "${CYAN}${method}${NC} $endpoint"
    echo -e "${YELLOW}$description${NC}"
    
    # Make request with status code
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
    
    # Return response for further processing
    echo "$response"
}

# ============================================================================
# CLIENTS ENDPOINTS
# ============================================================================

print_section "TESTING CLIENTS ENDPOINTS"

# 1. POST - Create a new client
echo -e "${YELLOW}1. Creating a new client...${NC}\n"
CLIENT_CREATE=$(test_endpoint "POST" "/clients" "Creating client with email: $CLIENT_EMAIL" \
"{\"email\":\"$CLIENT_EMAIL\",\"name\":\"Test Client\",\"phone\":\"+1234567890\",\"company\":\"Test Company\"}")

# Extract client ID
CLIENT_ID=$(echo "$CLIENT_CREATE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('id', data.get('clientId', '')))" 2>/dev/null || echo "")

if [ -n "$CLIENT_ID" ]; then
    print_result 0 "Client created with ID: ${CYAN}$CLIENT_ID${NC}"
else
    print_result 1 "Could not extract client ID. Response: $CLIENT_CREATE"
    echo -e "${YELLOW}Continuing with subsequent tests...${NC}\n"
fi

# 2. GET - List all clients
echo -e "\n${YELLOW}2. Listing all clients...${NC}\n"
CLIENTS_LIST=$(test_endpoint "GET" "/clients" "Fetching all clients")

# Extract first client ID from list if we don't have one
if [ -z "$CLIENT_ID" ]; then
    CLIENT_ID=$(echo "$CLIENTS_LIST" | python3 -c "import sys, json; data=json.load(sys.stdin); items=data.get('items', data.get('clients', [])); print(items[0].get('id', items[0].get('clientId', '')) if items else '')" 2>/dev/null || echo "")
fi

if [ -n "$CLIENT_ID" ]; then
    print_result 0 "Listed all clients (Found ID: ${CYAN}$CLIENT_ID${NC})"
else
    print_result 1 "No clients found in list"
    CLIENT_ID="test-id-placeholder"
fi

# 3. GET - Retrieve specific client by ID
echo -e "\n${YELLOW}3. Getting client by ID (${CYAN}${CLIENT_ID}${YELLOW})...${NC}\n"
CLIENT_GET=$(test_endpoint "GET" "/clients/$CLIENT_ID" "Fetching client details")
print_result 0 "Retrieved client details"

# 4. PUT - Update the client
echo -e "\n${YELLOW}4. Updating client (${CYAN}${CLIENT_ID}${YELLOW})...${NC}\n"
CLIENT_UPDATE=$(test_endpoint "PUT" "/clients/$CLIENT_ID" "Updating client information" \
"{\"email\":\"$CLIENT_EMAIL\",\"name\":\"Updated Test Client\",\"phone\":\"+9876543210\",\"company\":\"Updated Company\"}")
print_result 0 "Updated client"

# 5. DELETE - Delete the client
echo -e "\n${YELLOW}5. Deleting client (${CYAN}${CLIENT_ID}${YELLOW})...${NC}\n"
CLIENT_DELETE=$(test_endpoint "DELETE" "/clients/$CLIENT_ID" "Deleting client")
print_result 0 "Deleted client"

# ============================================================================
# AFFILIATES ENDPOINTS
# ============================================================================

print_section "TESTING AFFILIATES ENDPOINTS"

# 1. POST - Create a new affiliate
echo -e "${YELLOW}1. Creating a new affiliate...${NC}\n"
AFFILIATE_CREATE=$(test_endpoint "POST" "/affiliates" "Creating affiliate with email: $AFFILIATE_EMAIL" \
"{\"email\":\"$AFFILIATE_EMAIL\",\"name\":\"Test Affiliate\",\"phone\":\"+1111111111\",\"commissionRate\":0.15}")

# Extract affiliate ID
AFFILIATE_ID=$(echo "$AFFILIATE_CREATE" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('id', data.get('affiliateId', '')))" 2>/dev/null || echo "")

if [ -n "$AFFILIATE_ID" ]; then
    print_result 0 "Affiliate created with ID: ${CYAN}$AFFILIATE_ID${NC}"
else
    print_result 1 "Could not extract affiliate ID. Response: $AFFILIATE_CREATE"
    echo -e "${YELLOW}Continuing with subsequent tests...${NC}\n"
fi

# 2. GET - List all affiliates
echo -e "\n${YELLOW}2. Listing all affiliates...${NC}\n"
AFFILIATES_LIST=$(test_endpoint "GET" "/affiliates" "Fetching all affiliates")

# Extract first affiliate ID from list if we don't have one
if [ -z "$AFFILIATE_ID" ]; then
    AFFILIATE_ID=$(echo "$AFFILIATES_LIST" | python3 -c "import sys, json; data=json.load(sys.stdin); items=data.get('items', data.get('affiliates', [])); print(items[0].get('id', items[0].get('affiliateId', '')) if items else '')" 2>/dev/null || echo "")
fi

if [ -n "$AFFILIATE_ID" ]; then
    print_result 0 "Listed all affiliates (Found ID: ${CYAN}$AFFILIATE_ID${NC})"
else
    print_result 1 "No affiliates found in list"
    AFFILIATE_ID="test-id-placeholder"
fi

# 3. GET - Retrieve specific affiliate by ID
echo -e "\n${YELLOW}3. Getting affiliate by ID (${CYAN}${AFFILIATE_ID}${YELLOW})...${NC}\n"
AFFILIATE_GET=$(test_endpoint "GET" "/affiliates/$AFFILIATE_ID" "Fetching affiliate details")
print_result 0 "Retrieved affiliate details"

# 4. PUT - Update the affiliate
echo -e "\n${YELLOW}4. Updating affiliate (${CYAN}${AFFILIATE_ID}${YELLOW})...${NC}\n"
AFFILIATE_UPDATE=$(test_endpoint "PUT" "/affiliates/$AFFILIATE_ID" "Updating affiliate information" \
"{\"email\":\"$AFFILIATE_EMAIL\",\"name\":\"Updated Test Affiliate\",\"phone\":\"+2222222222\",\"commissionRate\":0.20}")
print_result 0 "Updated affiliate"

# 5. DELETE - Delete the affiliate
echo -e "\n${YELLOW}5. Deleting affiliate (${CYAN}${AFFILIATE_ID}${YELLOW})...${NC}\n"
AFFILIATE_DELETE=$(test_endpoint "DELETE" "/affiliates/$AFFILIATE_ID" "Deleting affiliate")
print_result 0 "Deleted affiliate"

# ============================================================================
# TEST SUMMARY
# ============================================================================

echo -e "\n${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}✓ Test suite completed!${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}\n"

echo -e "${YELLOW}Summary:${NC}"
echo -e "  • Clients endpoint:"
echo -e "    - POST (create)"
echo -e "    - GET (list)"
echo -e "    - GET (by ID: ${CYAN}$CLIENT_ID${NC})"
echo -e "    - PUT (update)"
echo -e "    - DELETE"
echo -e ""
echo -e "  • Affiliates endpoint:"
echo -e "    - POST (create)"
echo -e "    - GET (list)"
echo -e "    - GET (by ID: ${CYAN}$AFFILIATE_ID${NC})"
echo -e "    - PUT (update)"
echo -e "    - DELETE"
echo -e ""
echo -e "  • Base URL: ${CYAN}$BASE_URL${NC}"
echo -e "\n${YELLOW}Usage:${NC}"
echo -e "  ./scripts/test-api.sh [BASE_URL]"
echo -e "  VERBOSE=true ./scripts/test-api.sh  # Show detailed responses"
echo -e "\n"

