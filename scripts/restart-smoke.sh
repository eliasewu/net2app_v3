#!/usr/bin/env bash
# ============================================================
# scripts/restart-smoke.sh — restart + recovery smoke for NET2APP Hub
# ------------------------------------------------------------
# What it does, in order:
#   1. systemctl reset-failed <SERVICE>           (clear start-limit-burst)
#      then systemctl restart <SERVICE>           (hard exit on fail)
#   2. wait for upstream on http://127.0.0.1:3001 by polling
#      POST /api/auth/login every ${PROBE_INTERVAL}s up to
#      ${WAIT_TIMEOUT}s — accept ANY HTTP code != 000 as proof
#      Express is alive (4xx from auth/login is expected; no
#      bouncing ⇒ process is genuinely up)
#   3. authenticated POST /api/auth/login → grab a JWT
#      (writes body to $LOGIN_JSON, parsed in-place; file is
#      cleaned up via an EXIT trap)
#   4. authenticated GET /api/dashboard/stats → 200 = pass
#   5. nginx -t (config validation; reload is hard-gated behind
#      it so a known-bad config cannot poison the live server)
#   6. systemctl reload nginx
#   7. unauthenticated GET / via nginx, expect 200/301/302
#   8. summary block with total duration + per-check status
#
# Usage:
#   bash /opt/net2app-hub/scripts/restart-smoke.sh
#
# Env overrides (all optional):
#   SERVICE             systemd unit name                (default: net2app-hub)
#   UPSTREAM_URL        http(s)://host:port              (default: http://127.0.0.1:3001)
#                       Probe path /api/auth/login is appended.
#   NGINX_RELOAD        0 to skip steps 5–7 entirely     (default: 1)
#   WAIT_TIMEOUT        seconds to wait for upstream     (default: 30)
#   PROBE_INTERVAL      seconds between probes           (default: 1)
#   PROBE_TIMEOUT       curl --max-time for poll loop    (default: 3)
#   CALL_TIMEOUT        curl --max-time for auth/dashboard probes (default: 5)
#   ADMIN_USER          credential for /api/auth/login   (default: admin)
#   ADMIN_PASS          credential for /api/auth/login   (default: admin123)
#   SPOTCHECK_URL       full URL used for step 7         (default: http://127.0.0.1/)
#   NO_DEFAULT_CREDS_BANNER=1 silences the default-credentials warning
#
# Why NOT `systemctl restart net2app-hub && curl -f /api/dashboard/stats`:
#   * curl -f fails silently on 4xx — /api/dashboard/stats requires
#     auth, so the literal one-liner returns 401 and exits non-zero
#     even on a healthy box.
#   * `&&` chains do not retry — a restart that takes 4 s (cold
#     npm cache, large distrowatch imports, etc.) will trip the
#     one-shot curl before the listener is up. We poll instead.
#   * No diagnostic dump on failure — the operator has to remember
#     which log to read. We tail journalctl when the probe fails.
#   * No reset-failed before restart — if the unit is in start-
#     limit-burst `failed` state, restart rejects immediately
#     (mirror of the safety guard already in healthcheck.sh).
# ============================================================

set -u
set -o pipefail

SERVICE="${SERVICE:-net2app-hub}"
UPSTREAM_URL="${UPSTREAM_URL:-http://127.0.0.1:3001}"
NGINX_RELOAD="${NGINX_RELOAD:-1}"
WAIT_TIMEOUT="${WAIT_TIMEOUT:-30}"
PROBE_INTERVAL="${PROBE_INTERVAL:-1}"
PROBE_TIMEOUT="${PROBE_TIMEOUT:-3}"
CALL_TIMEOUT="${CALL_TIMEOUT:-5}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-admin123}"
SPOTCHECK_URL="${SPOTCHECK_URL:-http://127.0.0.1/}"

# --------- pre-flight: tools we depend on ---------------------
for bin in curl systemctl python3 mktemp; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    printf 'pre-flight FAIL: %s not installed\n' "$bin" >&2
    exit 2
  fi
done

# --------- tmp file scoping (JWT lives in $LOGIN_JSON) --------
# mktemp guarantees a unique path even under concurrent runs;
# the EXIT trap guarantees the file is removed regardless of
# which step (if any) caused us to bail out.
LOGIN_JSON=$(mktemp -p "${TMPDIR:-/tmp}" restart_smoke_login.XXXXXX.json 2>/dev/null \
             || mktemp -t restart_smoke_login.XXXXXX.json)
DASH_JSON=$(mktemp  -p "${TMPDIR:-/tmp}" restart_smoke_dash.XXXXXX.json  2>/dev/null \
             || mktemp -t restart_smoke_dash.XXXXXX.json)
trap 'rm -f "${LOGIN_JSON:-}" "${DASH_JSON:-}"' EXIT

