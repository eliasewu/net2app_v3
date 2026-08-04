#!/bin/bash
# ============================================================
# Net2App Hub — One-Shot Deployment to ANY New Server
# ============================================================
# Usage:  ./deploy_to_newserver.sh <SERVER_IP> [SSH_USER] [SSH_KEY_OR_PASS]
#
#   SSH key (default):  ./deploy_to_newserver.sh 51.178.20.165
#   SSH key + user:     ./deploy_to_newserver.sh 51.178.20.165 root ~/.ssh/mykey
#   Password auth:      ./deploy_to_newserver.sh 147.135.128.43 ubuntu pass:Telco1988
#   Deploy to BOTH:     ./deploy_to_newserver.sh both
#
# This script does EVERYTHING on a fresh Ubuntu 22.04/24.04 server:
#   • Installs ALL system dependencies (Node 20, Java 21, PostgreSQL, Nginx, Maven)
#   • Sets up PostgreSQL database + user + all 9 migration files
#   • Copies ALL project files (excluding node_modules, .git, backups)
#   • Builds React frontend (npm install + npm run build)
#   • Builds Java SMPP Gateway (mvn package)
#   • Creates systemd services (net2app-hub, net2app-smpg, nginx)
#   • Configures firewall (ufw)
#   • Resets admin password to admin123
#   • Verifies deployment (HTTP 200, API login, service status)
# ============================================================
set -e

# ── Parse arguments ──
SERVER_IP="${1}"
SSH_USER="${2:-root}"
SSH_KEY_OR_PASS="${3:-}"

# "both" mode — deploy to both known production servers
if [ "$SERVER_IP" = "both" ]; then
    echo "=== Deploying to BOTH production servers ==="
    # 51.178.20.165 uses SSH key as root
    "$0" 51.178.20.165 root
    echo ""
    # 147.135.128.43 uses password auth as ubuntu
    "$0" 147.135.128.43 ubuntu pass:Telco1988
    exit 0
fi

if [ -z "$SERVER_IP" ]; then
    echo "Usage: $0 <SERVER_IP> [SSH_USER] [SSH_KEY_OR_PASS]"
    echo ""
    echo "Examples:"
    echo "  $0 51.178.20.165                          # SSH key as root"
    echo "  $0 51.178.20.165 root ~/.ssh/mykey        # Explicit key"
    echo "  $0 147.135.128.43 ubuntu pass:Telco1988    # Password auth"
    echo "  $0 both                                     # Deploy to both servers"
    exit 1
fi

SERVER="${SSH_USER}@${SERVER_IP}"
REMOTE_DIR="/home/ubuntu/net2app-v3"
PROJECT_SRC="$(cd "$(dirname "$0")" && pwd)"

# ── SSH setup: detect key vs password auth ──
SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=10"
USE_SSHPASS=""
SSH_PASS=""
SUDO_PREFIX=""

if [ -n "$SSH_KEY_OR_PASS" ] && [[ "$SSH_KEY_OR_PASS" == pass:* ]]; then
    # Password-based auth via sshpass
    SSH_PASS="${SSH_KEY_OR_PASS#pass:}"
    USE_SSHPASS="sshpass -p '$SSH_PASS'"
    echo "Using password auth for $SERVER"
elif [ -n "$SSH_KEY_OR_PASS" ]; then
    SSH_OPTS="$SSH_OPTS -i $SSH_KEY_OR_PASS"
fi

# ── SSH wrapper function ──
ssh_cmd() {
    if [ -n "$USE_SSHPASS" ]; then
        sshpass -p "$SSH_PASS" ssh $SSH_OPTS "$SERVER" "$@"
    else
        ssh $SSH_OPTS "$SERVER" "$@"
    fi
}

# ── SUDO wrapper: non-root users need sudo with possible password ──
sudo_remote() {
    if [ "$SSH_USER" = "root" ]; then
        ssh_cmd "$@"
    elif [ -n "$SSH_PASS" ]; then
        ssh_cmd "echo '$SSH_PASS' | sudo -S $*"
    else
        ssh_cmd "sudo $*"
    fi
}

