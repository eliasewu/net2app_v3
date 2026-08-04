#!/bin/bash
set -e
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'
PROJECT_DIR="/home/ubuntu/net2app-v3"

echo -e "${YELLOW}[1/10] Stopping Docker containers on port 80...${NC}"
docker stop sms-api sms-kannel sms-smpp 2>/dev/null || true
docker rm sms-api sms-kannel sms-smpp 2>/dev/null || true
echo -e "${GREEN}Done${NC}"

echo -e "${YELLOW}[2/10] Installing Java 21 + Maven...${NC}"
apt-get update -qq
if ! apt-get install -y -qq openjdk-21-jdk maven 2>/dev/null; then
    echo "Trying Adoptium..."
    apt-get install -y -qq wget apt-transport-https
    wget -qO - https://packages.adoptium.net/artifactory/api/gpg/key/public | gpg --dearmor -o /usr/share/keyrings/adoptium-archive-keyring.gpg
    CODENAME=$(awk -F= '/^VERSION_CODENAME/{print$2}' /etc/os-release)
    echo "deb [signed-by=/usr/share/keyrings/adoptium-archive-keyring.gpg] https://packages.adoptium.net/artifactory/deb ${CODENAME} main" > /etc/apt/sources.list.d/adoptium.list
    apt-get update -qq
    apt-get install -y -qq temurin-21-jdk maven 2>&1 | tail -5
fi
echo "Java: $(java -version 2>&1 | head -1)"
echo "Maven: $(mvn -v 2>&1 | head -1)"
echo -e "${GREEN}Done${NC}"

echo -e "${YELLOW}[3/10] Setting up PostgreSQL database...${NC}"
systemctl restart postgresql
sudo -u postgres psql -c "DROP DATABASE IF EXISTS sms_platform;" 2>/dev/null || true
sudo -u postgres psql -c "DROP USER IF EXISTS sms_user;" 2>/dev/null || true
sudo -u postgres psql -c "CREATE DATABASE sms_platform;"
sudo -u postgres psql -c "CREATE USER sms_user WITH PASSWORD 'Ariya@2024Net2App';"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE sms_platform TO sms_user;"
sudo -u postgres psql -d sms_platform -c "GRANT ALL ON SCHEMA public TO sms_user;"
sudo -u postgres psql -d sms_platform -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO sms_user;"
sudo -u postgres psql -d sms_platform -c "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO sms_user;"
echo -e "${GREEN}Done${NC}"

echo -e "${YELLOW}[4/10] Importing database schema...${NC}"
cd "$PROJECT_DIR"
sudo -u postgres psql -d sms_platform < src/database/schema.sql 2>&1 | tail -3
sudo -u postgres psql -d sms_platform < src/database/migrate_v2.sql 2>/dev/null || true
sudo -u postgres psql -d sms_platform < src/database/migrate_voice_otp_v3.sql 2>/dev/null || true
sudo -u postgres psql -d sms_platform < src/database/migrate_queue.sql 2>/dev/null || true
sudo -u postgres psql -d sms_platform < db_migration_add_missing_columns.sql 2>/dev/null || true
echo -e "${GREEN}Done${NC}"

echo -e "${YELLOW}[5/10] Running npm install...${NC}"
cd "$PROJECT_DIR"
npm install 2>&1 | tail -5
echo -e "${GREEN}Done${NC}"

echo -e "${YELLOW}[6/10] Building frontend...${NC}"
npm run build 2>&1 | tail -5
if [ -f dist/index.html ]; then
    echo -e "${GREEN}Frontend built OK${NC}"
else
    echo -e "${RED}Build failed - no dist/index.html${NC}"
    exit 1
fi

echo -e "${YELLOW}[7/10] Creating admin user...${NC}"
node setup-admin.js 2>/dev/null || node reset-admin-password.js 2>/dev/null || node update-admin-password.js 2>/dev/null || echo "Using default admin credentials"
echo -e "${GREEN}Done${NC}"

echo -e "${YELLOW}[8/10] Creating systemd service...${NC}"
cat > /etc/systemd/system/net2app-hub.service << 'SVCEND'
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

StartLimitBurst=5
StartLimitInterval=30

[Install]
WantedBy=multi-user.target
SVCEND
systemctl daemon-reload
systemctl enable net2app-hub
echo -e "${GREEN}Done${NC}"

echo -e "${YELLOW}[9/10] Starting Node.js server...${NC}"
systemctl restart net2app-hub
sleep 3
systemctl is-active net2app-hub && echo -e "${GREEN}Server running${NC}" || echo -e "${RED}Server FAILED to start${NC}"

echo -e "${YELLOW}[10/10] Setting up Nginx...${NC}"
# Remove docker nginx if it exists
apt-get install -y -qq nginx 2>&1 | tail -3 || true

cat > /etc/nginx/sites-available/net2app-hub << 'NGXEND'
server {
    listen 80;
    server_name _;
    root /home/ubuntu/net2app-v3/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 90;
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
NGXEND

ln -sf /etc/nginx/sites-available/net2app-hub /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Kill anything on port 80
fuser -k 80/tcp 2>/dev/null || true
sleep 1

nginx -t && systemctl restart nginx
echo -e "${GREEN}Done${NC}"

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  ALL FIXES COMPLETE${NC}"
echo -e "${GREEN}========================================${NC}"
