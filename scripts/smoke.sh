#!/bin/bash
# ============================================================
# scripts/smoke.sh — end-to-end smoke test for NET2APP Hub backend
# ============================================================
# Boots the Express server as a child of THIS bash process (no setsid detach —
# avoids the issue where backgrounding gets reaped), waits for it to respond
# via a curl-based probe (faster than 'ss'-based port polling), runs a full
# CRUD lifecycle on /api/route_maps including the singleton GET endpoint,
# then smokes 12 other endpoints + asserts DB parity before killing the
# server cleanly.
#
# Usage:  bash scripts/smoke.sh
# Requires: a PostgreSQL backend on localhost:5432 (database sms_platform,
#           user sms_user) initialized from src/database/schema.sql.
# ============================================================
set +e

# Failure accumulator — incremented whenever a phase reports a defect.
# We intentionally keep `set +e` so we collect all observations before
# exiting with a meaningful code (handy for CI pipelines that care).
FAILURES=0

echo '=== STEP 1: KILL OLD ==='
for pid in $(pgrep -f 'server\.cjs'); do kill -9 "$pid" 2>/dev/null; done
sleep 3
pgrep -af 'server\.cjs' >/dev/null && echo STILL_RUNNING || echo CLEAN
echo ''

echo '=== STEP 2: BOOT ==='
rm -f /tmp/srv_smoke.log
node server.cjs > /tmp/srv_smoke.log 2>&1 &
SERVER_PID=$!
echo "SERVER_PID=$SERVER_PID"