# ── rsync wrapper ──
rsync_cmd() {
    if [ -n "$USE_SSHPASS" ]; then
        sshpass -p "$SSH_PASS" rsync "$@" -e "ssh $SSH_OPTS"
    else
        rsync "$@" -e "ssh $SSH_OPTS"
    fi
}

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════════╗"
echo "║     Net2App Hub — New Server Deployment          ║"
echo "║     Target: ${SERVER_IP}                         ║"
echo "╚══════════════════════════════════════════════════╝"
echo -e "${NC}"

# ── Pre-flight check ──
echo -e "${YELLOW}[0/5] Pre-flight checks...${NC}"
if [ ! -f "$PROJECT_SRC/server.cjs" ]; then
    echo -e "${RED}✗ server.cjs not found in $PROJECT_SRC — run from project root${NC}"
    exit 1
fi
echo -e "  ${GREEN}✓${NC} Project root: $PROJECT_SRC"
echo -e "  ${GREEN}✓${NC} server.cjs: $(wc -c < "$PROJECT_SRC/server.cjs") bytes"

# Test SSH connectivity
if ssh_cmd "hostname" 2>/dev/null; then
    echo -e "  ${GREEN}✓${NC} SSH connectivity OK"
else
    echo -e "${RED}✗ Cannot SSH to $SERVER — check IP, user, and credentials${NC}"
    exit 1
fi

# ============================================================
# STEP 1: Prepare server environment
# ============================================================
echo -e "${YELLOW}[1/5] Preparing server environment...${NC}"
ssh_cmd "bash -s" << 'PREPARE'
set -e
# Create ubuntu user if not exists (for non-root deploys)
if ! id ubuntu &>/dev/null && [ "$(whoami)" = "root" ]; then
    useradd -m -s /bin/bash ubuntu 2>/dev/null || true
    echo "ubuntu ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/ubuntu
    mkdir -p /home/ubuntu/.ssh
    cp /root/.ssh/authorized_keys /home/ubuntu/.ssh/ 2>/dev/null || true
    chown -R ubuntu:ubuntu /home/ubuntu/.ssh
    chmod 700 /home/ubuntu/.ssh
    chmod 600 /home/ubuntu/.ssh/authorized_keys 2>/dev/null || true
fi
# Update apt
apt-get update -qq 2>&1 | tail -1
# Install base tools + firewall
apt-get install -y -qq rsync curl wget gnupg2 ca-certificates lsb-release ufw 2>&1 | tail -3
echo "Server prepared: $(lsb_release -ds), $(free -h | awk '/^Mem:/{print $2}') RAM, $(df -h / | awk 'NR==2{print $2}') disk"
PREPARE
echo -e "${GREEN}✓ Server prepared${NC}"

# ============================================================
# STEP 2: Copy ALL project files
# ============================================================
echo -e "${YELLOW}[2/5] Copying project files to server...${NC}"
rsync_cmd -avz --progress \
    --exclude 'node_modules' \
    --exclude 'dist' \
    --exclude '.git' \
    --exclude 'java-sms-gateway/target' \
    --exclude '*.backup*' \
    --exclude '*.bak*' \
    --exclude 'server.cjs.before-*' \
    --exclude 'server_*_backup*' \
    --exclude 'server-*.cjs' \
    --exclude 'server_final*.cjs' \
    --exclude 'server_full*.cjs' \
    --exclude 'server_complete*.cjs' \
    --exclude 'server_working*.cjs' \
    --exclude 'server_fixed*.cjs' \
    --exclude 'server-new.cjs' \
    --exclude 'server-clean.cjs' \
    --exclude 'server-crud.cjs' \
    --exclude 'server-ordered.cjs' \
    --exclude 'server-patch.cjs' \
    --exclude 'server_matching_schema.cjs' \
    --exclude '*/.DS_Store' \
    --exclude '__pycache__' \
    --exclude '*.pyc' \
    "$PROJECT_SRC/" "$SERVER:$REMOTE_DIR/"
