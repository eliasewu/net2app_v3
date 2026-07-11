-- ============================================================
-- NET2APP HUB - COMPLETE POSTGRESQL DATABASE SCHEMA
-- ============================================================

-- Drop existing tables (for fresh install)
DROP TABLE IF EXISTS dlr_queue CASCADE;
DROP TABLE IF EXISTS sms_logs CASCADE;
DROP TABLE IF EXISTS route_plans CASCADE;
DROP TABLE IF EXISTS routes CASCADE;
DROP TABLE IF EXISTS trunks CASCADE;
DROP TABLE IF EXISTS rates CASCADE;
DROP TABLE IF EXISTS mccmnc CASCADE;
DROP TABLE IF EXISTS invoices CASCADE;
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS voice_call_retry_queue CASCADE;
DROP TABLE IF EXISTS social_api_suppliers CASCADE;
DROP TABLE IF EXISTS sip_server_destinations CASCADE;
DROP TABLE IF EXISTS sip_servers CASCADE;
DROP TABLE IF EXISTS number_validation_results CASCADE;
DROP TABLE IF EXISTS number_validation_providers CASCADE;
DROP TABLE IF EXISTS pending_deliver_sm CASCADE;
DROP TABLE IF EXISTS smpp_sessions CASCADE;
DROP VIEW IF EXISTS active_smpp_sessions CASCADE;
DROP TABLE IF EXISTS bind_history CASCADE;
DROP TABLE IF EXISTS asterisk_settings CASCADE;
DROP TABLE IF EXISTS api_keys CASCADE;
DROP TABLE IF EXISTS mo_sms CASCADE;
DROP TABLE IF EXISTS ip_lists CASCADE;
DROP TABLE IF EXISTS idempotency_keys CASCADE;
DROP TABLE IF EXISTS residential_proxies CASCADE;
DROP TABLE IF EXISTS schema_migrations CASCADE;
DROP TABLE IF EXISTS channel_messages CASCADE;
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
    api_key VARCHAR(255),
    api_enabled BOOLEAN DEFAULT false,
    webhook_url TEXT,
    dlr_callback_url VARCHAR(500),
    force_dlr BOOLEAN DEFAULT false,
    force_dlr_timeout_mode VARCHAR(20) DEFAULT 'fixed',
    dlr_timeout INTEGER DEFAULT 150,
    connection_type VARCHAR(50) DEFAULT 'smpp',
    preferred_channel VARCHAR(40) DEFAULT 'sms',
    allowed_channels TEXT[] DEFAULT ARRAY['sms','whatsapp','telegram','rcs','flash_sms','voice_otp'],
    api_connector_id INTEGER,
    voice_otp_config_id INTEGER,
    voice_otp_use_secondary BOOLEAN DEFAULT false,
    whatsapp_device_ids TEXT[] DEFAULT '{}',
    telegram_device_ids TEXT[] DEFAULT '{}',
    client_ips TEXT DEFAULT '',
    routing_plan_id INTEGER,
    rate_plan_id INTEGER,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','inactive','suspended')),
    is_deleted BOOLEAN DEFAULT false,
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
    smpp_version VARCHAR(20) DEFAULT 'auto',
    smpp_system_type VARCHAR(50) DEFAULT '',
    smpp_bind_type VARCHAR(10) DEFAULT 'trx',
    smpp_addr_ton INTEGER DEFAULT 0,
    smpp_addr_npi INTEGER DEFAULT 0,
    smpp_addr_range VARCHAR(100) DEFAULT '',
    is_inbound BOOLEAN DEFAULT false,
    api_url TEXT,
    api_key TEXT,
    api_secret TEXT,
    api_method VARCHAR(10) DEFAULT 'POST',
    api_connector_id INTEGER,
    voice_otp_config_id INTEGER,
    whatsapp_device_ids TEXT,
    telegram_device_ids TEXT,
    force_dlr BOOLEAN DEFAULT false,
    dlr_timeout INTEGER DEFAULT 150,
    force_dlr_timeout_mode VARCHAR(20) DEFAULT 'fixed',
    routed_via_asterisk BOOLEAN DEFAULT false,
    balance DECIMAL(15,4) DEFAULT 0.0000,
    credit_limit DECIMAL(15,4) DEFAULT 0.0000,
    currency VARCHAR(3) DEFAULT 'EUR',
    bind_status VARCHAR(20) DEFAULT 'unbound' CHECK (bind_status IN ('bound','unbound','binding','error')),
    consecutive_failures INTEGER DEFAULT 0,
    max_failures INTEGER DEFAULT 20,
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active','inactive','suspended')),
    is_deleted BOOLEAN DEFAULT false,
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
    mccmnc_denied TEXT[] DEFAULT '{}',
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
    preferred_channel VARCHAR(50),
    mccmnc_allowed TEXT[] DEFAULT '{*}',
    mccmnc_denied TEXT[] DEFAULT '{}',
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
    allowed_channels TEXT[] DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO route_plans (plan_name, route_ids, is_default) VALUES
