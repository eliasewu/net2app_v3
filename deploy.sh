#!/usr/bin/env bash
# Net2App deployment bootstrap — multi-node aware.
#
# Local/bundled usage (on a server):
#   sudo bash deploy.sh
#
# One-line usage:
#   curl -fsSL https://raw.githubusercontent.com/eliasewu/net2app_v3/main/deploy.sh | sudo bash
#
# Configuration is supplied through environment variables and forwarded to
# install.sh. For example:
#   sudo env MYSQL_REGISTER_CLUSTER=false bash deploy.sh
#
# Post-deploy self-heal (added 2026-09-15):
#   - Ensures .env DB password actually matches PostgreSQL (recreates sms_user
#     password from .env if mismatched — the #1 cause of "HikariPool total=0"
#     and android gateway 'unbound/offline' symptoms).
#   - Creates android gateway columns on suppliers (device_name,
#     last_heartbeat_at, android_version, sim_ready, sim_carrier, sim_number,
#     battery_level, signal_strength, last_device_info_at).
#   - Allows 'android_SMS' in suppliers.connection_type.
#   - Rebuilds the java SMPP gateway jar if missing (service needs
#     java-sms-gateway/target/sms-gateway-1.0.0.jar).
#   - Adds .env.production (DB_* subset) for the net2app-smpg systemd unit
#     when that unit references it.
#   - Verifies hub + SMPP gateway health at the end.
#
# Update an ALREADY-DEPLOYED node without reinstalling (runs only the
# self-heal fixes above):
#   curl -fsSL https://raw.githubusercontent.com/eliasewu/net2app_v3/main/deploy.sh | sudo SELF_HEAL_ONLY=1 bash

set -Eeuo pipefail

readonly INSTALL_URL="${INSTALL_URL:-https://raw.githubusercontent.com/eliasewu/net2app_v3/main/install.sh}"
readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)"

printf '\033[0;36mNet2App deployment bootstrap\033[0m\n'
printf 'Installer source: %s\n' "$INSTALL_URL"

# Fail fast with a clear message instead of a cryptic installer error.
if [[ "$(id -u)" -ne 0 ]]; then
  printf '\033[0;31mERROR:\033[0m deploy.sh must run as root:\n' >&2
  printf '  curl -fsSL https://raw.githubusercontent.com/eliasewu/net2app_v3/main/deploy.sh | sudo bash\n' >&2
  exit 1
fi
if [[ -r /etc/os-release ]] && ! grep -qi '^ID=ubuntu' /etc/os-release; then
  printf '\033[0;31mERROR:\033[0m deploy.sh supports Ubuntu only (detected: %s)\n' "$(grep -E '^ID=' /etc/os-release | cut -d= -f2 | tr -d '"')" >&2
  exit 1
fi
export DEBIAN_FRONTEND=noninteractive

