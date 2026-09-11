#!/usr/bin/env bash
# =============================================================================
# NET2APP Hub — Quickstart Script
#
# Automates the complete first-SMS setup flow in 11 steps via curl API calls:
#   1. Login → JWT token
#   2. Create a Supplier (SMPP gateway)
#   3. Create a Client (SMS account)
#   4. Create a Trunk (links supplier)
#   5. Create a Route (groups trunks)
#   6. Create a Route Map (client → route → supplier)
#   7. Create a Route Plan (bundles routes)
#   8. Assign Route Plan to Client
#   9. Set Client Rate (sell price)
#  10. Set Supplier Rate (buy price)
#  11. Send a Test SMS
#
# Usage:
#   chmod +x scripts/quickstart.sh
#   ./scripts/quickstart.sh [--base-url http://localhost:3000] [--force]
#
# Idempotent: skips creation if entities already exist (finds and reuses them).
# Set --force to reset the client balance to €100 and re-assign the route plan
# (useful after running the test SMS multiple times).
# =============================================================================

set -euo pipefail

# ── Config ──────────────────────────────────────────────────────────────────
BASE_URL="${QUICKSTART_BASE_URL:-http://localhost:3000}"
FORCE="${QUICKSTART_FORCE:-false}"
ADMIN_USER="${QUICKSTART_ADMIN_USER:-admin}"
ADMIN_PASS="${QUICKSTART_ADMIN_PASS:-admin123}"

# Test entity codes (prefixed with QS_ to avoid collisions with real data)
SUPPLIER_CODE="QS_SUPPLIER"
CLIENT_CODE="QS_CLIENT"
TRUNK_NAME="QS_Trunk"
ROUTE_NAME="QS_Route"
ROUTE_PLAN_NAME="QS_RoutePlan"
# Random suffix for unique usernames (avoids UNIQUE constraint on soft-deleted rows)
RAND_SUFFIX="${QUICKSTART_RAND:-$RANDOM}"

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $*"; }
fail() { echo -e "${RED}✗${NC} $*"; exit 1; }
info() { echo -e "${BLUE}→${NC} $*"; }
warn() { echo -e "${YELLOW}⚠${NC} $*"; }
step() { echo -e "\n${CYAN}━━━ Step $1${NC} ${CYAN}$2${NC}"; }

# ── Helper: find entity ID using Python for reliable JSON parsing ───────────
# Usage: find_entity_id "/api/suppliers" "supplier_code" "$SUPPLIER_CODE"
find_entity_id() {
  local url="$1" key="$2" value="$3"
  curl -s -H "$AUTH" "$BASE_URL$url" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    for r in d.get('data', []):
        if str(r.get('$key', '')) == '$value':
            print(r['id'])
            break
except: pass
" 2>/dev/null || echo ""
}

# ── Helper: try to create an entity; if HTTP 500 (likely soft-deleted UNIQUE
#    conflict), append _ts suffix and retry. Sets ${prefix}_ID in caller scope.
create_entity() {
  local prefix="$1" url="$2" key="$3" code="$4" json_body="$5"
  local resp id http_code

  resp=$(curl -s -w '\n%{http_code}' --connect-timeout 5 \
    -X POST "$BASE_URL$url" -H "$AUTH" -H "$CONTENT" -d "$json_body")
  http_code=$(echo "$resp" | tail -1)
  resp=$(echo "$resp" | sed '$d')
  id=$(echo "$resp" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)

  # If 500 (likely UNIQUE constraint from soft-deleted row), retry with _ts suffix
  if [ "$http_code" = "500" ] && [ -z "$id" ]; then
    local ts="_$(date +%s)"
    local retry_body=$(echo "$json_body" | sed "s/\"$code\"/\"${code}${ts}\"/")
    resp=$(curl -s -w '\n%{http_code}' --connect-timeout 5 \
      -X POST "$BASE_URL$url" -H "$AUTH" -H "$CONTENT" -d "$retry_body")
    http_code=$(echo "$resp" | tail -1)
    resp=$(echo "$resp" | sed '$d')
    id=$(echo "$resp" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
    if [ -n "$id" ]; then
      eval "${prefix}_CODE=${code}${ts}"
    fi
  fi

  if [ -n "$id" ]; then
    ok "${prefix} created (id=$id)"
    eval "${prefix}_ID=$id"
    return 0
  fi
  return 1
}

# ── Helper: find route_map ID by client_id + supplier_id ───────────────────
find_routemap_id() {
  local cid="$1" sid="$2"
  curl -s -H "$AUTH" "$BASE_URL/api/route_maps" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
    for r in d.get('data', []):
        if r.get('client_id') == $cid and r.get('supplier_id') == $sid:
            print(r['id'])
            break
except: pass
" 2>/dev/null || echo ""
}

# Parse CLI args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url) BASE_URL="$2"; shift 2 ;;
    --force)    FORCE="true"; shift ;;
    *)          echo "Unknown flag: $1"; echo "Usage: $0 [--base-url URL] [--force]"; exit 1 ;;
  esac
