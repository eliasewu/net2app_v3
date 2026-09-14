#!/usr/bin/env bash
# shellcheck shell=bash
#
# Net2App production installer for a fresh Ubuntu server.
#
# Example (public repository, with central MySQL registration):
#   curl -fsSL https://raw.githubusercontent.com/eliasewu/net2app_v3/main/install.sh | \
#     sudo env REPO_URL=https://github.com/eliasewu/net2app_v3.git \
#       MYSQL_HOST=mysql.example.com MYSQL_PORT=3306 MYSQL_DATABASE=net2app \
#       MYSQL_USER=cluster_writer MYSQL_PASSWORD='REPLACE_ME' bash -s
#
# The script is intentionally fail-fast. It never creates a fake cluster
# registration when central MySQL credentials are missing or the table schema
# is incompatible.

set -Eeuo pipefail
IFS=$'\n\t'

readonly SCRIPT_NAME="Net2App production installer"
readonly APP_USER="${APP_USER:-net2app}"
readonly APP_HOME="/home/${APP_USER}"
readonly APP_DIR="${APP_DIR:-/opt/net2app-v3}"
readonly REPO_URL="${REPO_URL:-https://github.com/eliasewu/net2app_v3.git}"
readonly REPO_REF="${REPO_REF:-main}"
readonly NODE_MAJOR="${NODE_MAJOR:-22}"
readonly DB_NAME="${DB_NAME:-sms_platform}"
readonly DB_USER="${DB_USER:-sms_user}"
readonly DB_HOST="${DB_HOST:-127.0.0.1}"
readonly DB_PORT="${DB_PORT:-5432}"
readonly APP_PORT="${PORT:-3001}"
readonly SMPP_PORT="${SMPP_PORT:-2775}"
readonly JAVA_BRIDGE_PORT="${JAVA_BRIDGE_PORT:-9091}"
readonly MYSQL_REGISTER_CLUSTER="${MYSQL_REGISTER_CLUSTER:-true}"
readonly LOG_FILE="/var/log/net2app-install.log"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

log()  { printf '%b[%s]%b %s\n' "$GREEN" "$(date '+%F %T')" "$NC" "$*" | tee -a "$LOG_FILE"; }
warn() { printf '%b[WARN]%b %s\n' "$YELLOW" "$NC" "$*" | tee -a "$LOG_FILE" >&2; }
die()  { printf '%b[ERROR]%b %s\n' "$RED" "$NC" "$*" | tee -a "$LOG_FILE" >&2; exit 1; }

on_error() {
  local line=$1
  printf '%b[ERROR]%b Installation failed at line %s. See %s\n' "$RED" "$NC" "$line" "$LOG_FILE" >&2
}
trap 'on_error "$LINENO"' ERR

require_root() {
  [[ "$(id -u)" -eq 0 ]] || die "Run as root, for example: curl -fsSL <url>/install.sh | sudo bash"
}

