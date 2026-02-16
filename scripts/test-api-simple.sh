#!/bin/bash

# API Testing Script for Lead Intake System
# Tests POST, GET (list), GET (by ID), PUT, DELETE operations
# Usage: ./scripts/test-api-simple.sh [BASE_URL]
# Example: ./scripts/test-api-simple.sh https://knc901awc8.execute-api.us-east-1.amazonaws.com/dev/v2

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
GRAY='\033[0;37m'
NC='\033[0m'

BASE_URL="${1:-https://knc901awc8.execute-api.us-east-1.amazonaws.com/dev/v2}"
TIMESTAMP=$(date +%s%N)

# Unique test data
CLIENT_EMAIL="client-${TIMESTAMP}@test.com"
AFFILIATE_EMAIL="affiliate-${TIMESTAMP}@test.com"

echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  API Test Suite - CRUD Operations${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "Base URL: ${CYAN}$BASE_URL${NC}"
echo -e "Test Run: ${CYAN}$TIMESTAMP${NC}\n"

# Track created IDs
CLIENT_ID=""
AFFILIATE_ID=""

# ============================================================================
# CLIENTS TESTS
# ============================================================================

echo -e "\n${BLUE}┌─ CLIENTS ENDPOINT ─────────────────────────────────────┐${NC}\n"

# POST - Create
echo -e "${YELLOW}[1] POST /clients${NC} - Create new client"
echo -e "${GRAY}Email: $CLIENT_EMAIL${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/clients" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\":\"$CLIENT_EMAIL\",
    \"name\":\"Test Client\",
    \"phone\":\"+1234567890\",
    \"company\":\"Test Company\"
  }")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

echo -e "Response (HTTP $HTTP_CODE):"
echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"

# Try to extract ID
CLIENT_ID=$(echo "$BODY" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('id', data.get('clientId', '')))" 2>/dev/null || echo "")
echo ""

# GET - List all
echo -e "${YELLOW}[2] GET /clients${NC} - List all clients"
RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/clients" \
  -H "Content-Type: application/json")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

echo -e "Response (HTTP $HTTP_CODE):"
echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"

# Extract ID from list if not from POST
if [ -z "$CLIENT_ID" ]; then
  CLIENT_ID=$(echo "$BODY" | python3 -c "import sys, json; data=json.load(sys.stdin); items=data.get('items', data.get('clients', [])); print(items[0].get('id', items[0].get('clientId', '')) if items else '')" 2>/dev/null || echo "")
fi

if [ -n "$CLIENT_ID" ]; then
  echo -e "${GREEN}✓ Extracted Client ID: $CLIENT_ID${NC}"
else
  echo -e "${RED}✗ Could not extract Client ID${NC}"
  CLIENT_ID="placeholder-id"
fi
echo ""

# GET - Get by ID
echo -e "${YELLOW}[3] GET /clients/{id}${NC} - Get client by ID"
echo -e "${GRAY}ID: $CLIENT_ID${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/clients/$CLIENT_ID" \
  -H "Content-Type: application/json")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

echo -e "Response (HTTP $HTTP_CODE):"
echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
echo ""

# PUT - Update
echo -e "${YELLOW}[4] PUT /clients/{id}${NC} - Update client"
echo -e "${GRAY}ID: $CLIENT_ID${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" -X PUT "$BASE_URL/clients/$CLIENT_ID" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\":\"$CLIENT_EMAIL\",
    \"name\":\"Updated Client\",
    \"phone\":\"+9876543210\",
    \"company\":\"Updated Company\"
  }")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

echo -e "Response (HTTP $HTTP_CODE):"
echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
echo ""

# DELETE - Delete
echo -e "${YELLOW}[5] DELETE /clients/{id}${NC} - Delete client"
echo -e "${GRAY}ID: $CLIENT_ID${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" -X DELETE "$BASE_URL/clients/$CLIENT_ID" \
  -H "Content-Type: application/json")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

echo -e "Response (HTTP $HTTP_CODE):"
echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
echo ""

# ============================================================================
# AFFILIATES TESTS
# ============================================================================

echo -e "\n${BLUE}┌─ AFFILIATES ENDPOINT ──────────────────────────────────┐${NC}\n"

# POST - Create
echo -e "${YELLOW}[1] POST /affiliates${NC} - Create new affiliate"
echo -e "${GRAY}Email: $AFFILIATE_EMAIL${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/affiliates" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\":\"$AFFILIATE_EMAIL\",
    \"name\":\"Test Affiliate\",
    \"phone\":\"+1111111111\",
    \"commissionRate\":0.15
  }")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

