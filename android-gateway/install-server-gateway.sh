#!/bin/bash
# ============================================================
# NET2APP Android Gateway — Server Integration Script
# ============================================================
# This script adds the Android Gateway API routes to server.cjs
# safely with a backup.
# ============================================================

set -e

SERVER_FILE="../server.cjs"
GATEWAY_ROUTES="server-gateway-routes.cjs"
BACKUP_FILE="server.cjs.bak.gateway.$(date +%Y%m%d_%H%M%S)"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  NET2APP Android Gateway Installer${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""

# Check files exist
if [ ! -f "$SERVER_FILE" ]; then
    echo -e "${RED}Error: $SERVER_FILE not found!${NC}"
    echo "Run this script from the android-gateway/ directory"
    exit 1
fi

if [ ! -f "$GATEWAY_ROUTES" ]; then
    echo -e "${RED}Error: $GATEWAY_ROUTES not found!${NC}"
    exit 1
fi

# Check if already installed
if grep -q "ANDROID SMS GATEWAY" "$SERVER_FILE"; then
    echo -e "${YELLOW}⚠ Android Gateway routes already exist in server.cjs${NC}"
    echo -e "${YELLOW}  Skipping installation to avoid duplicates.${NC}"
    echo ""
    echo "To re-install:"
    echo "  1. Remove the gateway section from server.cjs"
    echo "  2. Run this script again"
    exit 0
fi

# Create backup
cp "$SERVER_FILE" "$BACKUP_FILE"
echo -e "${GREEN}✅ Backup saved: $BACKUP_FILE${NC}"

# Find insertion point (before app.listen)
LISTEN_LINE=$(grep -n "app\.listen" "$SERVER_FILE" | head -1 | cut -d: -f1)

if [ -z "$LISTEN_LINE" ]; then
    echo -e "${RED}Error: Could not find app.listen() in $SERVER_FILE${NC}"
    exit 1
fi

INSERT_LINE=$((LISTEN_LINE - 2))

echo -e "${GREEN}  Found app.listen() at line $LISTEN_LINE${NC}"
echo -e "${GREEN}  Inserting gateway routes at line $INSERT_LINE${NC}"

# Extract and insert the route code from the .cjs file
# We need to extract everything after the header comment block
ROUTES_START=$(grep -n "app.post('/api/gateway/register'" "$GATEWAY_ROUTES" | head -1 | cut -d: -f1)

if [ -z "$ROUTES_START" ]; then
    echo -e "${YELLOW}  Extracting full route content...${NC}"
    # Just insert the whole file minus header comments
    sed -n '/^app\./,$ p' "$GATEWAY_ROUTES" > /tmp/gateway_routes_temp.js
    
    # Insert before app.listen using sed
    sed -i "${INSERT_LINE}r /tmp/gateway_routes_temp.js" "$SERVER_FILE"
else
    echo -e "${YELLOW}  Routes start at line $ROUTES_START${NC}"
    sed -n "${ROUTES_START},\$ p" "$GATEWAY_ROUTES" > /tmp/gateway_routes_temp.js
    
    # Insert before app.listen
    sed -i "${INSERT_LINE}r /tmp/gateway_routes_temp.js" "$SERVER_FILE"
fi

rm -f /tmp/gateway_routes_temp.js

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  ✅ Gateway routes installed!${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""
echo "Next steps:"
echo "  1. Review the changes:  diff $BACKUP_FILE $SERVER_FILE"
echo "  2. Restart the server:  pm2 restart server"
echo "  3. Test:               curl http://localhost:3001/api/gateway/ping"
echo ""
echo "To revert: cp $BACKUP_FILE $SERVER_FILE"
