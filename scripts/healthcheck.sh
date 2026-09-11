#!/usr/bin/env bash
# ============================================================
# scripts/healthcheck.sh
# ------------------------------------------------------------
# Self-healing health probe for the net2app-hub Node.js upstream
# (Express server bound to 127.0.0.1:3001 by install.sh step 5).
#
# Run every minute by net2app-hub-healthcheck.timer (see
# scripts/systemd/net2app-hub-healthcheck.timer). When probe
# fails, restarts the net2app-hub systemd unit so nginx stops
# returning 502 to the frontend.
#
# Why POST /api/auth/login with an empty JSON body:
#   * Doesn't require credentials and certainly won't 200; we
#     only need to prove the Express router is wired up and the
#     pg pool answered — anything in the 4xx range is "alive".
#   * Contacts Postgres on the request path, so a real PG outage
#     still surfaces here (server.cjs would block or crash).
#   * curl returns "000" on connection refused / timeout, which
#     we treat as definitively DOWN.
#
# Flap protection:
#   * State file /var/lib/net2app-hub/healthcheck.state records
#     the epoch of the last restart. We never restart more often
#     than once per $COOLDOWN_SECONDS seconds, so systemd's own
#     Restart=always gets a fair chance to recover, and we don't
#     thrash a service that's mid-recovery.
#
# All knobs are env-overridable so the script can be exercised
# in CI by OVERRIDING, e.g.:
#     HEALTH_URL=http://127.0.0.1:65530 bash scripts/healthcheck.sh
# ============================================================

set -u
set -o pipefail

# -------- Configurable (env-overridable) ----------------------
SERVICE="${SERVICE:-net2app-hub}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3001/api/auth/login}"
PROBE_TIMEOUT="${PROBE_TIMEOUT:-5}"
COOLDOWN_SECONDS="${COOLDOWN_SECONDS:-120}"
LOG_FILE="${LOG_FILE:-/var/log/net2app-hub-healthcheck.log}"
STATE_DIR="${STATE_DIR:-/var/lib/net2app-hub}"
STATE_FILE="${STATE_DIR}/healthcheck.state"

# -------- Helpers ---------------------------------------------
ts()  { date -Is; }

log() {
  # Always emit to stderr so `journalctl -u net2app-hub-healthcheck`
  # captures recent activity, and persist to a logfile so we have
  # history even when journald cycles.
  local msg
  msg="[$(ts)] $*"
  printf '%s\n' "$msg" >&2
  printf '%s\n' "$msg" >> "$LOG_FILE" 2>/dev/null || true
}

mkdir -p "$(dirname "$LOG_FILE")" "$STATE_DIR" 2>/dev/null \
  || log "WARN: could not create log/state dirs (running as non-root?)"

last_restart_epoch() {
  if [ -f "$STATE_FILE" ]; then
    cat "$STATE_FILE" 2>/dev/null || echo 0
  else
    echo 0
  fi
}

# -------- Probe -----------------------------------------------
# Returns 0 if the upstream responded (any HTTP status code),
# 1 if the connection itself failed.
probe() {
  local code
  if ! code=$(curl --max-time "$PROBE_TIMEOUT" -sS -o /dev/null \
                -w '%{http_code}' \
                -X POST -H 'Content-Type: application/json' \
                -d '{}' "$HEALTH_URL" 2>/dev/null); then
    return 1
  fi
  # curl prints "000" on most network failures (timeout, refused)
  # even though our command exited cleanly — treat that as down.
  [ -n "$code" ] && [ "$code" != "000" ]
}

restart_service() {
  # Clear any start-limit burst counters so the restart isn't
  # rejected if systemd thinks the service failed too many times
  # in too short a window.
  systemctl reset-failed "$SERVICE" 2>&1 || log "WARN: reset-failed $SERVICE returned $?"
  # Capture stderr/stdout so a failure (e.g. "Unit not found",
  # permissions denied) lands in OUR persistent log instead of
  # being silently swallowed — diagnosing "why didn't it
  # self-heal?" is the whole point of this script.
  local out rc
  out=$(systemctl restart "$SERVICE" 2>&1) ; rc=$?
  if [ "$rc" -eq 0 ]; then
    date +%s > "$STATE_FILE"
    log "ACTION: restart $SERVICE OK (probe died: $HEALTH_URL)"
  else
    log "ERROR: systemctl restart $SERVICE failed (exit $rc): ${out//$'\n'/ | }"
    return 1
  fi
}

# -------- Main ------------------------------------------------
main() {
  if ! probe; then
    log "FAIL: probe $HEALTH_URL unreachable after ${PROBE_TIMEOUT}s"

    local now last age
    now=$(date +%s)
    last=$(last_restart_epoch)
    age=$(( now - last ))

    if [ "$age" -lt "$COOLDOWN_SECONDS" ]; then
      log "SKIP: restart suppressed (last restart ${age}s ago, cooldown=${COOLDOWN_SECONDS}s)"
      return 0
    fi

    restart_service || true
  fi
  # Healthy: stay silent. Logging once per minute would flood the
  # systemd journal without adding signal.
  return 0
}

main "$@"
