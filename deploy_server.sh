#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PROJECT_DIR="/home/ubuntu/net2app-v3"
NGINX_CONF="/etc/nginx/sites-available/net2app-hub"
NGINX_ENABLED="/etc/nginx/sites-enabled/net2app-hub"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Net2App Hub - Full Deployment Script${NC}"
echo -e "${GREEN}========================================${NC}"

cd "$PROJECT_DIR" || { echo -e "${RED}✗ Project directory not found${NC}"; exit 1; }

# ===============================================================
# 1. BACKUP current server
# ===============================================================
echo -e "${YELLOW}[1/5] Backing up current server...${NC}"
if [ -f server.cjs ]; then
    cp server.cjs server.cjs.backup.$(date +%Y%m%d_%H%M%S)
    echo -e "${GREEN}✓ Backup created${NC}"
fi

# ===============================================================
# 2. STOP current server (via systemd)
# ===============================================================
echo -e "${YELLOW}[2/5] Stopping current server...${NC}"
if systemctl is-active --quiet net2app-hub 2>/dev/null; then
    systemctl stop net2app-hub
    echo -e "${GREEN}✓ Server stopped via systemd${NC}"
else
    # Fallback: kill any lingering node processes on port 3001
    pkill -f "node .*server.*\.cjs" 2>/dev/null
    lsof -ti:3001 | xargs kill -9 2>/dev/null
    echo -e "${YELLOW}⚠ Server was not running via systemd, cleaned up${NC}"
fi

# Clean up stale SMPP port 2775 (prevents EADDRINUSE on restart)
# Force-kill any process on the port and wait for TIME_WAIT to clear
lsof -ti:2775 | xargs -r kill -9 2>/dev/null
sleep 4

# ===============================================================
# 3. DEPLOY systemd service & START server
# ===============================================================
echo -e "${YELLOW}[3/5] Deploying systemd service & starting API server...${NC}"

# Copy latest service file and wrapper if not already in place
if [ ! -f /etc/systemd/system/net2app-hub.service ]; then
    echo -e "${YELLOW}Creating systemd service file and wrapper...${NC}"
    
    # Create the production wrapper (keeps event loop alive under systemd)
    cat > "$PROJECT_DIR/start-server.cjs" << 'WRAPEOF'
/**
 * Systemd production entry point for Net2App Hub.
 *
 * Express 5 under systemd (Type=simple) may drain the event loop immediately
 * after app.listen() fires its callback if no other async handles are active.
 * A minimal keep-alive interval prevents this without any overhead.
 */
require('./server.cjs');

// Keep-alive: a no-op recurring timer ensures the event loop never drains.
// This is transparent — it does no work but prevents premature process exit.
setInterval(() => {}, 600_000); // every 10 minutes, effectively infinite
WRAPEOF
    chown ubuntu:ubuntu "$PROJECT_DIR/start-server.cjs"
    
    cat > /etc/systemd/system/net2app-hub.service << 'SVC_EOF'
[Unit]
Description=Net2App Hub - SMS Platform API Server
After=network-online.target postgresql.service
Wants=network-online.target postgresql.service

[Service]
Type=simple
User=ubuntu
Group=ubuntu
WorkingDirectory=/home/ubuntu/net2app-v3
ExecStart=/usr/bin/node start-server.cjs
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=net2app-hub

EnvironmentFile=/home/ubuntu/net2app-v3/.env.production

NoNewPrivileges=yes
PrivateTmp=yes
LimitNOFILE=65536
LimitNPROC=4096

# Restart policy — prevents infinite crash loops after rapid failures
StartLimitBurst=5
StartLimitInterval=30

KillSignal=SIGTERM
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
SVC_EOF
fi

systemctl daemon-reload
systemctl enable net2app-hub 2>/dev/null
systemctl restart net2app-hub
sleep 3

if systemctl is-active --quiet net2app-hub; then
    echo -e "${GREEN}✓ Server started via systemd (systemctl status net2app-hub)${NC}"
else
    echo -e "${RED}✗ Server failed to start. Check: journalctl -u net2app-hub -n 30${NC}"
    journalctl -u net2app-hub --no-pager -n 20
    exit 1
fi

# ===============================================================
# 4. BUILD frontend
# ===============================================================
echo -e "${YELLOW}[4/5] Building frontend...${NC}"
npm run build 2>&1 | tail -5
if [ $? -ne 0 ] || [ ! -f "dist/index.html" ]; then
    echo -e "${RED}✗ Frontend build failed${NC}"
    exit 1
fi
if [ -d "dist" ]; then
    echo -e "${GREEN}✓ Frontend built to dist/${NC}"
else
    echo -e "${RED}✗ Frontend build failed${NC}"
fi

# ===============================================================
# 5. RELOAD Nginx
# ===============================================================
echo -e "${YELLOW}[5/5] Reloading Nginx on port 80...${NC}"

# Ensure nginx config is in place
if [ ! -f "$NGINX_CONF" ]; then
    echo -e "${YELLOW}Creating Nginx config...${NC}"
    sudo tee "$NGINX_CONF" > /dev/null << 'NGINXEOF'
server {
    listen 80;
    server_name 192.95.36.154 localhost _;

    root /home/ubuntu/net2app-v3/dist;
    index index.html;

    # API proxy to Node.js backend
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
        expires 7d;
        add_header Cache-Control "public, immutable";
    }

    location /data/ {
        alias /home/ubuntu/net2app-v3/data/;
        expires 30d;
    }

    client_max_body_size 50M;
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml;
}
NGINXEOF

    sudo ln -sf "$NGINX_CONF" "$NGINX_ENABLED"
fi

# Remove conflicting configs
sudo rm -f /etc/nginx/sites-enabled/sms-platform /etc/nginx/sites-enabled/default 2>/dev/null

# Test and reload
if sudo nginx -t 2>&1 | grep -q "successful"; then
    sudo nginx -s reload
    echo -e "${GREEN}✓ Nginx reloaded${NC}"
else
    echo -e "${RED}✗ Nginx config test failed${NC}"
    sudo nginx -t
fi

# ===============================================================
# VERIFY
# ===============================================================
echo ""
echo -e "${YELLOW}Verifying deployment...${NC}"
sleep 2

# Test port 80 frontend
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:80/ 2>/dev/null)
if [ "$HTTP_CODE" = "200" ]; then
    echo -e "${GREEN}✓ Frontend on port 80: OK (${HTTP_CODE})${NC}"
else
    echo -e "${RED}✗ Frontend on port 80: FAIL (${HTTP_CODE})${NC}"
fi

# Test login
LOGIN=$(curl -s http://localhost:80/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"admin123"}' 2>/dev/null)
if echo "$LOGIN" | grep -q '"success":true'; then
    echo -e "${GREEN}✓ Login on port 80: OK${NC}"
else
    echo -e "${RED}✗ Login on port 80: FAIL${NC}"
fi

# ===============================================================
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "Frontend:  ${YELLOW}http://192.95.36.154${NC} (port 80)"
echo -e "API:       ${YELLOW}http://192.95.36.154/api${NC} (proxied)"
echo -e "Backend:   ${YELLOW}http://localhost:3001${NC} (direct)"
echo -e "Logs:      ${YELLOW}journalctl -u net2app-hub -f${NC}"
echo ""
echo -e "To restart:   ${YELLOW}systemctl restart net2app-hub${NC}"
echo -e "View logs:    ${YELLOW}journalctl -u net2app-hub -f${NC}"
echo -e "Service status: ${YELLOW}systemctl status net2app-hub${NC}"
