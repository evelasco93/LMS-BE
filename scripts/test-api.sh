#!/bin/bash

# Interactive API smoke test suite.
# Usage: ./scripts/test-api.sh
# Or non-interactive: ./scripts/test-api.sh --suite=auth|clients|affiliates|campaigns|all

set -euo pipefail

# ─── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'

# ─── Dotenv loader ────────────────────────────────────────────────────────────
load_dotenv_file() {
    local dotenv_path="$1"
    [ -f "$dotenv_path" ] || return 0
    while IFS= read -r raw_line || [ -n "$raw_line" ]; do
        local line
        line=$(echo "$raw_line" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')
        [ -z "$line" ] && continue
        [[ "$line" =~ ^# ]] && continue
        [[ "$line" != *=* ]] && continue
        local key="${line%%=*}"
        local value="${line#*=}"
        key=$(echo "$key" | sed -E 's/[[:space:]]+$//')
        value=$(echo "$value" | sed -E 's/^[[:space:]]+//')
        if [[ "$value" =~ ^\".*\"$ ]]; then value="${value:1:${#value}-2}"
        elif [[ "$value" =~ ^\'.*\'$ ]]; then value="${value:1:${#value}-2}"
        fi
        export "$key=$value"
    done < "$dotenv_path"
}
load_dotenv_file ".frontend-auth.env"

# ─── Configuration ────────────────────────────────────────────────────────────
DEFAULT_INTERNAL_API_BASE_URL="https://zf7o4xenif.execute-api.us-east-1.amazonaws.com/dev/"
DEFAULT_EXTERNAL_LEADS_API_BASE_URL="https://9mfoe2pmqb.execute-api.us-east-1.amazonaws.com/dev/"

INTERNAL_API_BASE_URL="${INTERNAL_API_BASE_URL:-${NEXT_INTERNAL_API_BASE_URL:-$DEFAULT_INTERNAL_API_BASE_URL}}"
EXTERNAL_LEADS_API_BASE_URL="${EXTERNAL_LEADS_API_BASE_URL:-${NEXT_EXTERNAL_LEADS_API_BASE_URL:-$DEFAULT_EXTERNAL_LEADS_API_BASE_URL}}"

VERBOSE="${VERBOSE:-false}"
AWS_REGION="${AWS_REGION:-us-east-1}"
TIMESTAMP=$(date +%s%N)
TEST_FAILURES=0

COGNITO_TEST_USERNAME="${COGNITO_TEST_USERNAME:-${TEST_COGNITO_USERNAME:-edgar@summitedgelegal.com}}"
COGNITO_TEST_PASSWORD="${COGNITO_TEST_PASSWORD:-${TEST_COGNITO_PASSWORD:-Test123!}}"

# Bearer token used for all internal API calls (populated by auth test or env)
INTERNAL_API_BEARER_TOKEN="${INTERNAL_API_BEARER_TOKEN:-}"

# Optional tables for cleanup
CAMPAIGNS_TABLE_NAME="${CAMPAIGNS_TABLE_NAME:-}"
CLIENTS_TABLE_NAME="${CLIENTS_TABLE_NAME:-}"
AFFILIATES_TABLE_NAME="${AFFILIATES_TABLE_NAME:-}"
LEADS_TABLE_NAME="${LEADS_TABLE_NAME:-}"

# Shared state between suites (populated when running "all")
CLIENT_ID=""
AFFILIATE_ID=""
CAMPAIGN_ID=""
CAMPAIGN_KEY=""
CLIENT_ID_2=""
AFFILIATE_ID_2=""
CAMPAIGN_ID_2=""
CAMPAIGN_KEY_2=""

# Test data
CLIENT_EMAIL="jason@summitedgelegal.com"
AFFILIATE_EMAIL="acme@email.com"
CAMPAIGN_NAME="Rideshare"
CAMPAIGN_NAME_2="Sex Abuse"
CLIENT_EMAIL_2="jeff@summitedgelegal.com"
AFFILIATE_EMAIL_2="afiliatetest@email.com"

# ─── Normalize URLs ───────────────────────────────────────────────────────────
normalize_url() { echo "$1" | sed -E 's#/*$##'; }
INTERNAL_API_BASE_URL="$(normalize_url "$INTERNAL_API_BASE_URL")"
EXTERNAL_LEADS_API_BASE_URL="$(normalize_url "$EXTERNAL_LEADS_API_BASE_URL")"
if [[ ! "$INTERNAL_API_BASE_URL" =~ /v2$ ]]; then
    INTERNAL_API_BASE_URL="${INTERNAL_API_BASE_URL}/v2"
fi

# ─── Headers (rebuilt whenever token changes) ─────────────────────────────────
build_internal_headers() {
    INTERNAL_HEADERS=(-H "Content-Type: application/json")
    if [ -n "$INTERNAL_API_BEARER_TOKEN" ]; then
        INTERNAL_HEADERS+=(-H "Authorization: Bearer $INTERNAL_API_BEARER_TOKEN")
    fi
}
EXTERNAL_HEADERS=(-H "Content-Type: application/json")
build_internal_headers

# ─── Helpers ──────────────────────────────────────────────────────────────────
LAST_HTTP_STATUS=""

print_section() {
    echo -e "\n${BLUE}──────────────────────────────────────────────────${NC}"
    echo -e "${YELLOW}→ $1${NC}"
    echo -e "${BLUE}──────────────────────────────────────────────────${NC}\n"
}

print_result() {
    if [ "$1" -eq 0 ]; then echo -e "  ${GREEN}✓ $2${NC}"
    else echo -e "  ${RED}✗ $2${NC}"; TEST_FAILURES=$((TEST_FAILURES + 1)); fi
}

extract_json_value() {
    JSON_IN="$1" JSON_PATH="$2" python3 - <<'PY'
import json, os
raw = os.environ.get("JSON_IN", "")
path = os.environ.get("JSON_PATH", "")
def dig(obj, keys):
    cur = obj
    for k in keys:
        if isinstance(cur, dict): cur = cur.get(k)
        else: return ""
    return cur if cur is not None else ""
try:
    data = json.loads(raw)
    value = dig(data, path.split('.')) if path else ""
    print(value)
except Exception:
    print("")
PY
}

print_json() { echo "$1" | python3 -m json.tool 2>/dev/null || echo "$1"; }

test_endpoint() {
    local method="$1"
    local endpoint="$2"
    local description="$3"
    local data="${4:-}"
    local target_api="${5:-internal}"

    local base_url
    local headers=()
    if [ "$target_api" = "external" ]; then
        base_url="$EXTERNAL_LEADS_API_BASE_URL"
        headers=("${EXTERNAL_HEADERS[@]}")
    else
        base_url="$INTERNAL_API_BASE_URL"
        build_internal_headers
        headers=("${INTERNAL_HEADERS[@]}")
    fi

    echo -e "  ${CYAN}${method}${NC} ${endpoint} (${target_api})" >&2
    echo -e "  ${YELLOW}${description}${NC}" >&2

    local output
    output=$(curl -s -w "\n%{http_code}" -X "$method" "$base_url$endpoint" \
        "${headers[@]}" \
        ${data:+-d "$data"})

    local http_status response
    http_status=$(echo "$output" | tail -n1)
    response=$(echo "$output" | head -n-1)
    LAST_HTTP_STATUS="$http_status"

    echo -e "  HTTP ${CYAN}$http_status${NC}\n" >&2
    if [ "$VERBOSE" = "true" ] || { [ "$http_status" -ge 400 ] 2>/dev/null && [ "${SHOW_ERROR_BODY:-true}" = "true" ]; }; then
        print_json "$response" >&2
        echo "" >&2
    fi
    echo "$response"
}

purge_table() {
    local table_name="$1"
    if [ -z "$table_name" ]; then echo -e "  ${YELLOW}Skipping purge (table not set)${NC}"; return; fi
    if ! command -v aws >/dev/null 2>&1; then echo -e "  ${RED}aws CLI not found; cannot purge ${table_name}${NC}"; return; fi
    echo -e "  ${CYAN}Purging: ${table_name}${NC}"
    local last_evaluated_key=""
    while :; do
        local page
        if [ -n "$last_evaluated_key" ]; then
            page=$(aws dynamodb scan --table-name "$table_name" --region "$AWS_REGION" \
                --projection-expression "id" --exclusive-start-key "$last_evaluated_key")
        else
            page=$(aws dynamodb scan --table-name "$table_name" --region "$AWS_REGION" \
                --projection-expression "id")
        fi
        local ids
        ids=$(echo "$page" | python3 - <<'PY'
import json, sys
data=json.load(sys.stdin)
items=data.get("Items",[])
ids=[item["id"]["S"] for item in items if "id" in item and "S" in item["id"]]
print("\n".join(ids))
print("__LEK__"+json.dumps(data.get("LastEvaluatedKey",{})))
PY
)
        local lek_line
        lek_line=$(echo "$ids" | grep "__LEK__")
        last_evaluated_key=$(echo "$lek_line" | sed 's/__LEK__//')
        for id in $(echo "$ids" | grep -v "__LEK__"); do
            aws dynamodb delete-item --table-name "$table_name" --region "$AWS_REGION" \
                --key "{\"id\":{\"S\":\"$id\"}}" >/dev/null
        done
        if [ "$last_evaluated_key" = "{}" ] || [ -z "$last_evaluated_key" ]; then break; fi
    done
}

# ═══════════════════════════════════════════════════════════════════════════════
# SUITE: AUTH
# Tests the custom login endpoint, confirms the token grants access, and
# confirms that requests without a token are rejected.
# ═══════════════════════════════════════════════════════════════════════════════
run_auth_tests() {
    echo -e "\n${MAGENTA}╔════════════════════════════════════════════════╗${NC}"
    echo -e "${MAGENTA}║  AUTH SUITE                                    ║${NC}"
    echo -e "${MAGENTA}╚════════════════════════════════════════════════╝${NC}"

    # ── 1. Login as primary admin user ──────────────────────────────────────
    print_section "LOGIN: POST /v2/auth/login (edgar@summitedgelegal.com)"
    local login_body login_status
    local login_resp
    login_resp=$(curl -s -w "\n%{http_code}" -X POST \
        "$INTERNAL_API_BASE_URL/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"$COGNITO_TEST_USERNAME\",\"password\":\"$COGNITO_TEST_PASSWORD\"}")
    login_status=$(echo "$login_resp" | tail -n1)
    login_body=$(echo "$login_resp" | head -n-1)

    echo -e "  HTTP ${CYAN}${login_status}${NC}"
    if [ "$VERBOSE" = "true" ] || [ "$login_status" -ge 400 ] 2>/dev/null; then
        print_json "$login_body"
    fi

    if [ "$login_status" -eq 200 ] 2>/dev/null; then
        print_result 0 "Login returned HTTP 200"
    else
        print_result 1 "Login failed (HTTP $login_status)"
        echo -e "  ${RED}Response: $login_body${NC}"
        if [ "$login_status" -eq 403 ] 2>/dev/null; then
            echo -e "  ${YELLOW}HTTP 403 'Missing Authentication Token' means API Gateway has no route"
            echo -e "  for /v2/auth/login — the CDK auth Lambda changes haven't been deployed yet."
            echo -e "  Run:  source ./scripts/env-dev.sh && cdk deploy${NC}"
        fi
        echo -e "  ${RED}Cannot continue auth suite without a valid token.${NC}"
        return 1
    fi

    local fetched_token fetched_id_token fetched_refresh
    fetched_token=$(extract_json_value "$login_body" "data.access_token")
    fetched_id_token=$(extract_json_value "$login_body" "data.id_token")
    fetched_refresh=$(extract_json_value "$login_body" "data.refresh_token")

    if [ -n "$fetched_token" ]; then
        print_result 0 "access_token present in login response"
    else
        print_result 1 "access_token missing from login response"
        return 1
    fi

    if [ -n "$fetched_id_token" ]; then
        print_result 0 "id_token present in login response"
    else
        print_result 1 "id_token missing from login response"
    fi

    if [ -n "$fetched_refresh" ]; then
        print_result 0 "refresh_token present in login response"
    else
        print_result 1 "refresh_token missing from login response"
    fi

    # CognitoUserPoolsAuthorizer validates ID tokens — use id_token for API calls
    # Store globally so other suites can use it
    INTERNAL_API_BEARER_TOKEN="$fetched_id_token"
    fetched_token="$fetched_id_token"
    build_internal_headers

    # ── 2. Promote edgar to admin (idempotent — safe to run every time) ──────
    print_section "SELF-PROMOTE: PUT /v2/users/edgar → role: admin"
    local encoded_username
    encoded_username=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$COGNITO_TEST_USERNAME', safe=''))")
    local promote_resp promote_status promote_body
    promote_resp=$(curl -s -w "\n%{http_code}" -X PUT \
        "$INTERNAL_API_BASE_URL/users/$encoded_username" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $fetched_token" \
        -d '{"role":"admin"}')
    promote_status=$(echo "$promote_resp" | tail -n1)
    promote_body=$(echo "$promote_resp" | head -n-1)
    echo -e "  HTTP ${CYAN}${promote_status}${NC}"
    if [ "$promote_status" -ge 200 ] && [ "$promote_status" -lt 300 ] 2>/dev/null; then
        print_result 0 "edgar set to admin role (HTTP $promote_status)"
    else
        # A 403 here means edgar wasn't in the admin group yet — expected on first
        # run before any admin exists. Print the body and continue.
        echo -e "  ${YELLOW}Note: PUT /users/$encoded_username → HTTP $promote_status${NC}"
        echo -e "  ${YELLOW}(If 403, edgar is not yet in the admin group — run option 6 Setup first,"
        echo -e "   then use the AWS console or create-cognito-user.sh to add edgar to 'admin' group.)${NC}"
        if [ "$VERBOSE" = "true" ]; then print_json "$promote_body"; fi
        print_result 1 "edgar admin promotion failed (HTTP $promote_status)"
    fi

    # Re-login to get a fresh token that includes the updated group claim
    print_section "RE-LOGIN: fetch fresh token with updated group claims"
    local relogin_resp relogin_status relogin_body
    relogin_resp=$(curl -s -w "\n%{http_code}" -X POST \
        "$INTERNAL_API_BASE_URL/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"$COGNITO_TEST_USERNAME\",\"password\":\"$COGNITO_TEST_PASSWORD\"}")
    relogin_status=$(echo "$relogin_resp" | tail -n1)
    relogin_body=$(echo "$relogin_resp" | head -n-1)
    if [ "$relogin_status" -eq 200 ] 2>/dev/null; then
        fetched_token=$(extract_json_value "$relogin_body" "data.id_token")
        fetched_refresh=$(extract_json_value "$relogin_body" "data.refresh_token")
        INTERNAL_API_BEARER_TOKEN="$fetched_token"
        build_internal_headers
        print_result 0 "Re-login successful — token includes updated group"
    else
        print_result 1 "Re-login failed (HTTP $relogin_status)"
    fi

    # ── 3. Token refresh ────────────────────────────────────────────────────
    if [ -n "$fetched_refresh" ]; then
        print_section "REFRESH: POST /v2/auth/refresh"
        local refresh_resp refresh_status refresh_body
        refresh_resp=$(curl -s -w "\n%{http_code}" -X POST \
            "$INTERNAL_API_BASE_URL/auth/refresh" \
            -H "Content-Type: application/json" \
            -d "{\"refresh_token\":\"$fetched_refresh\"}")
        refresh_status=$(echo "$refresh_resp" | tail -n1)
        refresh_body=$(echo "$refresh_resp" | head -n-1)

        echo -e "  HTTP ${CYAN}${refresh_status}${NC}"
        if [ "$refresh_status" -eq 200 ] 2>/dev/null; then
            print_result 0 "Token refresh returned HTTP 200"
            if [ -n "$(extract_json_value "$refresh_body" "data.access_token")" ]; then
                print_result 0 "Refreshed access_token present"
            else
                print_result 1 "Refreshed access_token missing"
            fi
            if [ -n "$(extract_json_value "$refresh_body" "data.id_token")" ]; then
                print_result 0 "Refreshed id_token present"
            else
                print_result 1 "Refreshed id_token missing"
            fi
        else
            print_result 1 "Token refresh failed (HTTP $refresh_status)"
        fi
    fi

    # ── 4. Create a temporary test user ─────────────────────────────────────
    local test_user_email="auth-test-user-${TIMESTAMP}@lms-test.local"
    local test_user_pass="TmpUser1!${TIMESTAMP: -4}"
    print_section "CREATE TEMP USER: POST /v2/users ($test_user_email)"
    local create_user_resp create_user_status create_user_body
    create_user_resp=$(curl -s -w "\n%{http_code}" -X POST \
        "$INTERNAL_API_BASE_URL/users" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $fetched_token" \
        -d "{\"email\":\"$test_user_email\",\"password\":\"$test_user_pass\",\"role\":\"staff\"}")
    create_user_status=$(echo "$create_user_resp" | tail -n1)
    create_user_body=$(echo "$create_user_resp" | head -n-1)
    echo -e "  HTTP ${CYAN}${create_user_status}${NC}"
    if [ "$VERBOSE" = "true" ]; then print_json "$create_user_body"; fi
    if [ "$create_user_status" -eq 201 ] || [ "$create_user_status" -eq 200 ] 2>/dev/null; then
        print_result 0 "Temp user created as staff (HTTP $create_user_status)"
    else
        print_result 1 "Failed to create temp user (HTTP $create_user_status)"
        print_json "$create_user_body"
    fi

    # ── 5. Login as the new test user ────────────────────────────────────────
    print_section "LOGIN AS TEMP USER: $test_user_email"
    local temp_login_resp temp_login_status temp_login_body temp_token
    temp_login_resp=$(curl -s -w "\n%{http_code}" -X POST \
        "$INTERNAL_API_BASE_URL/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"$test_user_email\",\"password\":\"$test_user_pass\"}")
    temp_login_status=$(echo "$temp_login_resp" | tail -n1)
    temp_login_body=$(echo "$temp_login_resp" | head -n-1)
    echo -e "  HTTP ${CYAN}${temp_login_status}${NC}"
    if [ "$temp_login_status" -eq 200 ] 2>/dev/null; then
        temp_token=$(extract_json_value "$temp_login_body" "data.id_token")
        print_result 0 "Temp user login succeeded"
    else
        temp_token=""
        print_result 1 "Temp user login failed (HTTP $temp_login_status)"
        if [ "$VERBOSE" = "true" ]; then print_json "$temp_login_body"; fi
    fi

    # ── 6. Temp user can call GET /v2/leads ──────────────────────────────────
    print_section "TEMP USER ACCESS: GET /v2/leads with staff token → expect 2xx"
    if [ -n "$temp_token" ]; then
        local temp_leads_resp temp_leads_status
        temp_leads_resp=$(curl -s -w "\n%{http_code}" -X GET \
            "$INTERNAL_API_BASE_URL/leads" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer $temp_token")
        temp_leads_status=$(echo "$temp_leads_resp" | tail -n1)
        echo -e "  HTTP ${CYAN}${temp_leads_status}${NC}"
        if [ "$temp_leads_status" -ge 200 ] && [ "$temp_leads_status" -lt 300 ] 2>/dev/null; then
            print_result 0 "Staff user can access GET /leads (HTTP $temp_leads_status)"
        else
            print_result 1 "Staff user denied GET /leads (HTTP $temp_leads_status)"
        fi
    else
        print_result 1 "Skipped — no token for temp user"
    fi

    # ── 7. Update temp user role to admin ────────────────────────────────────
    local encoded_test_user
    encoded_test_user=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$test_user_email', safe=''))")
    print_section "UPDATE TEMP USER ROLE: PUT /v2/users/$test_user_email → role: admin"
    local update_user_resp update_user_status update_user_body
    update_user_resp=$(curl -s -w "\n%{http_code}" -X PUT \
        "$INTERNAL_API_BASE_URL/users/$encoded_test_user" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $fetched_token" \
        -d '{"role":"admin"}')
    update_user_status=$(echo "$update_user_resp" | tail -n1)
    update_user_body=$(echo "$update_user_resp" | head -n-1)
    echo -e "  HTTP ${CYAN}${update_user_status}${NC}"
    if [ "$VERBOSE" = "true" ]; then print_json "$update_user_body"; fi
    if [ "$update_user_status" -ge 200 ] && [ "$update_user_status" -lt 300 ] 2>/dev/null; then
        local updated_role
        updated_role=$(extract_json_value "$update_user_body" "data.role")
        print_result 0 "Temp user role updated to admin (role=$updated_role, HTTP $update_user_status)"
    else
        print_result 1 "Temp user role update failed (HTTP $update_user_status)"
    fi

    # ── 8. Delete temp user ──────────────────────────────────────────────────
    print_section "DELETE TEMP USER: DELETE /v2/users/$test_user_email"
    local delete_user_resp delete_user_status
    delete_user_resp=$(curl -s -w "\n%{http_code}" -X DELETE \
        "$INTERNAL_API_BASE_URL/users/$encoded_test_user" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $fetched_token")
    delete_user_status=$(echo "$delete_user_resp" | tail -n1)
    echo -e "  HTTP ${CYAN}${delete_user_status}${NC}"
    if [ "$delete_user_status" -ge 200 ] && [ "$delete_user_status" -lt 300 ] 2>/dev/null; then
        print_result 0 "Temp user deleted (HTTP $delete_user_status)"
    else
        print_result 1 "Temp user deletion failed (HTTP $delete_user_status)"
    fi

    # ── 9. Valid token → access granted ─────────────────────────────────────
    print_section "AUTHENTICATED: GET /v2/leads with valid token → expect 2xx"
    local auth_resp auth_status
    auth_resp=$(curl -s -w "\n%{http_code}" -X GET \
        "$INTERNAL_API_BASE_URL/leads" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $fetched_token")
    auth_status=$(echo "$auth_resp" | tail -n1)

    echo -e "  HTTP ${CYAN}${auth_status}${NC}"
    if [ "$auth_status" -ge 200 ] && [ "$auth_status" -lt 300 ] 2>/dev/null; then
        print_result 0 "GET /leads with valid token → HTTP $auth_status (access granted)"
    else
        print_result 1 "GET /leads with valid token → HTTP $auth_status (expected 2xx)"
    fi

    # ── 10. No token → 401 ──────────────────────────────────────────────────
    print_section "UNAUTHENTICATED: GET /v2/leads with no token → expect 401"
    local noauth_resp noauth_status noauth_body
    noauth_resp=$(curl -s -w "\n%{http_code}" -X GET \
        "$INTERNAL_API_BASE_URL/leads" \
        -H "Content-Type: application/json")
    noauth_status=$(echo "$noauth_resp" | tail -n1)
    noauth_body=$(echo "$noauth_resp" | head -n-1)

    echo -e "  HTTP ${CYAN}${noauth_status}${NC}"
    echo -e "  Response: $(echo "$noauth_body" | head -c 200)"
    if [ "$noauth_status" -eq 401 ] 2>/dev/null; then
        print_result 0 "GET /leads without token → HTTP 401 (blocked as expected)"
    else
        print_result 1 "GET /leads without token → HTTP $noauth_status (expected 401)"
    fi

    # ── 11. Invalid/garbage token → 401 ─────────────────────────────────────
    print_section "INVALID TOKEN: GET /v2/leads with bad token → expect 401"
    local badtok_resp badtok_status
    badtok_resp=$(curl -s -w "\n%{http_code}" -X GET \
        "$INTERNAL_API_BASE_URL/leads" \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer not.a.real.token")
    badtok_status=$(echo "$badtok_resp" | tail -n1)

    echo -e "  HTTP ${CYAN}${badtok_status}${NC}"
    if [ "$badtok_status" -eq 401 ] 2>/dev/null; then
        print_result 0 "GET /leads with invalid token → HTTP 401 (blocked as expected)"
    else
        print_result 1 "GET /leads with invalid token → HTTP $badtok_status (expected 401)"
    fi

    echo -e "\n  ${MAGENTA}Auth suite done.${NC}"
}

# ═══════════════════════════════════════════════════════════════════════════════
# SUITE: CLIENTS
# ═══════════════════════════════════════════════════════════════════════════════
run_clients_tests() {
    echo -e "\n${MAGENTA}╔════════════════════════════════════════════════╗${NC}"
    echo -e "${MAGENTA}║  CLIENTS SUITE                                 ║${NC}"
    echo -e "${MAGENTA}╚════════════════════════════════════════════════╝${NC}"

    print_section "CREATE CLIENT 1 (valid)"
    local resp
    resp=$(test_endpoint "POST" "/clients" "Create client" \
        "{\"email\":\"$CLIENT_EMAIL\",\"name\":\"Test Client\",\"phone\":\"+1234567890\",\"client_code\":\"CLCODE-123\"}")
    CLIENT_ID=$(extract_json_value "$resp" "data.id")
    if [ -z "$CLIENT_ID" ]; then
        [ "$LAST_HTTP_STATUS" = "401" ] && echo -e "  ${RED}401 — run auth suite first or set INTERNAL_API_BEARER_TOKEN${NC}"
        print_result 1 "Failed to parse client id"
        print_json "$resp"
        return 1
    fi
    print_result 0 "Client 1 created: $CLIENT_ID"

    print_section "CREATE CLIENT (invalid — extra field)"
    local bad_resp
    bad_resp=$(test_endpoint "POST" "/clients" "Client with disallowed field 'company'" \
        "{\"email\":\"invalid-client-$TIMESTAMP@example.com\",\"name\":\"Bad\",\"phone\":\"+1999\",\"company\":\"BadCo\"}")
    if [ "$LAST_HTTP_STATUS" -ge 400 ] 2>/dev/null; then
        print_result 0 "Server rejected invalid client payload (HTTP $LAST_HTTP_STATUS)"
    else
        print_result 1 "Server accepted invalid client payload (HTTP $LAST_HTTP_STATUS)"
    fi

    print_section "CREATE CLIENT 2"
    local resp2
    resp2=$(test_endpoint "POST" "/clients" "Create second client" \
        "{\"email\":\"$CLIENT_EMAIL_2\",\"name\":\"Test Client 2\",\"phone\":\"+1987654321\"}")
    CLIENT_ID_2=$(extract_json_value "$resp2" "data.id")
    if [ -z "$CLIENT_ID_2" ]; then
        print_result 1 "Failed to parse client 2 id"
        return 1
    fi
    print_result 0 "Client 2 created: $CLIENT_ID_2"

    print_section "GET /clients list"
    test_endpoint "GET" "/clients" "List all clients" > /dev/null
    if [ "$LAST_HTTP_STATUS" -ge 200 ] && [ "$LAST_HTTP_STATUS" -lt 300 ] 2>/dev/null; then
        print_result 0 "GET /clients returned HTTP $LAST_HTTP_STATUS"
    else
        print_result 1 "GET /clients returned HTTP $LAST_HTTP_STATUS"
    fi

    echo -e "\n  ${MAGENTA}Clients suite done.${NC}"
}

# ═══════════════════════════════════════════════════════════════════════════════
# SUITE: AFFILIATES
# ═══════════════════════════════════════════════════════════════════════════════
run_affiliates_tests() {
    echo -e "\n${MAGENTA}╔════════════════════════════════════════════════╗${NC}"
    echo -e "${MAGENTA}║  AFFILIATES SUITE                              ║${NC}"
    echo -e "${MAGENTA}╚════════════════════════════════════════════════╝${NC}"

    print_section "CREATE AFFILIATE 1 (valid)"
    local resp
    resp=$(test_endpoint "POST" "/affiliates" "Create affiliate" \
        "{\"email\":\"$AFFILIATE_EMAIL\",\"name\":\"Test Affiliate\",\"phone\":\"+1111111111\",\"affiliate_code\":\"AFFCODE-987\"}")
    AFFILIATE_ID=$(extract_json_value "$resp" "data.id")
    if [ -z "$AFFILIATE_ID" ]; then
        print_result 1 "Failed to parse affiliate id"
        print_json "$resp"
        return 1
    fi
    print_result 0 "Affiliate 1 created: $AFFILIATE_ID"

    print_section "CREATE AFFILIATE (invalid — extra field)"
    test_endpoint "POST" "/affiliates" "Affiliate with disallowed field 'commissionRate'" \
        "{\"email\":\"invalid-aff-$TIMESTAMP@example.com\",\"name\":\"Bad\",\"phone\":\"+1222\",\"commissionRate\":0.2}" > /dev/null
    if [ "$LAST_HTTP_STATUS" -ge 400 ] 2>/dev/null; then
        print_result 0 "Server rejected invalid affiliate payload (HTTP $LAST_HTTP_STATUS)"
    else
        print_result 1 "Server accepted invalid affiliate payload (HTTP $LAST_HTTP_STATUS)"
    fi

    print_section "CREATE AFFILIATE 2"
    local resp2
    resp2=$(test_endpoint "POST" "/affiliates" "Create second affiliate" \
        "{\"email\":\"$AFFILIATE_EMAIL_2\",\"name\":\"Test Affiliate 2\",\"phone\":\"+1444444444\"}")
    AFFILIATE_ID_2=$(extract_json_value "$resp2" "data.id")
    if [ -z "$AFFILIATE_ID_2" ]; then
        print_result 1 "Failed to parse affiliate 2 id"
        return 1
    fi
    print_result 0 "Affiliate 2 created: $AFFILIATE_ID_2"

    echo -e "\n  ${MAGENTA}Affiliates suite done.${NC}"
}

# ═══════════════════════════════════════════════════════════════════════════════
# SUITE: CAMPAIGNS & LEADS
# Depends on CLIENT_ID, AFFILIATE_ID, CLIENT_ID_2, AFFILIATE_ID_2.
# ═══════════════════════════════════════════════════════════════════════════════
run_campaigns_leads_tests() {
    echo -e "\n${MAGENTA}╔════════════════════════════════════════════════╗${NC}"
    echo -e "${MAGENTA}║  CAMPAIGNS & LEADS SUITE                       ║${NC}"
    echo -e "${MAGENTA}╚════════════════════════════════════════════════╝${NC}"

    if [ -z "$CLIENT_ID" ] || [ -z "$AFFILIATE_ID" ]; then
        echo -e "  ${YELLOW}CLIENT_ID/AFFILIATE_ID not set — running clients + affiliates suites first...${NC}"
        run_clients_tests || return 1
        run_affiliates_tests || return 1
    fi

    # ── Campaign 1 (TEST lifecycle) ──────────────────────────────────────────
    print_section "CREATE CAMPAIGN 1: $CAMPAIGN_NAME"
    local c1_resp
    c1_resp=$(test_endpoint "POST" "/campaigns" "Create campaign 1" "{\"name\":\"$CAMPAIGN_NAME\"}")
    CAMPAIGN_ID=$(extract_json_value "$c1_resp" "data.id")
    if [ -z "$CAMPAIGN_ID" ]; then
        print_result 1 "Failed to parse campaign 1 id"
        return 1
    fi
    print_result 0 "Campaign 1 created: $CAMPAIGN_ID"

    print_section "LINK CLIENT + AFFILIATE → CAMPAIGN 1"
    test_endpoint "POST" "/campaigns/$CAMPAIGN_ID/clients" "Link client 1" \
        "{\"client_id\":\"$CLIENT_ID\"}" > /dev/null
    print_result 0 "Client 1 linked"

    local link_aff_resp
    link_aff_resp=$(test_endpoint "POST" "/campaigns/$CAMPAIGN_ID/affiliates" "Link affiliate 1" \
        "{\"affiliate_id\":\"$AFFILIATE_ID\"}")
    CAMPAIGN_KEY=$(extract_json_value "$link_aff_resp" "data.campaign_key")
    if [ -z "$CAMPAIGN_KEY" ]; then
        print_result 1 "Failed to parse campaign_key for campaign 1"
        print_json "$link_aff_resp"
        return 1
    fi
    print_result 0 "Affiliate 1 linked — campaign_key: $CAMPAIGN_KEY"

    print_section "CAMPAIGN 1 → STATUS: TEST"
    test_endpoint "PUT" "/campaigns/$CAMPAIGN_ID/status" "Move to TEST" '{"status":"TEST"}' > /dev/null
    if [ "$LAST_HTTP_STATUS" -ge 200 ] && [ "$LAST_HTTP_STATUS" -lt 300 ] 2>/dev/null; then
        print_result 0 "Campaign 1 moved to TEST"
    else
        print_result 1 "Campaign 1 status transition to TEST failed (HTTP $LAST_HTTP_STATUS)"
    fi

    # ── Campaign 2 (full ACTIVE lifecycle) ──────────────────────────────────
    print_section "CREATE CAMPAIGN 2: $CAMPAIGN_NAME_2"
    local c2_resp
    c2_resp=$(test_endpoint "POST" "/campaigns" "Create campaign 2" "{\"name\":\"$CAMPAIGN_NAME_2\"}")
    CAMPAIGN_ID_2=$(extract_json_value "$c2_resp" "data.id")
    if [ -z "$CAMPAIGN_ID_2" ]; then
        print_result 1 "Failed to parse campaign 2 id"
        return 1
    fi
    print_result 0 "Campaign 2 created: $CAMPAIGN_ID_2"

    print_section "LINK CLIENT2 + AFFILIATE2 → CAMPAIGN 2"
    test_endpoint "POST" "/campaigns/$CAMPAIGN_ID_2/clients" "Link client 2" \
        "{\"client_id\":\"$CLIENT_ID_2\"}" > /dev/null
    print_result 0 "Client 2 linked"

    local link_aff2_resp
    link_aff2_resp=$(test_endpoint "POST" "/campaigns/$CAMPAIGN_ID_2/affiliates" "Link affiliate 2" \
        "{\"affiliate_id\":\"$AFFILIATE_ID_2\"}")
    CAMPAIGN_KEY_2=$(extract_json_value "$link_aff2_resp" "data.campaign_key")
    if [ -z "$CAMPAIGN_KEY_2" ]; then
        print_result 1 "Failed to parse campaign_key for campaign 2"
        return 1
    fi
    print_result 0 "Affiliate 2 linked — campaign_key: $CAMPAIGN_KEY_2"

    print_section "CAMPAIGN 2 → STATUS: TEST"
    test_endpoint "PUT" "/campaigns/$CAMPAIGN_ID_2/status" "Move to TEST" '{"status":"TEST"}' > /dev/null
    print_result 0 "Campaign 2 moved to TEST"

    # ── Lead intake: campaign 1 (TEST) ───────────────────────────────────────
    print_section "LEAD INTAKE [C1/TEST]: valid test lead"
    test_endpoint "POST" "/v2/leads/test" "Test lead (should succeed)" \
        "{\"campaign_id\":\"$CAMPAIGN_ID\",\"campaign_key\":\"$CAMPAIGN_KEY\",\"payload\":{\"email\":\"lead-test@example.com\",\"phone\":\"+15551112222\",\"name\":\"Test Lead\"}}" \
        "external" > /dev/null
    if [ "$LAST_HTTP_STATUS" -ge 200 ] && [ "$LAST_HTTP_STATUS" -lt 300 ] 2>/dev/null; then
        print_result 0 "Test lead accepted (HTTP $LAST_HTTP_STATUS)"
    else
        print_result 1 "Test lead rejected unexpectedly (HTTP $LAST_HTTP_STATUS)"
    fi

    print_section "LEAD INTAKE [C1/TEST]: duplicate lead → flagged"
    local dup_resp
    dup_resp=$(test_endpoint "POST" "/v2/leads/test" "Duplicate test lead (should flag)" \
        "{\"campaign_id\":\"$CAMPAIGN_ID\",\"campaign_key\":\"$CAMPAIGN_KEY\",\"payload\":{\"email\":\"lead-test@example.com\",\"phone\":\"+15551112222\",\"name\":\"Dup Lead\"}}" \
        "external")
    local dup_flag dup_rejected
    dup_flag=$(extract_json_value "$dup_resp" "data.duplicate" | tr '[:upper:]' '[:lower:]')
    dup_rejected=$(extract_json_value "$dup_resp" "data.rejected" | tr '[:upper:]' '[:lower:]')
    if [ "$dup_flag" = "true" ] || [ "$dup_rejected" = "true" ]; then
        print_result 0 "Duplicate flagged (duplicate=$dup_flag, rejected=$dup_rejected)"
    else
        print_result 1 "Duplicate not flagged (duplicate=$dup_flag, rejected=$dup_rejected)"
    fi

    print_section "LEAD INTAKE [C1/TEST]: wrong campaign_key → fail"
    test_endpoint "POST" "/v2/leads/test" "Bad key (should fail)" \
        "{\"campaign_id\":\"$CAMPAIGN_ID\",\"campaign_key\":\"BADKEY\",\"payload\":{\"email\":\"bad-key@example.com\"}}" \
        "external" > /dev/null
    if [ "$LAST_HTTP_STATUS" -ge 400 ] 2>/dev/null; then
        print_result 0 "Wrong key rejected (HTTP $LAST_HTTP_STATUS)"
    else
        print_result 1 "Wrong key was NOT rejected (HTTP $LAST_HTTP_STATUS)"
    fi

    print_section "LEAD INTAKE [C1/TEST]: LIVE endpoint while TEST → fail"
    test_endpoint "POST" "/v2/leads" "Live endpoint while TEST (should fail)" \
        "{\"campaign_id\":\"$CAMPAIGN_ID\",\"campaign_key\":\"$CAMPAIGN_KEY\",\"payload\":{\"email\":\"live-while-test@example.com\"}}" \
        "external" > /dev/null
    if [ "$LAST_HTTP_STATUS" -ge 400 ] 2>/dev/null; then
        print_result 0 "Live lead blocked while TEST (HTTP $LAST_HTTP_STATUS)"
    else
        print_result 1 "Live lead unexpectedly accepted while TEST (HTTP $LAST_HTTP_STATUS)"
    fi

    # ── Campaign 2: ACTIVE attempt prereqs ───────────────────────────────────
    print_section "LEAD INTAKE [C2/TEST]: test lead → success"
    test_endpoint "POST" "/v2/leads/test" "Campaign 2 test lead" \
        "{\"campaign_id\":\"$CAMPAIGN_ID_2\",\"campaign_key\":\"$CAMPAIGN_KEY_2\",\"payload\":{\"email\":\"lead2-test@example.com\",\"name\":\"Test Lead 2\"}}" \
        "external" > /dev/null
    if [ "$LAST_HTTP_STATUS" -ge 200 ] && [ "$LAST_HTTP_STATUS" -lt 300 ] 2>/dev/null; then
        print_result 0 "Campaign 2 test lead accepted"
    else
        print_result 1 "Campaign 2 test lead rejected (HTTP $LAST_HTTP_STATUS)"
    fi

    print_section "CAMPAIGN 2: try ACTIVE while participants still TEST → fail"
    test_endpoint "PUT" "/campaigns/$CAMPAIGN_ID_2/status" "ACTIVE premature (should fail)" \
        '{"status":"ACTIVE"}' > /dev/null
    if [ "$LAST_HTTP_STATUS" -ge 400 ] 2>/dev/null; then
        print_result 0 "ACTIVE blocked while participants TEST (HTTP $LAST_HTTP_STATUS)"
    else
        print_result 1 "ACTIVE incorrectly allowed with TEST participants (HTTP $LAST_HTTP_STATUS)"
    fi

    print_section "CAMPAIGN 2: promote participants → LIVE"
    test_endpoint "PUT" "/campaigns/$CAMPAIGN_ID_2/clients/$CLIENT_ID_2" "Client 2 → LIVE" '{"status":"LIVE"}' > /dev/null
    print_result 0 "Client 2 set to LIVE"
    test_endpoint "PUT" "/campaigns/$CAMPAIGN_ID_2/affiliates/$AFFILIATE_ID_2" "Affiliate 2 → LIVE" '{"status":"LIVE"}' > /dev/null
    print_result 0 "Affiliate 2 set to LIVE"

    print_section "CAMPAIGN 2 → STATUS: ACTIVE"
    test_endpoint "PUT" "/campaigns/$CAMPAIGN_ID_2/status" "Move campaign 2 to ACTIVE" '{"status":"ACTIVE"}' > /dev/null
    if [ "$LAST_HTTP_STATUS" -ge 200 ] && [ "$LAST_HTTP_STATUS" -lt 300 ] 2>/dev/null; then
        print_result 0 "Campaign 2 moved to ACTIVE"
    else
        print_result 1 "Campaign 2 ACTIVE transition failed (HTTP $LAST_HTTP_STATUS)"
    fi

    print_section "LEAD INTAKE [C2/ACTIVE]: live lead → success"
    test_endpoint "POST" "/v2/leads" "Live lead for ACTIVE campaign 2" \
        "{\"campaign_id\":\"$CAMPAIGN_ID_2\",\"campaign_key\":\"$CAMPAIGN_KEY_2\",\"payload\":{\"email\":\"lead2-live@example.com\",\"name\":\"Live Lead 2\"}}" \
        "external" > /dev/null
    if [ "$LAST_HTTP_STATUS" -ge 200 ] && [ "$LAST_HTTP_STATUS" -lt 300 ] 2>/dev/null; then
        print_result 0 "Live lead accepted (HTTP $LAST_HTTP_STATUS)"
    else
        print_result 1 "Live lead rejected unexpectedly (HTTP $LAST_HTTP_STATUS)"
    fi

    print_section "LEAD INTAKE [C2/ACTIVE]: live lead wrong key → fail"
    test_endpoint "POST" "/v2/leads" "Wrong key on ACTIVE campaign 2" \
        "{\"campaign_id\":\"$CAMPAIGN_ID_2\",\"campaign_key\":\"WRONGKEY\",\"payload\":{\"email\":\"badkey@example.com\"}}" \
        "external" > /dev/null
    if [ "$LAST_HTTP_STATUS" -ge 400 ] 2>/dev/null; then
        print_result 0 "Bad key rejected on ACTIVE campaign (HTTP $LAST_HTTP_STATUS)"
    else
        print_result 1 "Bad key NOT rejected (HTTP $LAST_HTTP_STATUS)"
    fi

    print_section "LEAD INTAKE [C2/ACTIVE]: TEST endpoint while ACTIVE → fail"
    test_endpoint "POST" "/v2/leads/test" "Test endpoint while ACTIVE (should fail)" \
        "{\"campaign_id\":\"$CAMPAIGN_ID_2\",\"campaign_key\":\"$CAMPAIGN_KEY_2\",\"payload\":{\"email\":\"test-while-active@example.com\"}}" \
        "external" > /dev/null
    if [ "$LAST_HTTP_STATUS" -ge 400 ] 2>/dev/null; then
        print_result 0 "Test lead blocked while ACTIVE (HTTP $LAST_HTTP_STATUS)"
    else
        print_result 1 "Test lead accepted while ACTIVE (HTTP $LAST_HTTP_STATUS)"
    fi

    print_section "INTERNAL API: POST /leads must be blocked"
    test_endpoint "POST" "/leads" "POST /leads on internal API (must fail)" \
        "{\"campaign_id\":\"$CAMPAIGN_ID_2\",\"campaign_key\":\"$CAMPAIGN_KEY_2\",\"payload\":{\"email\":\"internal-post@example.com\"}}" \
        "internal" > /dev/null
    if [ "$LAST_HTTP_STATUS" -ge 400 ] 2>/dev/null; then
        print_result 0 "Internal API blocks POST /leads (HTTP $LAST_HTTP_STATUS)"
    else
        print_result 1 "Internal API unexpectedly allowed POST /leads (HTTP $LAST_HTTP_STATUS)"
    fi

    echo -e "\n  ${MAGENTA}Campaigns & Leads suite done.${NC}"
}

# ─── Optional cleanup ─────────────────────────────────────────────────────────
run_cleanup() {
    print_section "CLEANUP (DynamoDB tables)"
    purge_table "$CLIENTS_TABLE_NAME"
    purge_table "$AFFILIATES_TABLE_NAME"
    purge_table "$CAMPAIGNS_TABLE_NAME"
    purge_table "$LEADS_TABLE_NAME"
}

# ─── Setup: create/reset test Cognito user ───────────────────────────────────
run_setup_user() {
    print_section "Setup — Create / Reset Test Cognito User"

    # Display current config
    echo -e "  Email    : ${CYAN}$COGNITO_TEST_USERNAME${NC}"
    echo -e "  Password : ${CYAN}$COGNITO_TEST_PASSWORD${NC}"
    echo ""

    # Warn if still using the placeholder default password
    if [ "$COGNITO_TEST_PASSWORD" = "testPass123!" ]; then
        echo -e "  ${YELLOW}Warning: using default placeholder password 'testPass123!'.${NC}"
        printf "  Enter a new password (or press Enter to keep 'testPass123!'): "
        read -r new_pass
        if [ -n "$new_pass" ]; then
            COGNITO_TEST_PASSWORD="$new_pass"
            echo -e "  ${GREEN}Password updated.${NC}"
        fi
        echo ""
    fi

    # Resolve path to create-cognito-user.sh (sibling of this script)
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    local create_script="$script_dir/create-cognito-user.sh"

    if [ ! -f "$create_script" ]; then
        echo -e "  ${RED}✗ create-cognito-user.sh not found at: $create_script${NC}"
        return 1
    fi

    # Need TENANT/SYSTEM/ENVIRONMENT for auto pool resolution, or explicit USER_POOL_ID
    if [ -z "${TENANT:-}" ] || [ -z "${SYSTEM:-}" ] || [ -z "${ENVIRONMENT:-}" ]; then
        echo -e "  ${YELLOW}TENANT / SYSTEM / ENVIRONMENT are not set.${NC}"
        echo -e "  Tip: run ${CYAN}source ./scripts/env-dev.sh${NC} first."
        echo ""
        if [ -z "${USER_POOL_ID:-}" ]; then
            printf "  Enter Cognito User Pool ID directly (or press Enter to abort): "
            read -r pool_id
            if [ -z "$pool_id" ]; then
                echo -e "  ${RED}Aborted.${NC}"
                return 1
            fi
            USER_POOL_ID="$pool_id"
        fi
    fi

    echo -e "  ${YELLOW}Creating / resetting Cognito user...${NC}"

    local extra_args=()
    [ -n "${USER_POOL_ID:-}" ] && extra_args+=(--user-pool-id "$USER_POOL_ID")
    [ -n "${AWS_REGION:-}" ]   && extra_args+=(--region "$AWS_REGION")

    if bash "$create_script" \
            --email    "$COGNITO_TEST_USERNAME" \
            --password "$COGNITO_TEST_PASSWORD" \
            "${extra_args[@]}"; then
        echo ""
        echo -e "  ${GREEN}✓ Test user provisioned successfully.${NC}"
        echo -e "    Email    : ${CYAN}$COGNITO_TEST_USERNAME${NC}"
        echo -e "    Password : ${CYAN}$COGNITO_TEST_PASSWORD${NC}"
        echo ""
        printf "  Run Auth suite now? [y/N]: "
        read -r run_auth
        if [[ "$run_auth" =~ ^[Yy]$ ]]; then
            run_suite "auth"
        fi
    else
        echo ""
        echo -e "  ${RED}✗ Failed to create / reset test user.${NC}"
        return 1
    fi
}

# ─── Ensure token before protected suites ─────────────────────────────────────
ensure_auth_token() {
    if [ -n "$INTERNAL_API_BEARER_TOKEN" ]; then
        build_internal_headers
        return 0
    fi
    echo -e "  ${YELLOW}No INTERNAL_API_BEARER_TOKEN — fetching via /v2/auth/login...${NC}"
    run_auth_tests
}

# ─── Run a named suite and report failures delta ──────────────────────────────
run_suite() {
    local suite="$1"
    local before=$TEST_FAILURES

    case "$suite" in
        auth)       run_auth_tests ;;
        clients)    ensure_auth_token; run_clients_tests ;;
        affiliates) ensure_auth_token; run_affiliates_tests ;;
        campaigns)  ensure_auth_token; run_campaigns_leads_tests ;;
        setup)      run_setup_user ;;
        all)
            run_cleanup
            run_auth_tests
            ensure_auth_token
            run_clients_tests
            run_affiliates_tests
            run_campaigns_leads_tests
            ;;
        *) echo -e "  ${RED}Unknown suite: $suite${NC}"; return 1 ;;
    esac

    local delta=$((TEST_FAILURES - before))
    echo ""
    if [ "$delta" -eq 0 ]; then
        echo -e "  ${GREEN}✓ Suite '${suite}' — all assertions passed${NC}"
    else
        echo -e "  ${RED}✗ Suite '${suite}' — $delta assertion(s) failed${NC}"
    fi
}

# ─── Final summary ─────────────────────────────────────────────────────────────
print_summary() {
    echo -e "\n${BLUE}══════════════════════════════════════════════════════════${NC}"
    if [ "$TEST_FAILURES" -eq 0 ]; then
        echo -e "${GREEN}  ✓ ALL ASSERTIONS PASSED${NC}"
    else
        echo -e "${RED}  ✗ $TEST_FAILURES ASSERTION(S) FAILED${NC}"
    fi
    echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
    echo -e "  Internal API : ${CYAN}$INTERNAL_API_BASE_URL${NC}"
    echo -e "  External API : ${CYAN}$EXTERNAL_LEADS_API_BASE_URL${NC}"
    echo ""
    [ "$TEST_FAILURES" -gt 0 ] && exit 1 || exit 0
}

# ─── Interactive menu ─────────────────────────────────────────────────────────
show_menu() {
    echo -e "\n${BLUE}══════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  LMS API Test Suite${NC}"
    echo -e "${BLUE}══════════════════════════════════════════════════════════${NC}"
    echo -e "  Internal API : ${CYAN}$INTERNAL_API_BASE_URL${NC}"
    echo -e "  External API : ${CYAN}$EXTERNAL_LEADS_API_BASE_URL${NC}"
    echo -e "  Test user    : ${CYAN}$COGNITO_TEST_USERNAME${NC}"
    echo ""
    echo -e "  ${YELLOW}Select a suite:${NC}"
    echo ""
    echo -e "  ${GREEN}1)${NC} Auth          — login, token access control"
    echo -e "  ${GREEN}2)${NC} Clients       — create / validate"
    echo -e "  ${GREEN}3)${NC} Affiliates    — create / validate"
    echo -e "  ${GREEN}4)${NC} Campaigns & Leads — full lifecycle + lead intake"
    echo -e "  ${GREEN}5)${NC} All           — cleanup → auth → clients → affiliates → campaigns"
    echo -e "  ${GREEN}6)${NC} Setup         — create / reset test Cognito user"
    echo -e "  ${GREEN}0)${NC} Exit"
    echo ""
    printf "  ${CYAN}Choice [0-6]:${NC} "
    read -r choice
    echo ""

    case "$choice" in
        1) run_suite "auth" ;;
        2) run_suite "clients" ;;
        3) run_suite "affiliates" ;;
        4) run_suite "campaigns" ;;
        5) run_suite "all" ;;
        6) run_suite "setup" ;;
        0) echo -e "  ${YELLOW}Bye.${NC}"; exit 0 ;;
        *) echo -e "  ${RED}Invalid choice '$choice'.${NC}"; exit 1 ;;
    esac
}

# ─── Entry point ──────────────────────────────────────────────────────────────
# Non-interactive: ./test-api.sh --suite=<name> [--verbose]
SUITE=""
for arg in "$@"; do
    case "$arg" in
        --suite=*)                SUITE="${arg#--suite=}" ;;
        --verbose)                VERBOSE=true ;;
        VERBOSE=true)             VERBOSE=true ;;
        INTERNAL_API_BEARER_TOKEN=*) INTERNAL_API_BEARER_TOKEN="${arg#INTERNAL_API_BEARER_TOKEN=}"; build_internal_headers ;;
        INTERNAL_API_BASE_URL=*)  INTERNAL_API_BASE_URL="${arg#INTERNAL_API_BASE_URL=}" ;;
    esac
done

if [ -n "$SUITE" ]; then
    run_suite "$SUITE"
    print_summary
fi

show_menu
print_summary
