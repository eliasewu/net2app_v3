#!/bin/bash
# NET2APP Hub v0.1.0 — One-Line Deploy for Fresh Ubuntu 22.04/24.04 Server
#
# ONE-LINE COMMAND (replace YOUR_GITHUB_TOKEN):
#   git clone https://YOUR_GITHUB_TOKEN@github.com/eliasewu/net2app_v3.git /home/ubuntu/net2app-v3 && cd /home/ubuntu/net2app-v3 && bash INSTALL_FULL.sh
#
# Or manually:

set -e
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'
PROJECT_DIR="/home/ubuntu/net2app-v3"

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  NET2APP Hub v0.1.0 — Full Install${NC}"
echo -e "${GREEN}========================================${NC}"

# 1. Install system dependencies
echo -e "${YELLOW}[1/6] Installing system dependencies...${NC}"
sudo apt-get update -qq
sudo apt-get install -y curl nginx postgresql postgresql-contrib nodejs npm openjdk-21-jdk maven 2>&1 | tail -3
echo -e "${GREEN}✓ Dependencies installed${NC}"

# 2. Setup PostgreSQL
echo -e "${YELLOW}[2/6] Setting up PostgreSQL...${NC}"
sudo systemctl start postgresql
sudo systemctl enable postgresql
sudo -u postgres psql -c "CREATE DATABASE sms_platform;" 2>/dev/null || true
sudo -u postgres psql -c "CREATE USER sms_user WITH PASSWORD 'Ariya@2024Net2App';" 2>/dev/null || true
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE sms_platform TO sms_user;" 2>/dev/null || true
sudo -u postgres psql -d sms_platform -c "GRANT ALL ON SCHEMA public TO sms_user;" 2>/dev/null || true
echo -e "${GREEN}✓ PostgreSQL ready${NC}"

# 3. Import DB schema
echo -e "${YELLOW}[3/6] Importing database schema...${NC}"
cd "$PROJECT_DIR"
sudo -u postgres psql -d sms_platform < src/database/schema.sql 2>&1 | tail -3
sudo -u postgres psql -d sms_platform < src/database/migrate_v2.sql 2>/dev/null || true
sudo -u postgres psql -d sms_platform < src/database/migrate_voice_otp_v3.sql 2>/dev/null || true
sudo -u postgres psql -d sms_platform < src/database/migrate_queue.sql 2>/dev/null || true
sudo -u postgres psql -d sms_platform < db_migration_add_missing_columns.sql 2>/dev/null || true
echo -e "${GREEN}✓ Database schema imported${NC}"

# 4. Setup admin user
echo -e "${YELLOW}[4/6] Creating admin user...${NC}"
cd "$PROJECT_DIR"
node setup-admin.js 2>/dev/null || node reset-admin-password.js 2>/dev/null || echo "Admin: admin / admin123 (default)"
echo -e "${GREEN}✓ Admin user ready${NC}"

# 5. Build frontend
echo -e "${YELLOW}[5/6] Building frontend...${NC}"
cd "$PROJECT_DIR"
npm install 2>&1 | tail -3
npm run build 2>&1 | tail -3
echo -e "${GREEN}✓ Frontend built${NC}"

# 6. Setup systemd services (Node.js API + Java SMPP Gateway)
echo -e "${YELLOW}[6/6] Setting up services...${NC}"
cd "$PROJECT_DIR"

# Node.js API server
cat > /tmp/net2app-hub.service << 'NODEEOF'
[Unit]
Description=Net2App Hub - SMS Platform API Server
After=network-online.target postgresql.service
[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/net2app-v3
ExecStart=/usr/bin/node server.cjs
Restart=always
RestartSec=5
EnvironmentFile=/home/ubuntu/net2app-v3/.env.production
LimitNOFILE=65536
[Install]
WantedBy=multi-user.target
NODEEOF
sudo cp /tmp/net2app-hub.service /etc/systemd/system/

# Java SMPP Gateway
cat > /tmp/net2app-smpg.service << 'JAVAEOF'
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
EnvironmentFile=/home/ubuntu/net2app-v3/.env.production
LimitNOFILE=65536
[Install]
WantedBy=multi-user.target
JAVAEOF
sudo cp /tmp/net2app-smpg.service /etc/systemd/system/

# Nginx
sudo tee /etc/nginx/sites-available/net2app-hub > /dev/null << 'NGINXEOF'
server {
    listen 80;
    server_name _;
    root /home/ubuntu/net2app-v3/dist;
    index index.html;
    location /api/ { proxy_pass http://127.0.0.1:3001; proxy_http_version 1.1; proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr; proxy_read_timeout 90; }
    location / { try_files $uri $uri/ /index.html; }
    client_max_body_size 50M;
}
NGINXEOF
sudo ln -sf /etc/nginx/sites-available/net2app-hub /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Build Java gateway
cd "$PROJECT_DIR/java-sms-gateway"
mvn package -DskipTests 2>&1 | tail -3

# Start all services
sudo systemctl daemon-reload
sudo systemctl enable net2app-hub net2app-smpg 2>/dev/null
sudo systemctl restart net2app-hub net2app-smpg
sudo nginx -t && sudo nginx -s reload

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  NET2APP Hub v0.1.0 — DEPLOYED!${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "Frontend:  ${YELLOW}http://$(curl -s ifconfig.me)${NC}"
echo -e "API:       ${YELLOW}http://$(curl -s ifconfig.me)/api${NC}"
echo -e "Status:    ${YELLOW}systemctl status net2app-hub${NC}"
echo -e "Logs:      ${YELLOW}journalctl -u net2app-hub -f${NC}"
echo ""