# --------- pre-flight: scratch files writable ----------------
# If mktemp's primary AND fallback both fail (no /tmp writable,
# TMPDIR unset/inaccessible), $LOGIN_JSON would be empty and
# the downstream `curl -o ""` + python KeyError would surface as
# a confusing "login returned no usable token" step-3 failure
# rather than the true root cause. Fail loud here so the
# operator gets the right diagnostic immediately.
for f in "$LOGIN_JSON" "$DASH_JSON"; do
  if [ ! -w "$f" ]; then
    # Stream to stderr so a log scraper piping stdout (e.g.
    # `bash scripts/restart-smoke.sh 2>/dev/null`) does not
    # silently swallow this FAIL while still capturing the
    # runtime [FAIL] tags above. Preflight conventions match
    # the curl/systemctl/python3/mktemp loop above.
    printf 'pre-flight FAIL: cannot write scratch file %q (check TMPDIR and /tmp permissions)\n' "$f" >&2
    exit 2
  fi
done

# --------- output formatting ----------------------------------
if [ -t 1 ]; then
  RED=$'\e[31m'; GRN=$'\e[32m'; YEL=$'\e[33m'; BLU=$'\e[34m'; NC=$'\e[0m'
else
  RED=''; GRN=''; YEL=''; BLU=''; NC=''
fi

FAILED=0
START_EPOCH=$(date +%s)

# --------- operator-visible banner ---------------------------
# If the operator forgets to override the default credentials on
# a prod-like box, succeed-on-bad-config would silently affirm a
# compromised state. One-line disclaimer when defaults are in use.
if [ "$ADMIN_USER" = "admin" ] && [ "$ADMIN_PASS" = "admin123" ] \
   && [ "${NO_DEFAULT_CREDS_BANNER:-0}" -ne 1 ]; then
  printf '%sWARN:%s using default admin/admin123 credentials — set ADMIN_USER and ADMIN_PASS if this is not a freshly-installed dev box.\n' \
    "$YEL" "$NC"
fi

ts()   { date -Is; }
hdr()  { printf '\n%s== %s ==%s\n'  "$BLU" "$*" "$NC"; }
ok()   { printf '  %s[ ok ]%s %s\n'   "$GRN" "$NC" "$*"; }
nok()  { printf '  %s[FAIL]%s %s\n'   "$RED" "$NC" "$*"; FAILED=$((FAILED + 1)); }
note() { printf '       %s\n' "$*"; }

# --------- Step 1: reset-failed + restart ---------------------
hdr "Step 1 : restart $SERVICE"
# Clear any start-limit-burst counter first so the restart
# doesn't immediately fail because systemd thinks the unit
# crashed too many times in too short a window. Reset-failed
# returns non-zero when there is nothing to reset (perfectly
# fine), so we record the warning and continue.
if ! reset_out=$(systemctl reset-failed "$SERVICE" 2>&1); then
  note "WARN: reset-failed $SERVICE exited non-zero: ${reset_out//$'\n'/ | } — proceeding with restart"
fi
if ! restart_out=$(systemctl restart "$SERVICE" 2>&1); then
  nok "systemctl restart $SERVICE exited non-zero"
  note "stderr: ${restart_out//$'\n'/ | }"
  note "diagnose: sudo journalctl -u $SERVICE -n 50 --no-pager"
  exit 1  # no point polling if the restart itself failed
fi
ok "systemctl restart $SERVICE OK"

# --------- Step 2: wait for upstream --------------------------
hdr "Step 2 : wait for $UPSTREAM_URL/api/auth/login (max ${WAIT_TIMEOUT}s)"
DEADLINE=$(( $(date +%s) + WAIT_TIMEOUT ))
LAST_HTTPS=()
ATTEMPT=0
ALIVE=0
HTTP_LAST="000"
while [ "$(date +%s)" -lt "$DEADLINE" ]; do
  ATTEMPT=$((ATTEMPT + 1))
  HTTP=$(curl --max-time "$PROBE_TIMEOUT" -s -o /dev/null -w '%{http_code}' \
            -X POST -H 'Content-Type: application/json' -d '{}' \
            "${UPSTREAM_URL}/api/auth/login" 2>/dev/null || echo 000)
  HTTP_LAST="$HTTP"
  # curl writes "000" on connection refused / DNS / TLS handshake
  # failures. We want to show the operator that distinction, so
  # track each poll in LAST_HTTPS but stop on any real HTTP code.
  case "$HTTP" in
    4*|5*) ALIVE=1; break ;;  # any 4xx/5xx = Express answered
  esac
  if [ "${#LAST_HTTPS[@]}" -lt 20 ]; then  # cap memory growth on long tails
    LAST_HTTPS+=("$HTTP")
  fi
  sleep "$PROBE_INTERVAL"
done

if [ "$ALIVE" -ne 1 ]; then
  nok "upstream not responding after ${WAIT_TIMEOUT}s"
  note "polled $ATTEMPT times; last codes: ${LAST_HTTPS[*]:-} $HTTP_LAST"
  note "diagnose: sudo journalctl -u $SERVICE -n 40 --no-pager"
  exit 1
fi
ok "upstream alive after ${ATTEMPT} probe(s) (HTTP=$HTTP_LAST)"

