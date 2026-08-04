#!/bin/bash
# ============================================================
# Net2App Hub — Quick Incremental Update (Both Production Servers)
# ============================================================
# Usage:  ./quick_update.sh
#
# Fast incremental deploy — skips system setup, DB migrations,
# and full npm install. Just rsyncs code, builds frontend,
# and restarts services on both production servers.
#
# Servers:
#   51.178.20.165  (root, SSH key auth)
#   147.135.128.43 (ubuntu, password auth)
# ============================================================
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

PROJECT_SRC="$(cd "$(dirname "$0")" && pwd)"
REMOTE_DIR="/home/ubuntu/net2app-v3"

echo -e "${CYAN}"
echo "╔══════════════════════════════════════════════════╗"
echo "║     Net2App Hub — Quick Update (Both Servers)     ║"
echo "╚══════════════════════════════════════════════════╝"
echo -e "${NC}"

if [ ! -f "$PROJECT_SRC/server.cjs" ]; then
    echo -e "${RED}✗ Run from project root (server.cjs not found)${NC}"
    exit 1
fi

# ── Server definitions ──
declare -A S_HOST S_USER S_PASS S_SUDO
S_HOST[0]="51.178.20.165";    S_USER[0]="root";    S_PASS[0]=""
S_HOST[1]="147.135.128.43";   S_USER[1]="ubuntu";  S_PASS[1]="Telco1988"

RSYNC_EXCLUDES=(
    --exclude 'node_modules'
    --exclude 'dist'
    --exclude '.git'
    --exclude 'java-sms-gateway/target'
    --exclude '*.backup*'
    --exclude '*.bak*'
    --exclude 'server.cjs.before-*'
    --exclude 'server_*_backup*'
    --exclude 'server-*.cjs'
    --exclude 'server_final*.cjs'
    --exclude 'server_full*.cjs'
    --exclude 'server_complete*.cjs'
    --exclude 'server_working*.cjs'
    --exclude 'server_fixed*.cjs'
    --exclude 'server-new.cjs'
    --exclude 'server-clean.cjs'
    --exclude 'server-crud.cjs'
    --exclude 'server-ordered.cjs'
    --exclude 'server-patch.cjs'
    --exclude 'server_matching_schema.cjs'
    --exclude '*/.DS_Store'
    --exclude '__pycache__'
    --exclude '*.pyc'
)

# ── Build Java locally ──
echo -e "${YELLOW}[0/4] Building Java SMPP Gateway locally...${NC}"
cd "$PROJECT_SRC/java-sms-gateway"
mvn package -DskipTests -q 2>&1 | tail -2
echo -e "${GREEN}✓ Java gateway built${NC}"
cd "$PROJECT_SRC"

