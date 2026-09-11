# NET2APP HUB — Complete System Architecture

## 1. System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          BROWSER (React SPA)                                │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│  │  Login   │ │ Dashboard│ │  Clients │ │Suppliers │ │  Billing │  ...    │
│  │ /login   │ │    /     │ │/clients  │ │/suppliers│ │  /billing│  42+    │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘  Pages  │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │ HTTP/HTTPS (Port 443/80)
                               │ JSON REST API
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                NGINX Reverse Proxy                                         │
│  ┌──────────────────────────────────────────────────────────────────┐      │
│  │  /api/* → proxy_pass http://localhost:3001                       │      │
│  │  /*     → serve /opt/net2app-hub/dist/index.html (SPA)          │      │
│  └──────────────────────────────────────────────────────────────────┘      │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    NODE.JS (server.cjs) — Port 3001                         │
│                                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────┐                │
│  │  Auth    │  │  CRUD    │  │  SMS     │  │  External    │                │
│  │  JWT     │  │  API     │  │  Engine  │  │  API v1      │                │
│  │  bcrypt  │  │  Generic │  │  Profit  │  │  username+   │                │
│  │          │  │  for all │  │  Check   │  │  password    │                │
│  │          │  │  tables  │  │  DLR     │  │  auth        │                │
│  └──────────┘  └──────────┘  └──────────┘  └──────────────┘                │
└──────────────────────────────┬──────────────────────────────────────────────┘
                               │ node-postgres (pg)
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    POSTGRESQL — 27 Tables (net2app_hub)                    │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────┐      │
│  │  1. users           2. clients         3. suppliers              │      │
│  │  4. trunks          5. routes          6. route_plans            │      │
│  │  7. route_maps      8. rates           9. mccmnc                 │      │
│  │  10. sms_logs       11. dlr_queue     12. invoices               │      │
│  │  13. payments       14. ott_devices   15. api_connectors         │      │
│  │  16. voice_otp_configs  17. voice_otp_logs  18. campaigns        │      │
│  │  19. translations   20. notifications 21. notification_templates │      │
│  │  22. license        23. tenants       24. platform_settings      │      │
│  │  25. smtp_config    26. audit_logs    27. campaigns_recipients   │      │
│  └──────────────────────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. SMS Sending Flow

```
Client submits SMS → POST /api/sms/send
         │
         ▼
┌─────────────────────────────────────────────────────┐
│  STEP 1: AUTHENTICATION                              │
│  ┌─ Check client exists in clients table             │
│  ├─ status = 'active'                                │
│  ├─ SMPP credentials or JWT valid                    │
│  └─ IP whitelist (if configured)                     │
├─────────────────────────────────────────────────────┤
│  STEP 2: ROUTE PLAN (Mandatory)                      │
│  ┌─ client.routing_plan_id required                  │
│  ├─ route_plans → route_ids[] → routes               │
│  └─ routes → trunk_ids[] → trunks → supplier_id      │
├─────────────────────────────────────────────────────┤
│  STEP 3: MCCMNC LOOKUP                               │
│  ┌─ Parse destination number                         │
│  ├─ mccmnc table: match mcc by country               │
│  ├─ route_maps: mccmnc_pattern LIKE '310%'           │
│  └─ Match client → supplier mapping                  │
├─────────────────────────────────────────────────────┤
│  STEP 4: RATE CHECK                                   │
│  ┌─ rates table: entity_type='client', is_active     │
│  ├─ rates table: entity_type='supplier', is_active   │
│  ├─ profit = client_rate - supplier_rate              │
│  └─ profit ≤ 0 → ROUTE BLOCKED → find alternative    │
├─────────────────────────────────────────────────────┤
│  STEP 5: BALANCE + CREDIT CHECK                       │
│  ┌─ available = balance + credit_limit                │
│  ├─ cost = client_rate × message_parts                │
│  └─ available < cost → INSUFFICIENT BALANCE           │
├─────────────────────────────────────────────────────┤
│  STEP 6: INSERT SMS LOG                               │
│  ┌─ INSERT INTO sms_logs (status='submitted')        │
│  ├─ Stores: client_rate, supplier_rate, profit       │
│  └─ message_id = MSG + timestamp                     │
├─────────────────────────────────────────────────────┤
│  STEP 7: BILLING                                      │
│  ┌─ billing_mode = 'submit' → charge immediately     │
│  ├─ billing_mode = 'dlr' → charge on delivery       │
│  ├─ force_dlr = true → charge after timeout          │
│  └─ force_dlr = false → charge only on DELIVRD       │
├─────────────────────────────────────────────────────┤
│  STEP 8: DLR PROCESSING                               │
│  ┌─ Simulated DLR after 3-8 seconds                  │
│  ├─ DELIVRD → status='delivered', charge if dlr mode │
│  ├─ UNDELIV → status='failed', NO charge             │
│  ├─ 20 consecutive failures → auto-block supplier    │
│  └─ DLR callback to client's dlr_url if configured   │
└─────────────────────────────────────────────────────┘
```

---

## 3. Database Schema (27 Tables)

### Table: users
```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'agent',
    permissions TEXT[] DEFAULT '{}',
    client_id INTEGER, supplier_id INTEGER,
    name VARCHAR(255), is_active BOOLEAN DEFAULT true,
    last_login TIMESTAMP, created_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```
**Default users: admin/admin123, support/support123, billing/billing123, techcorp_user/techcorp123, globalsms_user/globalsms123**

### Table: clients
```sql
CREATE TABLE clients (
    id SERIAL PRIMARY KEY, client_code VARCHAR(50) UNIQUE NOT NULL,
    company_name VARCHAR(255) NOT NULL, contact_person VARCHAR(255),
    email VARCHAR(255), phone VARCHAR(50), address TEXT, country VARCHAR(100),
    smpp_username VARCHAR(100) UNIQUE NOT NULL, smpp_password VARCHAR(255) NOT NULL,
    smpp_ip VARCHAR(50), smpp_port INTEGER DEFAULT 2775,
    system_type VARCHAR(50) DEFAULT 'SMPP', max_tps INTEGER DEFAULT 100,
    billing_mode VARCHAR(20) DEFAULT 'dlr', currency VARCHAR(3) DEFAULT 'EUR',
    balance DECIMAL(15,4) DEFAULT 0, credit_limit DECIMAL(15,4) DEFAULT 0,
    api_enabled BOOLEAN DEFAULT false, webhook_url TEXT,
    force_dlr BOOLEAN DEFAULT false, dlr_timeout INTEGER DEFAULT 150,
    routing_plan_id INTEGER, rate_plan_id INTEGER,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Table: suppliers
```sql
CREATE TABLE suppliers (
    id SERIAL PRIMARY KEY, supplier_code VARCHAR(50) UNIQUE NOT NULL,
    company_name VARCHAR(255) NOT NULL, connection_type VARCHAR(50) NOT NULL,
    smpp_host VARCHAR(255), smpp_port INTEGER DEFAULT 2775,
    smpp_username VARCHAR(100), smpp_password VARCHAR(255), system_id VARCHAR(100),
    api_url TEXT, api_key TEXT, api_secret TEXT, api_method VARCHAR(10) DEFAULT 'POST',
    balance DECIMAL(15,4) DEFAULT 0, credit_limit DECIMAL(15,4) DEFAULT 0,
    currency VARCHAR(3) DEFAULT 'EUR',
    bind_status VARCHAR(20) DEFAULT 'unbound', consecutive_failures INTEGER DEFAULT 0,
    max_failures INTEGER DEFAULT 20, selected_endpoint_id VARCHAR(100),
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Table: sms_logs (Complete CDR)
```sql
CREATE TABLE sms_logs (
    id SERIAL PRIMARY KEY, message_id VARCHAR(100) UNIQUE NOT NULL,
    client_id INTEGER, client_code VARCHAR(50),
    supplier_id INTEGER, supplier_code VARCHAR(50),
    sender_id VARCHAR(100) NOT NULL, destination VARCHAR(50) NOT NULL,
    mcc VARCHAR(10), mnc VARCHAR(10), country VARCHAR(100), operator VARCHAR(100),
    message TEXT NOT NULL, message_parts INTEGER DEFAULT 1,
    client_rate DECIMAL(10,6) DEFAULT 0, supplier_rate DECIMAL(10,6) DEFAULT 0,
    profit DECIMAL(10,6) DEFAULT 0, currency VARCHAR(3) DEFAULT 'EUR',
    status VARCHAR(20) DEFAULT 'pending',
    dlr_status VARCHAR(20), dlr_timestamp TIMESTAMP,
    error_code VARCHAR(10), error_message TEXT,
    route_id INTEGER, route_name VARCHAR(255), trunk_name VARCHAR(255),
    smpp_message_id VARCHAR(100), source VARCHAR(50) DEFAULT 'smpp',
    submit_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    delivery_time TIMESTAMP, dlr_callback_url TEXT, dlr_attempts INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Table: rates (Versioned)
```sql
CREATE TABLE rates (
    id SERIAL PRIMARY KEY, entity_type VARCHAR(20) NOT NULL,
    entity_id INTEGER NOT NULL, mcc VARCHAR(10) NOT NULL,
    mnc VARCHAR(10) NOT NULL DEFAULT '*', country VARCHAR(100) NOT NULL,
    operator VARCHAR(100) DEFAULT 'All', rate DECIMAL(10,6) NOT NULL,
    currency VARCHAR(3) DEFAULT 'EUR', effective_from DATE NOT NULL,
    effective_to DATE, is_active BOOLEAN DEFAULT true,
    version INTEGER DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Table: invoices
```sql
CREATE TABLE invoices (
    id SERIAL PRIMARY KEY, invoice_number VARCHAR(100) UNIQUE NOT NULL,
    entity_type VARCHAR(20) NOT NULL, entity_id INTEGER NOT NULL,
    entity_name VARCHAR(255) NOT NULL,
    invoice_to_name VARCHAR(255), invoice_to_address TEXT, invoice_to_email VARCHAR(255),
    invoice_by_name VARCHAR(255) DEFAULT 'NET2APP Hub',
    invoice_by_address TEXT, invoice_by_email VARCHAR(255),
    invoice_by_vat VARCHAR(50),
    period_start DATE NOT NULL, period_end DATE NOT NULL,
    total_sms INTEGER DEFAULT 0, total_amount DECIMAL(15,4) DEFAULT 0,
    tax_amount DECIMAL(15,4) DEFAULT 0, tax_rate DECIMAL(5,2) DEFAULT 19.00,
    grand_total DECIMAL(15,4) DEFAULT 0, currency VARCHAR(3) DEFAULT 'EUR',
    status VARCHAR(20) DEFAULT 'draft', due_date DATE, paid_date DATE,
    payment_method VARCHAR(50), payment_reference VARCHAR(255),
    notes TEXT, sent_at TIMESTAMP,
    bank_name VARCHAR(255), bank_account VARCHAR(100), bank_iban VARCHAR(50), bank_bic VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Other Tables: route_plans, routes, trunks, route_maps, mccmnc, dlr_queue, payments, campaigns, campaign_recipients, translations, notifications, notification_templates, ott_devices, api_connectors, voice_otp_configs, voice_otp_logs, license, tenants, platform_settings, smtp_config, audit_logs

---

## 4. API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/auth/login | JWT authentication |
| GET/POST/PUT/DELETE | /api/clients[/:id] | Client CRUD |
| GET/POST/PUT/DELETE | /api/suppliers[/:id] | Supplier CRUD |
| POST | /api/sms/send | Send SMS with validation |
| POST | /api/sms/logs | Query SMS logs |
| GET/POST | /api/rates[/:id] | Rate CRUD with versioning |
| POST | /api/rates/bulk | Bulk rate import |
| GET/POST/PUT/DELETE | /api/mccmnc[/:id] | MCCMNC database |
| GET/POST | /api/billing/invoices[/:id] | Invoice generation + CRUD |
| POST | /api/billing/invoices/bulk | Bulk invoice generation |
| GET | /api/bind/status | SMPP bind status |
| POST | /api/bind/:id/reconnect | Reconnect supplier |
| POST | /api/v1/sms/send | External API — send SMS |
| GET | /api/v1/sms/dlr/:id | External API — DLR inquiry |
| GET | /api/v1/account/balance | External API — balance check |
| POST | /api/v1/supplier/sms/receive | Supplier receives SMS |
| POST | /api/v1/supplier/dlr/submit | Supplier submits DLR |
| GET/POST/PUT/DELETE | /api/{table}[/:id] | Generic CRUD for all 27 tables |

---

## 5. Data Flow in Production (PostgreSQL)

```
Browser Action → React State → setClients → localStorage (dev)
                                          ↘ PostgreSQL (prod via API)

Dev Mode:
  DataContext → useState → setState → save('clients_db', clients) → localStorage
  Page load → useState → load('clients_db') → localStorage

Production Mode:
  DataContext → API call → fetch('/api/clients') → PostgreSQL → response → useState
  User action → API call → POST/PUT/DELETE → PostgreSQL
```

### Switching to Production:
Set env var `__API_URL__` and DataContext will use `apiFetch<T>()` instead of `localStorage`:

```javascript
// src/store/DataContext.tsx
const API_URL = (window as any).__API_URL__ || '';
const isProduction = !!API_URL;

// Production: all CRUD goes through API
function apiFetch<T>(path: string, method = 'GET', body?: any): Promise<T> {
  const token = localStorage.getItem('auth_token'); // JWT
  return fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  }).then(r => r.json()).then(j => j.data ?? j);
}
```

---

## 6. Installation (Ubuntu/Debian)

```bash
sudo bash install.sh sms.yourdomain.com
```

This automates:
1. System update + Node.js 20 + PostgreSQL + Nginx + Certbot
2. PostgreSQL database + user creation
3. Schema import (27 tables)
4. Node.js app deployment with systemd service
5. Nginx reverse proxy config with SSL
6. UFW firewall (ports 22, 80, 443)
7. Auto-renewal for Let's Encrypt certificates

---

## 7. Profit Logic

```
profit = client_rate - supplier_rate

if profit ≤ 0:
  → BLOCK ROUTE
  → Find alternative supplier with lower rate
  → If no alternative found → REJECT SMS

if profit > 0:
  → ALLOW SMS
  → Balance check
  → Submit to supplier
  → Wait for DLR
  → Bill accordingly
```

---

## 8. Billing Modes

| Mode | Charge Timing | Failed SMS |
|------|--------------|------------|
| submit | On submission | Charged |
| dlr | Only on DELIVRD | No charge |
| force_dlr=true | After 150s timeout | Charged |
| force_dlr=false | Only on DELIVRD | No charge |

---

## 9. Key File Map

```
src/
├── store/
│   ├── AuthContext.tsx      ← Login, JWT, role management
│   ├── DataContext.tsx      ← All CRUD with localStorage/API fallback
│   └── ThemeContext.tsx     ← Dark/light mode
├── database/
│   └── schema.sql           ← Full PostgreSQL schema (27 tables)
├── services/
│   ├── api.ts               ← HTTP client with JWT
│   ├── apiServices.ts       ← Business logic services
│   └── smppService.ts       ← SMPP server + client
├── pages/                   ← 42+ pages (all functional)
│   ├── Auth/Login.tsx       ← CAPTCHA, animated login
│   ├── Dashboard.tsx        ← Real-time stats, alerts
│   ├── Billing/InvoicesList.tsx  ← Professional PDF invoices
│   └── System/License.tsx   ← License key, tenants, volume
├── data/
│   └── connectors.ts        ← 68 pre-configured API providers
├── components/
│   └── Layout/
│       ├── Sidebar.tsx      ← Blue gradient + white text
│       ├── Header.tsx       ← Real-time stats, dark mode toggle
│       └── MainLayout.tsx   ← Overall layout
├── App.tsx                  ← All 42+ routes with auth protection
├── server.cjs               ← Express + PostgreSQL backend (300+ endpoints)
└── install.sh               ← One-command Ubuntu deployment
```