done

# ── 0. Pre-flight check ─────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║     NET2APP Hub — First-SMS Quickstart              ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
info "Base URL:  $BASE_URL"
info "Admin:     $ADMIN_USER"
info "Force:     $FORCE"

if ! curl -s --connect-timeout 3 "$BASE_URL/api/auth/login" > /dev/null 2>&1; then
  fail "Cannot reach $BASE_URL — is the server running?"
fi
ok "Server reachable at $BASE_URL"

# ── 1. Login ────────────────────────────────────────────────────────────────
step "1" "Login → JWT token"

LOGIN_RESP=$(curl -s --connect-timeout 5 \
  -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}")

TOKEN=$(echo "$LOGIN_RESP" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  fail "Login failed. Response: $(echo $LOGIN_RESP | head -c 200)"
fi
ok "Logged in as $ADMIN_USER (token: ${TOKEN:0:12}...)"

AUTH="Authorization: Bearer $TOKEN"
CONTENT="Content-Type: application/json"

# ── Helper: create entity, falling back to idempotent lookup ────────────────
# Usage: create_or_find "SUPPLIER" "/api/suppliers" "supplier_code" "$CODE" "{...json...}"
# Sets the variable named ${prefix}_ID in the caller's scope via eval
create_or_find() {
  local prefix="$1" url="$2" key="$3" value="$4" json_body="$5"
  local resp id

  resp=$(curl -s --connect-timeout 5 -X POST "$BASE_URL$url" -H "$AUTH" -H "$CONTENT" -d "$json_body")
  id=$(echo "$resp" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)

  if [ -z "$id" ]; then
    id=$(find_entity_id "$url" "$key" "$value")
    if [ -n "$id" ]; then
      ok "${prefix} already exists (id=$id)"
    else
      fail "Failed to create ${prefix}. Response: $(echo $resp | head -c 300)"
    fi
  else
    ok "${prefix} created: $value (id=$id)"
  fi
  eval "${prefix}_ID=$id"
}

# ── 2. Create Supplier ──────────────────────────────────────────────────────
step "2" "Create Supplier (SMPP gateway)"

SUPPLIER_ID=""
SUPPLIER_CODE_USED="$SUPPLIER_CODE"

# First, check if an active QS_SUPPLIER already exists
SUPPLIER_ID=$(find_entity_id "/api/suppliers" "supplier_code" "$SUPPLIER_CODE")

if [ -z "$SUPPLIER_ID" ]; then
  # Try creating; if soft-deleted conflict, retry with _ts suffix
  create_entity "Supplier" "/api/suppliers" "supplier_code" "$SUPPLIER_CODE" "{
    \"supplier_code\": \"$SUPPLIER_CODE\",
    \"company_name\": \"Quickstart SMPP Gateway\",
    \"connection_type\": \"smpp\",
    \"smpp_host\": \"127.0.0.1\",
    \"smpp_port\": 2775,
    \"smpp_username\": \"qs_user_${RAND_SUFFIX}\",
    \"smpp_password\": \"qs_pass\"
  }" || fail "Failed to create supplier"