# ── Deploy to each server ──
for i in 0 1; do
    HOST="${S_HOST[$i]}"
    USER="${S_USER[$i]}"
    PASS="${S_PASS[$i]}"
    SERVER="${USER}@${HOST}"
    
    echo ""
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${CYAN}  Deploying to: ${HOST} (${USER})${NC}"
    echo -e "${CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

    # SSH helper
    if [ -n "$PASS" ]; then
        SSH_CMD="sshpass -p '$PASS' ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10"
        RSYNC_CMD="sshpass -p '$PASS' rsync -avz --progress -e 'ssh -o StrictHostKeyChecking=no'"
    else
        SSH_CMD="ssh -o StrictHostKeyChecking=no -o ConnectTimeout=10"
        RSYNC_CMD="rsync -avz --progress -e 'ssh -o StrictHostKeyChecking=no'"
    fi

    # Test SSH
    if ! $SSH_CMD "$SERVER" "hostname" 2>/dev/null; then
        echo -e "${RED}✗ Cannot connect to $SERVER${NC}"
        continue
    fi

    # [1/4] Rsync source files
    echo -e "${YELLOW}  [1/4] Rsync source files...${NC}"
    $RSYNC_CMD "${RSYNC_EXCLUDES[@]}" "$PROJECT_SRC/" "$SERVER:$REMOTE_DIR/" 2>&1 | tail -3
    echo -e "  ${GREEN}✓ Files synced${NC}"

    # [2/4] Rsync Java jar
    echo -e "${YELLOW}  [2/4] Deploying Java gateway jar...${NC}"
    if [ -n "$PASS" ]; then
        sshpass -p "$PASS" rsync -avz -e 'ssh -o StrictHostKeyChecking=no' \
            "$PROJECT_SRC/java-sms-gateway/target/sms-gateway-1.0.0.jar" \
            "$SERVER:$REMOTE_DIR/java-sms-gateway/target/sms-gateway-1.0.0.jar" 2>&1 | tail -1
    else
        rsync -avz -e 'ssh -o StrictHostKeyChecking=no' \
            "$PROJECT_SRC/java-sms-gateway/target/sms-gateway-1.0.0.jar" \
            "$SERVER:$REMOTE_DIR/java-sms-gateway/target/sms-gateway-1.0.0.jar" 2>&1 | tail -1
    fi
    echo -e "  ${GREEN}✓ Gateway jar deployed${NC}"

    # [3/4] Build frontend & restart services
    echo -e "${YELLOW}  [3/4] Building frontend + restarting services...${NC}"
    if [ -n "$PASS" ]; then
        $SSH_CMD "$SERVER" "cd $REMOTE_DIR && npm run build 2>&1 | tail -3 && \
            echo '$PASS' | sudo -S systemctl restart net2app-hub net2app-smpg 2>&1 && \
            sleep 3 && \
            echo '$PASS' | sudo -S nginx -t 2>&1 && \
            echo '$PASS' | sudo -S nginx -s reload 2>&1 && \
            echo 'ALL_OK'"
    else
        $SSH_CMD "$SERVER" "cd $REMOTE_DIR && npm run build 2>&1 | tail -3 && \
            systemctl restart net2app-hub net2app-smpg 2>&1 && \
            sleep 3 && \
            nginx -t 2>&1 && \
            nginx -s reload 2>&1 && \
            echo 'ALL_OK'"
    fi
    echo -e "  ${GREEN}✓ Services restarted${NC}"

    # [4/4] Verify
    echo -e "${YELLOW}  [4/4] Verifying...${NC}"
    HTTP=$(curl -s -o /dev/null -w '%{http_code}' "http://${HOST}:80/" 2>/dev/null || echo "FAIL")
    LOGIN=$(curl -s "http://${HOST}:80/api/auth/login" -H 'Content-Type: application/json' \
        -d '{"username":"admin","password":"admin123"}' 2>/dev/null | grep -c '"success":true' || echo "0")
    
    if [ "$HTTP" = "200" ]; then
        echo -e "  ${GREEN}✓ Frontend HTTP ${HTTP}${NC}"
    else
        echo -e "  ${RED}✗ Frontend HTTP ${HTTP}${NC}"
    fi
    if [ "$LOGIN" -ge 1 ]; then
        echo -e "  ${GREEN}✓ API Login OK${NC}"
    else
        echo -e "  ${RED}✗ API Login FAIL${NC}"
    fi

    # Service status
    for svc in net2app-hub net2app-smpg; do
        STATUS=$($SSH_CMD "$SERVER" "systemctl is-active $svc" 2>/dev/null || echo "unknown")
        if [ "$STATUS" = "active" ]; then
            echo -e "  ${GREEN}✓ $svc${NC}"
        else
            echo -e "  ${RED}✗ $svc: $STATUS${NC}"
        fi
    done
done

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║          🚀  QUICK UPDATE COMPLETE!              ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${YELLOW}Server 1:${NC} http://51.178.20.165"
echo -e "  ${YELLOW}Server 2:${NC} http://147.135.128.43"
echo -e "  ${YELLOW}Login:${NC}   admin / admin123"
echo ""