valid_identifier() {
  [[ "$1" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]
}

sql_quote() {
  local value=${1//\\/\\\\}
  value=${value//\'/\'\'}
  printf "'%s'" "$value"
}

dotenv_quote() {
  local value=${1//\\/\\\\}
  value=${value//\"/\\\"}
  value=${value//$'\n'/\\n}
  value=${value//$'\r'/\\r}
  printf '"%s"' "$value"
}

run_as_app() {
  runuser -u "$APP_USER" -- env HOME="$APP_HOME" PM2_HOME="$APP_HOME/.pm2" "$@"
}

wait_for_port() {
  local port=$1 name=$2 attempts=${3:-60}
  for ((i=1; i<=attempts; i++)); do
    if ss -ltnH "sport = :${port}" 2>/dev/null | grep -q .; then
      log "$name is listening on TCP ${port}"
      return 0
    fi
    sleep 1
  done
  return 1
}

# ---------------------------------------------------------------------------
# 1. OS, architecture, address and interface detection
# ---------------------------------------------------------------------------
require_root
[[ "$SMPP_PORT" == "2775" ]] || die "SMPP_PORT must remain 2775 because the Java gateway entry point uses a fixed port"
[[ "$JAVA_BRIDGE_PORT" == "9091" ]] || die "JAVA_BRIDGE_PORT must remain 9091 because the Java REST bridge uses a fixed port"
mkdir -p "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"
chmod 600 "$LOG_FILE"

[[ -r /etc/os-release ]] || die "/etc/os-release is unavailable"
# shellcheck disable=SC1091
source /etc/os-release
[[ "${ID:-}" == "ubuntu" ]] || die "This installer supports Ubuntu only (detected: ${ID:-unknown})"

ARCH_RAW=$(uname -m)
case "$ARCH_RAW" in
  x86_64)   ARCH="amd64" ;;
  aarch64)  ARCH="arm64" ;;
  armv7l)   ARCH="armhf" ;;
  *) die "Unsupported CPU architecture: $ARCH_RAW" ;;
esac

# iproute2 is present on supported Ubuntu images; use fallbacks before apt.
PRIMARY_ROUTE=$(ip route get 1.1.1.1 2>/dev/null | head -n1 || true)
PRIMARY_IFACE=$(awk '{for (i=1; i<=NF; i++) if ($i == "dev") { print $(i+1); exit }}' <<<"$PRIMARY_ROUTE")
LOCAL_IP=$(awk '{for (i=1; i<=NF; i++) if ($i == "src") { print $(i+1); exit }}' <<<"$PRIMARY_ROUTE")
PRIMARY_IFACE=${PRIMARY_IFACE:-$(ip -o -4 route show to default 2>/dev/null | awk '{print $5; exit}')}
LOCAL_IP=${LOCAL_IP:-$(hostname -I 2>/dev/null | awk '{print $1}')}
PRIMARY_IFACE=${PRIMARY_IFACE:-unknown}
LOCAL_IP=${LOCAL_IP:-127.0.0.1}
PUBLIC_IP=$(curl -4fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)
PUBLIC_IP=${PUBLIC_IP:-$(curl -4fsS --max-time 5 https://ifconfig.me 2>/dev/null || true)}
PUBLIC_IP=${PUBLIC_IP:-$LOCAL_IP}
HOSTNAME_FQDN=$(hostname -f 2>/dev/null || hostname)
NODE_ID="${NODE_ID:-$(cat /proc/sys/kernel/random/uuid 2>/dev/null || openssl rand -hex 16)}"

printf '\n%b============================================================%b\n' "$CYAN" "$NC"
printf '%b  %s%b\n' "$CYAN" "$SCRIPT_NAME" "$NC"
printf '%b============================================================%b\n' "$CYAN" "$NC"
printf '  OS:             %s %s (%s)\n' "$PRETTY_NAME" "${VERSION_ID:-unknown}" "VERSION_CODENAME=${VERSION_CODENAME:-unknown}"
printf '  Architecture:   %s (%s)\n' "$ARCH" "$ARCH_RAW"
printf '  Hostname:       %s\n' "$HOSTNAME_FQDN"
printf '  Interface:      %s\n' "$PRIMARY_IFACE"
printf '  Local IP:       %s\n' "$LOCAL_IP"
printf '  Public IP:      %s\n' "$PUBLIC_IP"
printf '  Node ID:        %s\n' "$NODE_ID"
printf '  Application:    %s\n' "$APP_DIR"
printf '  API/SMPP/Java:  %s/%s/%s\n' "$APP_PORT" "$SMPP_PORT" "$JAVA_BRIDGE_PORT"
printf '%b============================================================%b\n\n' "$CYAN" "$NC"

# ---------------------------------------------------------------------------
# 2. Prerequisites and kernel tuning
# ---------------------------------------------------------------------------
export DEBIAN_FRONTEND=noninteractive
log "Installing OS prerequisites"
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates curl wget git gnupg lsb-release build-essential \
  iproute2 net-tools procps openssl rsync nginx ufw \
  redis-server redis-tools postgresql postgresql-contrib \
  mysql-client openjdk-21-jdk maven

# Small VPS nodes can OOM during npm/maven builds. Ensure swap exists before
# any build step runs.
MEM_MB=$(free -m | awk '/^Mem:/{print $2}')
SWAP_MB=$(free -m | awk '/^Swap:/{print $2}')
if [[ "${MEM_MB:-0}" -lt 2000 && "${SWAP_MB:-0}" -lt 1024 && ! -f /swapfile ]]; then
  log "Low-memory node (${MEM_MB:-?} MB RAM, ${SWAP_MB:-0} MB swap) — creating 2G swapfile"
  fallocate -l 2G /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'process.versions.node.split(".")[0]')" -lt "$NODE_MAJOR" ]]; then
  log "Installing Node.js ${NODE_MAJOR}.x LTS"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y nodejs
fi

command -v node >/dev/null || die "Node.js installation failed"
command -v npm >/dev/null || die "npm installation failed"
log "Node.js $(node --version), npm $(npm --version)"

log "Installing PM2"
npm install --global --no-audit --no-fund pm2
command -v pm2 >/dev/null || die "PM2 installation failed"

log "Applying high-throughput network and file-descriptor limits"
LIMITS_BEGIN="# NET2APP-BEGIN"
LIMITS_END="# NET2APP-END"
if ! grep -qF "$LIMITS_BEGIN" /etc/security/limits.conf; then
  cat >> /etc/security/limits.conf <<EOF

$LIMITS_BEGIN
* soft nofile 1048576
* hard nofile 1048576
* soft nproc 131072
* hard nproc 131072
${APP_USER} soft nofile 1048576
${APP_USER} hard nofile 1048576
$LIMITS_END
EOF
fi

SYSCTL_FILE=/etc/sysctl.d/99-net2app-sms.conf
cat > "$SYSCTL_FILE" <<'EOF'
# NET2APP high-throughput SMPP/API tuning
fs.file-max = 2097152
net.core.somaxconn = 65535
net.core.netdev_max_backlog = 250000
net.ipv4.ip_local_port_range = 10240 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.tcp_fin_timeout = 15
net.ipv4.tcp_keepalive_time = 60
net.ipv4.tcp_keepalive_intvl = 15
net.ipv4.tcp_keepalive_probes = 4
net.ipv4.tcp_tw_reuse = 1
EOF
sysctl --system >/tmp/net2app-sysctl.out 2>&1 || { tail -50 /tmp/net2app-sysctl.out; die "sysctl tuning failed"; }

systemctl enable --now redis-server postgresql
redis-cli -h 127.0.0.1 -p 6379 ping | grep -qx PONG || die "Redis health check failed"
log "Redis is healthy"

# Refresh detection after bootstrap packages are installed. Minimal Ubuntu
# images may not have curl/iproute2 before apt, so the initial values can be
# incomplete; these are the values persisted to .env and sent to MySQL.
if command -v ip >/dev/null 2>&1; then
  PRIMARY_ROUTE=$(ip route get 1.1.1.1 2>/dev/null | head -n1 || true)
  PRIMARY_IFACE=$(awk '{for (i=1; i<=NF; i++) if ($i == "dev") { print $(i+1); exit }}' <<<"$PRIMARY_ROUTE")
  LOCAL_IP=$(awk '{for (i=1; i<=NF; i++) if ($i == "src") { print $(i+1); exit }}' <<<"$PRIMARY_ROUTE")
fi
PRIMARY_IFACE=${PRIMARY_IFACE:-$(ip -o -4 route show to default 2>/dev/null | awk '{print $5; exit}')}
LOCAL_IP=${LOCAL_IP:-$(hostname -I 2>/dev/null | awk '{print $1}')}
PRIMARY_IFACE=${PRIMARY_IFACE:-unknown}
LOCAL_IP=${LOCAL_IP:-127.0.0.1}
PUBLIC_IP=$(curl -4fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)
PUBLIC_IP=${PUBLIC_IP:-$(curl -4fsS --max-time 5 https://ifconfig.me 2>/dev/null || true)}
PUBLIC_IP=${PUBLIC_IP:-$LOCAL_IP}
log "Final network detection: interface=${PRIMARY_IFACE}, local_ip=${LOCAL_IP}, public_ip=${PUBLIC_IP}"

# ---------------------------------------------------------------------------
# 3. Application user, repository and PostgreSQL configuration
# ---------------------------------------------------------------------------
if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --create-home --home-dir "$APP_HOME" --shell /bin/bash "$APP_USER"
fi
install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$APP_DIR"
# Existing installations may have been cloned by root during an interrupted
# first run; normalize ownership before running Git as APP_USER.
if [[ -d "$APP_DIR/.git" ]]; then
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
fi

if [[ -f "$APP_DIR/server.cjs" && -f "$APP_DIR/package.json" ]]; then
  if [[ -d "$APP_DIR/.git" ]]; then
    log "Repository already exists; updating with fast-forward only"
    run_as_app git -C "$APP_DIR" fetch --prune origin "$REPO_REF"
    # The public repository may intentionally be rewritten to remove exposed
    # history. The application directory is installer-managed, so align it to
    # the fetched deployment ref rather than merging unrelated histories.
    run_as_app git -C "$APP_DIR" reset --hard "origin/$REPO_REF"
    run_as_app git -C "$APP_DIR" clean -fd
  else
    log "Using pre-staged application source at $APP_DIR"
  fi
else
  if [[ -e "$APP_DIR" && ! -d "$APP_DIR" ]]; then
    die "APP_DIR exists but is not a directory: $APP_DIR"
  fi
  if [[ -d "$APP_DIR" && -n "$(find "$APP_DIR" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]]; then
    die "APP_DIR is non-empty but does not contain a valid Net2App source tree: $APP_DIR"
  fi
  log "Cloning repository ${REPO_URL} (${REPO_REF})"
  clone_args=("-b" "$REPO_REF" "--single-branch")
  if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    git -c "http.extraheader=AUTHORIZATION: bearer ${GITHUB_TOKEN}" clone "${clone_args[@]}" "$REPO_URL" "$APP_DIR"
  else
    git clone "${clone_args[@]}" "$REPO_URL" "$APP_DIR"
  fi
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

valid_identifier "$DB_NAME" || die "Invalid DB_NAME: $DB_NAME"
valid_identifier "$DB_USER" || die "Invalid DB_USER: $DB_USER"
DB_PASS="${DB_PASS:-$(openssl rand -hex 32)}"
JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"

log "Configuring PostgreSQL database ${DB_NAME}"
DB_PASS_SQL=$(sql_quote "$DB_PASS")
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -Atqc \
  "DO \$\$ BEGIN
     IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = $(sql_quote "$DB_USER")) THEN
       CREATE ROLE \"$DB_USER\" LOGIN PASSWORD $DB_PASS_SQL;
     ELSE
       ALTER ROLE \"$DB_USER\" LOGIN PASSWORD $DB_PASS_SQL;
     END IF;
   END \$\$;"

if ! runuser -u postgres -- psql -Atqc "SELECT 1 FROM pg_database WHERE datname = $(sql_quote "$DB_NAME")" | grep -qx 1; then
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$DB_NAME\" OWNER \"$DB_USER\";"
fi
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -d "$DB_NAME" -c "GRANT ALL ON SCHEMA public TO \"$DB_USER\";"

cd "$APP_DIR"
CORE_TABLES=$(runuser -u postgres -- psql -d "$DB_NAME" -Atqc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name IN ('users','clients','sms_logs')" || echo 0)
FRESH_DB=0
if [[ "${CORE_TABLES:-0}" -eq 0 ]]; then
  FRESH_DB=1
  [[ -f src/database/schema.sql ]] || die "src/database/schema.sql is missing"
  log "Fresh PostgreSQL database: applying schema.sql"
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 -1 -q -d "$DB_NAME" < src/database/schema.sql
else
  log "Existing PostgreSQL database detected: skipping destructive schema.sql"
fi

# Apply migrations in dependency order. Several migrations alter tables created
# by migrate_v2.sql, so filesystem/glob order is deliberately not used.
MIGRATIONS=(
  src/database/migrate_v2.sql
  src/database/migrate_voice_otp_v3.sql
  src/database/migrate_queue.sql
  src/database/migrate_add_blocking_rules.sql
  src/database/migrate_block_ethiopia.sql
  src/database/migrate_add_voice_otp_config_id.sql
  src/database/migrate_otp_pattern.sql
  src/database/migrate_dlr_match_ids.sql
  src/database/migrate_translations_v4.sql
  src/database/migrate_keyword_replace.sql
  src/database/migrate_message_type.sql
  src/database/migrate_pcap.sql
  src/database/migrate_security.sql
  src/database/migrate_supplier_heartbeat.sql
  src/database/migrate_supplier_device_info.sql
)
for migration in "${MIGRATIONS[@]}"; do
  [[ -f "$migration" ]] || continue
  log "Applying $(basename "$migration")"
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 -1 -q -d "$DB_NAME" < "$migration"
done
if [[ -f db_migration_add_missing_columns.sql ]]; then
  log "Applying db_migration_add_missing_columns.sql"
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 -1 -q -d "$DB_NAME" < db_migration_add_missing_columns.sql
fi

# Migrations run as postgres, but the API and queue workers run as APP_USER's
# database role. Transfer ownership so worker functions that use row locking,
# ALTER/maintenance operations, or sequence writes are fully authorized.
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -d "$DB_NAME" <<SQL
DO \$\$
DECLARE
  item RECORD;
BEGIN
  FOR item IN
    SELECT tablename AS object_name
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I OWNER TO %I', item.object_name, '$DB_USER');
  END LOOP;

  FOR item IN
    SELECT sequence_name AS object_name
    FROM information_schema.sequences
    WHERE sequence_schema = 'public'
  LOOP
    EXECUTE format('ALTER SEQUENCE public.%I OWNER TO %I', item.object_name, '$DB_USER');
  END LOOP;
END
\$\$;
SQL

# The schema is executed by postgres, while the API runs as APP_USER. Grant
# existing and future object privileges explicitly; schema privileges alone do
# not grant table or sequence DML in PostgreSQL.
runuser -u postgres -- psql -v ON_ERROR_STOP=1 -d "$DB_NAME" <<SQL
GRANT USAGE, CREATE ON SCHEMA public TO "$DB_USER";
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "$DB_USER";
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO "$DB_USER";
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO "$DB_USER";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO "$DB_USER";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO "$DB_USER";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO "$DB_USER";
SQL

# Seed only a fresh database. seed_translations.sql intentionally TRUNCATEs
# translations and must never run during an in-place production upgrade.
if [[ "$FRESH_DB" -eq 1 && -f src/database/seed_translations.sql ]]; then
  log "Seeding default translation rules"
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 -1 -q -d "$DB_NAME" < src/database/seed_translations.sql
fi

# ---------------------------------------------------------------------------
# 4. Environment, dependencies and production assets
# ---------------------------------------------------------------------------
log "Writing protected application environment"
ENV_FILE="$APP_DIR/.env"
cat > "$ENV_FILE" <<EOF
NODE_ENV=production
PORT=$APP_PORT
SMPP_PORT=$SMPP_PORT
SERVER_IP=$PUBLIC_IP
PUBLIC_IP=$PUBLIC_IP
LOCAL_IP=$LOCAL_IP
NETWORK_INTERFACE=$PRIMARY_IFACE
NODE_ID=$NODE_ID

DB_HOST=$DB_HOST
DB_PORT=$DB_PORT
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASS=$(dotenv_quote "$DB_PASS")
JWT_SECRET=$(dotenv_quote "$JWT_SECRET")
COOKIE_SECURE=${COOKIE_SECURE:-false}

REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_URL=redis://127.0.0.1:6379
JAVA_GATEWAY_HOST=127.0.0.1
JAVA_GATEWAY_PORT=$JAVA_BRIDGE_PORT
EOF
chmod 600 "$ENV_FILE"
chown "$APP_USER:$APP_USER" "$ENV_FILE"

log "Installing Node dependencies"
run_as_app bash -c "cd '$APP_DIR' && PUPPETEER_SKIP_DOWNLOAD=true npm install --no-audit --no-fund --legacy-peer-deps"

# Full MCC/MNC operator reference dataset (2,938 networks / 227 countries).
# Idempotent: wipes and re-inserts in one transaction. Used by route
# resolution (destination number -> MCC/MNC -> client rates).
if [[ -f "$APP_DIR/src/database/import_mccmnc.cjs" && -f "$APP_DIR/src/database/mccmnc_full.json" ]]; then
  log "Loading MCC/MNC operator database"
  run_as_app bash -c "cd '$APP_DIR' && set -a && . ./.env && set +a && node src/database/import_mccmnc.cjs" || warn "MCC/MNC import failed (non-fatal) — rerun: node src/database/import_mccmnc.cjs"
fi

log "Building frontend"
run_as_app bash -c "cd '$APP_DIR' && npm run build"
# Nginx serves only the compiled frontend as www-data. Keep the application
# directory and .env private while granting traversal/read access to dist.
chmod 751 "$APP_DIR"
find "$APP_DIR/dist" -type d -exec chmod 755 {} +
find "$APP_DIR/dist" -type f -exec chmod 644 {} +

# Net2appPro Android gateway APK: git ignores *.apk so a fresh clone has none.
# Serve the newest APK found in public/, optionally downloading one via APK_URL.
APK_FILE=""
for f in "$APP_DIR"/public/net2apppro-*.apk; do
  [[ -f "$f" ]] && APK_FILE="$f"
done
if [[ -z "$APK_FILE" && -n "${APK_URL:-}" ]]; then
  log "Downloading Net2appPro APK from APK_URL"
  curl -fsSL --retry 3 --retry-delay 2 -o "$APP_DIR/public/net2apppro-download.apk" "$APK_URL"
  APK_FILE="$APP_DIR/public/net2apppro-download.apk"
fi
if [[ -n "$APK_FILE" ]]; then
  chmod 644 "$APK_FILE"
  chown "$APP_USER:$APP_USER" "$APK_FILE"
  log "Net2appPro APK ready: /download/$(basename "$APK_FILE") (alias /download/net2app-gateway.apk)"
else
  warn "No Net2appPro APK in public/ and APK_URL not set — copy an APK to $APP_DIR/public/ or set APK_URL, otherwise the Android pairing download 404s"
fi

if [[ -f "$APP_DIR/java-sms-gateway/pom.xml" ]]; then
  log "Building Java SMPP gateway"
  run_as_app bash -c "cd '$APP_DIR/java-sms-gateway' && mvn -q -DskipTests package"
  JAVA_JAR=$(find "$APP_DIR/java-sms-gateway/target" -maxdepth 1 -type f -name 'sms-gateway-*.jar' ! -name '*original*' | sort | head -n1)
  [[ -n "$JAVA_JAR" ]] || die "Java SMPP gateway JAR was not produced"
else
  die "java-sms-gateway/pom.xml is missing"
fi

# PM2 loads this file as the single source of truth for both daemons. dotenv
# reads .env without putting credentials on the command line or in the PM2 CLI.
PM2_CONFIG="$APP_DIR/ecosystem.config.cjs"
cat > "$PM2_CONFIG" <<'EOF'
const path = require('path');
const dotenv = require('dotenv');
const appDir = __dirname;
dotenv.config({ path: path.join(appDir, '.env') });

const sharedEnv = {
  ...process.env,
  NODE_ENV: 'production',
};

module.exports = {
  apps: [
    {
      name: 'net2app-api',
      cwd: appDir,
      script: 'server.cjs',
      interpreter: '/usr/bin/node',
      exec_mode: 'fork',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      kill_timeout: 30000,
      listen_timeout: 15000,
      restart_delay: 5000,
      time: true,
      env: sharedEnv,
    },
    {
      name: 'net2app-smpg',
      cwd: path.join(appDir, 'java-sms-gateway'),
      script: '/usr/bin/java',
      args: ['-jar', '__JAVA_JAR__'],
      interpreter: 'none',
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      kill_timeout: 30000,
      restart_delay: 5000,
      time: true,
      env: sharedEnv,
    },
  ],
};
EOF
# Use the actually-built JAR file name instead of assuming a fixed version.
sed -i "s|__JAVA_JAR__|$JAVA_JAR|g" "$PM2_CONFIG"
chown "$APP_USER:$APP_USER" "$PM2_CONFIG"
chmod 640 "$PM2_CONFIG"

# ---------------------------------------------------------------------------
# 5. Nginx, firewall and PM2 boot registration
# ---------------------------------------------------------------------------
log "Configuring Nginx reverse proxy"
install -d -m 0755 /var/www/certbot
NGINX_SITE=/etc/nginx/sites-available/net2app
cat > "$NGINX_SITE" <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;
    root $APP_DIR/dist;

    # Let's Encrypt HTTP-01 challenge responses (also used for IP certificates
    # when ENABLE_HTTPS=true)
    location ^~ /.well-known/acme-challenge/ {
        root /var/www/certbot;
        default_type "text/plain";
    }
    index index.html;
    client_max_body_size 50M;

    location /api/ {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
    }

    location /ws/ {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
    }

    # API serves /health, /install (one-tap APK page) and /download (APK) from
    # public/; without these the SPA fallback below would answer with
    # index.html instead.
    location = /health {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_set_header Host \$host;
    }

    location = /install {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_set_header Host \$host;
    }

    location /download/ {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_set_header Host \$host;
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
}
EOF
ln -sfn "$NGINX_SITE" /etc/nginx/sites-enabled/net2app
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx

log "Configuring firewall (database, Redis and Java bridge remain private)"
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow "$SMPP_PORT"/tcp
ufw --force enable

log "Registering PM2 for automatic boot"
PM2_BIN=$(command -v pm2)
install -d -o "$APP_USER" -g "$APP_USER" -m 0750 "$APP_HOME/.pm2"
pm2 startup systemd -u "$APP_USER" --hp "$APP_HOME" >/tmp/net2app-pm2-startup.log 2>&1 || {
  cat /tmp/net2app-pm2-startup.log >&2
  die "pm2 startup failed"
}
# The PM2-generated unit is intentionally replaced below. PM2's generated
# Type=forking service can report a protocol failure when resurrect finds an
# already-running daemon; a oneshot resident unit is deterministic on reruns.
PM2_SERVICE="pm2-${APP_USER}"
cat > "/etc/systemd/system/${PM2_SERVICE}.service" <<EOF
[Unit]
Description=PM2 process manager for ${APP_USER}
After=network.target

[Service]
Type=oneshot
RemainAfterExit=yes
User=${APP_USER}
Environment=HOME=${APP_HOME}
Environment=PM2_HOME=${APP_HOME}/.pm2
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStart=${PM2_BIN} resurrect
ExecReload=${PM2_BIN} reload all
ExecStop=${PM2_BIN} kill
LimitNOFILE=1048576
LimitNPROC=131072

[Install]
WantedBy=multi-user.target
EOF
mkdir -p "/etc/systemd/system/${PM2_SERVICE}.service.d"
cat > "/etc/systemd/system/${PM2_SERVICE}.service.d/limits.conf" <<'EOF'
[Service]
LimitNOFILE=1048576
LimitNPROC=131072
EOF
systemctl daemon-reload
systemctl enable "$PM2_SERVICE"

run_as_app pm2 delete net2app-api >/dev/null 2>&1 || true
run_as_app pm2 delete net2app-smpg >/dev/null 2>&1 || true
run_as_app pm2 start "$PM2_CONFIG"
run_as_app pm2 save
systemctl restart "$PM2_SERVICE"

# ---------------------------------------------------------------------------
# 6b. Optional HTTPS with a Let's Encrypt IP certificate (ENABLE_HTTPS=true)
# ---------------------------------------------------------------------------
# Let's Encrypt issues trusted certificates for bare IP addresses using the
# shortlived profile (6-day validity, auto-renewed by certbot). Requires
# certbot >= 5.4 (installed via snap below when missing). When enabled, the
# web UI redirects HTTP->HTTPS while /api, /health, /install and /download
# stay reachable over plain HTTP for Android gateways.
if [[ "${ENABLE_HTTPS:-false}" == "true" ]]; then
  if ! command -v certbot >/dev/null 2>&1; then
    log "Installing certbot (snap)"
    apt-get install -y snapd
    snap install core 2>/dev/null || true
    snap refresh core 2>/dev/null || true
    snap install --classic certbot
    ln -sfn /snap/bin/certbot /usr/bin/certbot
  fi
  CERTBOT_MAJOR=$(certbot --version 2>/dev/null | grep -oE '[0-9]+' | head -n1)
  [[ "${CERTBOT_MAJOR:-0}" -ge 5 ]] || die "certbot >= 5.4 is required for IP address certificates"

  if [[ -f "/etc/letsencrypt/live/$PUBLIC_IP/fullchain.pem" ]]; then
    log "IP certificate for $PUBLIC_IP already present"
  else
    log "Requesting Let's Encrypt IP certificate for $PUBLIC_IP (staging validation)"
    certbot certonly --staging --non-interactive --agree-tos --register-unsafely-without-email \
      --preferred-profile shortlived --webroot --webroot-path /var/www/certbot \
      --ip-address "$PUBLIC_IP"
    certbot delete --cert-name "$PUBLIC_IP" --non-interactive
    log "Requesting production IP certificate for $PUBLIC_IP"
    certbot certonly --non-interactive --agree-tos --register-unsafely-without-email \
      --preferred-profile shortlived --webroot --webroot-path /var/www/certbot \
      --ip-address "$PUBLIC_IP"
  fi

  install -d -m 0755 /etc/letsencrypt/renewal-hooks/deploy
  cat > /etc/letsencrypt/renewal-hooks/deploy/reload-net2app-nginx.sh <<'HOOK'
#!/bin/bash
# Reload nginx so renewed certificates are picked up immediately
/usr/sbin/nginx -t >/dev/null 2>&1 && systemctl reload nginx
HOOK
  chmod +x /etc/letsencrypt/renewal-hooks/deploy/reload-net2app-nginx.sh

  NGINX_TLS_BLOCK="
# ---- port 443: full site over TLS ------------------------------------------
server {
    listen 443 ssl;
    listen [::]:443 ssl;
    server_name _;

    ssl_certificate     /etc/letsencrypt/live/$PUBLIC_IP/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$PUBLIC_IP/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;
    ssl_session_tickets off;
    ssl_prefer_server_ciphers off;

    root $APP_DIR/dist;
    index index.html;
    client_max_body_size 50M;

    location /api/ {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_read_timeout 300s;
    }

    location /ws/ {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \"upgrade\";
        proxy_set_header Host \$host;
    }

    location = /health {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_set_header Host \$host;
    }

    location = /install {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_set_header Host \$host;
    }

    location /download/ {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_set_header Host \$host;
    }

    location /assets/ {
        expires 30d;
        add_header Cache-Control \"public, immutable\";
        try_files \$uri =404;
    }

    location = /index.html {
        add_header Cache-Control \"no-cache\";
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
"
  if ! grep -q "listen 443 ssl" "$NGINX_SITE"; then
    # Flip the :80 web-UI location to a redirect BEFORE appending the TLS block
    # (the 443 block itself keeps serving the SPA directly).
    sed -i 's|try_files \$uri \$uri/ /index.html;|return 301 https://\$host\$request_uri;|' "$NGINX_SITE"
    printf '%s\n' "$NGINX_TLS_BLOCK" >> "$NGINX_SITE"
  fi
  nginx -t
  systemctl reload nginx
  log "HTTPS enabled: https://$PUBLIC_IP/ (web UI redirects; API/gateway endpoints remain on HTTP)"
fi

# ---------------------------------------------------------------------------
# 7. Central MySQL cluster registration and diagnostics
# ---------------------------------------------------------------------------
mysql_config_file=$(mktemp /run/net2app-mysql.XXXXXX)
cleanup_mysql_config() { rm -f "$mysql_config_file"; }
trap cleanup_mysql_config EXIT
chmod 600 "$mysql_config_file"

if [[ "$MYSQL_REGISTER_CLUSTER" == "true" ]]; then
  : "${MYSQL_HOST:?MYSQL_HOST is required when MYSQL_REGISTER_CLUSTER=true}"
  : "${MYSQL_DATABASE:?MYSQL_DATABASE is required when MYSQL_REGISTER_CLUSTER=true}"
  : "${MYSQL_USER:?MYSQL_USER is required when MYSQL_REGISTER_CLUSTER=true}"
  : "${MYSQL_PASSWORD:?MYSQL_PASSWORD is required when MYSQL_REGISTER_CLUSTER=true}"
  MYSQL_PORT="${MYSQL_PORT:-3306}"
  cat > "$mysql_config_file" <<EOF
[client]
host=$MYSQL_HOST
port=$MYSQL_PORT
database=$MYSQL_DATABASE
user=$MYSQL_USER
password=$MYSQL_PASSWORD
connect-timeout=10
EOF
  chmod 600 "$mysql_config_file"
  mysql_cmd=(mysql --defaults-extra-file="$mysql_config_file" --batch --skip-column-names --raw)
  "${mysql_cmd[@]}" -e 'SELECT 1' | grep -qx 1 || die "Central MySQL connectivity check failed"

  TABLE_EXISTS=$("${mysql_cmd[@]}" -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='cluster_nodes'")
  [[ "$TABLE_EXISTS" == "1" ]] || die "Central MySQL table cluster_nodes does not exist"

  # Discover common column names so the installer works with the usual
  # cluster_nodes variants without guessing or writing to unrelated columns.
  mapfile -t MYSQL_COLUMNS < <("${mysql_cmd[@]}" -e 'SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name="cluster_nodes" ORDER BY ORDINAL_POSITION')
  has_mysql_column() {
    local candidate=$1 column
    for column in "${MYSQL_COLUMNS[@]}"; do [[ "$column" == "$candidate" ]] && return 0; done
    return 1
  }
  add_mysql_field() {
    MYSQL_INSERT_COLUMNS+=("$1")
    MYSQL_INSERT_VALUES+=("$2")
    MYSQL_UPDATE_VALUES+=("\`$1\`=$2")
  }

  MYSQL_INSERT_COLUMNS=(); MYSQL_INSERT_VALUES=(); MYSQL_UPDATE_VALUES=()
  if has_mysql_column node_id; then add_mysql_field node_id "$(sql_quote "$NODE_ID")"; fi
  if has_mysql_column node_uuid; then add_mysql_field node_uuid "$(sql_quote "$NODE_ID")"; fi
  if has_mysql_column node_name; then add_mysql_field node_name "$(sql_quote "$HOSTNAME_FQDN")"; fi
  if has_mysql_column hostname; then add_mysql_field hostname "$(sql_quote "$HOSTNAME_FQDN")"; fi
  if has_mysql_column name && ! has_mysql_column node_name; then add_mysql_field name "$(sql_quote "$HOSTNAME_FQDN")"; fi
  if has_mysql_column ip_address; then add_mysql_field ip_address "$(sql_quote "$PUBLIC_IP")"; fi
  if has_mysql_column public_ip; then add_mysql_field public_ip "$(sql_quote "$PUBLIC_IP")"; fi
  if has_mysql_column local_ip; then add_mysql_field local_ip "$(sql_quote "$LOCAL_IP")"; fi
  if has_mysql_column network_interface; then add_mysql_field network_interface "$(sql_quote "$PRIMARY_IFACE")"; fi
  if has_mysql_column interface_name; then add_mysql_field interface_name "$(sql_quote "$PRIMARY_IFACE")"; fi
  if has_mysql_column status; then add_mysql_field status "'active'"; fi
  if has_mysql_column role; then add_mysql_field role "'worker'"; fi
  if has_mysql_column node_role; then add_mysql_field node_role "'worker'"; fi
  if has_mysql_column api_port; then add_mysql_field api_port "$APP_PORT"; fi
  if has_mysql_column smpp_port; then add_mysql_field smpp_port "$SMPP_PORT"; fi
  if has_mysql_column last_heartbeat; then add_mysql_field last_heartbeat 'NOW()'; fi
  if has_mysql_column heartbeat_at; then add_mysql_field heartbeat_at 'NOW()'; fi
  if has_mysql_column registered_at; then add_mysql_field registered_at 'NOW()'; fi
  if has_mysql_column created_at; then add_mysql_field created_at 'NOW()'; fi
  if has_mysql_column updated_at; then add_mysql_field updated_at 'NOW()'; fi

  ((${#MYSQL_INSERT_COLUMNS[@]} > 0)) || die "cluster_nodes has no recognized registration columns"
  MYSQL_COL_SQL=$(IFS=,; printf '%s' "${MYSQL_INSERT_COLUMNS[*]}")
  MYSQL_VAL_SQL=$(IFS=,; printf '%s' "${MYSQL_INSERT_VALUES[*]}")
  MYSQL_UPDATE_SQL=$(IFS=,; printf '%s' "${MYSQL_UPDATE_VALUES[*]}")
  "${mysql_cmd[@]}" -e "INSERT INTO cluster_nodes (${MYSQL_COL_SQL}) VALUES (${MYSQL_VAL_SQL}) ON DUPLICATE KEY UPDATE ${MYSQL_UPDATE_SQL}"
  log "Central MySQL cluster node registered as active worker"
else
  warn "MYSQL_REGISTER_CLUSTER=false; central MySQL registration was explicitly disabled"
fi

log "Running local diagnostics"
redis-cli -h 127.0.0.1 -p 6379 ping | grep -qx PONG || die "Redis diagnostic failed"
runuser -u postgres -- psql -d "$DB_NAME" -Atqc 'SELECT 1' | grep -qx 1 || die "PostgreSQL diagnostic failed"
wait_for_port "$APP_PORT" "Net2App API" 60 || die "API port ${APP_PORT} is not listening"
wait_for_port "$SMPP_PORT" "SMPP gateway" 60 || die "SMPP port ${SMPP_PORT} is not listening"
wait_for_port "$JAVA_BRIDGE_PORT" "Java REST bridge" 60 || die "Java bridge port ${JAVA_BRIDGE_PORT} is not listening"
curl -fsS --max-time 10 "http://127.0.0.1:${APP_PORT}/health" >/tmp/net2app-health.json || die "API health endpoint failed"
curl -fsS --max-time 10 "http://127.0.0.1:${JAVA_BRIDGE_PORT}/health" >/tmp/net2app-java-health.json || die "Java gateway health endpoint failed"

systemctl is-enabled "pm2-${APP_USER}" >/dev/null || die "PM2 boot registration is not enabled"
run_as_app pm2 status
log "Installation completed successfully"

printf '\n%b============================================================%b\n' "$GREEN" "$NC"
printf '%b  Net2App installation completed successfully%b\n' "$GREEN" "$NC"
printf '%b============================================================%b\n' "$GREEN" "$NC"
printf '  URL:             http://%s/\n' "$PUBLIC_IP"
printf '  API health:      http://%s/health\n' "$PUBLIC_IP"
printf '  SMPP endpoint:   %s:%s\n' "$PUBLIC_IP" "$SMPP_PORT"
printf '  App directory:   %s\n' "$APP_DIR"
printf '  PM2 status:      runuser -u %s -- pm2 status\n' "$APP_USER"
printf '  Logs:            runuser -u %s -- pm2 logs\n' "$APP_USER"
printf '  Install log:     %s\n' "$LOG_FILE"
printf '%b============================================================%b\n' "$GREEN" "$NC"