# --------- Step 3: login to grab a real JWT -------------------
hdr "Step 3 : login as $ADMIN_USER"
# Writes the body to $LOGIN_JSON; parses the JWT in-place; the
# EXIT trap removes the file regardless of which step we exit on.
# `${CALL_TIMEOUT}` overrides the legacy hardcoded 5s timeout.
LOGIN_HTTP=$(curl --max-time "$CALL_TIMEOUT" -o "$LOGIN_JSON" -w '%{http_code}' \
              -sS \
              -X POST -H 'Content-Type: application/json' \
              -d "{\"username\":\"$ADMIN_USER\",\"password\":\"$ADMIN_PASS\"}" \
              "${UPSTREAM_URL}/api/auth/login" 2>/dev/null || echo 000)
case "$LOGIN_HTTP" in
  200) ;;
  *) nok "POST /api/auth/login → $LOGIN_HTTP (expected 200)"
     note "body (first 400 chars): $(head -c 400 "$LOGIN_JSON" 2>/dev/null || echo '<missing>')"
     exit 1
     ;;
esac
TOKEN=$(LOGIN_JSON="$LOGIN_JSON" python3 -c '
import json, os
try:
    with open(os.environ["LOGIN_JSON"]) as f:
        print(json.load(f).get("token","") or "")
except Exception:
    print("")
')
if [ "${#TOKEN}" -lt 20 ]; then
  nok "login response had no usable token (len=${#TOKEN})"
  note "raw response (first 400 chars): $(head -c 400 "$LOGIN_JSON" 2>/dev/null || echo '<missing>')"
  exit 1
fi
ok "login OK, JWT len=${#TOKEN}"

# --------- Step 4: authenticated dashboard call ---------------
hdr "Step 4 : GET /api/dashboard/stats"
DASH_HTTP=$(curl --max-time "$CALL_TIMEOUT" -o "$DASH_JSON" -w '%{http_code}' \
              -sS \
              -H "Authorization: Bearer $TOKEN" \
              "${UPSTREAM_URL}/api/dashboard/stats" 2>/dev/null || echo 000)
case "$DASH_HTTP" in
  200)
    SUM=$(DASH_JSON="$DASH_JSON" python3 -c '
import json, os
try:
    d = json.load(open(os.environ["DASH_JSON"])).get("data", {})
    print(",".join(f"{k}={d.get(k,0)}" for k in ("total_clients","active_binds","total_sms_today")))
except Exception:
    print("parse_err")
')
    ok "/api/dashboard/stats → 200  ($SUM)"
    ;;
  *)
    nok "/api/dashboard/stats → $DASH_HTTP (expected 200)"
    note "body (first 400 chars): $(head -c 400 "$DASH_JSON" 2>/dev/null || echo '<missing>')"
    ;;
esac

# --------- Step 5–7: nginx hard-gated ------------------------
if [ "$NGINX_RELOAD" -eq 1 ]; then
  hdr "Step 5 : nginx -t"
  if ! nginx_t_out=$(nginx -t 2>&1); then
    nok "nginx -t FAILED — reloading would corrupt runtime config, aborting reload"
    note "stderr: ${nginx_t_out//$'\n'/ | }"
    note "fix the config (likely an unescaped cert path, missing semicolon, or stale try_files) and re-run."
    # do NOT try to reload — a known-bad config would just make the first symptom worse
  else
    ok "nginx -t OK: $(echo "$nginx_t_out" | head -2 | paste -sd' ' -)"

    hdr "Step 6 : systemctl reload nginx"
    if ! reload_out=$(systemctl reload nginx 2>&1); then
      nok "systemctl reload nginx FAILED"
      note "stderr: ${reload_out//$'\n'/ | }"
    else
      ok "nginx reload OK"

      hdr "Step 7 : GET $SPOTCHECK_URL via nginx"
      N=$(curl --max-time "$CALL_TIMEOUT" -s -o /dev/null -w '%{http_code}' "$SPOTCHECK_URL")
      case "$N" in
        200) ok "GET $SPOTCHECK_URL → 200 (SPA index served)" ;;
        301|302) ok "GET $SPOTCHECK_URL → $N (HTTP→HTTPS redirect active)" ;;
        *) nok "GET $SPOTCHECK_URL → $N (expected 200/301/302)" ;;
      esac
    fi
  fi
else
  note "Steps 5–7 : skipped (NGINX_RELOAD=$NGINX_RELOAD)"
fi

# --------- summary -------------------------------------------
ELAPSED=$(( $(date +%s) - START_EPOCH ))
printf '\n%s=========================================%s\n' "$BLU" "$NC"
printf '  restart-smoke duration: %ds\n' "$ELAPSED"
if [ "$FAILED" -gt 0 ]; then
  printf '  status:                 %sFAIL%s (%d check(s))\n' "$RED" "$NC" "$FAILED"
  exit 1
fi
printf '  status:                 %sPASS%s\n' "$GRN" "$NC"
exit 0
