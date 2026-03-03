#!/bin/bash

# Interactive lead sender for LMS API.
# Prompts for campaign_id, campaign_key, and whether to send TEST or LIVE.
# Usage: ./scripts/send-lead.sh [BASE_URL]
# Example: ./scripts/send-lead.sh https://eg0tg7ncg5.execute-api.us-east-1.amazonaws.com/dev/v2

set -euo pipefail

DEFAULT_BASE_URL="${1:-https://eg0tg7ncg5.execute-api.us-east-1.amazonaws.com/dev/v2}"
BASE_URL="$DEFAULT_BASE_URL"
HEADERS=(-H "Content-Type: application/json")

print_json() {
    echo "$1" | python3 -m json.tool 2>/dev/null || echo "$1"
}

prompt() {
    local label="$1"
    local default_value="$2"
    local value
    read -r -p "$label [$default_value]: " value
    if [ -z "$value" ]; then
        echo "$default_value"
    else
        echo "$value"
    fi
}

echo "Lead Intake Helper"
echo "-------------------"
read -r -p "Base URL [$BASE_URL]: " input_base
if [ -n "$input_base" ]; then
    BASE_URL="$input_base"
fi

echo ""  # spacing
CAMPAIGN_ID=""
while [ -z "$CAMPAIGN_ID" ]; do
    read -r -p "Campaign ID (required): " CAMPAIGN_ID
    if [ -z "$CAMPAIGN_ID" ]; then
        echo "Campaign ID cannot be empty."
    fi
done

CAMPAIGN_KEY=""
while [ -z "$CAMPAIGN_KEY" ]; do
    read -r -p "Campaign Key (required): " CAMPAIGN_KEY
    if [ -z "$CAMPAIGN_KEY" ]; then
        echo "Campaign Key cannot be empty."
    fi
done

LEAD_TYPE=$(prompt "Lead type (test/live)" "test")
LEAD_TYPE=$(echo "$LEAD_TYPE" | tr 'A-Z' 'a-z')

case "$LEAD_TYPE" in
    test)
        ENDPOINT="/leads/test"
        ;;
    live)
        ENDPOINT="/leads"
        ;;
    *)
        echo "Invalid lead type. Choose 'test' or 'live'."
        exit 1
        ;;
esac

default_payload='{"email":"lead@example.com","name":"Sample Lead"}'
read -r -p "Payload JSON [$default_payload]: " INPUT_PAYLOAD
if [ -z "$INPUT_PAYLOAD" ]; then
    PAYLOAD_JSON="$default_payload"
else
    PAYLOAD_JSON="$INPUT_PAYLOAD"
fi

REQUEST_BODY=$(cat <<EOF
{"campaign_id":"$CAMPAIGN_ID","campaign_key":"$CAMPAIGN_KEY","payload":$PAYLOAD_JSON}
EOF
)

printf "\nSending %s lead to %s%s\n" "$LEAD_TYPE" "$BASE_URL" "$ENDPOINT"

OUTPUT=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL$ENDPOINT" \
    "${HEADERS[@]}" \
    -d "$REQUEST_BODY")

HTTP_STATUS=$(echo "$OUTPUT" | tail -n1)
RESPONSE=$(echo "$OUTPUT" | head -n-1)

echo "HTTP Status: $HTTP_STATUS"
print_json "$RESPONSE"

if [ "$HTTP_STATUS" -ge 200 ] && [ "$HTTP_STATUS" -lt 300 ]; then
    echo "Result: success"
else
    echo "Result: error"
fi
