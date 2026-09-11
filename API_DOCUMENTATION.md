# NET2APP Hub - HTTP API Documentation

## Base URL
```
https://sms.yourdomain.com/api/v1
```

## Authentication
All API requests require an API key passed in the header:
```
X-API-Key: your_api_key_here
```

For Basic Auth (Twilio-style):
```
Authorization: Basic base64(username:password)
```

For Bearer Token:
```
Authorization: Bearer your_token_here
```

---

## CLIENT API (Send SMS)

### 1. Send SMS
Send a single SMS message through the platform.

```
POST /api/v1/sms/send
Content-Type: application/json
X-API-Key: {client_api_key}
```

**Request Body:**
```json
{
  "to": "+1234567890",
  "from": "TECHCORP",
  "text": "Your verification code is 123456",
  "message_id": "OPTIONAL_UNIQUE_ID",
  "dlr_url": "https://your-server.com/dlr-callback",
  "route_plan_id": "1",
  "schedule": "2024-06-15T10:30:00Z",
  "unicode": false,
  "flash": false,
  "ttl": 3600
}
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| to | string | Yes | Destination phone number (E.164 format recommended) |
| from | string | Yes | Sender ID / short code (max 11 chars for numeric, 11 for alphanumeric) |
| text | string | Yes | Message body (max 1600 chars) |
| message_id | string | No | Your unique message ID for tracking |
| dlr_url | string | No | Webhook URL for delivery receipt callback |
| route_plan_id | string | No | Force specific route plan |
| schedule | ISO 8601 | No | Schedule for future delivery |
| unicode | boolean | No | Send as Unicode (UCS-2) instead of GSM-7 |
| flash | boolean | No | Send as Flash SMS (Class 0) |
| ttl | integer | No | Time-to-live in seconds before expiry |

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "message_id": "MSG202406151030001234",
    "your_message_id": "OPTIONAL_UNIQUE_ID",
    "to": "+1234567890",
    "from": "TECHCORP",
    "text": "Your verification code is 123456",
    "parts": 1,
    "rate": 0.0250,
    "currency": "EUR",
    "cost": 0.0250,
    "status": "submitted",
    "submitted_at": "2024-06-15T10:30:00Z"
  }
}
```

**Error Response (400/401/402/429):**
```json
{
  "success": false,
  "error": "Insufficient balance",
  "code": "INSUFFICIENT_BALANCE",
  "details": {
    "balance": 500.00,
    "credit_limit": 1000.00,
    "available": 1500.00,
    "needed": 0.0250
  }
}
```

### 2. Send Bulk SMS
Send SMS to multiple recipients.

```
POST /api/v1/sms/bulk
Content-Type: application/json
X-API-Key: {client_api_key}
```

**Request Body:**
```json
{
  "messages": [
    {
      "to": "+1234567890",
      "text": "Hello John!"
    },
    {
      "to": "+1987654321",
      "text": "Hello Sarah!"
    }
  ],
  "from": "TECHCORP",
  "dlr_url": "https://your-server.com/dlr-callback"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "batch_id": "BATCH202406151031000001",
    "total": 2,
    "accepted": 2,
    "rejected": 0,
    "messages": [
      { "to": "+1234567890", "message_id": "MSG202406151031001234", "status": "submitted" },
      { "to": "+1987654321", "message_id": "MSG202406151031001235", "status": "submitted" }
    ]
  }
}
```

### 3. Check DLR (Delivery Receipt)

```
GET /api/v1/sms/dlr/{message_id}
X-API-Key: {client_api_key}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "message_id": "MSG202406151030001234",
    "your_message_id": "OPTIONAL_UNIQUE_ID",
    "to": "+1234567890",
    "from": "TECHCORP",
    "status": "delivered",
    "dlr_status": "DELIVRD",
    "submitted_at": "2024-06-15T10:30:00Z",
    "delivered_at": "2024-06-15T10:30:03Z",
    "latency_ms": 3200,
    "error": null
  }
}
```