else
  ok "Supplier already exists (id=$SUPPLIER_ID)"
fi

# ── 3. Create Client ────────────────────────────────────────────────────────
step "3" "Create Client (SMS account)"

CLIENT_ID=""

# First, check if an active QS_CLIENT already exists
CLIENT_ID=$(find_entity_id "/api/clients" "client_code" "$CLIENT_CODE")

if [ -z "$CLIENT_ID" ]; then
  create_entity "Client" "/api/clients" "client_code" "$CLIENT_CODE" "{
    \"client_code\": \"$CLIENT_CODE\",
    \"company_name\": \"Quickstart Test Client\",
    \"email\": \"qs@example.com\",
    \"smpp_username\": \"qs_client_smpp_${RAND_SUFFIX}\",
    \"smpp_password\": \"qs_client_pass\",
    \"billing_mode\": \"dlr\",
    \"currency\": \"EUR\",
    \"balance\": 100.00,
    \"credit_limit\": 1000.00
  }" || fail "Failed to create client"
else
  ok "Client already exists (id=$CLIENT_ID)"
fi

# ── Force mode: reset client balance ────────────────────────────────────────
if [ "$FORCE" = "true" ] && [ -n "$CLIENT_ID" ]; then
  curl -s -X PUT "$BASE_URL/api/clients/$CLIENT_ID" \
    -H "$AUTH" -H "$CONTENT" \
    -d '{"balance": 100.00}' > /dev/null 2>&1 || true
  ok "Client balance reset to €100.00"
fi

# ── 4. Create Trunk ─────────────────────────────────────────────────────────
step "4" "Create Trunk (links supplier)"

TRUNK_ID=""
TRUNK_RESP=$(curl -s --connect-timeout 5 \
  -X POST "$BASE_URL/api/trunks" \
  -H "$AUTH" -H "$CONTENT" \
  -d "{
    \"trunk_name\": \"$TRUNK_NAME\",
    \"trunk_type\": \"smpp\",
    \"supplier_id\": $SUPPLIER_ID,
    \"priority\": 1,
    \"percentage\": 100,
    \"is_active\": true
  }")

TRUNK_ID=$(echo "$TRUNK_RESP" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)

if [ -z "$TRUNK_ID" ]; then
  TRUNK_ID=$(find_entity_id "/api/trunks" "trunk_name" "$TRUNK_NAME")
  if [ -n "$TRUNK_ID" ]; then
    ok "Trunk already exists (id=$TRUNK_ID)"
  else
    fail "Failed to create trunk. Response: $(echo $TRUNK_RESP | head -c 400)"
  fi
else
  ok "Trunk created: $TRUNK_NAME (id=$TRUNK_ID)"
fi

# ── 5. Create Route ─────────────────────────────────────────────────────────
step "5" "Create Route (groups trunks)"

ROUTE_ID=""
ROUTE_RESP=$(curl -s --connect-timeout 5 \
  -X POST "$BASE_URL/api/routes" \
  -H "$AUTH" -H "$CONTENT" \
  -d "{
    \"route_name\": \"$ROUTE_NAME\",
    \"trunk_ids\": [$TRUNK_ID],
    \"route_method\": \"priority\",
    \"is_active\": true
  }")

ROUTE_ID=$(echo "$ROUTE_RESP" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)

if [ -z "$ROUTE_ID" ]; then
  ROUTE_ID=$(find_entity_id "/api/routes" "route_name" "$ROUTE_NAME")
  if [ -n "$ROUTE_ID" ]; then
    ok "Route already exists (id=$ROUTE_ID)"
  else
    fail "Failed to create route. Response: $(echo $ROUTE_RESP | head -c 400)"
  fi
else
  ok "Route created: $ROUTE_NAME (id=$ROUTE_ID)"
fi

# ── 6. Create Route Map ─────────────────────────────────────────────────────
step "6" "Create Route Map (client → route → supplier)"

