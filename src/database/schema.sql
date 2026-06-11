-- ============================================================
-- NET2APP HUB - COMPLETE POSTGRESQL DATABASE SCHEMA
-- ============================================================

-- Drop existing tables (for fresh install)
DROP TABLE IF EXISTS dlr_queue CASCADE;
DROP TABLE IF EXISTS sms_logs CASCADE;
DROP TABLE IF EXISTS route_maps CASCADE;
DROP TABLE IF EXISTS route_plans CASCADE;
DROP TABLE IF EXISTS routes CASCADE;
DROP TABLE IF EXISTS trunks CASCADE;
DROP TABLE IF EXISTS rates CASCADE;
DROP TABLE IF EXISTS mccmnc CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS voice_otp_logs CASCADE;
DROP TABLE IF EXISTS voice_otp_configs CASCADE;
DROP TABLE IF EXISTS ott_devices CASCADE;
DROP TABLE IF EXISTS api_connectors CASCADE;
DROP TABLE IF EXISTS campaigns CASCADE;
DROP TABLE IF EXISTS campaigns_recipients CASCADE;
DROP TABLE IF EXISTS translations CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS notification_templates CASCADE;
DROP TABLE IF EXISTS license CASCADE;
DROP TABLE IF EXISTS tenants CASCADE;
DROP TABLE IF EXISTS platform_settings CASCADE;
DROP TABLE IF EXISTS smtp_config CASCADE;
DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS suppliers CASCADE;
DROP TABLE IF EXISTS clients CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- ============================================================
-- 1. USERS TABLE (Authentication & Authorization)
-- ============================================================
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'agent',
    permissions TEXT[] DEFAULT '{}',
    client_id INTEGER,
    supplier_id INTEGER,
    name VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Default user accounts with passwords (bcrypt hashed in production)
INSERT INTO users (username, password_hash, email, role, permissions, name, is_active) VALUES
('admin', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'admin@net2app.com', 'super_admin', ARRAY['all'], 'Super Admin', true),
('support', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'support@net2app.com', 'support', ARRAY['view_clients','view_suppliers','view_sms_logs','test_sms','manage_bind','view_reports'], 'Support Team', true),
('billing', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'billing@net2app.com', 'billing', ARRAY['manage_invoices','manage_payments','view_reports','view_clients','view_suppliers'], 'Billing Team', true),
('techcorp_user', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'user@techcorp.com', 'client', ARRAY['view_own_cdr','view_own_usage','view_own_payments','test_sms','send_sms'], 'TechCorp Client', true),
('globalsms_user', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'user@globalsms.com', 'supplier', ARRAY['view_own_cdr','view_own_usage','view_own_payments','view_bind_status'], 'GlobalSMS Supplier', true);