**DLR Status Codes:**
| Code | Description |
|------|-------------|
| DELIVRD | Message delivered successfully |
| UNDELIV | Message undeliverable |
| EXPIRED | Message TTL expired |
| REJECTD | Message rejected by operator |
| DELETED | Message deleted |
| UNKNOWN | Status unknown |
| PENDING | Awaiting delivery confirmation |

### 4. Check Balance

```
GET /api/v1/account/balance
X-API-Key: {client_api_key}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "balance": 5000.00,
    "credit_limit": 10000.00,
    "available": 15000.00,
    "currency": "EUR",
    "billing_mode": "dlr"
  }
}
```

---

## SUPPLIER API (Receive SMS for Delivery)

### 1. Receive SMS for Delivery (SMPP/HTTP Gateway)
Suppliers use this endpoint to receive SMS that NET2APP routes through them.

```
POST /api/v1/supplier/sms/receive
Content-Type: application/json
Authorization: Basic base64(supplier_username:supplier_password)
```

**Request Body:**
```json
{
  "messages": [
    {
      "message_id": "EXT_MSG_001",
      "to": "+1234567890",
      "from": "TECHCORP",
      "text": "Your OTP is 123456",
      "coding": 0,
      "registered_delivery": 1
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "accepted": 1,
    "message_ids": ["NET2APP_MSG_001"]
  }
}
```

### 2. Submit DLR (Delivery Receipt)
Suppliers submit delivery receipts back to the platform.

```
POST /api/v1/supplier/dlr/submit
Content-Type: application/json
Authorization: Basic base64(supplier_username:supplier_password)
```

**Request Body:**
```json
{
  "dlrs": [
    {
      "message_id": "NET2APP_MSG_001",
      "status": "DELIVRD",
      "error_code": "000",
      "submit_date": "2024-06-15T10:30:00Z",
      "done_date": "2024-06-15T10:30:03Z"
    },
    {
      "message_id": "NET2APP_MSG_002",
      "status": "UNDELIV",
      "error_code": "001",
      "error_text": "Subscriber unreachable",
      "submit_date": "2024-06-15T10:30:00Z",
      "done_date": "2024-06-15T10:30:05Z"
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "processed": 2,
    "delivered": 1,
    "failed": 1
  }
}
```

### 3. Supplier Balance Inquiry

```
GET /api/v1/supplier/account/balance
Authorization: Basic base64(supplier_username:supplier_password)
```

**Response:**
```json
{
  "success": true,
  "data": {
    "balance": 50000.00,
    "credit_limit": 100000.00,
    "currency": "EUR",
    "sms_sent_today": 125000,
    "sms_delivered_today": 118750
  }
}
```

---

## CALLBACKS / WEBHOOKS

### DLR Callback (sent to your dlr_url)
When a DLR is received, the platform POSTs to your callback URL:

```
POST {your_dlr_url}
Content-Type: application/json
```

**Callback Body:**
```json
{
  "message_id": "MSG202406151030001234",
  "your_message_id": "OPTIONAL_UNIQUE_ID",
  "to": "+1234567890",
  "status": "delivered",
  "dlr_status": "DELIVRD",
  "dlr_timestamp": "2024-06-15T10:30:03Z",
  "error_code": "000",
  "latency_ms": 3200
}
```

### Incoming SMS (MO) Callback
When a mobile-originated SMS is received:

```json
{
  "type": "mo",
  "from": "+1234567890",
  "to": "TECHCORP",
  "text": "STOP",
  "received_at": "2024-06-15T10:35:00Z",
  "keyword": "STOP",
  "mcc": "310",
  "mnc": "260",
  "country": "United States"
}
```

---

## ERROR CODES