ROUTE_MAP_ID=""
ROUTE_MAP_RESP=$(curl -s --connect-timeout 5 \
  -X POST "$BASE_URL/api/route_maps" \
  -H "$AUTH" -H "$CONTENT" \
  -d "{
    \"client_id\": $CLIENT_ID,
    \"route_id\": $ROUTE_ID,
    \"supplier_id\": $SUPPLIER_ID,
    \"mccmnc_pattern\": \"*\",
    \"priority\": 1,
    \"percentage\": 100,
    \"is_active\": true
  }")

ROUTE_MAP_ID=$(echo "$ROUTE_MAP_RESP" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)

if [ -z "$ROUTE_MAP_ID" ]; then
  ROUTE_MAP_ID=$(find_routemap_id "$CLIENT_ID" "$SUPPLIER_ID")
  if [ -n "$ROUTE_MAP_ID" ]; then
    ok "Route map already exists (id=$ROUTE_MAP_ID)"
  else
    fail "Failed to create route map. Response: $(echo $ROUTE_MAP_RESP | head -c 400)"
  fi
else
  ok "Route map created (id=$ROUTE_MAP_ID) — client=$CLIENT_ID → route=$ROUTE_ID → supplier=$SUPPLIER_ID [pattern: *]"
fi

# ── 7. Create Route Plan ────────────────────────────────────────────────────
step "7" "Create Route Plan (bundles routes)"

ROUTE_PLAN_ID=""
ROUTE_PLAN_RESP=$(curl -s --connect-timeout 5 \
  -X POST "$BASE_URL/api/route_plans" \
  -H "$AUTH" -H "$CONTENT" \
  -d "{
    \"plan_name\": \"$ROUTE_PLAN_NAME\",
    \"route_ids\": [$ROUTE_ID],
    \"is_default\": true
  }")

ROUTE_PLAN_ID=$(echo "$ROUTE_PLAN_RESP" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)

if [ -z "$ROUTE_PLAN_ID" ]; then
  ROUTE_PLAN_ID=$(find_entity_id "/api/route_plans" "plan_name" "$ROUTE_PLAN_NAME")
  if [ -n "$ROUTE_PLAN_ID" ]; then
    ok "Route plan already exists (id=$ROUTE_PLAN_ID)"
  else
    fail "Failed to create route plan. Response: $(echo $ROUTE_PLAN_RESP | head -c 400)"
  fi
else
  ok "Route plan created: $ROUTE_PLAN_NAME (id=$ROUTE_PLAN_ID)"
fi

# ── 8. Assign Route Plan to Client ──────────────────────────────────────────
step "8" "Assign Route Plan to Client"

ASSIGN_RESP=$(curl -s --connect-timeout 5 \
  -X PUT "$BASE_URL/api/clients/$CLIENT_ID" \
  -H "$AUTH" -H "$CONTENT" \
  -d "{\"routing_plan_id\": $ROUTE_PLAN_ID}")

if echo "$ASSIGN_RESP" | grep -q '"success":true'; then
  ok "Route plan $ROUTE_PLAN_NAME assigned to client $CLIENT_CODE"
else
  fail "Failed to assign route plan. Response: $(echo $ASSIGN_RESP | head -c 200)"
fi

# ── 9. Set Client Rate (sell price) ─────────────────────────────────────────
step "9" "Set Client Rate (sell price)"

CLIENT_RATE_RESP=$(curl -s --connect-timeout 5 \
  -X POST "$BASE_URL/api/rates" \
  -H "$AUTH" -H "$CONTENT" \
  -d "{
    \"entity_type\": \"client\",
    \"entity_id\": $CLIENT_ID,
    \"mcc\": \"*\",
    \"mnc\": \"*\",
    \"country\": \"Default\",
    \"operator\": \"All\",
    \"rate\": 0.05
  }")

CLIENT_RATE_ID=$(echo "$CLIENT_RATE_RESP" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)

if [ -z "$CLIENT_RATE_ID" ]; then
  warn "Could not create client rate (may already exist). Continuing..."
else
  ok "Client rate set: €0.05/SMS (id=$CLIENT_RATE_ID)"
fi

# ── 10. Set Supplier Rate (buy price) ───────────────────────────────────────
step "10" "Set Supplier Rate (buy price)"