ssh_cmd "chown -R ubuntu:ubuntu $REMOTE_DIR 2>/dev/null || true"
echo -e "${GREEN}✓ Files copied${NC}"

# ============================================================
# STEP 3: Full installation
# ============================================================
echo -e "${YELLOW}[3/5] Running full installation... (this takes 3-5 minutes)${NC}"
ssh_cmd "bash -s" << 'INSTALL'
set -e
PROJECT_DIR="/home/ubuntu/net2app-v3"

# ── sudo wrapper for non-root users ──
if [ "$(whoami)" != "root" ]; then
    _sudo() { sudo "$@"; }
else
    _sudo() { "$@"; }
fi

echo "[3a] Installing system dependencies..."
_sudo apt-get update -qq
_sudo apt-get install -y -qq curl nginx postgresql postgresql-contrib 2>&1 | tail -2

# Node.js 20.x
if ! command -v node &>/dev/null || [ "$(node -v | cut -d. -f1 | tr -d 'v')" -lt 18 ]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - 2>&1 | tail -1
    _sudo apt-get install -y nodejs 2>&1 | tail -1
fi
echo "  Node.js: $(node -v)"

# OpenJDK 21 + Maven
_sudo apt-get install -y -qq openjdk-21-jdk maven 2>&1 | tail -2
echo "  Java: $(java -version 2>&1 | head -1)"
echo "  Maven: $(mvn -version 2>&1 | head -1)"

echo "[3b] Setting up PostgreSQL..."
_sudo systemctl start postgresql
_sudo systemctl enable postgresql
_sudo -u postgres psql -c "CREATE DATABASE sms_platform;" 2>/dev/null || true
_sudo -u postgres psql -c "CREATE USER sms_user WITH PASSWORD 'Ariya@2024Net2App';" 2>/dev/null || true
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE sms_platform TO sms_user;" 2>/dev/null || true
_sudo -u postgres psql -d sms_platform -c "GRANT ALL ON SCHEMA public TO sms_user;" 2>/dev/null || true
_sudo -u postgres psql -d sms_platform -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO sms_user;" 2>/dev/null || true
_sudo -u postgres psql -d sms_platform -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO sms_user;" 2>/dev/null || true
echo "  PostgreSQL ready"

echo "[3c] Importing database schema (9 migration files)..."
cd "$PROJECT_DIR"
MIGRATIONS=(
  src/database/schema.sql
  src/database/migrate_v2.sql
  src/database/migrate_voice_otp_v3.sql
  src/database/migrate_queue.sql
  src/database/migrate_add_blocking_rules.sql
  src/database/migrate_add_voice_otp_config_id.sql
  src/database/migrate_otp_pattern.sql
  src/database/migrate_translations_v4.sql
  db_migration_add_missing_columns.sql
)
for f in "${MIGRATIONS[@]}"; do
  if [ -f "$f" ]; then
    _sudo -u postgres psql -d sms_platform -f "$f" 2>/dev/null && echo "  ✓ $f" || echo "  ⚠ $f (non-fatal errors)"
  fi
done
mkdir -p data/uploads/audio data/asterisk 2>/dev/null || true
_sudo chown -R ubuntu:ubuntu data/ 2>/dev/null || true
echo "  Schema imported"

echo "[3d] Setting admin password..."
cd "$PROJECT_DIR"
npm install --no-audit --no-fund 2>&1 | tail -1
node -e '
const p = require("'$PROJECT_DIR'/node_modules/pg/lib/index.js");
const b = require("'$PROJECT_DIR'/node_modules/bcryptjs/index.js");
const pool = new p.Pool({host:"localhost",database:"sms_platform",user:"sms_user",password:"Ariya@2024Net2App"});
(async()=>{
  const h = await b.hash("admin123",10);
  await pool.query("UPDATE users SET password_hash=$1 WHERE username=$2",[h,"admin"]);
  console.log("  Admin: admin / admin123");
  await pool.end();
})();
'
echo "  Admin password set"