echo -e "Response (HTTP $HTTP_CODE):"
echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"

# Try to extract ID
AFFILIATE_ID=$(echo "$BODY" | python3 -c "import sys, json; data=json.load(sys.stdin); print(data.get('id', data.get('affiliateId', '')))" 2>/dev/null || echo "")
echo ""

# GET - List all
echo -e "${YELLOW}[2] GET /affiliates${NC} - List all affiliates"
RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/affiliates" \
  -H "Content-Type: application/json")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

echo -e "Response (HTTP $HTTP_CODE):"
echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"

# Extract ID from list if not from POST
if [ -z "$AFFILIATE_ID" ]; then
  AFFILIATE_ID=$(echo "$BODY" | python3 -c "import sys, json; data=json.load(sys.stdin); items=data.get('items', data.get('affiliates', [])); print(items[0].get('id', items[0].get('affiliateId', '')) if items else '')" 2>/dev/null || echo "")
fi

if [ -n "$AFFILIATE_ID" ]; then
  echo -e "${GREEN}✓ Extracted Affiliate ID: $AFFILIATE_ID${NC}"
else
  echo -e "${RED}✗ Could not extract Affiliate ID${NC}"
  AFFILIATE_ID="placeholder-id"
fi
echo ""

# GET - Get by ID
echo -e "${YELLOW}[3] GET /affiliates/{id}${NC} - Get affiliate by ID"
echo -e "${GRAY}ID: $AFFILIATE_ID${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "$BASE_URL/affiliates/$AFFILIATE_ID" \
  -H "Content-Type: application/json")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

echo -e "Response (HTTP $HTTP_CODE):"
echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
echo ""

# PUT - Update
echo -e "${YELLOW}[4] PUT /affiliates/{id}${NC} - Update affiliate"
echo -e "${GRAY}ID: $AFFILIATE_ID${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" -X PUT "$BASE_URL/affiliates/$AFFILIATE_ID" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\":\"$AFFILIATE_EMAIL\",
    \"name\":\"Updated Affiliate\",
    \"phone\":\"+2222222222\",
    \"commissionRate\":0.20
  }")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

echo -e "Response (HTTP $HTTP_CODE):"
echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
echo ""

# DELETE - Delete
echo -e "${YELLOW}[5] DELETE /affiliates/{id}${NC} - Delete affiliate"
echo -e "${GRAY}ID: $AFFILIATE_ID${NC}"
RESPONSE=$(curl -s -w "\n%{http_code}" -X DELETE "$BASE_URL/affiliates/$AFFILIATE_ID" \
  -H "Content-Type: application/json")

HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | head -n-1)

echo -e "Response (HTTP $HTTP_CODE):"
echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
echo ""

# ============================================================================
# SUMMARY
# ============================================================================

echo -e "\n${BLUE}════════════════════════════════════════════════════════════${NC}"
echo -e "${CYAN}Test Summary${NC}"
echo -e "${BLUE}════════════════════════════════════════════════════════════${NC}\n"

echo -e "${YELLOW}Endpoints Tested:${NC}"
echo -e "  • Clients:"
echo -e "    ✓ POST   /clients"
echo -e "    ✓ GET    /clients"
echo -e "    ✓ GET    /clients/{id}"
echo -e "    ✓ PUT    /clients/{id}"
echo -e "    ✓ DELETE /clients/{id}"
echo -e ""
echo -e "  • Affiliates:"
echo -e "    ✓ POST   /affiliates"
echo -e "    ✓ GET    /affiliates"
echo -e "    ✓ GET    /affiliates/{id}"
echo -e "    ✓ PUT    /affiliates/{id}"
echo -e "    ✓ DELETE /affiliates/{id}"
echo ""

echo -e "${YELLOW}IDs Extracted:${NC}"
echo -e "  Client ID: ${CYAN}$CLIENT_ID${NC}"
echo -e "  Affiliate ID: ${CYAN}$AFFILIATE_ID${NC}"
echo ""

echo -e "${YELLOW}Usage:${NC}"
echo -e "  ${CYAN}./scripts/test-api-simple.sh [BASE_URL]${NC}"
echo -e "  Example: ${CYAN}./scripts/test-api-simple.sh https://knc901awc8.execute-api.us-east-1.amazonaws.com/dev/v2${NC}"
echo ""
