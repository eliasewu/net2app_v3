# NET2APP Hub - Complete SMS Flow & Database Schema

## SMS SENDING FLOW (10 Steps)

```
STEP 1: CLIENT CONNECTION
- SMPP Bind (smpp_username + password + IP whitelist check)
- HTTP API (api_key authentication)
- WhatsApp/Telegram OTT, Voice OTP

STEP 2: AUTHENTICATION CHECK
- Check client exists + status = 'active'
- SQL: SELECT * FROM clients WHERE smpp_username=? AND status='active'

STEP 3: ROUTE PLAN CHECK (Mandatory)
- Client must have routing_plan_id assigned
- Route plan contains routes → routes contain trunk_ids → suppliers
- If no route plan → REJECTED

STEP 4: MCCMNC LOOKUP
- Parse destination → match against route_maps.mccmnc_pattern
- "310*" = US, "234*" = UK, "*" = all

STEP 5: RATE + PROFIT VALIDATION
- profit = client_rate - supplier_rate
- If profit ≤ 0 → ROUTE BLOCKED (supplier costs more than client pays)

STEP 6: BALANCE + CREDIT CHECK
- total_available = balance + credit_limit
- cost = client_rate × message_parts
- If total_available < cost → REJECTED

STEP 7: SUPPLIER SELECTION
- Check bind_status = 'bound', status = 'active', failures < 20

STEP 8: SMS SUBMISSION
- INSERT INTO sms_logs → Submit to supplier → INSERT INTO dlr_queue

STEP 9: DLR PROCESSING
- Retry every 30-35s, max 150s timeout
- force_dlr=true → mark delivered anyway after timeout
- 20 consecutive failures → auto-block supplier

STEP 10: BILLING
- submit mode: charge immediately
- dlr mode: charge only on DELIVRD confirmation
- Invoice: period totals by destination + 19% tax → PDF + email
```

---

## DATABASE SCHEMA (26 Tables) - File: src/database/schema.sql

### 1. users (Authentication)
```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY, username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255), email VARCHAR(255),
    role VARCHAR(50), permissions TEXT[],
    client_id INTEGER, supplier_id INTEGER,
    is_active BOOLEAN, last_login TIMESTAMP
);
```

**Credentials:**
| Username | Password | Role |
|----------|----------|------|
| admin | admin123 | super_admin |
| support | support123 | support |
| billing | billing123 | billing |
| techcorp_user | techcorp123 | client |
| globalsms_user | globalsms123 | supplier |

### 2. clients (SMPP Client Accounts)
```sql
CREATE TABLE clients (
    id SERIAL PRIMARY KEY, client_code VARCHAR(50) UNIQUE,
    company_name VARCHAR(255), email VARCHAR(255),
    smpp_username VARCHAR(100), smpp_password VARCHAR(255), smpp_ip VARCHAR(50),
    max_tps INTEGER, billing_mode VARCHAR(20), currency VARCHAR(3),
    balance DECIMAL(15,4), credit_limit DECIMAL(15,4),
    force_dlr BOOLEAN, dlr_timeout INTEGER,
    routing_plan_id INTEGER, status VARCHAR(20)
);
```

### 3. suppliers (Gateways/Vendors)
```sql
CREATE TABLE suppliers (
    id SERIAL PRIMARY KEY, supplier_code VARCHAR(50) UNIQUE,
    company_name VARCHAR(255),
    connection_type VARCHAR(50), -- smpp/http/ott_whatsapp/ott_telegram/voice_otp/local_bypass/rcs
    smpp_host VARCHAR(255), smpp_port INTEGER,
    smpp_username VARCHAR(100), smpp_password VARCHAR(255),
    api_url TEXT, api_key TEXT,
    balance DECIMAL(15,4), credit_limit DECIMAL(15,4),
    bind_status VARCHAR(20), consecutive_failures INTEGER DEFAULT 0, max_failures INTEGER DEFAULT 20,
    status VARCHAR(20)
);
```

### 4. trunks
```sql
CREATE TABLE trunks (
    id SERIAL PRIMARY KEY, trunk_name VARCHAR(255), trunk_type VARCHAR(50),
    supplier_id INTEGER REFERENCES suppliers(id),
    priority INTEGER, percentage INTEGER,
    is_active BOOLEAN, mccmnc_allowed TEXT[]
);
```

### 5. routes
```sql
CREATE TABLE routes (
    id SERIAL PRIMARY KEY, route_name VARCHAR(255),
    trunk_ids INTEGER[], route_method VARCHAR(20), is_active BOOLEAN
);
```