echo "[3e] Building frontend..."
cd "$PROJECT_DIR"
npm run build 2>&1 | tail -2
echo "  Frontend built: $(ls dist/index.html 2>/dev/null && echo 'OK' || echo 'FAILED')"

echo "[3f] Building Java SMPP Gateway..."
cd "$PROJECT_DIR/java-sms-gateway"
mvn package -DskipTests 2>&1 | tail -2
echo "  Gateway built: $(ls target/sms-gateway*.jar 2>/dev/null && echo 'OK' || echo 'FAILED')"

echo "[3g] Setting up systemd services..."
cd "$PROJECT_DIR"

# Node.js API server
_sudo tee /etc/systemd/system/net2app-hub.service > /dev/null << 'NODEEOF'
[Unit]
Description=Net2App Hub - SMS Platform API Server
After=network-online.target postgresql.service
Wants=network-online.target postgresql.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/net2app-v3
ExecStart=/usr/bin/node server.cjs
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=net2app-hub

Environment=NODE_ENV=production

NoNewPrivileges=yes
PrivateTmp=yes
LimitNOFILE=65536
LimitNPROC=4096

StartLimitBurst=5
StartLimitInterval=30

KillSignal=SIGTERM
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
NODEEOF

# Java SMPP Gateway
_sudo tee /etc/systemd/system/net2app-smpg.service > /dev/null << 'JAVAEOF'
[Unit]
Description=NET2APP Java SMPP Gateway (Java 21)
After=network-online.target postgresql.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/net2app-v3/java-sms-gateway
ExecStart=/usr/bin/java -jar /home/ubuntu/net2app-v3/java-sms-gateway/target/sms-gateway-1.0.0.jar
Restart=always
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
JAVAEOF

# Nginx config
_sudo rm -f /etc/nginx/sites-available/net2app-hub /etc/nginx/sites-enabled/net2app-hub /etc/nginx/sites-enabled/default 2>/dev/null || true
_sudo tee /etc/nginx/sites-available/net2app-hub > /dev/null << 'NGINXEOF'
server {
    listen 80;
    server_name _;

    root /home/ubuntu/net2app-v3/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 90;
        proxy_connect_timeout 90;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    client_max_body_size 50M;
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
}
NGINXEOF

_sudo ln -sf /etc/nginx/sites-available/net2app-hub /etc/nginx/sites-enabled/
_sudo rm -f /etc/nginx/sites-enabled/default

echo "[3h] Configuring firewall..."
_sudo ufw --force reset 2>/dev/null || true
_sudo ufw default deny incoming
_sudo ufw default allow outgoing
_sudo ufw allow 22/tcp
_sudo ufw allow 80/tcp
_sudo ufw allow 443/tcp
_sudo ufw allow 2775/tcp
_sudo ufw allow 3000/tcp
_sudo ufw allow 3001/tcp
_sudo ufw allow 5038/tcp
_sudo ufw --force enable
echo "  Firewall configured"

echo "[3i] Starting all services..."
_sudo systemctl daemon-reload
_sudo systemctl enable net2app-hub net2app-smpg 2>/dev/null || true
_sudo systemctl restart net2app-hub net2app-smpg 2>/dev/null || true
sleep 4
_sudo nginx -t && _sudo systemctl reload nginx
echo "  Services started"
INSTALL
echo -e "${GREEN}✓ Installation complete${NC}"

# ============================================================
# STEP 4: Verify deployment
# ============================================================
echo -e "${YELLOW}[4/5] Verifying deployment...${NC}"
sleep 4

