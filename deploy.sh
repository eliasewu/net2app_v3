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
# Update an ALREADY-DEPLOYED node without reinstalling (runs only the
# post-deploy self-heal fixes below):
#   curl -fsSL https://raw.githubusercontent.com/eliasewu/net2app_v3/main/deploy.sh | sudo SELF_HEAL_ONLY=1 bash
#
# Post-deploy self-heal (see self_heal()). Previously observed breakage, in the
# order the fixes are applied:
#   1. .env DB password drifting from PostgreSQL — the #1 cause of
#      "HikariPool total=0" and android gateways stuck 'unbound/offline'.
#   2. Android gateway columns on suppliers (device_name, last_heartbeat_at,
#      android_version, sim_ready, sim_carrier, sim_number, battery_level,
#      signal_strength, last_device_info_at) and android_SMS in
#      suppliers.connection_type.
#   3. Frontend bundle integrity (added 2026-09-15). dist/index.html references
#      content-hashed files ("/assets/index-<hash>.js"). If those hashes are
#      missing from dist/assets — e.g. index.html was copied without its bundle
#      — nginx answers "404 text/html" for the ES module and every page renders
#      a blank white screen. deploy.sh now detects the mismatch, rebuilds the
#      SPA and verifies the referenced files are actually served.
#   4. java-sms-gateway/target/sms-gateway-1.0.0.jar is missing or older than
#      its sources; .env.production (DB_* subset) is created when the
#      net2app-smpg unit references it but it does not exist.
#   5. net2app systemd units that have no EnvironmentFile get one, built from
#      the node's .env/.env.production. server.cjs and the java gateway read
#      process.env directly, so such a unit starts "active" with no database
#      credentials and every API call fails ("client password must be a
#      string").
#   6. Services are reloaded — "pm2 startOrReload" when pm2 owns the apps (so
#      .env changes actually take effect) with a systemctl fallback — then the
#      hub, frontend, java bridge and SMPP port are health-checked.
#
# Safety: install.sh aligns an existing checkout with "git reset --hard
# origin/<ref>", which silently discards node-local hotfixes. A full run
# therefore refuses to continue when the app checkout has uncommitted changes
# unless ALLOW_DIRTY=1 is set.
#
# Other knobs:
#   SKIP_FRONTEND_BUILD=1  report missing frontend assets without rebuilding.
#   FORCE_FRONTEND_BUILD=1 rebuild the SPA even when it looks up to date.
#   FORCE_JAVA_BUILD=1     rebuild the SMPP jar even when it looks up to date.
#   APP_DIR=/path          override app directory detection.
#   ALLOW_DIRTY=1          let a full run reset an app checkout with local edits.

set -Eeuo pipefail

readonly INSTALL_URL="${INSTALL_URL:-https://raw.githubusercontent.com/eliasewu/net2app_v3/main/install.sh}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)"
readonly SCRIPT_DIR

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info() { printf '%b[self-heal]%b %s\n' "$CYAN" "$NC" "$*"; }
ok()   { printf '%b[self-heal]%b %s\n' "$GREEN" "$NC" "$*"; }
warn() { printf '%b[self-heal]%b %s\n' "$YELLOW" "$NC" "$*" >&2; }
fail() { printf '%b[self-heal]%b %s\n' "$RED" "$NC" "$*" >&2; }

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
  if [[ -n "${APP_DIR:-}" ]]; then
    [[ -f "$APP_DIR/server.cjs" ]] && { echo "$APP_DIR"; return 0; }
    return 1
  fi
  if [[ -d /opt/net2app-v3 && -f /opt/net2app-v3/server.cjs ]]; then
    echo /opt/net2app-v3
  elif [[ -d /home/ubuntu/net2app-v3 && -f /home/ubuntu/net2app-v3/server.cjs ]]; then
    echo /home/ubuntu/net2app-v3
  else
    echo ""
  fi
}