### 6. route_plans
```sql
CREATE TABLE route_plans (
    id SERIAL PRIMARY KEY, plan_name VARCHAR(255),
    route_ids INTEGER[], is_default BOOLEAN
);
```

### 7. route_maps (Client → Route → Supplier + MCCMNC)
```sql
CREATE TABLE route_maps (
    id SERIAL PRIMARY KEY, client_id INTEGER, route_id INTEGER, supplier_id INTEGER,
    mccmnc_pattern VARCHAR(50) DEFAULT '*', priority INTEGER, percentage INTEGER,
    is_active BOOLEAN
);
-- Flow: Client → route_map (MCCMNC match) → route → trunks → supplier
```

### 8. rates (Versioned Pricing)
```sql
CREATE TABLE rates (
    id SERIAL PRIMARY KEY, entity_type VARCHAR(20), entity_id INTEGER,
    mcc VARCHAR(10), mnc VARCHAR(10) DEFAULT '*',
    country VARCHAR(100), operator VARCHAR(100), rate DECIMAL(10,6),
    currency VARCHAR(3), effective_from DATE, effective_to DATE,
    is_active BOOLEAN, version INTEGER DEFAULT 1
);
-- profit = client_rate - supplier_rate
-- If profit ≤ 0 → ROUTE BLOCKED
-- Old rates: is_active=false with timestamp (shown in RED)
```

### 9. mccmnc (Mobile Country/Network Codes)
```sql
CREATE TABLE mccmnc (
    id SERIAL PRIMARY KEY, country VARCHAR(100), country_code VARCHAR(10),
    mcc VARCHAR(10), mnc VARCHAR(10), operator VARCHAR(255), network_type VARCHAR(50)
);
-- 310=USA, 234=UK, 262=Germany, 208=France, 470=Bangladesh, 404=India
```

### 10. sms_logs (Complete SMS Transaction Log)
```sql
CREATE TABLE sms_logs (
    id SERIAL PRIMARY KEY, message_id VARCHAR(100) UNIQUE,
    client_id INTEGER, client_code VARCHAR(50), supplier_id INTEGER, supplier_code VARCHAR(50),
    sender_id VARCHAR(100), destination VARCHAR(50),
    mcc VARCHAR(10), mnc VARCHAR(10), country VARCHAR(100), operator VARCHAR(100),
    message TEXT, message_parts INTEGER,
    client_rate DECIMAL(10,6), supplier_rate DECIMAL(10,6), profit DECIMAL(10,6), currency VARCHAR(3),
    status VARCHAR(20), dlr_status VARCHAR(20), dlr_timestamp TIMESTAMP,
    error_code VARCHAR(10), error_message TEXT,
    route_id INTEGER, route_name VARCHAR(255), trunk_name VARCHAR(255),
    smpp_message_id VARCHAR(100), submit_time TIMESTAMP, delivery_time TIMESTAMP
);
-- All SMS from testing + clients saved here → visible in CDR
```

### 11. dlr_queue (DLR Retry Logic)
```sql
CREATE TABLE dlr_queue (
    id SERIAL PRIMARY KEY, message_id VARCHAR(100),
    status VARCHAR(20), retry_count INTEGER, max_retries INTEGER DEFAULT 150,
    force_dlr BOOLEAN, dlr_timeout INTEGER, dlr_result VARCHAR(50)
);
```

### 12. invoices
```sql
CREATE TABLE invoices (
    id SERIAL PRIMARY KEY, invoice_number VARCHAR(100) UNIQUE,
    entity_type VARCHAR(20), entity_id INTEGER, entity_name VARCHAR(255),
    invoice_to_name VARCHAR(255), invoice_by_name VARCHAR(255),
    period_start DATE, period_end DATE,
    total_sms INTEGER, total_amount DECIMAL(15,4), tax_amount DECIMAL(15,4),
    grand_total DECIMAL(15,4), tax_rate DECIMAL(5,2) DEFAULT 19.00,
    status VARCHAR(20), due_date DATE, paid_date DATE,
    bank_name VARCHAR(255), bank_iban VARCHAR(50)
);
```

### 13. payments
```sql
CREATE TABLE payments (
    id SERIAL PRIMARY KEY, payment_number VARCHAR(100) UNIQUE,
    entity_type VARCHAR(20), entity_id INTEGER, entity_name VARCHAR(255),
    amount DECIMAL(15,4), currency VARCHAR(3),
    payment_method VARCHAR(50), reference VARCHAR(255), status VARCHAR(20)
);
```