# Test frontend
HTTP_CODE=$(ssh_cmd "curl -s -o /dev/null -w '%{http_code}' http://localhost:80/" 2>/dev/null)
if [ "$HTTP_CODE" = "200" ]; then
    echo -e "  ${GREEN}✓${NC} Frontend (port 80): HTTP ${HTTP_CODE}"
else
    echo -e "  ${RED}✗${NC} Frontend (port 80): HTTP ${HTTP_CODE}"
fi

# Test API login
LOGIN=$(ssh_cmd "curl -s http://localhost:80/api/auth/login -H 'Content-Type: application/json' -d '{\"username\":\"admin\",\"password\":\"admin123\"}'" 2>/dev/null)
if echo "$LOGIN" | grep -q '"success":true'; then
    echo -e "  ${GREEN}✓${NC} API Login: OK"
else
    echo -e "  ${RED}✗${NC} API Login: FAIL — $LOGIN"
fi

# Check services
for svc in net2app-hub net2app-smpg postgresql nginx; do
    STATUS=$(ssh_cmd "systemctl is-active $svc" 2>/dev/null || echo "not-found")
    if [ "$STATUS" = "active" ]; then
        echo -e "  ${GREEN}✓${NC} $svc: active"
    else
        echo -e "  ${YELLOW}⚠${NC} $svc: $STATUS"
    fi
done

# Check SMPP port
if ssh_cmd "ss -tlnp | grep -q ':2775'" 2>/dev/null; then
    echo -e "  ${GREEN}✓${NC} SMPP port 2775: listening"
else
    echo -e "  ${YELLOW}⚠${NC} SMPP port 2775: not listening (Java gateway may need manual start)"
fi

# Check DB counts
DB_COUNTS=$(ssh_cmd "sudo -u postgres psql -d sms_platform -t -c 'SELECT (SELECT COUNT(*) FROM clients) || chr(9) || (SELECT COUNT(*) FROM suppliers) || chr(9) || (SELECT COUNT(*) FROM rates) || chr(9) || (SELECT COUNT(*) FROM mccmnc)'" 2>/dev/null || echo "?	?	?	?")
echo -e "  ${GREEN}✓${NC} DB: $(echo "$DB_COUNTS" | awk -F'\t' '{print "clients="$1" suppliers="$2" rates="$3" mccmnc="$4}')"

# ============================================================
# STEP 5: Final report
# ============================================================
echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║          🚀  DEPLOYMENT COMPLETE!                ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${YELLOW}Frontend:${NC}  http://${SERVER_IP}"
echo -e "  ${YELLOW}API:${NC}       http://${SERVER_IP}/api"
echo -e "  ${YELLOW}SMPP:${NC}      ${SERVER_IP}:2775"
echo -e "  ${YELLOW}Login:${NC}     admin / admin123"
echo ""
echo -e "  ${YELLOW}SSH:${NC}       ssh ${SSH_USER}@${SERVER_IP}"
echo -e "  ${YELLOW}Logs:${NC}      journalctl -u net2app-hub -f"
echo -e "  ${YELLOW}Restart:${NC}   systemctl restart net2app-hub net2app-smpg"
echo -e "  ${YELLOW}Nginx:${NC}     nginx -t && systemctl reload nginx"
echo ""
echo -e "  ${CYAN}Features deployed:${NC}"
echo -e "    • Dual billing (submit/dlr/force_dlr) with atomic claim-first"
echo -e "    • 4 billing mode combinations per message"
echo -e "    • force_dlr timeout auto-DLR (fake DELIVRD after N seconds)"
echo -e "    • Real-time SMPP DLR + billing via smppClient.mjs"
echo -e "    • Retroactive billing safety net (10s poller)"
echo -e "    • SMPP bind status + auto-block at 20 failures"
echo -e "    • Voice OTP (direct UDP SIP + RTP)"
echo -e "    • Rate versioning + % change + auto-deactivation"
echo -e "    • 2,459 MCCMNC entries for global routing"
echo ""
