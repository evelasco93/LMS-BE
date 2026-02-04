#!/bin/bash

# Test Script
# Tests the deployed API endpoints

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if API URL is provided
if [ -z "$1" ]; then
  echo -e "${RED}Error: API URL required${NC}"
  echo "Usage: ./scripts/test.sh <API_URL>"
  echo "Example: ./scripts/test.sh https://xxxxx.execute-api.us-east-1.amazonaws.com/dev"
  exit 1
fi

API_URL="$1"

# Remove trailing slash if present
API_URL="${API_URL%/}"

# Check if the URL already contains the path, if not, append it
if [[ "$API_URL" == */smashorbit/prototype/lead ]]; then
  ENDPOINT="$API_URL"
  BASE_URL="${API_URL%/smashorbit/prototype/lead}"
else
  BASE_URL="$API_URL"
  ENDPOINT="${API_URL}/smashorbit/prototype/lead"
fi

echo -e "${GREEN}Testing Lead Intake API${NC}"
echo "Endpoint: $ENDPOINT"
echo ""

# Test 2: Create Lead (POST)
echo -e "${YELLOW}Test 2: Create Lead (POST)${NC}"
RESPONSE=$(curl -s -X POST "$ENDPOINT" \
  -H "Content-Type: application/json" \
  -d '{
    "campaign_id": "67afb42529850",
      "campaign_key": "7zhSORO5WM002dg9",
      "marketing_source": "ADM036",
      "first_name": "Test",
      "last_name": "Lead",
      "phone": "5014708155",
      "email": "jeff.flores@smashorbit.com",
      "ip_address": "99.99.195.63",
      "message": "Yes I wass verbally sexually talk to by a guy who name was Lawrence from nyc..once he pick me up made me take his personal number to call him",
      "sub_id": "3845",
      "sub_channel": "",
      "test": "0",
      "address": "",
      "city": "NEWNAN",
      "state": "GA",
      "zip": "30263",
      "page_url": "https://lawsuitwinning.com/rideshare-assault1/",
      "referrer_url": "https://lawsuitwinning.com/rideshare-assault1/",
      "rideshare_abuse": "Yes",
      "rideshare_company": "Uber",
      "abuse_state": "GA",
      "gender": "Male",
      "assault_type": "Forced to perform sexual act",
      "has_ride_receipt": "Yes – I have it or can get it from the app/email (e.g., via Activity/Ride History)",
      "has_attorney": "No",
      "trusted_form_cert_id": "3c4af49b91b8c8e5f6e5933bd54fa7d2602abe04"
  }')

echo "$RESPONSE" | jq '.'
echo ""

# Check if successful
if echo "$RESPONSE" | jq -e '.result == true' > /dev/null; then
  echo -e "${GREEN}✓ Lead created successfully${NC}"
else
  echo -e "${RED}✗ Failed to create lead${NC}"
fi
echo ""
echo ""

# Test 3: Get All Leads (GET)
echo -e "${YELLOW}Test 3: Get All Leads (GET)${NC}"
RESPONSE=$(curl -s "$ENDPOINT")

echo "$RESPONSE" | jq '.'
echo ""

# Check if successful
if echo "$RESPONSE" | jq -e '.success == true' > /dev/null; then
  LEAD_COUNT=$(echo "$RESPONSE" | jq -r '.count')
  echo -e "${GREEN}✓ Retrieved $LEAD_COUNT leads successfully${NC}"
else
  echo -e "${RED}✗ Failed to retrieve leads${NC}"
fi

echo ""
echo -e "${GREEN}Testing complete!${NC}"