### 14-26: Supporting Tables
- **ott_devices**: WhatsApp/Telegram device sessions (QR pairing)
- **api_connectors**: 50+ pre-configured providers (Twilio, Vonage, Infobip...)
- **voice_otp_configs**: 40+ languages, greeting/retry, SIP settings
- **voice_otp_logs**: Call logs with retry tracking (1-4 attempts, 30-35s each)
- **campaigns**: Bulk SMS with route plan, upload numbers, schedule/immediate
- **campaigns_recipients**: Per-number delivery status
- **translations**: 12 types (SID masking, OTP extract, regex replace, emoji strip...)
- **notifications**: System alerts (low balance, DLR failure, rate change...)
- **notification_templates**: 9 email templates with variables
- **license**: Key activation, system IP/MAC binding, feature toggles
- **tenants**: Multi-tenant with monthly SMS limits & TPS
- **platform_settings**: 14 global config keys
- **smtp_config**: SMTP email (Gmail/Outlook/SendGrid/SES/custom)
- **audit_logs**: All user actions tracked

---

## BILLING MODES

### Submit Mode (billing_mode='submit'):
- Charge at SMS submission time
- UPDATE clients SET balance = balance - (rate × parts)
- DLR status does NOT affect billing
- Invoice: ALL submitted SMS counted

### DLR Mode (billing_mode='dlr'):
- NO charge at submission
- Charge ONLY when DLR = 'DELIVRD'
- UPDATE clients SET balance = balance - (rate × parts) only on success
- force_dlr=true → charge after timeout (150s) even without DLR
- force_dlr=false → NO charge if DLR never arrives

---

## ROUTING FLOW EXAMPLE

```
Client CLT001 → SMS to +1234567890 (US, MCC 310)
  │
  ├─ Route Map: "310*" → route_id=1, supplier_id=1, priority=1
  ├─ Route: "Premium OTP Route" (trunk_ids=[2,1])
  ├─ Trunk: "SIM OTP Primary" → supplier SUP003 (bound, 0 failures)
  ├─ Rate: Client €0.0250 - Supplier €0.0150 = Profit €0.0100 ✅
  ├─ Balance: €5,000 + Credit €10,000 = €15,000 available ✅
  └─ SUBMIT_SM → DLR (DELIVRD) → Billed €0.0250
```

---

## AUTO-BLOCKING

```
Each DLR failure → consecutive_failures++
Each DLR success → consecutive_failures = 0

IF consecutive_failures >= 20:
  → suppliers.status = 'inactive'
  → suppliers.bind_status = 'unbound'
  → DLR Failure Alert email sent
  → Route removed from active pool
  → Admin must manually reactivate
```

---

## SMS INBOX (MO - Mobile Originated)

```
All incoming SMS from end-users shown in SMS Inbox
Features: Reply, keyword detection (STOP/HELP), processed tracking
Two-way SMS planned for future
All MO messages stored in database
```

---

## PROFIT CALCULATION

```
profit = client_rate - supplier_rate
If profit ≤ 0 → ROUTE BLOCKED
If profit > 0 → Allow routing
Displayed in: Test SMS, CDR, Campaigns, Reports
```

---

## BALANCE CHECK

```
total_available = client.balance + client.credit_limit
cost = client_rate × message_parts
If total_available < cost → REJECTED: "Insufficient balance/credit"
```

---

## COMPLETE FILE MAP

```
src/
├── database/
│   ├── schema.sql          ← Full PostgreSQL schema with ALL 26 tables
│   ├── postgresql.ts       ← Database service layer
│   └── apiEndpoints.ts     ← 200+ REST API endpoints
├── store/
│   ├── AuthContext.tsx      ← Authentication (5 users, session management)
│   └── DataContext.tsx      ← Global state (all CRUD operations)
├── services/
│   ├── api.ts              ← HTTP client with JWT auth
│   ├── apiServices.ts      ← SMS, Rates, Billing, DLR, Voice OTP services
│   └── smppService.ts      ← SMPP Server & Client (smppy integration)
├── pages/
│   ├── Testing/TestSMS.tsx  ← Full validation flow (7 steps)
│   ├── SMSLogs.tsx          ← Complete CDR viewer
│   ├── SMSInbox.tsx         ← MO messages inbox
│   ├── Campaigns.tsx        ← Bulk SMS with upload/schedule
│   ├── Translations.tsx     ← 12 translation types
│   ├── Clients/             ← Client CRUD + rates + detail
│   ├── Suppliers/           ← Supplier CRUD + rates + API connectors + OTT + Voice
│   ├── Routing/             ← Trunks, Routes, Route Maps, Route Plans
│   ├── Billing/             ← Invoices, Payments
│   └── ...                  ← 30+ pages total
└── App.tsx                  ← Routes with auth guard
```