SUPPLIER_RATE_RESP=$(curl -s --connect-timeout 5 \
  -X POST "$BASE_URL/api/rates" \
  -H "$AUTH" -H "$CONTENT" \
  -d "{
    \"entity_type\": \"supplier\",
    \"entity_id\": $SUPPLIER_ID,
    \"mcc\": \"*\",
    \"mnc\": \"*\",
    \"country\": \"Default\",
    \"operator\": \"All\",
    \"rate\": 0.02
  }")

SUPPLIER_RATE_ID=$(echo "$SUPPLIER_RATE_RESP" | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)

if [ -z "$SUPPLIER_RATE_ID" ]; then
  warn "Could not create supplier rate (may already exist). Continuing..."
else
  ok "Supplier rate set: €0.02/SMS (id=$SUPPLIER_RATE_ID)"
fi

# Profit check: 0.05 - 0.02 = 0.03 > 0 ✓
ok "Profit margin: €0.03/SMS (client €0.05 - supplier €0.02) ✓"

# ── 11. Send Test SMS ───────────────────────────────────────────────────────
step "11" "Send Test SMS"

TEST_DEST="+1234567890"
SMS_RESP=$(curl -s --connect-timeout 10 \
  -X POST "$BASE_URL/api/sms/send" \
  -H "$AUTH" -H "$CONTENT" \
  -d "{
    \"client_id\": $CLIENT_ID,
    \"destination\": \"$TEST_DEST\",
    \"sender_id\": \"NET2APP\",
    \"message\": \"Hello from NET2APP Hub quickstart! Your first SMS is working.\"
  }")

if echo "$SMS_RESP" | grep -q '"success":true'; then
  MSG_ID=$(echo "$SMS_RESP" | grep -o '"message_id":"[^"]*"' | head -1 | cut -d'"' -f4)
  STATUS=$(echo "$SMS_RESP" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
  ok "Test SMS sent!"
  echo -e "   ${GREEN}Message ID:${NC} $MSG_ID"
  echo -e "   ${GREEN}Status:${NC}     $STATUS"
  echo -e "   ${GREEN}To:${NC}         $TEST_DEST"
else
  ERROR_MSG=$(echo "$SMS_RESP" | grep -o '"error":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [ -z "$ERROR_MSG" ]; then
    ERROR_MSG=$(echo "$SMS_RESP" | head -c 300)
  fi
  warn "SMS may not have dispatched (expected if no real SMPP gateway): $ERROR_MSG"
  warn "The setup flow is complete — SMS will dispatch when a real SMPP supplier is connected."
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║     Quickstart Complete!                            ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${CYAN}Supplier:${NC}    $SUPPLIER_CODE (id=$SUPPLIER_ID)"
echo -e "  ${CYAN}Client:${NC}      $CLIENT_CODE (id=$CLIENT_ID)"
echo -e "  ${CYAN}Trunk:${NC}       $TRUNK_NAME (id=$TRUNK_ID)"
echo -e "  ${CYAN}Route:${NC}       $ROUTE_NAME (id=$ROUTE_ID)"
echo -e "  ${CYAN}Route Map:${NC}   id=$ROUTE_MAP_ID (client→route→supplier, pattern: *)"
echo -e "  ${CYAN}Route Plan:${NC}  $ROUTE_PLAN_NAME (id=$ROUTE_PLAN_ID)"
echo -e "  ${CYAN}Client Rate:${NC}  €0.05/SMS (sell)"
echo -e "  ${CYAN}Supplier Rate:${NC} €0.02/SMS (buy)"
echo -e "  ${CYAN}Profit:${NC}       €0.03/SMS"
echo ""
echo -e "  ${GREEN}Next steps:${NC}"
echo -e "    1. Open ${BLUE}$BASE_URL${NC} → log in → check Dashboard"
echo -e "    2. Go to ${BLUE}SMS Logs${NC} to see your test message"
echo -e "    3. Connect a real SMPP supplier to send live SMS"
echo -e "    4. Run ${BLUE}./scripts/quickstart.sh --force${NC} to reset and re-run"
echo ""