('Premium Plan', ARRAY[1,3,4], true),
('Marketing Plan', ARRAY[2], false);

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
    calling_code VARCHAR(10),
    is_deleted BOOLEAN DEFAULT false,
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
    channel VARCHAR(40) DEFAULT 'sms',
    route_id INTEGER,
    route_name VARCHAR(255),
    trunk_id INTEGER,
    trunk_name VARCHAR(255),
    smpp_message_id VARCHAR(100),
    registered_delivery INTEGER DEFAULT 1,
    data_coding INTEGER DEFAULT 0,
    esm_class INTEGER DEFAULT 0,
    source VARCHAR(50) DEFAULT 'external_api',
    trace JSONB DEFAULT '[]',
    dlr_callback_url VARCHAR(500),
    is_billed BOOLEAN DEFAULT false,
    billing_mode_snapshot VARCHAR(10),
    is_force_dlr BOOLEAN DEFAULT false,
    refund_amount DECIMAL(10,6) DEFAULT 0,
    is_deleted BOOLEAN DEFAULT false,
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
    dlr_result VARCHAR(50),
    channel VARCHAR(40) DEFAULT 'sms'
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
    is_deleted BOOLEAN DEFAULT false,
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
    is_deleted BOOLEAN DEFAULT false,
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
    type VARCHAR(50) DEFAULT 'http',
    provider VARCHAR(100) NOT NULL,
    connector_type VARCHAR(50) DEFAULT 'http',
    auth_type VARCHAR(50) DEFAULT 'API_KEY',
    http_method VARCHAR(10) DEFAULT 'POST',
    base_url TEXT,
    send_url TEXT NOT NULL,
    dlr_url TEXT,
    region VARCHAR(100),
    submit_pattern VARCHAR(255),
    dlr_pattern VARCHAR(255),
    dlr_value VARCHAR(100),
    params TEXT,
    api_key TEXT,
    api_secret TEXT,
    description TEXT,
    username VARCHAR(255),
    password TEXT,
    phone_number_id VARCHAR(100),
    business_account_id VARCHAR(100),
    bot_token TEXT,
    dlr_webhook_secret TEXT,
    dlr_status_mapping JSONB DEFAULT '{"failed": "UNDELIV", "delivered": "DELIVRD"}',
    test_payload JSONB,
    last_tested_at TIMESTAMP,
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
    language_code VARCHAR(10) NOT NULL DEFAULT 'en',
    country_prefix VARCHAR(10) DEFAULT '',
    primary_language_code VARCHAR(10) DEFAULT 'en',
    secondary_language_code VARCHAR(10) DEFAULT 'en',
    primary_greeting_text TEXT,
    primary_retry_text TEXT,
    secondary_greeting_text TEXT,
    secondary_retry_text TEXT,
    greeting_text TEXT,
    retry_text TEXT,
    greeting_audio_url TEXT,
    secondary_greeting_audio_url TEXT,
    audio_0_9 JSONB DEFAULT '{}',
    audio_files JSONB DEFAULT '{}',
    secondary_audio_files JSONB DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 17a. CHANNEL MESSAGES TABLE (RCS, Flash SMS, WhatsApp, Telegram, HTTP)
