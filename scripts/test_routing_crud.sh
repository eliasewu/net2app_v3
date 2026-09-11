#!/usr/bin/env bash
# Live end-to-end test: create the full routing chain via the API and verify
# save/load for clients, suppliers, trunks, routes, route-plans, rates, and
# billing, plus route resolution via /api/sms/simulate.
set -u
API="${API:-http://localhost:80/api}"
DB="${DB:-sms_platform}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-admin123}"

jget() { python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("data",{}).get("'$1'",""))' 2>/dev/null; }
jget2() { python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("'$1'",""))' 2>/dev/null; }

echo "=== login ==="
LOGIN=$(curl -s "$API/auth/login" -H 'Content-Type: application/json' -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}")
TOKEN=$(echo "$LOGIN" | jget2 token)
if [ -z "$TOKEN" ]; then echo "LOGIN FAILED: $LOGIN"; exit 1; fi
echo "login OK"

post() { curl -s -H 'Content-Type: application/json' -H "Authorization: Bearer $TOKEN" "$@"; }

echo
echo "=== 1. SUPPLIER create ==="
SUP=$(post -X POST "$API/suppliers" -d '{"supplier_code":"SUPTEST1","company_name":"Test Supplier","connection_type":"smpp","smpp_host":"127.0.0.1","smpp_port":2775,"status":"active"}')
SID=$(echo "$SUP" | jget id)
echo "supplier resp: $SUP"
echo "supplier id=$SID"
# routing requires bind_status='bound' (normally set by the SMPP client on connect)
sudo -u postgres psql -d "$DB" -c "UPDATE suppliers SET bind_status='bound' WHERE id=$SID" 2>&1 | tail -1

echo
echo "=== 2. TRUNK create ==="
TRUNK=$(post -X POST "$API/trunks" -d "{\"trunk_name\":\"Trunk A\",\"supplier_id\":$SID,\"trunk_type\":\"sim_otp\",\"mccmnc_allowed\":[\"*\"],\"is_active\":true}")
TID=$(echo "$TRUNK" | jget id)
echo "trunk resp: $TRUNK"
echo "trunk id=$TID"

echo
echo "=== 3. ROUTE create ==="
ROUTE=$(post -X POST "$API/routes" -d "{\"route_name\":\"Route A\",\"trunk_ids\":[$TID],\"route_method\":\"priority\",\"is_active\":true}")
RID=$(echo "$ROUTE" | jget id)
echo "route resp: $ROUTE"
echo "route id=$RID"

echo
echo "=== 4. ROUTE PLAN create ==="
PLAN=$(post -X POST "$API/route-plans" -d "{\"plan_name\":\"Plan V1\",\"route_ids\":[$RID],\"is_default\":false}")
PID=$(echo "$PLAN" | jget id)
echo "plan resp: $PLAN"
echo "plan id=$PID"

echo
echo "=== 5. ROUTE PLAN name update ==="
UPD=$(post -X PUT "$API/route-plans/$PID" -d '{"plan_name":"Plan V2 RENAMED"}')
echo "update resp: $UPD"
echo "=== verify persisted name ==="
post "$API/route-plans/$PID"
echo

echo
echo "=== 6. CLIENT create with routing_plan_id ==="
CLIENT=$(post -X POST "$API/clients" -d "{\"client_code\":\"CLTTEST1\",\"company_name\":\"Test Client\",\"smpp_username\":\"clttest1\",\"smpp_password\":\"pass123\",\"routing_plan_id\":$PID,\"status\":\"active\"}")
CID=$(echo "$CLIENT" | jget id)
echo "client resp: $CLIENT"
echo "client id=$CID"
echo "=== verify client routing_plan_id persisted ==="
post "$API/clients/$CID" 2>/dev/null || post "$API/clients" | python3 -c 'import sys,json;d=json.load(sys.stdin);rows=d.get("data",[]);print([c for c in rows if c.get("client_code")=="CLTTEST1"])'
echo

echo
echo "=== 7. RATES (supplier + client) ==="
echo -n "supplier rate: "; post -X POST "$API/rates" -d "{\"entity_type\":\"supplier\",\"entity_id\":$SID,\"mcc\":\"470\",\"mnc\":\"*\",\"country\":\"Bangladesh\",\"rate\":0.01}"
echo
echo -n "client rate:   "; post -X POST "$API/rates" -d "{\"entity_type\":\"client\",\"entity_id\":$CID,\"mcc\":\"470\",\"mnc\":\"*\",\"country\":\"Bangladesh\",\"rate\":0.02}"
echo

echo
echo "=== 8. SIMULATE routing (client -> Bangladesh +880) ==="
post -X POST "$API/sms/simulate" -d "{\"client_id\":$CID,\"destination\":\"8801712345678\"}"
echo

echo
echo "=== 9. SMS SEND (full pipeline) ==="
post -X POST "$API/sms/send" -d "{\"client_id\":$CID,\"destination\":\"8801712345678\",\"sender_id\":\"TEST\",\"message\":\"hello routing test\"}"
echo