-- ============================================================
-- 2. CLIENTS TABLE
-- ============================================================
CREATE TABLE clients (
    id SERIAL PRIMARY KEY,
    client_code VARCHAR(50) UNIQUE NOT NULL,
    company_name VARCHAR(255) NOT NULL,
    contact_person VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(50),
    address TEXT,
    country VARCHAR(100),
    smpp_username VARCHAR(100) UNIQUE NOT NULL,
    smpp_password VARCHAR(255) NOT NULL,
    smpp_ip VARCHAR(50) DEFAULT '0.0.0.0',
    smpp_port INTEGER DEFAULT 2775,
    system_type VARCHAR(50) DEFAULT 'SMPP',
    max_tps INTEGER DEFAULT 100,
    billing_mode VARCHAR(20) DEFAULT 'dlr',
    currency VARCHAR(3) DEFAULT 'EUR',
    balance DECIMAL(15,4) DEFAULT 0.0000,
    credit_limit DECIMAL(15,4) DEFAULT 0.0000,
    api_enabled BOOLEAN DEFAULT false,
    webhook_url TEXT,
    force_dlr BOOLEAN DEFAULT false,
    dlr_timeout INTEGER DEFAULT 150,
    routing_plan_id INTEGER,
    rate_plan_id INTEGER,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','inactive','suspended')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO clients (client_code, company_name, contact_person, email, phone, address, country, smpp_username, smpp_password, max_tps, billing_mode, balance, credit_limit, status) VALUES
('CLT001', 'TechCorp Global', 'John Smith', 'john@techcorp.com', '+1234567890', '123 Tech Street, Silicon Valley', 'USA', 'techcorp_smpp', 'secure123', 100, 'dlr', 5000.0000, 10000.0000, 'active'),
('CLT002', 'MegaBank Ltd', 'Sarah Johnson', 'sarah@megabank.com', '+9876543210', '456 Finance Road, London', 'UK', 'megabank_smpp', 'bank456', 200, 'submit', 25000.0000, 50000.0000, 'active'),
('CLT003', 'EcomStore Inc', 'Mike Brown', 'mike@ecomstore.com', '+1122334455', '789 Commerce Ave, New York', 'USA', 'ecomstore_smpp', 'ecom789', 50, 'dlr', 1500.0000, 5000.0000, 'active');

-- ============================================================
-- 3. SUPPLIERS TABLE
-- ============================================================
CREATE TABLE suppliers (
    id SERIAL PRIMARY KEY,
    supplier_code VARCHAR(50) UNIQUE NOT NULL,
    company_name VARCHAR(255) NOT NULL,
    contact_person VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(50),
    connection_type VARCHAR(50) NOT NULL CHECK (connection_type IN ('smpp','http','ott_whatsapp','ott_telegram','voice_otp','local_bypass','rcs','flash_sms')),
    smpp_host VARCHAR(255),
    smpp_port INTEGER DEFAULT 2775,
    smpp_username VARCHAR(100),
    smpp_password VARCHAR(255),
    system_id VARCHAR(100),
    api_url TEXT,
    api_key TEXT,
    api_secret TEXT,
    api_method VARCHAR(10) DEFAULT 'POST',
    balance DECIMAL(15,4) DEFAULT 0.0000,
    credit_limit DECIMAL(15,4) DEFAULT 0.0000,
    currency VARCHAR(3) DEFAULT 'EUR',
    bind_status VARCHAR(20) DEFAULT 'unbound' CHECK (bind_status IN ('bound','unbound','binding','error')),
    consecutive_failures INTEGER DEFAULT 0,
    max_failures INTEGER DEFAULT 20,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','inactive','suspended')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO suppliers (supplier_code, company_name, contact_person, email, phone, connection_type, smpp_host, smpp_port, smpp_username, smpp_password, balance, bind_status, status) VALUES
('SUP001', 'GlobalSMS Gateway', 'Alex Turner', 'alex@globalsms.com', '+1111222233', 'smpp', 'smpp.globalsms.com', 2775, 'net2app_client', 'gateway123', 50000.0000, 'bound', 'active'),
('SUP002', 'DirectRoute Pro', 'Maria Garcia', 'maria@directroute.com', '+2222333344', 'smpp', 'smpp.directroute.com', 2775, 'net2app', 'direct456', 35000.0000, 'bound', 'active'),
('SUP003', 'SIM OTP Services', 'James Wilson', 'james@simotp.com', '+3333444455', 'smpp', 'otp.simotp.com', 2776, 'net2app_otp', 'otp789', 20000.0000, 'bound', 'active'),
('SUP004', 'WhatsApp Business API', 'Emma Davis', 'emma@wabusiness.com', '+4444555566', 'ott_whatsapp', NULL, 0, '', '', 15000.0000, 'bound', 'active'),
('SUP005', 'Voice OTP Provider', 'Robert Lee', 'robert@voiceotp.com', '+5555666677', 'voice_otp', 'sip.voiceotp.com', 5060, 'net2app_voice', 'voice321', 10000.0000, 'bound', 'active'),
('SUP006', 'Local Bypass Gateway', 'Chris Martin', 'chris@localbypass.com', '+7777888899', 'local_bypass', 'local.bypass.gateway', 2777, 'local_net2app', 'local654', 5000.0000, 'unbound', 'inactive');

-- ============================================================
-- 4. TRUNKS TABLE
-- ============================================================
CREATE TABLE trunks (
    id SERIAL PRIMARY KEY,
    trunk_name VARCHAR(255) NOT NULL,
    trunk_type VARCHAR(50) NOT NULL CHECK (trunk_type IN ('sim_otp','sim_marketing','voice_otp','local_direct_otp','local_direct_marketing','direct_route_otp','direct_route_marketing','whatsapp','telegram','rcs')),
    supplier_id INTEGER REFERENCES suppliers(id) NOT NULL,
    priority INTEGER DEFAULT 1,
    percentage INTEGER DEFAULT 100,
    is_active BOOLEAN DEFAULT true,
    mccmnc_allowed TEXT[] DEFAULT '{*}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO trunks (trunk_name, trunk_type, supplier_id, priority, percentage, mccmnc_allowed) VALUES
('Global SMS Direct', 'direct_route_otp', 1, 1, 70, ARRAY['310*','311*','234*']),
('SIM OTP Primary', 'sim_otp', 3, 1, 100, ARRAY['*']),
('Direct Route Marketing', 'direct_route_marketing', 2, 2, 30, ARRAY['310*','311*']),
('WhatsApp OTT', 'whatsapp', 4, 1, 100, ARRAY['*']),
('Voice OTP Main', 'voice_otp', 5, 1, 100, ARRAY['*']);

-- ============================================================
-- 5. ROUTES TABLE
-- ============================================================
CREATE TABLE routes (
    id SERIAL PRIMARY KEY,
    route_name VARCHAR(255) NOT NULL,
    trunk_ids INTEGER[] DEFAULT '{}',
    route_method VARCHAR(20) DEFAULT 'priority' CHECK (route_method IN ('priority','percentage','lcr')),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO routes (route_name, trunk_ids, route_method) VALUES
('Premium OTP Route', ARRAY[2,1], 'priority'),
('Marketing Blend', ARRAY[1,3], 'percentage'),
('OTT Messaging', ARRAY[4], 'lcr'),
('Voice OTP Fallback', ARRAY[5], 'priority');

-- ============================================================
-- 6. ROUTE PLANS TABLE
-- ============================================================
CREATE TABLE route_plans (
    id SERIAL PRIMARY KEY,
    plan_name VARCHAR(255) NOT NULL,
    route_ids INTEGER[] DEFAULT '{}',
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO route_plans (plan_name, route_ids, is_default) VALUES
('Premium Plan', ARRAY[1,3,4], true),
('Marketing Plan', ARRAY[2], false);

-- ============================================================
-- 7. ROUTE MAPS TABLE (Client -> Route -> Supplier mapping)
-- ============================================================
CREATE TABLE route_maps (
    id SERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id) NOT NULL,
    route_id INTEGER REFERENCES routes(id) NOT NULL,
    supplier_id INTEGER REFERENCES suppliers(id) NOT NULL,
    mccmnc_pattern VARCHAR(50) NOT NULL DEFAULT '*',
    priority INTEGER DEFAULT 1,
    percentage INTEGER DEFAULT 100,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO route_maps (client_id, route_id, supplier_id, mccmnc_pattern, priority, percentage) VALUES
(1, 1, 1, '310*', 1, 100),
(1, 1, 3, '234*', 2, 100),
(2, 1, 2, '*', 1, 70),
(1, 4, 5, '*', 1, 100);

-- ============================================================
-- 8. RATES TABLE (with versioning)
-- ============================================================
CREATE TABLE rates (
    id SERIAL PRIMARY KEY,
    entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('client','supplier')),
    entity_id INTEGER NOT NULL,
    mcc VARCHAR(10) NOT NULL,
    mnc VARCHAR(10) NOT NULL DEFAULT '*',
    country VARCHAR(100) NOT NULL,
    operator VARCHAR(100) DEFAULT 'All',
    rate DECIMAL(10,6) NOT NULL,
    currency VARCHAR(3) DEFAULT 'EUR',
    effective_from DATE NOT NULL,
    effective_to DATE,
    is_active BOOLEAN DEFAULT true,
    version INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO rates (entity_type, entity_id, mcc, mnc, country, operator, rate, effective_from, version, is_active) VALUES
('client', 1, '310', '*', 'United States', 'All', 0.025000, '2024-01-01', 2, true),
('client', 1, '310', '*', 'United States', 'All', 0.020000, '2023-06-01', 1, false),
('client', 1, '234', '*', 'United Kingdom', 'All', 0.022000, '2024-01-01', 1, true),
('client', 2, '310', '*', 'United States', 'All', 0.023000, '2024-02-01', 1, true),
('supplier', 1, '310', '*', 'United States', 'All', 0.015000, '2024-01-01', 1, true),
('supplier', 2, '310', '*', 'United States', 'All', 0.018000, '2024-01-15', 1, true);

-- ============================================================
-- 9. MCCMNC DATABASE TABLE
-- ============================================================
CREATE TABLE mccmnc (
    id SERIAL PRIMARY KEY,
    country VARCHAR(100) NOT NULL,
    country_code VARCHAR(10) NOT NULL,
    mcc VARCHAR(10) NOT NULL,
    mnc VARCHAR(10) NOT NULL,
    operator VARCHAR(255) NOT NULL,
    network_type VARCHAR(50) DEFAULT 'GSM',
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO mccmnc (country, country_code, mcc, mnc, operator, network_type) VALUES
('United States', 'US', '310', '260', 'T-Mobile USA', 'GSM'),
('United States', 'US', '310', '410', 'AT&T Mobility', 'GSM'),
('United States', 'US', '311', '480', 'Verizon Wireless', 'CDMA'),
('United Kingdom', 'GB', '234', '10', 'O2 UK', 'GSM'),
('United Kingdom', 'GB', '234', '15', 'Vodafone UK', 'GSM'),
('Germany', 'DE', '262', '01', 'Telekom Deutschland', 'GSM'),
('France', 'FR', '208', '01', 'Orange France', 'GSM'),
('Spain', 'ES', '214', '01', 'Vodafone Spain', 'GSM'),
('India', 'IN', '404', '10', 'Airtel India', 'GSM'),
('Bangladesh', 'BD', '470', '01', 'Grameenphone', 'GSM'),
('Saudi Arabia', 'SA', '420', '01', 'STC', 'GSM');

-- ============================================================
-- 10. SMS LOGS TABLE (Complete message tracking + DLR)
-- ============================================================
CREATE TABLE sms_logs (
    id SERIAL PRIMARY KEY,
    message_id VARCHAR(100) UNIQUE NOT NULL,
    client_id INTEGER REFERENCES clients(id),
    client_code VARCHAR(50),
    supplier_id INTEGER REFERENCES suppliers(id),
    supplier_code VARCHAR(50),
    sender_id VARCHAR(100) NOT NULL,
    destination VARCHAR(50) NOT NULL,
    mcc VARCHAR(10),
    mnc VARCHAR(10),
    country VARCHAR(100),
    operator VARCHAR(100),
    message TEXT NOT NULL,
    message_parts INTEGER DEFAULT 1,
    client_rate DECIMAL(10,6) DEFAULT 0,
    supplier_rate DECIMAL(10,6) DEFAULT 0,
    profit DECIMAL(10,6) DEFAULT 0,
    currency VARCHAR(3) DEFAULT 'EUR',
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','submitted','sent','delivered','failed','expired','rejected')),
    dlr_status VARCHAR(20),
    dlr_timestamp TIMESTAMP,
    error_code VARCHAR(10),
    error_message TEXT,
    route_id INTEGER,
    route_name VARCHAR(255),
    trunk_name VARCHAR(255),
    smpp_message_id VARCHAR(100),
    registered_delivery INTEGER DEFAULT 1,
    data_coding INTEGER DEFAULT 0,
    esm_class INTEGER DEFAULT 0,
    submit_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    delivery_time TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 11. DLR QUEUE TABLE (For DLR retry logic)
-- ============================================================
CREATE TABLE dlr_queue (
    id SERIAL PRIMARY KEY,
    message_id VARCHAR(100) REFERENCES sms_logs(message_id) NOT NULL,
    smpp_message_id VARCHAR(100),
    destination VARCHAR(50) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','waiting_dlr','dlr_received','dlr_failed','timeout')),
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 150,
    force_dlr BOOLEAN DEFAULT false,
    dlr_timeout INTEGER DEFAULT 150,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_retry_at TIMESTAMP,
    dlr_received_at TIMESTAMP,
    dlr_result VARCHAR(50)
);

-- ============================================================
-- 12. INVOICES TABLE (Professional invoice format)
-- ============================================================
CREATE TABLE invoices (
    id SERIAL PRIMARY KEY,
    invoice_number VARCHAR(100) UNIQUE NOT NULL,
    entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('client','supplier')),
    entity_id INTEGER NOT NULL,
    entity_name VARCHAR(255) NOT NULL,
    invoice_to_name VARCHAR(255),
    invoice_to_address TEXT,
    invoice_to_email VARCHAR(255),
    invoice_by_name VARCHAR(255) DEFAULT 'NET2APP Hub',
    invoice_by_address TEXT,
    invoice_by_email VARCHAR(255) DEFAULT 'billing@net2app.com',
    invoice_by_vat VARCHAR(50),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    total_sms INTEGER DEFAULT 0,
    total_amount DECIMAL(15,4) DEFAULT 0,
    tax_amount DECIMAL(15,4) DEFAULT 0,
    tax_rate DECIMAL(5,2) DEFAULT 19.00,
    grand_total DECIMAL(15,4) DEFAULT 0,
    currency VARCHAR(3) DEFAULT 'EUR',
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft','sent','paid','overdue','cancelled')),
    due_date DATE,
    paid_date DATE,
    payment_method VARCHAR(50),
    payment_reference VARCHAR(255),
    notes TEXT,
    bank_name VARCHAR(255),
    bank_account VARCHAR(100),
    bank_iban VARCHAR(50),
    bank_bic VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    sent_at TIMESTAMP
);

-- ============================================================
-- 13. PAYMENTS TABLE
-- ============================================================
CREATE TABLE payments (
    id SERIAL PRIMARY KEY,
    payment_number VARCHAR(100) UNIQUE NOT NULL,
    entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('client','supplier')),
    entity_id INTEGER NOT NULL,
    entity_name VARCHAR(255) NOT NULL,
    amount DECIMAL(15,4) NOT NULL,
    currency VARCHAR(3) DEFAULT 'EUR',
    payment_method VARCHAR(50) NOT NULL CHECK (payment_method IN ('bank_transfer','credit_card','paypal','crypto','stripe','piprapay','manual')),
    reference VARCHAR(255),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','completed','failed','refunded')),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 14. OTT DEVICES TABLE
-- ============================================================
CREATE TABLE ott_devices (
    id SERIAL PRIMARY KEY,
    device_name VARCHAR(255) NOT NULL,
    device_type VARCHAR(20) NOT NULL CHECK (device_type IN ('whatsapp','telegram')),
    phone_number VARCHAR(50),
    session_status VARCHAR(20) DEFAULT 'disconnected' CHECK (session_status IN ('connected','disconnected','qr_pending','error')),
    qr_code TEXT,
    last_active TIMESTAMP,
    supplier_id INTEGER REFERENCES suppliers(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 15. API CONNECTORS TABLE
-- ============================================================
CREATE TABLE api_connectors (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    provider VARCHAR(100) NOT NULL,
    region VARCHAR(100),
    auth_type VARCHAR(50) DEFAULT 'API_KEY' CHECK (auth_type IN ('API_KEY','BASIC','BEARER','OAUTH2')),
    http_method VARCHAR(10) DEFAULT 'POST' CHECK (http_method IN ('POST','GET','PUT')),
    api_key TEXT,
    api_secret TEXT,
    send_url TEXT NOT NULL,
    dlr_url TEXT,
    submit_pattern VARCHAR(255),
    dlr_pattern VARCHAR(255),
    dlr_value VARCHAR(100),
    params TEXT,
    is_active BOOLEAN DEFAULT true,
    connection_status VARCHAR(20) DEFAULT 'untested' CHECK (connection_status IN ('untested','connected','failed','testing')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 16. VOICE OTP CONFIGS TABLE
-- ============================================================
CREATE TABLE voice_otp_configs (
    id SERIAL PRIMARY KEY,
    language VARCHAR(100) NOT NULL,
    language_code VARCHAR(10) NOT NULL,
    greeting_text TEXT NOT NULL,
    retry_text TEXT,
    audio_0_9 JSONB DEFAULT '{}',
    sip_host VARCHAR(255) DEFAULT 'sip.provider.com',
    sip_port INTEGER DEFAULT 5060,
    sip_username VARCHAR(100),
    sip_password VARCHAR(255),
    caller_id VARCHAR(50),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 17. VOICE OTP LOGS TABLE
-- ============================================================
CREATE TABLE voice_otp_logs (
    id SERIAL PRIMARY KEY,
    call_id VARCHAR(100) UNIQUE NOT NULL,
    destination VARCHAR(50) NOT NULL,
    otp_code VARCHAR(10) NOT NULL,
    language VARCHAR(100),
    duration INTEGER DEFAULT 0,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 4,
    status VARCHAR(20) DEFAULT 'initiated' CHECK (status IN ('initiated','ringing','answered','completed','failed','busy','no_answer','timeout')),
    dlr_status VARCHAR(20),
    error_message TEXT,
    sip_call_id VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

-- ============================================================
-- 18. CAMPAIGNS TABLE
-- ============================================================
CREATE TABLE campaigns (
    id SERIAL PRIMARY KEY,
    campaign_name VARCHAR(255) NOT NULL,
    client_id INTEGER REFERENCES clients(id),
    sender_id VARCHAR(100) NOT NULL,
    message_template TEXT NOT NULL,
    recipients_count INTEGER DEFAULT 0,
    sent_count INTEGER DEFAULT 0,
    delivered_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft','scheduled','running','paused','completed','cancelled')),
    scheduled_at TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE campaigns_recipients (
    id SERIAL PRIMARY KEY,
    campaign_id INTEGER REFERENCES campaigns(id) ON DELETE CASCADE,
    phone_number VARCHAR(50) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','sent','delivered','failed')),
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 19. TRANSLATIONS TABLE
-- ============================================================
CREATE TABLE translations (
    id SERIAL PRIMARY KEY,
    translation_type VARCHAR(50) NOT NULL CHECK (translation_type IN ('sender_id','destination','content','origination')),
    source_pattern VARCHAR(255) NOT NULL,
    target_value VARCHAR(255) NOT NULL,
    client_id INTEGER REFERENCES clients(id),
    supplier_id INTEGER REFERENCES suppliers(id),
    route_id INTEGER REFERENCES routes(id),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 20. NOTIFICATIONS TABLE
-- ============================================================
CREATE TABLE notifications (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(20) DEFAULT 'info' CHECK (type IN ('info','warning','error','success')),
    entity_type VARCHAR(20) CHECK (entity_type IN ('client','supplier','system','route')),
    entity_name VARCHAR(255),
    entity_id INTEGER,
    recipient_email VARCHAR(255),
    recipient_role VARCHAR(50),
    is_read BOOLEAN DEFAULT false,
    is_emailed BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 21. NOTIFICATION TEMPLATES TABLE
-- ============================================================
CREATE TABLE notification_templates (
    id SERIAL PRIMARY KEY,
    template_name VARCHAR(255) NOT NULL,
    subject VARCHAR(500) NOT NULL,
    body TEXT NOT NULL,
    variables TEXT[] DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO notification_templates (template_name, subject, body, variables, is_active) VALUES
('Low Balance Alert', 'Low Balance Alert — {{client_name}} ({{client_code}})', 'Dear {{client_name}},\n\nYour account balance is low. Current balance: €{{balance}}\n\nPlease top up your account to continue service.\n\nNET2APP Hub', ARRAY['client_name','client_code','smpp_username','balance'], true),
('Client Account Created', 'Welcome to {{platform_name}} — SMPP Account Created', 'Dear {{client_name}},\n\nWelcome to {{platform_name}}!\n\nClient Code: {{client_code}}SMPP Username: {{smpp_username}}\n\nBest regards,\nNET2APP Hub Team', ARRAY['client_name','company_name','client_code','smpp_username','platform_name'], true),
('Supplier Account Created', 'Supplier Account Created — {{supplier_code}}', 'Dear {{contact_person}},\n\nSupplier account created.\n\nSupplier Code: {{supplier_code}}Connection Type: {{connection_type}}\n\nNET2APP Hub', ARRAY['contact_person','company_name','supplier_code','connection_type'], true),
('Invoice Generated', 'Invoice {{invoice_number}} — {{client_name}}', 'Dear {{client_name}},\n\nInvoice {{invoice_number}} generated.\n\nPeriod: {{period_start}} to {{period_end}}Total: €{{total_amount}}Due: {{due_date}}\n\nNET2APP Hub', ARRAY['client_name','invoice_number','period_start','period_end','total_amount','due_date'], true),
('Payment Received', 'Payment Received — €{{amount}} — {{entity_name}}', 'Dear {{entity_name}},\n\nPayment of €{{amount}} received via {{payment_method}}.\n\nReference: {{reference}}\n\nNET2APP Hub', ARRAY['entity_name','payment_number','amount','payment_method'], true),
('Rate Change Notice', 'Rate Update Notice — {{destination}}', 'Dear {{entity_name}},\n\nRate change notification.\n\nDestination: {{destination}}Old Rate: €{{old_rate}} → New Rate: €{{new_rate}}Effective: {{effective_date}}\n\nNET2APP Hub', ARRAY['entity_name','entity_code','smpp_username','destination','old_rate','new_rate','effective_date'], true),
('Channel Disconnect', '⚠ Channel Disconnected — {{entity_code}}', 'Alert! Channel disconnected.\n\nEntity: {{entity_name}} ({{entity_code}})Type: {{entity_type}}Failures: {{failure_count}}\n\nNET2APP Hub System', ARRAY['entity_code','entity_name','entity_type','smpp_username','failure_count'], true),
('Payment Reminder', 'Payment Reminder — Invoice {{invoice_number}}', 'Dear {{client_name}},\n\nPayment reminder for invoice {{invoice_number}}.\n\nAmount Due: €{{amount_due}}Due Date: {{due_date}}\n\nPlease pay promptly.\n\nNET2APP Hub', ARRAY['client_name','invoice_number','amount_due','due_date'], true),
('DLR Failure Alert', '⚠ DLR Failure Alert — {{route_name}}', 'Alert! High DLR failure rate detected.\n\nRoute: {{route_name}}Supplier: {{supplier_name}}Failures: {{failure_count}} in 20 consecutiveAction: Route auto-blocked\n\nNET2APP Hub System', ARRAY['route_name','supplier_name','failure_count','action_taken'], true);

-- ============================================================
-- 22. LICENSE TABLE
-- ============================================================
CREATE TABLE license (
    id SERIAL PRIMARY KEY,
    license_key VARCHAR(255) UNIQUE NOT NULL,
    license_type VARCHAR(50) NOT NULL CHECK (license_type IN ('trial','standard','enterprise','unlimited')),
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','expired','invalid','suspended')),
    issued_to VARCHAR(255),
    system_ip VARCHAR(50),
    system_mac VARCHAR(50),
    issued_date DATE,
    expiry_date DATE,
    features JSONB DEFAULT '{"smpp":true,"http":true,"whatsapp":false,"telegram":false,"rcs":false,"voice_otp":false}',
    limits JSONB DEFAULT '{"max_clients":10,"max_suppliers":5,"max_sms_monthly":100000,"max_tps":100}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 23. TENANTS TABLE
-- ============================================================
CREATE TABLE tenants (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','inactive','suspended')),
    features JSONB DEFAULT '{"smpp":true,"http":true,"whatsapp":false,"telegram":false,"rcs":false,"voice_otp":false}',
    limits JSONB DEFAULT '{"max_sms_monthly":100000,"max_tps":100}',
    sms_this_month INTEGER DEFAULT 0,
    tps_current INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 24. PLATFORM SETTINGS TABLE
-- ============================================================
CREATE TABLE platform_settings (
    id SERIAL PRIMARY KEY,
    key VARCHAR(255) UNIQUE NOT NULL,
    value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO platform_settings (key, value) VALUES
('platform_name', 'NET2APP Hub'),
('support_email', 'support@net2app.com'),
('company_name', 'NET2APP Technologies'),
('company_address', '123 Tech Park, Innovation City'),
('company_phone', '+1-800-SMS-HUB'),
('company_email', 'info@net2app.com'),
('company_vat', 'VAT-2024-001'),
('currency', 'EUR'),
('invoice_prefix', 'INV-2024-'),
('payment_prefix', 'PAY-2024-'),
('default_tax_rate', '19.00'),
('force_dlr_default', 'true'),
('dlr_timeout_default', '150'),
('auto_block_failures', '20'),
('max_retry_attempts', '4'),
('voice_otp_retry_interval', '30'),
('voice_otp_max_retries', '4');

-- ============================================================
-- 25. SMTP CONFIG TABLE
-- ============================================================
CREATE TABLE smtp_config (
    id SERIAL PRIMARY KEY,
    host VARCHAR(255) NOT NULL,
    port INTEGER DEFAULT 587,
    encryption VARCHAR(10) DEFAULT 'tls' CHECK (encryption IN ('tls','ssl','none')),
    username VARCHAR(255),
    password TEXT,
    from_email VARCHAR(255),
    from_name VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    test_status VARCHAR(20) DEFAULT 'untested' CHECK (test_status IN ('untested','success','failed')),
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 26. AUDIT LOGS TABLE
-- ============================================================
CREATE TABLE audit_logs (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    username VARCHAR(100),
    action VARCHAR(50) NOT NULL,
    entity_type VARCHAR(50),
    entity_id INTEGER,
    details JSONB,
    ip_address VARCHAR(50),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- INDEXES (Performance Optimization)
-- ============================================================
CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_clients_code ON clients(client_code);
CREATE INDEX idx_clients_email ON clients(email);
CREATE INDEX idx_suppliers_code ON suppliers(supplier_code);
CREATE INDEX idx_suppliers_type ON suppliers(connection_type);
CREATE INDEX idx_suppliers_bind ON suppliers(bind_status);

CREATE INDEX idx_sms_logs_message_id ON sms_logs(message_id);
CREATE INDEX idx_sms_logs_smpp_message_id ON sms_logs(smpp_message_id);
CREATE INDEX idx_sms_logs_client_id ON sms_logs(client_id);
CREATE INDEX idx_sms_logs_supplier_id ON sms_logs(supplier_id);
CREATE INDEX idx_sms_logs_status ON sms_logs(status);
CREATE INDEX idx_sms_logs_submit_time ON sms_logs(submit_time);
CREATE INDEX idx_sms_logs_destination ON sms_logs(destination);
CREATE INDEX idx_sms_logs_client_date ON sms_logs(client_id, submit_time);

CREATE INDEX idx_dlr_queue_status ON dlr_queue(status);
CREATE INDEX idx_dlr_queue_message_id ON dlr_queue(message_id);
CREATE INDEX idx_dlr_queue_force ON dlr_queue(force_dlr) WHERE force_dlr = true;

CREATE INDEX idx_rates_entity_active ON rates(entity_type, entity_id, is_active);
CREATE INDEX idx_rates_destination ON rates(entity_type, entity_id, mcc, mnc);
CREATE INDEX idx_rates_effective ON rates(effective_from, effective_to);

CREATE INDEX idx_route_maps_client_mccmnc ON route_maps(client_id, mccmnc_pattern);
CREATE INDEX idx_route_maps_supplier ON route_maps(supplier_id);
CREATE INDEX idx_trunks_supplier_active ON trunks(supplier_id, is_active);
CREATE INDEX idx_routes_active ON routes(is_active) WHERE is_active = true;

CREATE INDEX idx_notifications_unread ON notifications(is_read) WHERE is_read = false;
CREATE INDEX idx_notifications_type ON notifications(type);

CREATE INDEX idx_invoices_entity ON invoices(entity_type, entity_id);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_payments_entity ON payments(entity_type, entity_id);

CREATE INDEX idx_mccmnc_mcc ON mccmnc(mcc);
CREATE INDEX idx_mccmnc_country ON mccmnc(country);
CREATE INDEX idx_voice_otp_logs_status ON voice_otp_logs(status);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_time ON audit_logs(created_at);

-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON clients FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_suppliers_updated_at BEFORE UPDATE ON suppliers FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Generate invoice number automatically
CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TRIGGER AS $$
DECLARE
    year_prefix VARCHAR(4);
    sequence_num INTEGER;
BEGIN
    year_prefix := to_char(NEW.created_at, 'YYYY');
    SELECT COALESCE(MAX(CAST(SPLIT_PART(invoice_number, '-', 3) AS INTEGER)), 0) + 1 INTO sequence_num FROM invoices WHERE invoice_number LIKE 'INV-' || year_prefix || '-%';
    NEW.invoice_number := 'INV-' || year_prefix || '-' || LPAD(sequence_num::TEXT, 4, '0');
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER generate_invoice_number_trigger BEFORE INSERT ON invoices
FOR EACH ROW WHEN (NEW.invoice_number IS NULL)
EXECUTE FUNCTION generate_invoice_number();

-- Generate payment number automatically
CREATE OR REPLACE FUNCTION generate_payment_number()
RETURNS TRIGGER AS $$
DECLARE
    year_prefix VARCHAR(4);
    sequence_num INTEGER;
BEGIN
    year_prefix := to_char(NEW.created_at, 'YYYY');
    SELECT COALESCE(MAX(CAST(SPLIT_PART(payment_number, '-', 3) AS INTEGER)), 0) + 1 INTO sequence_num FROM payments WHERE payment_number LIKE 'PAY-' || year_prefix || '-%';
    NEW.payment_number := 'PAY-' || year_prefix || '-' || LPAD(sequence_num::TEXT, 4, '0');
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER generate_payment_number_trigger BEFORE INSERT ON payments
FOR EACH ROW WHEN (NEW.payment_number IS NULL)
EXECUTE FUNCTION generate_payment_number();

-- Generate unique message ID
CREATE OR REPLACE FUNCTION generate_message_id()
RETURNS TRIGGER AS $$
BEGIN
    NEW.message_id := 'MSG' || to_char(NOW(), 'YYYYMMDDHH24MISS') || LPAD(CAST(floor(random() * 9999) AS TEXT), 4, '0');
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER generate_sms_message_id BEFORE INSERT ON sms_logs
FOR EACH ROW WHEN (NEW.message_id IS NULL)
EXECUTE FUNCTION generate_message_id();

-- Auto-deduct balance on SMS submission
CREATE OR REPLACE FUNCTION deduct_client_balance()
RETURNS TRIGGER AS $$
DECLARE
    client_balance DECIMAL(15,4);
    client_credit DECIMAL(15,4);
    total_cost DECIMAL(15,4);
    billing_mode VARCHAR(20);
BEGIN
    SELECT balance, credit_limit, billing_mode INTO client_balance, client_credit, billing_mode FROM clients WHERE id = NEW.client_id FOR UPDATE;
    
    -- Calculate cost
    total_cost := NEW.client_rate * NEW.message_parts;
    
    -- Only deduct if billing_mode is 'submit' (immediate charge)
    -- For 'dlr' mode, charge happens when DLR received
    IF billing_mode = 'submit' THEN
        UPDATE clients SET balance = balance - total_cost WHERE id = NEW.client_id;
    END IF;
    
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Check balance and credit before allowing SMS
CREATE OR REPLACE FUNCTION check_client_balance(client_id INTEGER, estimated_cost DECIMAL)
RETURNS TABLE (allowed BOOLEAN, current_balance DECIMAL, available_credit DECIMAL, message TEXT) AS $$
DECLARE
    bal DECIMAL(15,4);
    cred DECIMAL(15,4);
BEGIN
    SELECT balance, credit_limit INTO bal, cred FROM clients WHERE id = client_id;
    
    -- Total available = balance + credit_limit
    IF (bal + cred) >= estimated_cost THEN
        RETURN QUERY SELECT true, bal, bal + cred, 'Sufficient balance'::TEXT;
    ELSE
        RETURN QUERY SELECT false, bal, bal + cred, 'Insufficient balance. Please top up your account.'::TEXT;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- PASSWORD RESET FUNCTION
-- ============================================================
-- In production, use bcrypt to hash passwords
-- Passwords are: admin123, support123, billing123, techcorp123, globalsms123
-- The password_hash field stores bcrypt hash
-- To verify: SELECT * FROM users WHERE username = ? AND password_hash = crypt(?, password_hash);

COMMENT ON TABLE users IS 'User accounts with roles and permissions';
COMMENT ON TABLE clients IS 'SMPP client accounts with billing info';
COMMENT ON TABLE suppliers IS 'SMPP suppliers and gateways';
COMMENT ON TABLE sms_logs IS 'Complete SMS transaction log with DLR tracking';
COMMENT ON TABLE dlr_queue IS 'DLR retry queue for undelivered messages';
COMMENT ON TABLE rates IS 'Client/supplier rates with version history';
COMMENT ON TABLE route_maps IS 'Client -> Route -> Supplier mapping with MCCMNC patterns';
COMMENT ON TABLE invoices IS 'Professional invoices with destination breakdown';
COMMENT ON TABLE voice_otp_configs IS 'Voice OTP language configs with audio files';
COMMENT ON TABLE notification_templates IS 'Email notification templates with variables';
COMMENT ON TABLE license IS 'Platform license and feature control';
COMMENT ON TABLE tenants IS 'Tenant management with feature limits';
COMMENT ON TABLE platform_settings IS 'Global platform configuration';
COMMENT ON TABLE smtp_config IS 'SMTP email configuration';
COMMENT ON TABLE audit_logs IS 'User activity audit trail';