-- ============================================================
CREATE TABLE channel_messages (
    id SERIAL PRIMARY KEY,
    message_id VARCHAR(255) UNIQUE NOT NULL,
    channel VARCHAR(50) NOT NULL,
    destination VARCHAR(100) NOT NULL,
    message_text TEXT,
    media_url TEXT,
    device_id INTEGER,
    sender_id VARCHAR(100),
    api_connector_id INTEGER,
    status VARCHAR(50) DEFAULT 'queued',
    http_status INTEGER,
    error TEXT,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    delivered_at TIMESTAMP,
    retry_language_code VARCHAR(10) DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 17b. VOICE OTP LOGS TABLE
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
    status VARCHAR(20) DEFAULT 'initiated' CHECK (status IN ('initiated','ringing','answered','completed','failed','busy','no_answer','timeout','sent')),
    dlr_status VARCHAR(20),
    error_message TEXT,
    sip_call_id VARCHAR(100),
    client_id INTEGER,
    channel VARCHAR(40) DEFAULT 'voice_otp',
    asterisk_channel_id VARCHAR(100),
    dial_status VARCHAR(50),
    sip_server_id INTEGER,
    next_retry_at TIMESTAMP,
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
    is_deleted BOOLEAN DEFAULT false,
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
    mcc VARCHAR(10),
    mnc VARCHAR(10),
    name VARCHAR(255) DEFAULT '',
    description TEXT DEFAULT '',
    subtype VARCHAR(100) DEFAULT '',
    priority INTEGER DEFAULT 1,
    apply_to VARCHAR(20) DEFAULT 'client',
    apply_entity_id VARCHAR(50) DEFAULT 'all',
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
-- 27. SMPP SESSIONS TABLE
-- ============================================================
CREATE TABLE smpp_sessions (
    id SERIAL PRIMARY KEY,
    entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('client','supplier')),
    entity_id INTEGER NOT NULL,
    system_id VARCHAR(100) NOT NULL,
    ip_address VARCHAR(50),
    port INTEGER DEFAULT 2775,
    bind_mode VARCHAR(20) DEFAULT 'transceiver',
    status VARCHAR(20) DEFAULT 'unbound',
    connected_at TIMESTAMP,
    disconnected_at TIMESTAMP,
    last_activity TIMESTAMP,
    bound_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    smpp_session_id TEXT,
    remote_ip VARCHAR(50),
    negotiated_version VARCHAR(10),
    last_error VARCHAR(500),
    last_error_at TIMESTAMP,
    UNIQUE (entity_type, entity_id)
);

-- ============================================================
-- 27a. ACTIVE SMPP SESSIONS VIEW (pre-filters deleted entities)
-- ============================================================
-- Joins smpp_sessions with clients/suppliers and excludes soft-deleted entities.
-- Used by the supplier bind status query for zero-overhead filtering.
-- Returns only sessions belonging to active (non-deleted) clients and suppliers.
CREATE OR REPLACE VIEW active_smpp_sessions AS
SELECT ss.id,
    ss.entity_type,
    ss.entity_id,
    ss.system_id,
    COALESCE(ss.remote_ip, ss.ip_address) AS ip_address,
    ss.port,
    ss.bind_mode,
    ss.status,
    ss.negotiated_version,
    ss.connected_at,
    ss.disconnected_at,
    ss.last_activity,
    ss.bound_count,
    ss.smpp_session_id,
    CASE
        WHEN ss.entity_type = 'client' THEN c.client_code
        WHEN ss.entity_type = 'supplier' THEN s.supplier_code
        ELSE NULL
    END AS entity_code,
    CASE
        WHEN ss.entity_type = 'client' THEN c.company_name
        WHEN ss.entity_type = 'supplier' THEN s.company_name
        ELSE NULL
    END AS entity_name,
    COALESCE(s.connection_type, 'smpp') AS connection_type,
    COALESCE(s.is_inbound, false) AS is_inbound
