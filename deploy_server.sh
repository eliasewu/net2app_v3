#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Net2App Hub Server Deployment Script${NC}"
echo -e "${GREEN}========================================${NC}"

# Navigate to app directory
cd /home/ubuntu/net2app-hub

# Backup current server if exists
if [ -f server.cjs ]; then
    echo -e "${YELLOW}Backing up current server.cjs...${NC}"
    cp server.cjs server.cjs.backup.$(date +%Y%m%d_%H%M%S)
    echo -e "${GREEN}✓ Backup created${NC}"
fi

# Stop current server
echo -e "${YELLOW}Stopping current server...${NC}"
pkill -f "node.*server.cjs"
sleep 2
echo -e "${GREEN}✓ Server stopped${NC}"

# Deploy new server
echo -e "${YELLOW}Deploying new server with DELETE endpoint...${NC}"
cp server_complete.cjs server.cjs
echo -e "${GREEN}✓ New server deployed${NC}"

# Start server
echo -e "${YELLOW}Starting server on port 3001...${NC}"
PORT=3001 node server.cjs > server.log 2>&1 &
SERVER_PID=$!
sleep 3

# Check if server is running
if ps -p $SERVER_PID > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Server started successfully (PID: $SERVER_PID)${NC}"
else
    echo -e "${RED}✗ Server failed to start. Check server.log${NC}"
    tail -20 server.log
    exit 1
fi

# Test server
echo -e "${YELLOW}Testing server connectivity...${NC}"
sleep 2

# Test health endpoint
HEALTH_CHECK=$(curl -s http://localhost:3001/health)
if echo "$HEALTH_CHECK" | grep -q "ok"; then
    echo -e "${GREEN}✓ Health check passed${NC}"
else
    echo -e "${RED}✗ Health check failed${NC}"
fi

# Test login
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Ariya2015@22"}' \
  | jq -r '.token')

if [ "$TOKEN" != "null" ] && [ -n "$TOKEN" ]; then
    echo -e "${GREEN}✓ Authentication working${NC}"
    
    # Test DELETE endpoint
    echo -e "${YELLOW}Testing DELETE endpoint...${NC}"
    
    # Create test client
    CREATE_RESULT=$(curl -s -X POST http://localhost:3001/api/clients \
      -H "Content-Type: application/json" \
      -H "Authorization: Bearer $TOKEN" \
      -d '{
        "client_code": "CL_TEST_DELETE_API",
        "company_name": "Test DELETE API",
        "routing_plan_id": 3,
        "smpp_username": "test_delete",
        "smpp_password": "test123",
        "max_tps": 10
      }')
    
    CLIENT_ID=$(echo $CREATE_RESULT | jq -r '.data.id')
    
    if [ "$CLIENT_ID" != "null" ] && [ -n "$CLIENT_ID" ]; then
        # Delete the test client
        DELETE_RESULT=$(curl -s -X DELETE "http://localhost:3001/api/clients/$CLIENT_ID" \
          -H "Authorization: Bearer $TOKEN")
        
        if echo "$DELETE_RESULT" | grep -q "success"; then
            echo -e "${GREEN}✓ DELETE endpoint working${NC}"
        else
            echo -e "${RED}✗ DELETE endpoint failed${NC}"
        fi
    fi
else
    echo -e "${RED}✗ Authentication failed${NC}"
fi

echo -e "\n${GREEN}========================================${NC}"
echo -e "${GREEN}Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "Server running on: ${YELLOW}http://localhost:3001${NC}"
echo -e "Log file: ${YELLOW}/home/ubuntu/net2app-hub/server.log${NC}"
echo -e "\nTo view logs: ${YELLOW}tail -f /home/ubuntu/net2app-hub/server.log${NC}"
echo -e "To stop server: ${YELLOW}pkill -f 'node.*server.cjs'${NC}"
echo -e "To restart: ${YELLOW}cd /home/ubuntu/net2app-hub && PORT=3001 node server.cjs &${NC}"