echo '--- waiting for readiness via curl POST /api/auth/login ---'
READY=0
for i in $(seq 1 25); do
  H=$(curl -s -m 1 -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' \
    -d '{}' http://localhost:3000/api/auth/login 2>/dev/null)
  if [ "$H" = "200" ] || [ "$H" = "400" ] || [ "$H" = "401" ]; then
    echo "READY_AT_${i}s HTTP=$H"
    READY=1
    break
  fi
  sleep 1
done

if [ "$READY" -ne 1 ]; then
  echo 'NEVER_READY'
  echo '--- server log ---'; sed -n '1,50p' /tmp/srv_smoke.log
  kill $SERVER_PID 2>/dev/null
  exit 1  # hard exit — no point continuing if the server never came up
fi
echo '--- server log (first 20 lines) ---'
sed -n '1,20p' /tmp/srv_smoke.log
echo ''

echo '=== STEP 3: PG BASELINE ==='
pg_isready -h localhost -U sms_user 2>&1 | head -2
for tbl in route_maps users clients suppliers routes route_plans invoices; do
  CNT=$(psql -h localhost -U sms_user -d sms_platform -tA -c "SELECT count(*) FROM $tbl" 2>&1 | tr -d '\n')
  echo "$tbl: $CNT"
done
echo ''

echo '=== STEP 4: LOGIN admin ==='
LOGIN=$(curl -s -m 10 -X POST -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin123"}' \
  http://localhost:3000/api/auth/login)
echo "LOGIN_RESP=${LOGIN:0:300}"
TOKEN=$(echo "$LOGIN" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("token",""))')
echo "TOK_LEN=${#TOKEN}"
if [ "${#TOKEN}" -lt 20 ]; then
  echo 'AUTH_FAIL_ABORT'
  kill $SERVER_PID 2>/dev/null
  exit 1  # hard exit — auth failure means nothing else is meaningful
fi
echo 'AUTH_OK'
AUTH="Authorization: Bearer $TOKEN"
echo ''

echo '=== STEP 5: FK TARGETS ==='
C=$(curl -s -m 10 -H "$AUTH" http://localhost:3000/api/clients \
  | python3 -c 'import json,sys;d=json.load(sys.stdin).get("data",[]);print(d[0]["id"] if d else "")')
R=$(curl -s -m 10 -H "$AUTH" http://localhost:3000/api/routes \
  | python3 -c 'import json,sys;d=json.load(sys.stdin).get("data",[]);print(d[0]["id"] if d else "")')
S=$(curl -s -m 10 -H "$AUTH" http://localhost:3000/api/suppliers \
  | python3 -c 'import json,sys;d=json.load(sys.stdin).get("data",[]);print(d[0]["id"] if d else "")')
echo "C(client_id)=$C  R(route_id)=$R  S(supplier_id)=$S"
echo ''

echo '=== STEP 6: FULL CRUD on /api/route_maps ==='
BEFORE=$(curl -s -m 10 -H "$AUTH" http://localhost:3000/api/route_maps \
  | python3 -c 'import json,sys;d=json.load(sys.stdin).get("data",[]);print(len(d))')
echo "BEFORE_COUNT=$BEFORE"

echo '--- 6a: POST insert ---'
INS=$(curl -s -m 10 -X POST -H 'Content-Type: application/json' -H "$AUTH" \
  -d "{\"client_id\":$C,\"route_id\":$R,\"supplier_id\":$S,\"mccmnc_pattern\":\"999*\",\"priority\":99,\"percentage\":60,\"is_active\":true}" \
  -w '\n__HTTP:%{http_code}' \
  http://localhost:3000/api/route_maps)
echo "INSERT_RESP=${INS:0:400}"
NEW_ID=$(echo "$INS" | grep -v '__HTTP' \
  | python3 -c 'import json,sys;d=json.load(sys.stdin);print(d.get("data",{}).get("id") or d.get("id") or "")')
echo "NEW_ID=$NEW_ID"

echo '--- 6b: GET list (after insert) ---'
AFTER=$(curl -s -m 10 -H "$AUTH" http://localhost:3000/api/route_maps \
  | python3 -c 'import json,sys;d=json.load(sys.stdin).get("data",[]);print(len(d))')
echo "AFTER_INSERT=$AFTER (delta=$((AFTER-BEFORE)))"

echo '--- 6c: PUT update ---'
UPD=$(curl -s -m 10 -X PUT -H 'Content-Type: application/json' -H "$AUTH" \
  -d '{"percentage":85,"priority":50}' \
  -w '\n__HTTP:%{http_code}' \
  "http://localhost:3000/api/route_maps/$NEW_ID")
echo "UPDATE_RESP=${UPD:0:400}"

echo '--- 6d: GET /:id (singleton endpoint, validates server.cjs single-row GET) ---'
SNG=$(curl -s -m 10 -H "$AUTH" -w '\n__HTTP:%{http_code}' \
  "http://localhost:3000/api/route_maps/$NEW_ID")
echo "SINGLE_RESP=${SNG:0:500}"
SP=$(echo "$SNG" | grep -v '__HTTP' \
  | python3 -c 'import json,sys;d=json.load(sys.stdin).get("data",{});print(d.get("percentage",""))' 2>/dev/null)
SPR=$(echo "$SNG" | grep -v '__HTTP' \
  | python3 -c 'import json,sys;d=json.load(sys.stdin).get("data",{});print(d.get("priority",""))' 2>/dev/null)
echo "VERIFIED percentage=$SP (want 85) priority=$SPR (want 50)"
if [ "$SP" != "85" ] || [ "$SPR" != "50" ]; then
  echo '❌ SINGLETON GET DID NOT RETURN UPDATED VALUES'
  FAILURES=$((FAILURES + 1))
fi

echo '--- 6e: DELETE ---'
DEL=$(curl -s -m 10 -X DELETE -H "$AUTH" -w '\n__HTTP:%{http_code}' \
  "http://localhost:3000/api/route_maps/$NEW_ID")
echo "DELETE_RESP=${DEL:0:300}"
FINAL=$(curl -s -m 10 -H "$AUTH" http://localhost:3000/api/route_maps \
  | python3 -c 'import json,sys;d=json.load(sys.stdin).get("data",[]);print(len(d))')
echo "FINAL_COUNT=$FINAL (want $BEFORE)"
echo ''

echo '=== STEP 7: SMOKE 12 OTHER ENDPOINTS ==='
for path in /clients /suppliers /routes /route_plans /payments /users \
            /billing/invoices /platform_settings /notification_templates \
            /campaigns /translations; do
  RC=$(curl -s -m 8 -o /tmp/r.json -w '%{http_code}' -H "$AUTH" \
    "http://localhost:3000/api$path")
  N=$(python3 -c 'import json;d=json.load(open("/tmp/r.json"));x=d.get("data",d) if isinstance(d,dict) else d;print(len(x) if hasattr(x,"__len__") else "?")' 2>/dev/null)
  echo "GET $path -> $RC rows=$N"
done
RC1=$(curl -s -m 8 -o /tmp/r.json -w '%{http_code}' -X POST \
  -H 'Content-Type: application/json' -H "$AUTH" \
  -d '{"limit":5,"offset":0}' http://localhost:3000/api/sms/logs)
N1=$(python3 -c 'import json;d=json.load(open("/tmp/r.json"));x=d.get("data",d);print(len(x) if hasattr(x,"__len__") else "?")' 2>/dev/null)
echo "POST /api/sms/logs -> $RC1 rows=$N1"
# Note: /api_keys is intentionally NOT in this loop — it 404s because api_keys
# is registered via a separate code path (external API key endpoints), not the
# generic CRUD loop. See CONTRIBUTING.md Common Gotchas §5 for details.
echo ''

echo '=== STEP 8: DB PARITY ==='
AFT=$(psql -h localhost -U sms_user -d sms_platform -tA \
  -c 'SELECT count(*) FROM route_maps' 2>&1 | tr -d '\n')
echo "FINAL route_maps DB count: $AFT (baseline was $BEFORE)"
if [ "$AFT" = "$BEFORE" ]; then echo 'DB PARITY OK'; else echo 'DB COUNT DRIFT'; FAILURES=$((FAILURES + 1)); fi
echo ''

echo '=== STEP 9: CLEANUP ==='
kill $SERVER_PID 2>/dev/null
sleep 1
pgrep -af 'server\.cjs' >/dev/null && echo STILL_RUNNING || echo CLEAN_AFTER_TEST
echo ''

echo '========== SMOKE TEST COMPLETE =========='
if [ "$FAILURES" -gt 0 ]; then
  echo "❌ FAILED: $FAILURES phase(s) reported defects"
  exit "$FAILURES"  # exit code == number of phase failures (handy for CI)
else
  echo '✅ ALL PHASES PASSED'
  exit 0
fi