FROM smpp_sessions ss
    LEFT JOIN clients c ON ss.entity_type = 'client' AND ss.entity_id = c.id
        AND (c.is_deleted IS NULL OR c.is_deleted = false)
    LEFT JOIN suppliers s ON ss.entity_type = 'supplier' AND ss.entity_id = s.id
        AND (s.is_deleted IS NULL OR s.is_deleted = false)
WHERE (c.id IS NOT NULL OR s.id IS NOT NULL);

-- ============================================================
-- 28. API KEYS TABLE
-- ============================================================
CREATE TABLE api_keys (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL REFERENCES clients(id),
    api_key_hash VARCHAR(255) UNIQUE NOT NULL,
    api_key_prefix VARCHAR(10) NOT NULL,
    rate_limit_tps INTEGER DEFAULT 10,
    daily_quota INTEGER DEFAULT 5000,
    usage_count INTEGER DEFAULT 0,
    usage_reset_at DATE DEFAULT CURRENT_DATE,
    last_used_at TIMESTAMP,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 29. ASTERISK SETTINGS TABLE
-- ============================================================
CREATE TABLE asterisk_settings (
    id SERIAL PRIMARY KEY,
    sip_host VARCHAR(255) DEFAULT '127.0.0.1' NOT NULL,
    ami_host VARCHAR(255) DEFAULT '127.0.0.1' NOT NULL,
    ami_port INTEGER DEFAULT 5038 NOT NULL,
    ami_username VARCHAR(100) DEFAULT 'net2app',
    ami_secret VARCHAR(255) DEFAULT 'net2app_secret',
    dialplan_context VARCHAR(100) DEFAULT 'net2app-otp',
    poll_interval_seconds INTEGER DEFAULT 5,
    retries_2_wait_seconds INTEGER DEFAULT 70,
    retries_3_wait_seconds INTEGER DEFAULT 105,
    max_retries INTEGER DEFAULT 3,
    asterisk_installed BOOLEAN DEFAULT false,
    asterisk_running BOOLEAN DEFAULT false,
    asterisk_config_path VARCHAR(500) DEFAULT '/etc/asterisk',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    use_existing_config BOOLEAN DEFAULT true,
    manager_conf_path VARCHAR(500) DEFAULT '/etc/asterisk/manager.conf'
);

-- ============================================================
-- 30. BIND HISTORY TABLE
-- ============================================================
CREATE TABLE bind_history (
    id SERIAL PRIMARY KEY,
    entity_type VARCHAR(20) NOT NULL CHECK (entity_type IN ('client','supplier')),
    entity_id INTEGER NOT NULL,
    system_id VARCHAR(100) NOT NULL,
    ip_address VARCHAR(50),
    port INTEGER DEFAULT 2775,
    bind_mode VARCHAR(20) DEFAULT 'transceiver',
    status VARCHAR(20) NOT NULL CHECK (status IN ('bound','unbound','binding','error')),
    negotiated_version VARCHAR(10),
    smpp_session_id TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 31. IDEMPOTENCY KEYS TABLE
-- ============================================================
CREATE TABLE idempotency_keys (
    idempotency_key VARCHAR(100) PRIMARY KEY,
    endpoint VARCHAR(120) NOT NULL,
    response_body JSONB,
    status_code INTEGER DEFAULT 200,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 32. IP LISTS TABLE
-- ============================================================
CREATE TABLE ip_lists (
    id SERIAL PRIMARY KEY,
    ip_address VARCHAR(45) NOT NULL,
    list_type VARCHAR(20) NOT NULL CHECK (list_type IN ('unaudited','blacklist','whitelist','web_login_blacklist')),
    notes TEXT,
    trunk_id INTEGER,
    created_by VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (ip_address, list_type)
);

-- ============================================================
-- 33. MO SMS TABLE (Mobile Originated / Incoming SMS)
-- ============================================================
CREATE TABLE mo_sms (
    id SERIAL PRIMARY KEY,
    channel VARCHAR(20) NOT NULL,
    external_id VARCHAR(100),
    sender VARCHAR(100),
    sender_name VARCHAR(255),
    recipient VARCHAR(100),
    message TEXT,
    message_type VARCHAR(30) DEFAULT 'text',
    metadata JSONB,
    reply_sent BOOLEAN DEFAULT false,
    reply_text TEXT,
    replied_at TIMESTAMPTZ,
    processed BOOLEAN DEFAULT false,
    received_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 34. NUMBER VALIDATION PROVIDERS TABLE
-- ============================================================
CREATE TABLE number_validation_providers (
    id SERIAL PRIMARY KEY,
    channel VARCHAR(40) UNIQUE NOT NULL,
    provider_kind VARCHAR(40) NOT NULL,
    enabled BOOLEAN DEFAULT true,
    api_url TEXT,
    api_key TEXT,
    api_secret TEXT,
    extra JSONB DEFAULT '{}',
    last_test_at TIMESTAMP,
    last_test_success BOOLEAN,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 35. NUMBER VALIDATION RESULTS TABLE
-- ============================================================
CREATE TABLE number_validation_results (
    id SERIAL PRIMARY KEY,
    phone_e164 VARCHAR(40) UNIQUE NOT NULL,
    has_whatsapp BOOLEAN,
    has_telegram BOOLEAN,
    has_rcs BOOLEAN,
    flash_sms_capable BOOLEAN,
    voice_capable BOOLEAN,
    provider VARCHAR(50),
    raw_response JSONB,
    checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP DEFAULT (CURRENT_TIMESTAMP + INTERVAL '24 hours'),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 36. PENDING DELIVER_SM TABLE (DLR Queue for ESME)
-- ============================================================
CREATE TABLE pending_deliver_sm (
    id SERIAL PRIMARY KEY,
    client_id INTEGER NOT NULL,
    message_id VARCHAR(100) NOT NULL,
    smpp_message_id VARCHAR(100),
    dlr_status VARCHAR(20) NOT NULL,
    error_code VARCHAR(10) DEFAULT '000',
    destination VARCHAR(20),
    source_addr VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT now(),
    delivered BOOLEAN DEFAULT false,
    delivered_at TIMESTAMPTZ
);

-- ============================================================
-- 37. RESIDENTIAL PROXIES TABLE
-- ============================================================
CREATE TABLE residential_proxies (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    proxy_type VARCHAR(20) NOT NULL DEFAULT 'socks5' CHECK (proxy_type IN ('residential','datacenter','isp','socks5')),
    host VARCHAR(255) NOT NULL,
    port INTEGER DEFAULT 1080 NOT NULL,
    username VARCHAR(255) DEFAULT '',
    password TEXT DEFAULT '',
    public_ip VARCHAR(50),
    is_active BOOLEAN DEFAULT true,
    is_online BOOLEAN DEFAULT false,
    last_heartbeat TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 38. SCHEMA MIGRATIONS TABLE
-- ============================================================
CREATE TABLE schema_migrations (
    id SERIAL PRIMARY KEY,
    hash TEXT UNIQUE NOT NULL,
    label TEXT,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 39. SIP SERVERS TABLE
-- ============================================================
CREATE TABLE sip_servers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    ami_host VARCHAR(255) NOT NULL,
    sip_host VARCHAR(255) NOT NULL,
    ami_port INTEGER DEFAULT 5038 NOT NULL,
    ami_username VARCHAR(100) DEFAULT 'net2app' NOT NULL,
    ami_secret VARCHAR(255) DEFAULT 'net2app_secret' NOT NULL,
    transport VARCHAR(10) DEFAULT 'udp' NOT NULL CHECK (transport IN ('udp','tcp','tls')),
    dialplan_context VARCHAR(100) DEFAULT 'net2app-otp',
    priority INTEGER DEFAULT 10 NOT NULL,
    is_active BOOLEAN DEFAULT true NOT NULL,
    last_health_status VARCHAR(20) DEFAULT 'unknown',
    last_health_at TIMESTAMP,
    last_health_latency_ms INTEGER,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_dlr_pushed_at TIMESTAMP,
    last_dlr_push_route VARCHAR(20),
    last_dlr_push_message_id VARCHAR(100),
    UNIQUE (ami_host, ami_port)
);

-- ============================================================
-- 40. SIP SERVER DESTINATIONS TABLE
-- ============================================================
CREATE TABLE sip_server_destinations (
    id SERIAL PRIMARY KEY,
    sip_server_id INTEGER NOT NULL REFERENCES sip_servers(id) ON DELETE CASCADE,
    kind VARCHAR(10) NOT NULL DEFAULT 'allow' CHECK (kind IN ('allow','deny')),
    priority INTEGER DEFAULT 10 NOT NULL,
    is_active BOOLEAN DEFAULT true NOT NULL,
    pattern TEXT NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (sip_server_id, pattern)
);

-- ============================================================
-- 41. SOCIAL API SUPPLIERS TABLE
-- ============================================================
CREATE TABLE social_api_suppliers (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    platform VARCHAR(20) NOT NULL CHECK (platform IN ('whatsapp_cloud','telegram_bot')),
    phone_number_id VARCHAR(100),
    business_account_id VARCHAR(100),
    access_token TEXT,
    webhook_verify_token VARCHAR(255),
    bot_token TEXT,
    bot_username VARCHAR(100),
    proxy_enabled BOOLEAN DEFAULT false,
    proxy_host VARCHAR(255),
    proxy_port INTEGER DEFAULT 8080,
    proxy_username VARCHAR(255),
    proxy_password TEXT,
    proxy_type VARCHAR(20) DEFAULT 'residential' CHECK (proxy_type IN ('residential','datacenter','isp')),
    is_active BOOLEAN DEFAULT true,
    connection_status VARCHAR(20) DEFAULT 'untested' CHECK (connection_status IN ('connected','disconnected','error','untested')),
    last_tested_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 42. VOICE CALL RETRY QUEUE TABLE
-- ============================================================
CREATE TABLE voice_call_retry_queue (
    id SERIAL PRIMARY KEY,
    call_id VARCHAR(100) NOT NULL,
    destination VARCHAR(40) NOT NULL,
    otp_code VARCHAR(20) NOT NULL,
    language VARCHAR(20) NOT NULL,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 3,
    next_attempt_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    last_dial_result VARCHAR(40),
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','waiting','connected','failed','timeout','completed')),
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP,
    client_id INTEGER REFERENCES clients(id),
    sip_server_id INTEGER REFERENCES sip_servers(id),
    next_sip_server_id INTEGER REFERENCES sip_servers(id)
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
COMMENT ON TABLE invoices IS 'Professional invoices with destination breakdown';
COMMENT ON TABLE voice_otp_configs IS 'Voice OTP language configs with audio files';
COMMENT ON TABLE channel_messages IS 'Multi-channel message log (RCS, Flash SMS, WhatsApp, Telegram, HTTP)';
COMMENT ON TABLE smpp_sessions IS 'Current and historical SMPP session tracking';
COMMENT ON TABLE api_keys IS 'Client API keys with rate limiting and daily quotas';
COMMENT ON TABLE asterisk_settings IS 'Asterisk PBX configuration (AMI/SIP)';
COMMENT ON TABLE bind_history IS 'SMPP bind/unbind audit trail';
COMMENT ON TABLE idempotency_keys IS 'API request idempotency for safe retries';
COMMENT ON TABLE ip_lists IS 'IP allow/deny lists for trunks and web login';
COMMENT ON TABLE mo_sms IS 'Mobile-Originated (incoming) SMS from all channels';
COMMENT ON TABLE number_validation_providers IS 'External number validation API providers';
COMMENT ON TABLE number_validation_results IS 'Cached phone number capability detection results';
COMMENT ON TABLE pending_deliver_sm IS 'DLRs queued for delivery to ESME when it rebinds';
COMMENT ON TABLE residential_proxies IS 'Proxy server pool for OTT channel connections';
COMMENT ON TABLE schema_migrations IS 'Database schema version tracking';
COMMENT ON TABLE sip_servers IS 'SIP server connections with health monitoring';
COMMENT ON TABLE sip_server_destinations IS 'SIP routing patterns (allow/deny) per server';
COMMENT ON TABLE social_api_suppliers IS 'Social media API suppliers (WhatsApp Cloud, Telegram Bot)';
COMMENT ON TABLE voice_call_retry_queue IS 'Voice OTP call retry queue with failover SIP servers';
COMMENT ON TABLE trunks IS 'Message routing trunks with priority and MCC/MNC filtering';
COMMENT ON TABLE routes IS 'Route definitions combining trunks with routing strategies';
COMMENT ON TABLE route_plans IS 'Grouped route plans assigned to clients';
COMMENT ON TABLE mccmnc IS 'MCC/MNC operator database for number lookups';
COMMENT ON TABLE payments IS 'Payment transactions against invoices';
COMMENT ON TABLE ott_devices IS 'OTT device connections (WhatsApp/Telegram) with QR pairing';
COMMENT ON TABLE api_connectors IS 'API gateway connectors with auth configs and DLR mapping';
COMMENT ON TABLE voice_otp_logs IS 'Voice OTP call logs with retry tracking';
COMMENT ON TABLE campaigns IS 'Bulk SMS/OTT campaign management';
COMMENT ON TABLE campaigns_recipients IS 'Individual recipient status within a campaign';
COMMENT ON TABLE translations IS 'Message routing and content translation rules';
COMMENT ON TABLE notifications IS 'System notifications and alerts';

-- ============================================================
-- INDEXES FOR NEW TABLES
-- ============================================================
CREATE INDEX idx_bindhist_created ON bind_history(created_at DESC);
CREATE INDEX idx_bindhist_entity ON bind_history(entity_type, entity_id, created_at DESC);
CREATE INDEX idx_idempotency_keys_created_at ON idempotency_keys(created_at);
CREATE UNIQUE INDEX idx_ip_lists_ip_type ON ip_lists(ip_address, list_type);
CREATE INDEX idx_mo_sms_channel ON mo_sms(channel);
CREATE INDEX idx_mo_sms_external ON mo_sms(channel, external_id);
CREATE INDEX idx_mo_sms_received ON mo_sms(received_at DESC);
CREATE INDEX idx_nvr_expires ON number_validation_results(expires_at);
CREATE INDEX idx_nvr_phone ON number_validation_results(phone_e164);
CREATE INDEX idx_pending_dlr_client ON pending_deliver_sm(client_id) WHERE delivered = false;
CREATE INDEX idx_rp_online ON residential_proxies(is_online);
CREATE INDEX idx_sas_active ON social_api_suppliers(is_active);
CREATE INDEX idx_sas_platform ON social_api_suppliers(platform);
CREATE INDEX idx_schema_migrations_hash ON schema_migrations(hash);
CREATE INDEX idx_sip_active_priority ON sip_servers(is_active, priority, id);
CREATE INDEX idx_sip_dlr_pushed ON sip_servers(last_dlr_pushed_at);
CREATE INDEX idx_ssd_active_pri ON sip_server_destinations(is_active, priority, id);
CREATE INDEX idx_ssd_server ON sip_server_destinations(sip_server_id);
CREATE INDEX idx_vcrq_call_id ON voice_call_retry_queue(call_id);
CREATE INDEX idx_vcrq_server ON voice_call_retry_queue(sip_server_id);
CREATE INDEX idx_vcrq_status_next ON voice_call_retry_queue(status, next_attempt_at);
COMMENT ON TABLE notification_templates IS 'Email notification templates with variables';
COMMENT ON TABLE license IS 'Platform license and feature control';
COMMENT ON TABLE tenants IS 'Tenant management with feature limits';
COMMENT ON TABLE platform_settings IS 'Global platform configuration';
COMMENT ON TABLE smtp_config IS 'SMTP email configuration';
COMMENT ON TABLE audit_logs IS 'User activity audit trail';