# ---------------------------------------------------------------- run_installer
run_installer() {
  if [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/install.sh" ]]; then
    printf 'Using bundled installer: %s\n' "$SCRIPT_DIR/install.sh"
    bash "$SCRIPT_DIR/install.sh" "$@"
  else
    command -v curl >/dev/null 2>&1 || {
      printf '\033[0;31mERROR:\033[0m curl is required to download install.sh\n' >&2
      exit 1
    }
    # Download to a temporary file so a network interruption cannot pipe a
    # truncated installer into bash. Environment variables remain in the
    # current process and are inherited by the installer.
    local tmp_install
    tmp_install=$(mktemp)
    curl --fail --silent --show-error --location --retry 3 --retry-delay 2 "$INSTALL_URL" -o "$tmp_install"
    [[ -s "$tmp_install" ]] || {
      printf '\033[0;31mERROR:\033[0m downloaded installer is empty — check INSTALL_URL and network\n' >&2
      rm -f "$tmp_install"
      exit 1
    }
    bash -n "$tmp_install" || {
      printf '\033[0;31mERROR:\033[0m downloaded installer failed syntax check — refusing to execute\n' >&2
      rm -f "$tmp_install"
      exit 1
    }
    chmod 700 "$tmp_install"
    bash "$tmp_install" "$@"
    rm -f "$tmp_install"
  fi
}

# ---------------------------------------------------------------- locate_app_dir
# Find where the app lives: /opt/net2app-v3 (newer installs) or
# /home/ubuntu/net2app-v3 (original node layout).
locate_app_dir() {
  if [[ -d /opt/net2app-v3 && -f /opt/net2app-v3/server.cjs ]]; then
    echo /opt/net2app-v3
  elif [[ -d /home/ubuntu/net2app-v3 && -f /home/ubuntu/net2app-v3/server.cjs ]]; then
    echo /home/ubuntu/net2app-v3
  else
    echo ""
  fi
}

# ---------------------------------------------------------------- self_heal
# Fix the classes of breakage observed on live nodes (see header).
self_heal() {
  local APP_DIR
  APP_DIR="$(locate_app_dir)"
  if [[ -z "$APP_DIR" ]]; then
    printf '\033[0;33m[self-heal]\033[0m app dir not found — skipping post-deploy fixes\n'
    return 0
  fi
  printf '\033[0;36m[self-heal]\033[0m applying post-deploy fixes in %s\n' "$APP_DIR"

  local ENV_FILE="$APP_DIR/.env"
  [[ -f "$ENV_FILE" ]] || { printf '\033[0;33m[self-heal]\033[0m no .env — skipping DB checks\n'; return 0; }

  local DB_HOST DB_PORT DB_NAME DB_USER DB_PASS
  DB_HOST=$(grep -E '^DB_HOST=' "$ENV_FILE" | cut -d= -f2- || echo 127.0.0.1)
  DB_PORT=$(grep -E '^DB_PORT=' "$ENV_FILE" | cut -d= -f2- || echo 5432)
  DB_NAME=$(grep -E '^DB_NAME=' "$ENV_FILE" | cut -d= -f2- || echo sms_platform)
  DB_USER=$(grep -E '^DB_USER=' "$ENV_FILE" | cut -d= -f2- || echo sms_user)
  DB_PASS=$(grep -E '^DB_PASS=' "$ENV_FILE" | cut -d= -f2- || true)

  # --- 1) Make the .env DB password authoritative in PostgreSQL ------------
  if PGPASSWORD="$DB_PASS" psql -h "${DB_HOST:-127.0.0.1}" -p "${DB_PORT:-5432}" -U "$DB_USER" -d "$DB_NAME" -tc 'select 1' >/dev/null 2>&1; then
    printf '\033[0;32m[self-heal]\033[0m DB auth OK for %s\n' "$DB_USER"
  else
    printf '\033[0;33m[self-heal]\033[0m DB auth FAILED for %s — resetting role password from .env\n' "$DB_USER"
    sudo -u postgres psql -tc "ALTER ROLE $DB_USER WITH PASSWORD '$DB_PASS';" || {
      printf '\033[0;31m[self-heal]\033[0m could not reset DB password (is postgres running?)\n' >&2
    }
  fi

  # --- 2) Android gateway schema -------------------------------------------
  PGPASSWORD="$DB_PASS" psql -h "${DB_HOST:-127.0.0.1}" -p "${DB_PORT:-5432}" -U "$DB_USER" -d "$DB_NAME" <<'SQL' || true
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS device_name VARCHAR(255);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMP;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS battery_level INTEGER;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS signal_strength INTEGER;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS android_version VARCHAR(60);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS sim_ready BOOLEAN;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS sim_carrier VARCHAR(120);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS sim_number VARCHAR(40);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS last_device_info_at TIMESTAMP;
SQL
  printf '\033[0;32m[self-heal]\033[0m android gateway columns ensured\n'

  # --- 3) Allow android_SMS connection type ---------------------------------
  PGPASSWORD="$DB_PASS" psql -h "${DB_HOST:-127.0.0.1}" -p "${DB_PORT:-5432}" -U "$DB_USER" -d "$DB_NAME" -tc \
    "SELECT 1 FROM pg_constraint WHERE conname='suppliers_connection_type_check' AND pg_get_constraintdef(oid) LIKE '%android_SMS%'" \
    | grep -q 1 || {
    PGPASSWORD="$DB_PASS" psql -h "${DB_HOST:-127.0.0.1}" -p "${DB_PORT:-5432}" -U "$DB_USER" -d "$DB_NAME" <<'SQL' || true
ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS suppliers_connection_type_check;
ALTER TABLE suppliers ADD CONSTRAINT suppliers_connection_type_check
  CHECK (connection_type IN ('smpp','http','ott_whatsapp','ott_telegram','voice_otp','local_bypass','rcs','flash_sms','android_SMS'));
SQL
    printf '\033[0;32m[self-heal]\033[0m android_SMS connection type allowed\n'
  }

  # --- 4) java SMPP gateway jar + .env.production ---------------------------
  local JAR="$APP_DIR/java-sms-gateway/target/sms-gateway-1.0.0.jar"
  if [[ ! -f "$JAR" ]] && command -v mvn >/dev/null 2>&1; then
    printf '\033[0;33m[self-heal]\033[0m SMPP jar missing — building (this can take minutes)...\n'
    ( cd "$APP_DIR/java-sms-gateway" && mvn -q clean package -DskipTests ) || \
      printf '\033[0;31m[self-heal]\033[0m jar build failed — net2app-smpg will stay down\n' >&2
  fi
  local SMPG_UNIT
  SMPG_UNIT=$(systemctl cat net2app-smpg 2>/dev/null | grep -oE 'EnvironmentFile=.*' | head -1 | cut -d= -f2- || true)
  if [[ -n "$SMPG_UNIT" && ! -f "$SMPG_UNIT" ]]; then
    grep -E '^DB_(HOST|PORT|NAME|USER|PASS)=' "$ENV_FILE" > "$SMPG_UNIT" || true
    chmod 640 "$SMPG_UNIT"
    chown "$(stat -c '%U:%G' "$APP_DIR")" "$SMPG_UNIT" 2>/dev/null || true
    printf '\033[0;32m[self-heal]\033[0m created %s (was referenced but missing)\n' "$SMPG_UNIT"
  fi

  # --- 5) Restart services ---------------------------------------------------
  systemctl daemon-reload 2>/dev/null || true
  if systemctl list-unit-files | grep -q '^net2app-hub'; then
    systemctl restart net2app-hub 2>/dev/null || true
  fi
  if systemctl list-unit-files | grep -q '^net2app-smpg'; then
    systemctl restart net2app-smpg 2>/dev/null || true
  fi
  if systemctl list-unit-files | grep -q '^pm2-net2app'; then
    systemctl restart pm2-net2app 2>/dev/null || true
  fi
  sleep 5

  # --- 6) Health check --------------------------------------------------------
  local ok=1
  if curl -sf -o /dev/null http://127.0.0.1:3001/; then
    printf '\033[0;32m[self-heal]\033[0m hub :3001 OK\n'
  else
    printf '\033[0;31m[self-heal]\033[0m hub :3001 NOT responding\n' >&2
    ok=0
  fi
  if timeout 3 bash -c 'exec 3<>/dev/tcp/127.0.0.1/2775' 2>/dev/null; then
    printf '\033[0;32m[self-heal]\033[0m SMPP :2775 OK\n'
  else
    printf '\033[0;33m[self-heal]\033[0m SMPP :2775 not listening (java gateway down?)\n'
  fi
  [[ $ok -eq 1 ]] || return 1
}

# ---------------------------------------------------------------- main
if [[ "${SELF_HEAL_ONLY:-0}" == "1" ]]; then
  printf '\033[0;36mSELF_HEAL_ONLY=1 — skipping installer, running post-deploy fixes only\033[0m\n'
  self_heal || {
    printf '\033[0;31mSelf-heal finished with health-check failures — inspect logs above.\033[0m\n' >&2
    exit 1
  }
  printf '\033[0;32mSelf-heal complete.\033[0m\n'
  exit 0
fi

run_installer "$@"
self_heal || {
  printf '\033[0;31mDeployment finished with health-check failures — inspect logs above.\033[0m\n' >&2
  exit 1
}
printf '\033[0;32mNet2App deployment complete.\033[0m\n'
