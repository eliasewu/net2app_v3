#!/bin/bash

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}Testing Complete CRUD Operations${NC}"
echo -e "${BLUE}========================================${NC}"

# Get token
TOKEN=$(curl -s -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Ariya2015@22"}' \
  | jq -r '.token')

if [ "$TOKEN" == "null" ] || [ -z "$TOKEN" ]; then
    echo -e "${RED}Failed to get token${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Token obtained${NC}\n"

# 1. CREATE
echo -e "${YELLOW}1. CREATE Client${NC}"
CREATE_RESULT=$(curl -s -X POST http://localhost:3001/api/clients \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "client_code": "CL_CRUD_TEST",
    "company_name": "CRUD Test Client",
    "contact_person": "Test User",
    "phone": "+1234567890",
    "smpp_username": "crud_test",
    "smpp_password": "test123",
    "max_tps": 30,
    "routing_plan_id": 3
  }')

CLIENT_ID=$(echo $CREATE_RESULT | jq -r '.data.id')
echo "Created Client ID: $CLIENT_ID"
echo ""

# 2. READ
echo -e "${YELLOW}2. READ Client${NC}"
curl -s -X GET "http://localhost:3001/api/clients?client_code=CL_CRUD_TEST" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.data[0] | {client_code, company_name, max_tps}'
echo ""

# 3. UPDATE
echo -e "${YELLOW}3. UPDATE Client${NC}"
curl -s -X PUT "http://localhost:3001/api/clients/$CLIENT_ID" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "max_tps": 75,
    "company_name": "CRUD Test Client Updated",
    "credit_limit": 25000.00
  }' \
  | jq '{success, message}'
echo ""

# 4. VERIFY UPDATE
echo -e "${YELLOW}4. VERIFY Update${NC}"
curl -s -X GET "http://localhost:3001/api/clients?client_code=CL_CRUD_TEST" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.data[0] | {client_code, company_name, max_tps, credit_limit}'
echo ""

# 5. DELETE
echo -e "${YELLOW}5. DELETE Client${NC}"
curl -s -X DELETE "http://localhost:3001/api/clients/$CLIENT_ID" \
  -H "Authorization: Bearer $TOKEN" \
  | jq .
echo ""

# 6. VERIFY DELETION
echo -e "${YELLOW}6. VERIFY Deletion${NC}"
COUNT=$(curl -s -X GET "http://localhost:3001/api/clients?client_code=CL_CRUD_TEST" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.data | length')
echo "Client found: $COUNT (0 = deleted successfully)"
echo ""

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}CRUD Test Complete!${NC}"
echo -e "${GREEN}========================================${NC}"

