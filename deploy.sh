#!/bin/bash
# Net2App Hub - One Line Installer
# Usage: curl -sSL https://raw.githubusercontent.com/eliasewu/net2app_v3/main/deploy.sh | bash

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}     Net2App Hub Installer v3.0${NC}"
echo -e "${GREEN}========================================${NC}"

# Check OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
    VER=$VERSION_ID
else
    echo -e "${RED}Unsupported OS${NC}"
    exit 1
fi

echo -e "${GREEN}Detected OS: $OS $VER${NC}"

# Update system
echo -e "${YELLOW}Updating system...${NC}"
sudo apt update && sudo apt upgrade -y

# Install dependencies
echo -e "${YELLOW}Installing dependencies...${NC}"
sudo apt install -y curl wget git nginx postgresql postgresql-contrib nodejs npm python3 python3-pip build-essential

# Install Node.js 20.x if not present
if ! node --version | grep -q "v20"; then
    echo -e "${YELLOW}Installing Node.js 20.x...${NC}"
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
fi

# Setup PostgreSQL
echo -e "${YELLOW}Setting up PostgreSQL...${NC}"
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create database and user
sudo -u postgres psql << EOF
CREATE USER net2app_user WITH PASSWORD 'Ariya@2024Net2App';
CREATE DATABASE net2app_hub OWNER net2app_user;
GRANT ALL PRIVILEGES ON DATABASE net2app_hub TO net2app_user;
ALTER USER net2app_user WITH SUPERUSER;
EOF

# Clone or pull repository
if [ ! -d "/opt/net2app-hub" ]; then
    echo -e "${YELLOW}Cloning repository...${NC}"
    sudo git clone https://github.com/eliasewu/net2app_v3.git /opt/net2app-hub
else
    echo -e "${YELLOW}Updating repository...${NC}"
    cd /opt/net2app-hub && sudo git pull
fi

cd /opt/net2app-hub

# Install Node dependencies
echo -e "${YELLOW}Installing Node dependencies...${NC}"
npm install --production

# Build frontend
echo -e "${YELLOW}Building frontend...${NC}"
npm run build

# Setup database schema
echo -e "${YELLOW}Setting up database schema...${NC}"
sudo -u postgres psql -d net2app_hub -f database/schema.sql 2>/dev/null || echo "Schema already exists"

# Create systemd service
echo -e "${YELLOW}Creating systemd services...${NC}"

# API Server service
sudo cat > /etc/systemd/system/net2app-api.service << EOF
[Unit]
Description=Net2App Hub API Server
After=network.target postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/net2app-hub
ExecStart=/usr/bin/node server_final_working.cjs
Restart=always
RestartSec=10
Environment=NODE_ENV=production
Environment=PORT=3001

[Install]
WantedBy=multi-user.target
EOF

# SMPP Server service
sudo cat > /etc/systemd/system/net2app-smpp.service << EOF
[Unit]
Description=Net2App SMPP Server
After=network.target postgresql.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/net2app-hub
ExecStart=/usr/bin/node smpp-server.mjs
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd and start services
sudo systemctl daemon-reload
sudo systemctl enable net2app-api net2app-smpp
sudo systemctl restart net2app-api net2app-smpp

# Configure Nginx
echo -e "${YELLOW}Configuring Nginx...${NC}"
sudo cat > /etc/nginx/sites-available/net2app << EOF
server {
    listen 80;
    server_name _;
    
    client_max_body_size 50M;
    
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_cache_bypass \$http_upgrade;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

sudo ln -sf /etc/nginx/sites-available/net2app /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo systemctl restart nginx

# Setup firewall
echo -e "${YELLOW}Configuring firewall...${NC}"
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 3001/tcp
sudo ufw allow 2775/tcp
echo "y" | sudo ufw enable

# Create admin user
echo -e "${YELLOW}Creating admin user...${NC}"
cat > /tmp/create_admin.js << 'EOF'
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
    host: 'localhost',
    database: 'net2app_hub',
    user: 'net2app_user',
    password: 'Ariya@2024Net2App',
});

async function createAdmin() {
    const hash = await bcrypt.hash('admin123', 10);
    await pool.query(`
        INSERT INTO users (username, email, password_hash, role, permissions, is_active, created_at)
        VALUES ('admin', 'admin@net2app.com', $1, 'super_admin', ARRAY['all'], true, NOW())
        ON CONFLICT (username) DO UPDATE SET password_hash = $1
    `, [hash]);
    console.log('Admin user created: admin / admin123');
    process.exit(0);
}
createAdmin();
EOF

cd /opt/net2app-hub && node /tmp/create_admin.js

# Insert sample data
echo -e "${YELLOW}Inserting sample data...${NC}"
sudo -u postgres psql -d net2app_hub << 'SQLEOF'
INSERT INTO clients (client_code, company_name, smpp_username, smpp_password, max_tps, balance, credit_limit, status) VALUES
('CL_DEMO', 'Demo Client', 'demo_user', 'demo123', 50, 5000, 10000, 'active')
ON CONFLICT (client_code) DO NOTHING;

INSERT INTO suppliers (supplier_code, company_name, connection_type) VALUES
('SUP_DEMO', 'Demo Supplier', 'smpp')
ON CONFLICT (supplier_code) DO NOTHING;
SQLEOF

# Final output
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}     Installation Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${GREEN}Access your Net2App Hub at:${NC}"
echo -e "  http://$(curl -s ifconfig.me)"
echo ""
echo -e "${GREEN}Login credentials:${NC}"
echo -e "  Username: admin"
echo -e "  Password: admin123"
echo ""
echo -e "${GREEN}Service management:${NC}"
echo -e "  sudo systemctl status net2app-api"
echo -e "  sudo systemctl status net2app-smpp"
echo -e "  sudo journalctl -u net2app-api -f"
echo ""
echo -e "${GREEN}API Endpoints:${NC}"
echo -e "  API Base: http://$(curl -s ifconfig.me)/api"
echo -e "  Health: http://$(curl -s ifconfig.me)/health"
echo ""