# ---------------------------------------------------------------- small helpers
# Read KEY from a dotenv file, tolerating "export KEY=" and surrounding quotes
# (a quoted DB_PASS must not be handed to PostgreSQL verbatim).
env_value() {
  local key=$1 file=$2 value
  value=$(grep -E "^[[:space:]]*(export[[:space:]]+)?${key}=" "$file" 2>/dev/null | head -1 | cut -d= -f2- || true)
  value=${value%$'\r'}
  if [[ ${#value} -ge 2 && ( $value == \"*\" || $value == \'*\' ) ]]; then
    value=${value:1:${#value}-2}
  fi
  printf '%s' "$value"
}

app_user_for() {
  local owner
  owner=$(stat -c '%U' "$1" 2>/dev/null || true)
  printf '%s' "${owner:-root}"
}

run_as_app() {
  local dir=$1 app_user=$2
  shift 2
  ( cd "$dir" && runuser -u "$app_user" -- env HOME="/home/$app_user" "$@" )
}

psql_super() {
  if command -v runuser >/dev/null 2>&1; then
    runuser -u postgres -- psql "$@"
  else
    sudo -u postgres psql "$@"
  fi
}

# ---------------------------------------------------------------- frontend bundle
# dist/index.html references "/assets/index-<hash>.js"; the entry bundle in turn
# references its lazily-loaded chunks as "./index-<hash>.js". A hash present in
# index.html but missing from dist/assets makes every page render blank.
frontend_entry_refs() {
  local dist=$1
  grep -oE '(src|href)="[^"]+"' "$dist/index.html" 2>/dev/null \
    | sed -E 's/.*="([^"]+)".*/\1/' \
    | grep -E '^/assets/' \
    | sed 's|^/||' || true
}

frontend_chunk_refs() {
  local dist=$1 ref
  while IFS= read -r ref; do
    [[ -n "$ref" && -f "$dist/$ref" ]] || continue
    grep -oE '"\./[A-Za-z0-9._-]+\.(js|css)"' "$dist/$ref" 2>/dev/null \
      | tr -d '"' | sed 's|^\./|assets/|' || true
  done < <(frontend_entry_refs "$dist")
}

frontend_missing_assets() {
  local dist=$1 ref
  { frontend_entry_refs "$dist"; frontend_chunk_refs "$dist"; } | sort -u | while IFS= read -r ref; do
    if [[ -n "$ref" && ! -f "$dist/$ref" ]]; then printf '%s\n' "$ref"; fi
  done || true
}

# Content fingerprint of the frontend sources. Timestamps alone are not
# trustworthy: a code sync (rsync -a, tar, a fresh copy) can land different
# source while keeping older mtimes, and then a node quietly keeps serving a
# bundle built from the previous source.
frontend_source_fingerprint() {
  local APP_DIR=$1 out
  # "|| true" everywhere: a missing path (find exits non-zero) must not abort the
  # deploy through "set -e" on a command substitution.
  out=$( cd "$APP_DIR" 2>/dev/null && { find src index.html vite.config.ts -type f -print0 2>/dev/null \
      | sort -z | xargs -0 md5sum 2>/dev/null | md5sum | cut -d' ' -f1; } ) || true
  printf '%s' "$out"
  return 0
}

# True when the built bundle does not match the frontend sources, i.e. a code
# sync landed but the SPA was never rebuilt (deployed UI would be stale).
frontend_build_stale() {
  local APP_DIR=$1
  local DIST="$APP_DIR/dist"
  [[ -f "$DIST/index.html" ]] || return 0

  # Preferred: compare source content against the fingerprint recorded by the
  # build deploy.sh performed.
  if [[ -f "$DIST/.source-fingerprint" ]]; then
    [[ "$(cat "$DIST/.source-fingerprint" 2>/dev/null)" != "$(frontend_source_fingerprint "$APP_DIR")" ]]
    return
  fi

  # No recorded fingerprint (bundle produced outside deploy.sh): fall back to
  # modification times.
  [[ -n "$(find "$APP_DIR/src" "$APP_DIR/index.html" "$APP_DIR/vite.config.ts" -newer "$DIST/index.html" -print -quit 2>/dev/null)" ]]
}

# "vite build" empties dist/, which would delete artifacts it does not produce
# (Android APKs, QR images) and break the pairing/download links.
preserve_dist_extras() {
  local DIST=$1 target=$2
  ( cd "$DIST" && find . -mindepth 1 -maxdepth 1 \( -name '*.apk' -o -name '*.idsig' -o -name 'qr' -o -name 'download' \) -exec cp -a {} "$target"/ \; ) 2>/dev/null || true
}

# Rebuild the SPA when the served index.html and dist/assets disagree (white
# screen) or when the sources moved ahead of the build (stale UI).
ensure_frontend_bundle() {
  local APP_DIR=$1 APP_USER=$2 missing
  local DIST="$APP_DIR/dist"
  if [[ ! -f "$DIST/index.html" ]]; then
    warn "no $DIST/index.html — skipping frontend bundle checks"
    return 0
  fi

  local reason=""
  missing=$(frontend_missing_assets "$DIST")
  if [[ -n "$missing" ]]; then
    reason='dist/index.html references assets that are missing from dist/assets — the web UI renders as a blank white page (nginx/app fallback answers text/html for the ES module)'
  elif [[ "${FORCE_FRONTEND_BUILD:-0}" == "1" ]]; then
    reason='FORCE_FRONTEND_BUILD=1 was requested'
  elif frontend_build_stale "$APP_DIR"; then
    reason='the built frontend does not match src/ (stale or partially synced sources) — the deployed UI is out of date'
  fi

  if [[ -z "$reason" ]]; then
    ok "frontend bundle up to date ($(frontend_entry_refs "$DIST" | wc -l) entry refs present)"
    return 0
  fi

  warn "$reason"
  if [[ -n "$missing" ]]; then
    warn 'missing assets:'
    while IFS= read -r ref; do
      if [[ -n "$ref" ]]; then printf '               %s\n' "$ref" >&2; fi
    done <<< "$missing"
  fi

  if [[ "${SKIP_FRONTEND_BUILD:-0}" == "1" ]]; then
    fail 'SKIP_FRONTEND_BUILD=1 — leaving the frontend bundle as is'
    return 1
  fi
  if [[ ! -x "$APP_DIR/node_modules/.bin/vite" ]]; then
    fail "vite is not installed in $APP_DIR/node_modules — cannot rebuild the frontend"
    return 1
  fi

  local keep
  keep=$(mktemp -d)
  preserve_dist_extras "$DIST" "$keep"
  info 'rebuilding frontend bundle (npm run build)...'
  if ! run_as_app "$APP_DIR" "$APP_USER" npm run build; then
    fail 'frontend build failed — the web UI may be broken'
    rm -rf "$keep"
    return 1
  fi
  preserve_dist_extras "$keep" "$DIST"
  rm -rf "$keep"
  chown -R "$APP_USER:$APP_USER" "$DIST"
  # Record what this bundle was built from so later runs compare content.
  frontend_source_fingerprint "$APP_DIR" > "$DIST/.source-fingerprint" || true

  missing=$(frontend_missing_assets "$DIST")
  if [[ -n "$missing" ]]; then
    fail 'frontend still references missing assets after rebuild:'
    while IFS= read -r ref; do
      if [[ -n "$ref" ]]; then printf '               %s\n' "$ref" >&2; fi
    done <<< "$missing"
    return 1
  fi
  ok 'frontend bundle rebuilt and consistent with index.html'
}

# ---------------------------------------------------------------- java gateway
java_source_fingerprint() {
  local APP_DIR=$1 out
  out=$( cd "$APP_DIR/java-sms-gateway" 2>/dev/null && { find src pom.xml -type f -print0 2>/dev/null \
      | sort -z | xargs -0 md5sum 2>/dev/null | md5sum | cut -d' ' -f1; } ) || true
  printf '%s' "$out"
  return 0
}

SMPP_JAR_NAME='sms-gateway-1.0.0.jar'

# The jar must be rebuilt when it is missing, when its sources moved ahead, or
# when its content no longer matches them (rsync/tar syncs keep old mtimes, so
# timestamps alone can hide a changed source tree).
java_build_needed() {
  local APP_DIR=$1
  local JAR="$APP_DIR/java-sms-gateway/target/$SMPP_JAR_NAME"
  local MARKER="$APP_DIR/java-sms-gateway/target/.source-fingerprint"
  [[ -f "$JAR" ]] || return 0
  if [[ "${FORCE_JAVA_BUILD:-0}" == "1" ]]; then
    return 0
  fi
  if [[ -f "$MARKER" ]]; then
    [[ "$(cat "$MARKER" 2>/dev/null)" != "$(java_source_fingerprint "$APP_DIR")" ]] && return 0
    return 1
  fi
  [[ -n "$(find "$APP_DIR/java-sms-gateway/src" "$APP_DIR/java-sms-gateway/pom.xml" -newer "$JAR" -type f -print -quit 2>/dev/null)" ]]
}

# ---------------------------------------------------------------- unit env
# server.cjs reads process.env directly (there is no dotenv in it), and the java
# gateway reads DB_* the same way. A systemd unit started without an
# EnvironmentFile therefore runs with an empty/undefined DB password and loses
# ALL database access — seen on 51.178.20.165 as:
#   "SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string"
# for every API call while the unit still reported "active". Materialize the
# node's config file as an EnvironmentFile for any unit that has none.
ensure_unit_env() {
  local unit=$1
  has_unit "$unit" || return 0

  local referenced
  referenced=$(systemctl cat "$unit" 2>/dev/null | grep -oE 'EnvironmentFile=-?[^ ]+' | head -1 | cut -d= -f2- || true)
  if [[ -n "$referenced" && -f "$referenced" ]]; then
    ok "$unit environment: $referenced"
    return 0
  fi
  if [[ -z "$ENV_FILE" ]]; then
    warn "$unit has no EnvironmentFile and no .env/.env.production to copy from"
    return 0
  fi

  local target="${referenced:-/etc/net2app/net2app.env}"
  install -d -m 0755 "$(dirname "$target")"
  # Only KEY=VALUE lines: comments and blanks would be parsed by systemd too.
  grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE" > "$target" || true
  chmod 640 "$target"
  chown root:root "$target"

  if [[ -z "$referenced" ]]; then
    install -d -m 0755 "/etc/systemd/system/${unit}.service.d"
    printf '[Service]\nEnvironmentFile=%s\n' "$target" \
      > "/etc/systemd/system/${unit}.service.d/10-env.conf"
    systemctl daemon-reload 2>/dev/null || true
    ok "$unit had no EnvironmentFile — added $target via drop-in"
  else
    ok "created missing $target (referenced by $unit)"
  fi
}

# ---------------------------------------------------------------- preflight
# install.sh runs "git reset --hard origin/<ref> && git clean -fd" on an
# existing checkout. Refuse to let that silently discard node-local hotfixes.
preflight_checkout() {
  local APP_DIR=$1 dirty
  [[ -d "$APP_DIR/.git" ]] || return 0
  dirty=$(git -C "$APP_DIR" -c safe.directory="$APP_DIR" status --porcelain 2>/dev/null | grep -vE '^(\?\?|!!)' || true)
  if [[ -z "$dirty" ]]; then
    return 0
  fi
  warn "app checkout at $APP_DIR has uncommitted changes:"
  while IFS= read -r line; do
    if [[ -n "$line" ]]; then printf '               %s\n' "$line" >&2; fi
  done <<< "$dirty"
  if [[ "${ALLOW_DIRTY:-0}" != "1" ]]; then
    fail 'install.sh would discard these changes with "git reset --hard".'
    fail 'Commit/push them, or re-run with ALLOW_DIRTY=1 to accept the reset.'
    return 1
  fi
  warn 'ALLOW_DIRTY=1 — the changes above will be discarded by install.sh'
  return 0
}

# ---------------------------------------------------------------- self_heal
self_heal() {
  local APP_DIR
  APP_DIR="$(locate_app_dir)"
  if [[ -z "$APP_DIR" ]]; then
    warn 'app dir not found — skipping post-deploy fixes'
    return 0
  fi
  info "applying post-deploy fixes in $APP_DIR"

  local APP_USER
  APP_USER="$(app_user_for "$APP_DIR")"

  # systemd unit list, read once. "systemctl list-unit-files | grep -q" would
  # SIGPIPE systemctl as soon as grep matched, and "set -o pipefail" turns that
  # into a failed condition — which silently skipped the restart step entirely.
  local UNITS
  UNITS=$(systemctl list-unit-files --type=service --no-legend --plain 2>/dev/null || true)
  has_unit() { grep -qE "^$1(\.service)?[[:space:]]" <<< "$UNITS"; }

  # Older nodes keep their configuration in .env.production (no .env), so look
  # for both before declaring the DB settings unavailable.
  local ENV_FILE="" candidate
  for candidate in "$APP_DIR/.env" "$APP_DIR/.env.production" "$APP_DIR/.env.local"; do
    if [[ -f "$candidate" ]]; then ENV_FILE="$candidate"; break; fi
  done
  if [[ -z "$ENV_FILE" ]]; then
    warn "no .env/.env.production in $APP_DIR — skipping DB checks"
  else
    info "using configuration file $ENV_FILE"
  fi

  local DB_HOST DB_PORT DB_NAME DB_USER DB_PASS
  DB_HOST=$(env_value DB_HOST "${ENV_FILE:-/dev/null}"); DB_HOST=${DB_HOST:-127.0.0.1}
  DB_PORT=$(env_value DB_PORT "${ENV_FILE:-/dev/null}"); DB_PORT=${DB_PORT:-5432}
  DB_NAME=$(env_value DB_NAME "${ENV_FILE:-/dev/null}"); DB_NAME=${DB_NAME:-sms_platform}
  DB_USER=$(env_value DB_USER "${ENV_FILE:-/dev/null}"); DB_USER=${DB_USER:-sms_user}
  DB_PASS=$(env_value DB_PASS "${ENV_FILE:-/dev/null}")

  if [[ -z "$ENV_FILE" ]]; then
    : # no configuration file — DB steps below are skipped
  elif ! command -v psql >/dev/null 2>&1; then
    warn 'psql is not installed — skipping database checks'
  elif [[ -z "$DB_PASS" ]]; then
    warn "DB_PASS is empty in $ENV_FILE — skipping database checks"
  else
    psql_app() {
      PGPASSWORD="$DB_PASS" psql -v ON_ERROR_STOP=1 -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" "$@"
    }

    # --- 1) Make the .env DB password authoritative in PostgreSQL ------------
    if psql_app -tAc 'select 1' >/dev/null 2>&1; then
      ok "DB auth OK for $DB_USER@$DB_HOST:$DB_PORT/$DB_NAME"
    else
      warn "DB auth FAILED for $DB_USER — resetting role password from .env"
      local escaped_pass=${DB_PASS//\'/\'\'}
      if psql_super -tAc "ALTER ROLE $DB_USER WITH PASSWORD '$escaped_pass';" >/dev/null 2>&1; then
        ok 'role password reset to match .env'
      else
        fail 'could not reset DB password (is PostgreSQL running?)'
      fi
    fi

    # --- 2) Android gateway schema ------------------------------------------
    if psql_app >/dev/null 2>&1 <<'SQL'
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
    then
      ok 'android gateway columns ensured'
    else
      fail 'could not apply android gateway columns (suppliers table/DB unreachable?)'
    fi

    # --- 3) Allow android_SMS connection type -------------------------------
    # Captured into a variable rather than piped into "grep -q": an early grep
    # exit SIGPIPEs psql, and "set -o pipefail" would turn that into a false
    # "constraint missing" verdict on every run.
    local constraint_has_android
    constraint_has_android=$(psql_app -tAc "SELECT 1 FROM pg_constraint WHERE conname='suppliers_connection_type_check' AND pg_get_constraintdef(oid) LIKE '%android_SMS%'" 2>/dev/null || true)
    if [[ "$constraint_has_android" == 1 ]]; then
      ok 'android_SMS connection type already allowed'
    elif psql_app >/dev/null 2>&1 <<'SQL'
ALTER TABLE suppliers DROP CONSTRAINT IF EXISTS suppliers_connection_type_check;
ALTER TABLE suppliers ADD CONSTRAINT suppliers_connection_type_check
  CHECK (connection_type IN ('smpp','http','ott_whatsapp','ott_telegram','voice_otp','local_bypass','rcs','flash_sms','android_SMS'));
SQL
    then
      ok 'android_SMS connection type allowed'
    else
      fail 'could not relax suppliers_connection_type_check'
    fi
  fi

  # --- 4) Frontend bundle (white-screen guard) ------------------------------
  local frontend_ok=1
  ensure_frontend_bundle "$APP_DIR" "$APP_USER" || frontend_ok=0

  # --- 5) java SMPP gateway jar + .env.production ---------------------------
  local JAR="$APP_DIR/java-sms-gateway/target/$SMPP_JAR_NAME"
  if java_build_needed "$APP_DIR"; then
    if [[ -f "$JAR" ]]; then
      info 'java SMPP jar is missing or out of date with its sources'
    fi
    if command -v mvn >/dev/null 2>&1; then
      info 'building SMPP jar (this can take minutes)...'
      if run_as_app "$APP_DIR/java-sms-gateway" "$APP_USER" mvn -q clean package -DskipTests; then
        java_source_fingerprint "$APP_DIR" \
          > "$APP_DIR/java-sms-gateway/target/.source-fingerprint" || true
        ok 'SMPP jar built'
      else
        fail 'jar build failed — net2app-smpg will stay down'
      fi
    else
      fail 'SMPP jar missing/stale and maven is not installed'
    fi
  fi
  # systemd-managed nodes: neither the hub nor the Java gateway has a built-in
  # credential fallback, so a unit without an EnvironmentFile silently runs with
  # no database access. net2app-pcap does not use the database.
  local unit_name
  for unit_name in net2app-hub net2app-smpg; do
    ensure_unit_env "$unit_name"
  done

  # --- 6) Restart services ---------------------------------------------------
  systemctl daemon-reload 2>/dev/null || true

  restart_unit() {
    local unit=$1 pid_before pid_after
    pid_before=$(systemctl show -p MainPID --value "$unit" 2>/dev/null || true)
    if ! systemctl restart "$unit"; then
      fail "$unit restart failed"
      return 1
    fi
    sleep 2
    if ! systemctl is-active --quiet "$unit"; then
      fail "$unit is not active after restart"
      return 1
    fi
    pid_after=$(systemctl show -p MainPID --value "$unit" 2>/dev/null || true)
    ok "$unit restarted (pid ${pid_before:-none} -> ${pid_after:-unknown})"
  }

  local restarted=0
  local unit
  local ECOSYSTEM="$APP_DIR/ecosystem.config.cjs"
  if command -v pm2 >/dev/null 2>&1 && [[ -f "$ECOSYSTEM" ]]; then
    # startOrReload re-reads ecosystem.config.cjs (and the .env it loads), which
    # "pm2 resurrect" from the systemd unit does not — otherwise config changes
    # silently never reach the running processes.
    info 'reloading pm2 apps from ecosystem.config.cjs'
    if ( cd "$APP_DIR" && runuser -u "$APP_USER" -- env HOME="/home/$APP_USER" PM2_HOME="/home/$APP_USER/.pm2" pm2 startOrReload "$ECOSYSTEM" --update-env >/dev/null ); then
      ( cd "$APP_DIR" && runuser -u "$APP_USER" -- env HOME="/home/$APP_USER" PM2_HOME="/home/$APP_USER/.pm2" pm2 save >/dev/null ) || true
      ok 'pm2 apps reloaded from ecosystem.config.cjs'
      restarted=1
    else
      fail 'pm2 reload failed'
    fi
  fi
  # Restart dependencies first: the hub round-trips to the gateway on startup.
  for unit in net2app-smpg net2app-hub; do
    if has_unit "$unit"; then
      restart_unit "$unit" || true
      restarted=1
    fi
  done
  if [[ $restarted -eq 0 ]] && ! command -v pm2 >/dev/null 2>&1 && has_unit 'pm2-'; then
    unit=$(awk '/^pm2-/{print $1; exit}' <<< "$UNITS")
    [[ -n "$unit" ]] && { restart_unit "$unit" || true; restarted=1; }
  fi
  if [[ $restarted -eq 0 ]]; then
    warn 'no net2app/pm2 service found to restart — is this app running as a service?'
  fi
  sleep 5

  # --- 7) Health check --------------------------------------------------------
  local healthy=1
  if curl -sf -o /dev/null "http://127.0.0.1:3001/health"; then
    ok 'hub :3001/health OK'
  else
    fail 'hub :3001/health NOT responding'
    healthy=0
  fi

  # The app answers unknown /assets/* paths with the SPA fallback (index.html),
  # so a 200 alone proves nothing — the content type must be the real module.
  local entry_ref ctype
  while IFS= read -r entry_ref; do
    [[ -n "$entry_ref" ]] || continue
    ctype=$(curl -sf -o /dev/null -w '%{content_type}' "http://127.0.0.1:3001/$entry_ref" 2>/dev/null || true)
    if [[ -n "$ctype" && "$ctype" != text/html* ]]; then
      ok "frontend asset $entry_ref served OK ($ctype)"
    else
      fail "frontend asset $entry_ref is NOT served as a module (got '${ctype:-no response}') — web UI will be blank"
      healthy=0
    fi
  done < <(frontend_entry_refs "$APP_DIR/dist")
  [[ $frontend_ok -eq 1 ]] || healthy=0

  # A gateway that must run here (systemd unit or pm2 ecosystem) failing to come
  # up is a failed deploy, not a footnote: clients lose SMPP binds and DLRs.
  local expect_gateway=0
  if has_unit net2app-smpg || { command -v pm2 >/dev/null 2>&1 && [[ -f "$ECOSYSTEM" ]]; }; then
    expect_gateway=1
  fi

  local wait_s java_ok=0 smpp_ok=0
  for wait_s in 1 2 3 5 8 13 20; do
    if curl -sf -o /dev/null "http://127.0.0.1:9091/health"; then java_ok=1; else sleep "$wait_s"; fi
    if timeout 2 bash -c 'exec 3<>/dev/tcp/127.0.0.1/2775' 2>/dev/null; then smpp_ok=1; else sleep "$wait_s"; fi
    [[ $java_ok -eq 1 && $smpp_ok -eq 1 ]] && break
  done

  if [[ $java_ok -eq 1 ]]; then
    ok 'java bridge :9091/health OK'
  elif [[ $expect_gateway -eq 1 ]]; then
    fail 'java bridge :9091/health NOT responding — the SMPP gateway failed to start'
    healthy=0
  else
    warn 'java bridge :9091/health not responding (no gateway service expected here?)'
  fi

  if [[ $smpp_ok -eq 1 ]]; then
    ok 'SMPP :2775 OK'
  elif [[ $expect_gateway -eq 1 ]]; then
    fail 'SMPP :2775 NOT listening — check: journalctl -u net2app-smpg -n 50'
    healthy=0
  else
    warn 'SMPP :2775 not listening (no gateway service expected here?)'
  fi

  [[ $healthy -eq 1 ]]
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

PREFLIGHT_APP_DIR="$(locate_app_dir)"
if [[ -n "$PREFLIGHT_APP_DIR" ]]; then
  preflight_checkout "$PREFLIGHT_APP_DIR" || exit 1
fi

run_installer "$@"
self_heal || {
  printf '\033[0;31mDeployment finished with health-check failures — inspect logs above.\033[0m\n' >&2
  exit 1
}
printf '\033[0;32mNet2App deployment complete.\033[0m\n'