| HTTP Code | Code | Description |
|-----------|------|-------------|
| 400 | INVALID_NUMBER | Invalid destination number |
| 400 | INVALID_SENDER | Invalid sender ID |
| 400 | EMPTY_MESSAGE | Message body is empty |
| 400 | MESSAGE_TOO_LONG | Message exceeds maximum length |
| 400 | MISSING_PARAMETER | Required parameter missing |
| 400 | ROUTE_NOT_FOUND | No active route for destination |
| 400 | ROUTE_BLOCKED | Route blocked (negative profit) |
| 401 | AUTH_FAILED | Invalid API key or credentials |
| 401 | ACCOUNT_SUSPENDED | Account is suspended |
| 402 | INSUFFICIENT_BALANCE | Balance + credit limit insufficient |
| 402 | MONTHLY_LIMIT_REACHED | Monthly SMS volume limit reached |
| 402 | TPS_LIMIT_REACHED | Transactions per second limit reached |
| 403 | FEATURE_DISABLED | Licensed feature not enabled |
| 403 | IP_NOT_ALLOWED | IP address not whitelisted |
| 404 | MESSAGE_NOT_FOUND | Message ID not found |
| 429 | RATE_LIMITED | Too many requests |
| 500 | INTERNAL_ERROR | Internal server error |

---

## RATE LIMITS

| Endpoint | Limit |
|----------|-------|
| POST /sms/send | Per-client TPS limit |
| POST /sms/bulk | 1000 messages per request max |
| GET /sms/dlr | 100 requests per second |
| GET /account/balance | 10 requests per second |

---

## CODE EXAMPLES

### cURL
```bash
# Send SMS
curl -X POST https://sms.yourdomain.com/api/v1/sms/send \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your_api_key" \
  -d '{
    "to": "+1234567890",
    "from": "TECHCORP",
    "text": "Hello World!"
  }'

# Check DLR
curl -X GET https://sms.yourdomain.com/api/v1/sms/dlr/MSG202406151030001234 \
  -H "X-API-Key: your_api_key"

# Check Balance
curl -X GET https://sms.yourdomain.com/api/v1/account/balance \
  -H "X-API-Key: your_api_key"
```

### Python
```python
import requests

API_URL = "https://sms.yourdomain.com/api/v1"
API_KEY = "your_api_key"

# Send SMS
response = requests.post(
    f"{API_URL}/sms/send",
    headers={"X-API-Key": API_KEY, "Content-Type": "application/json"},
    json={"to": "+1234567890", "from": "TECHCORP", "text": "Hello World!"}
)
print(response.json())

# Check DLR
dlr = requests.get(
    f"{API_URL}/sms/dlr/MSG202406151030001234",
    headers={"X-API-Key": API_KEY}
)
print(dlr.json())

# Check Balance
balance = requests.get(
    f"{API_URL}/account/balance",
    headers={"X-API-Key": API_KEY}
)
print(balance.json())
```

### PHP
```php
<?php
$api_url = "https://sms.yourdomain.com/api/v1";
$api_key = "your_api_key";

// Send SMS
$ch = curl_init("$api_url/sms/send");
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, ["Content-Type: application/json", "X-API-Key: $api_key"]);
curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode(["to" => "+1234567890", "from" => "TECHCORP", "text" => "Hello World!"]));
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
echo curl_exec($ch);
curl_close($ch);

// Check DLR
$ch = curl_init("$api_url/sms/dlr/MSG202406151030001234");
curl_setopt($ch, CURLOPT_HTTPHEADER, ["X-API-Key: $api_key"]);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
echo curl_exec($ch);
curl_close($ch);
?>
```

### Node.js
```javascript
const axios = require('axios');

const API_URL = 'https://sms.yourdomain.com/api/v1';
const API_KEY = 'your_api_key';

// Send SMS
async function sendSMS() {
  const { data } = await axios.post(`${API_URL}/sms/send`, {
    to: '+1234567890',
    from: 'TECHCORP',
    text: 'Hello World!'
  }, { headers: { 'X-API-Key': API_KEY, 'Content-Type': 'application/json' } });
  console.log(data);
}

// Check DLR
async function checkDLR(messageId) {
  const { data } = await axios.get(`${API_URL}/sms/dlr/${messageId}`, {
    headers: { 'X-API-Key': API_KEY }
  });
  console.log(data);
}

sendSMS();
```
