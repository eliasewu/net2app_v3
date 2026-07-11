-- ============================================================
-- NET2APP HUB - MIGRATION SCRIPT v2
-- Adds new tables, columns, indexes, and features to an
-- existing database WITHOUT dropping any tables or data.
--
-- Safe to run multiple times (fully idempotent).
-- ============================================================
-- Usage: sudo -u postgres psql -d sms_platform -f src/database/migrate_v2.sql
-- ============================================================

BEGIN;

-- ============================================================
-- PART 1: NEW TABLES (CREATE TABLE IF NOT EXISTS)
-- ============================================================

-- 1a. CHANNEL MESSAGES TABLE
CREATE TABLE IF NOT EXISTS channel_messages (
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

-- 1b. SMPP SESSIONS TABLE
CREATE TABLE IF NOT EXISTS smpp_sessions (
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

-- 1c. API KEYS TABLE
CREATE TABLE IF NOT EXISTS api_keys (
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

-- 1d. ASTERISK SETTINGS TABLE
CREATE TABLE IF NOT EXISTS asterisk_settings (
    id SERIAL PRIMARY KEY,
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

-- 1e. BIND HISTORY TABLE
CREATE TABLE IF NOT EXISTS bind_history (
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

-- 1f. IDEMPOTENCY KEYS TABLE
CREATE TABLE IF NOT EXISTS idempotency_keys (
    idempotency_key VARCHAR(100) PRIMARY KEY,
    endpoint VARCHAR(120) NOT NULL,
    response_body JSONB,
    status_code INTEGER DEFAULT 200,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 1g. IP LISTS TABLE
CREATE TABLE IF NOT EXISTS ip_lists (
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

-- 1h. MO SMS TABLE (Mobile Originated / Incoming SMS)
CREATE TABLE IF NOT EXISTS mo_sms (
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

-- 1i. NUMBER VALIDATION PROVIDERS TABLE
CREATE TABLE IF NOT EXISTS number_validation_providers (
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

-- 1j. NUMBER VALIDATION RESULTS TABLE
CREATE TABLE IF NOT EXISTS number_validation_results (
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

-- 1k. PENDING DELIVER_SM TABLE (DLR Queue for ESME)
CREATE TABLE IF NOT EXISTS pending_deliver_sm (
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

-- 1l. RESIDENTIAL PROXIES TABLE
CREATE TABLE IF NOT EXISTS residential_proxies (
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

-- 1m. SCHEMA MIGRATIONS TABLE
CREATE TABLE IF NOT EXISTS schema_migrations (
    id SERIAL PRIMARY KEY,
    hash TEXT UNIQUE NOT NULL,
    label TEXT,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 1n. SIP SERVERS TABLE
CREATE TABLE IF NOT EXISTS sip_servers (
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

-- 1o. SIP SERVER DESTINATIONS TABLE
CREATE TABLE IF NOT EXISTS sip_server_destinations (
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

-- 1p. SOCIAL API SUPPLIERS TABLE
CREATE TABLE IF NOT EXISTS social_api_suppliers (
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

-- 1q. VOICE CALL RETRY QUEUE TABLE
CREATE TABLE IF NOT EXISTS voice_call_retry_queue (
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
-- PART 2: MISSING COLUMNS ON EXISTING TABLES
-- ============================================================

-- ============================================================
-- 2a. api_connectors — add 12 new columns
-- ============================================================
ALTER TABLE api_connectors ADD COLUMN IF NOT EXISTS auth_type VARCHAR(50) DEFAULT 'API_KEY';
ALTER TABLE api_connectors ADD COLUMN IF NOT EXISTS http_method VARCHAR(10) DEFAULT 'POST';
ALTER TABLE api_connectors ADD COLUMN IF NOT EXISTS dlr_url TEXT;
ALTER TABLE api_connectors ADD COLUMN IF NOT EXISTS submit_pattern VARCHAR(255);
ALTER TABLE api_connectors ADD COLUMN IF NOT EXISTS dlr_pattern VARCHAR(255);
ALTER TABLE api_connectors ADD COLUMN IF NOT EXISTS dlr_value VARCHAR(100);
ALTER TABLE api_connectors ADD COLUMN IF NOT EXISTS params TEXT;
ALTER TABLE api_connectors ADD COLUMN IF NOT EXISTS connector_type VARCHAR(50) DEFAULT 'http';
ALTER TABLE api_connectors ADD COLUMN IF NOT EXISTS dlr_webhook_secret TEXT;
ALTER TABLE api_connectors ADD COLUMN IF NOT EXISTS dlr_status_mapping JSONB DEFAULT '{"failed": "UNDELIV", "delivered": "DELIVRD"}';
ALTER TABLE api_connectors ADD COLUMN IF NOT EXISTS test_payload JSONB;
ALTER TABLE api_connectors ADD COLUMN IF NOT EXISTS last_tested_at TIMESTAMP;

-- Make send_url NOT NULL if it's currently nullable (skip if already NOT NULL)
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'api_connectors' AND column_name = 'send_url'
        AND is_nullable = 'YES'
    ) THEN
        -- First ensure no NULL values exist
        UPDATE api_connectors SET send_url = '' WHERE send_url IS NULL;
        ALTER TABLE api_connectors ALTER COLUMN send_url SET NOT NULL;
    END IF;
END $$;

-- ============================================================
-- 2b. clients — add 11 new columns
-- ============================================================
ALTER TABLE clients ADD COLUMN IF NOT EXISTS api_key VARCHAR(255);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS dlr_callback_url VARCHAR(500);
ALTER TABLE clients ADD COLUMN IF NOT EXISTS allowed_channels TEXT[] DEFAULT ARRAY['sms','whatsapp','telegram','rcs','flash_sms','voice_otp'];
ALTER TABLE clients ADD COLUMN IF NOT EXISTS preferred_channel VARCHAR(40) DEFAULT 'sms';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS force_dlr_timeout_mode VARCHAR(20) DEFAULT 'fixed';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS connection_type VARCHAR(50) DEFAULT 'smpp';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS api_connector_id INTEGER;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS voice_otp_config_id INTEGER;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS whatsapp_device_ids TEXT[] DEFAULT '{}';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS telegram_device_ids TEXT[] DEFAULT '{}';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS client_ips TEXT DEFAULT '';

-- ============================================================
-- 2c. sms_logs — add 8 new columns + adjust source column
-- ============================================================
ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS channel VARCHAR(40) DEFAULT 'sms';
ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS trunk_id INTEGER;
ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS trace JSONB DEFAULT '[]';
ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS dlr_callback_url VARCHAR(500);
ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS is_billed BOOLEAN DEFAULT false;
ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS billing_mode_snapshot VARCHAR(10);
ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS is_force_dlr BOOLEAN DEFAULT false;
ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS refund_amount DECIMAL(10,6) DEFAULT 0;

-- Adjust source column: change from VARCHAR(100) to VARCHAR(50) with default
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'sms_logs' AND column_name = 'source'
        AND data_type = 'character varying' AND character_maximum_length = 100
    ) THEN
        -- Truncate any values longer than 50 chars before shrinking the column
        UPDATE sms_logs SET source = LEFT(source, 50) WHERE LENGTH(source) > 50;
        ALTER TABLE sms_logs ALTER COLUMN source TYPE VARCHAR(50);
    END IF;
    -- Set default for source if not already set
    ALTER TABLE sms_logs ALTER COLUMN source SET DEFAULT 'external_api';
EXCEPTION WHEN OTHERS THEN
    NULL;
END $$;

-- ============================================================
-- 2d. suppliers — add 3 new columns
-- ============================================================
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS dlr_timeout INTEGER DEFAULT 150;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS force_dlr_timeout_mode VARCHAR(20) DEFAULT 'fixed';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS routed_via_asterisk BOOLEAN DEFAULT false;

-- ============================================================
-- 2e. voice_otp_logs — add 4 new columns
-- ============================================================
ALTER TABLE voice_otp_logs ADD COLUMN IF NOT EXISTS channel VARCHAR(40) DEFAULT 'voice_otp';
ALTER TABLE voice_otp_logs ADD COLUMN IF NOT EXISTS asterisk_channel_id VARCHAR(100);
ALTER TABLE voice_otp_logs ADD COLUMN IF NOT EXISTS dial_status VARCHAR(50);
ALTER TABLE voice_otp_logs ADD COLUMN IF NOT EXISTS sip_server_id INTEGER;

-- ============================================================
-- 2f. voice_otp_configs — add 1 new column
-- ============================================================
ALTER TABLE voice_otp_configs ADD COLUMN IF NOT EXISTS retry_language_code VARCHAR(10) DEFAULT '';

-- ============================================================
-- 2g. mccmnc — add 1 new column
-- ============================================================
ALTER TABLE mccmnc ADD COLUMN IF NOT EXISTS calling_code VARCHAR(10);

-- ============================================================
-- 2h. dlr_queue — add 1 new column
-- ============================================================
ALTER TABLE dlr_queue ADD COLUMN IF NOT EXISTS channel VARCHAR(40) DEFAULT 'sms';


-- ============================================================
-- PART 3: INDEXES
-- ============================================================

-- Original indexes (safe to re-run)
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_clients_code ON clients(client_code);
CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email);
CREATE INDEX IF NOT EXISTS idx_suppliers_code ON suppliers(supplier_code);
CREATE INDEX IF NOT EXISTS idx_suppliers_type ON suppliers(connection_type);
CREATE INDEX IF NOT EXISTS idx_suppliers_bind ON suppliers(bind_status);

CREATE INDEX IF NOT EXISTS idx_sms_logs_message_id ON sms_logs(message_id);
CREATE INDEX IF NOT EXISTS idx_sms_logs_smpp_message_id ON sms_logs(smpp_message_id);
CREATE INDEX IF NOT EXISTS idx_sms_logs_client_id ON sms_logs(client_id);
CREATE INDEX IF NOT EXISTS idx_sms_logs_supplier_id ON sms_logs(supplier_id);
CREATE INDEX IF NOT EXISTS idx_sms_logs_status ON sms_logs(status);
CREATE INDEX IF NOT EXISTS idx_sms_logs_submit_time ON sms_logs(submit_time);
CREATE INDEX IF NOT EXISTS idx_sms_logs_destination ON sms_logs(destination);
CREATE INDEX IF NOT EXISTS idx_sms_logs_client_date ON sms_logs(client_id, submit_time);

CREATE INDEX IF NOT EXISTS idx_dlr_queue_status ON dlr_queue(status);
CREATE INDEX IF NOT EXISTS idx_dlr_queue_message_id ON dlr_queue(message_id);
CREATE INDEX IF NOT EXISTS idx_dlr_queue_force ON dlr_queue(force_dlr) WHERE force_dlr = true;

CREATE INDEX IF NOT EXISTS idx_rates_entity_active ON rates(entity_type, entity_id, is_active);
CREATE INDEX IF NOT EXISTS idx_rates_destination ON rates(entity_type, entity_id, mcc, mnc);
CREATE INDEX IF NOT EXISTS idx_rates_effective ON rates(effective_from, effective_to);

CREATE INDEX IF NOT EXISTS idx_trunks_supplier_active ON trunks(supplier_id, is_active);
CREATE INDEX IF NOT EXISTS idx_routes_active ON routes(is_active) WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(is_read) WHERE is_read = false;
CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type);

CREATE INDEX IF NOT EXISTS idx_invoices_entity ON invoices(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_payments_entity ON payments(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_mccmnc_mcc ON mccmnc(mcc);
CREATE INDEX IF NOT EXISTS idx_mccmnc_country ON mccmnc(country);
CREATE INDEX IF NOT EXISTS idx_voice_otp_logs_status ON voice_otp_logs(status);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_time ON audit_logs(created_at);

-- New table indexes
CREATE INDEX IF NOT EXISTS idx_bindhist_created ON bind_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bindhist_entity ON bind_history(entity_type, entity_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_idempotency_keys_created_at ON idempotency_keys(created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ip_lists_ip_type ON ip_lists(ip_address, list_type);
CREATE INDEX IF NOT EXISTS idx_mo_sms_channel ON mo_sms(channel);
CREATE INDEX IF NOT EXISTS idx_mo_sms_external ON mo_sms(channel, external_id);
CREATE INDEX IF NOT EXISTS idx_mo_sms_received ON mo_sms(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_nvr_expires ON number_validation_results(expires_at);
CREATE INDEX IF NOT EXISTS idx_nvr_phone ON number_validation_results(phone_e164);
CREATE INDEX IF NOT EXISTS idx_pending_dlr_client ON pending_deliver_sm(client_id) WHERE delivered = false;
CREATE INDEX IF NOT EXISTS idx_rp_online ON residential_proxies(is_online);
CREATE INDEX IF NOT EXISTS idx_sas_active ON social_api_suppliers(is_active);
CREATE INDEX IF NOT EXISTS idx_sas_platform ON social_api_suppliers(platform);
CREATE INDEX IF NOT EXISTS idx_schema_migrations_hash ON schema_migrations(hash);
CREATE INDEX IF NOT EXISTS idx_sip_active_priority ON sip_servers(is_active, priority, id);
CREATE INDEX IF NOT EXISTS idx_sip_dlr_pushed ON sip_servers(last_dlr_pushed_at);
CREATE INDEX IF NOT EXISTS idx_ssd_active_pri ON sip_server_destinations(is_active, priority, id);
CREATE INDEX IF NOT EXISTS idx_ssd_server ON sip_server_destinations(sip_server_id);
CREATE INDEX IF NOT EXISTS idx_vcrq_call_id ON voice_call_retry_queue(call_id);
CREATE INDEX IF NOT EXISTS idx_vcrq_server ON voice_call_retry_queue(sip_server_id);
CREATE INDEX IF NOT EXISTS idx_vcrq_status_next ON voice_call_retry_queue(status, next_attempt_at);


-- ============================================================
-- PART 4: FUNCTIONS & TRIGGERS
-- ============================================================

-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create triggers idempotently (drop + create)
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_users_updated_at') THEN
        CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_clients_updated_at') THEN
        CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON clients
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_suppliers_updated_at') THEN
        CREATE TRIGGER update_suppliers_updated_at BEFORE UPDATE ON suppliers
        FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    END IF;
END $$;

-- Generate invoice number automatically
CREATE OR REPLACE FUNCTION generate_invoice_number()
RETURNS TRIGGER AS $$
DECLARE
    year_prefix VARCHAR(4);
    sequence_num INTEGER;
BEGIN
    year_prefix := to_char(NEW.created_at, 'YYYY');
    SELECT COALESCE(MAX(CAST(SPLIT_PART(invoice_number, '-', 3) AS INTEGER)), 0) + 1
    INTO sequence_num
    FROM invoices
    WHERE invoice_number LIKE 'INV-' || year_prefix || '-%';
    NEW.invoice_number := 'INV-' || year_prefix || '-' || LPAD(sequence_num::TEXT, 4, '0');
    RETURN NEW;
END;
$$ language 'plpgsql';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'generate_invoice_number_trigger') THEN
        CREATE TRIGGER generate_invoice_number_trigger BEFORE INSERT ON invoices
        FOR EACH ROW WHEN (NEW.invoice_number IS NULL)
        EXECUTE FUNCTION generate_invoice_number();
    END IF;
END $$;

-- Generate payment number automatically
CREATE OR REPLACE FUNCTION generate_payment_number()
RETURNS TRIGGER AS $$
DECLARE
    year_prefix VARCHAR(4);
    sequence_num INTEGER;
BEGIN
    year_prefix := to_char(NEW.created_at, 'YYYY');
    SELECT COALESCE(MAX(CAST(SPLIT_PART(payment_number, '-', 3) AS INTEGER)), 0) + 1
    INTO sequence_num
    FROM payments
    WHERE payment_number LIKE 'PAY-' || year_prefix || '-%';
    NEW.payment_number := 'PAY-' || year_prefix || '-' || LPAD(sequence_num::TEXT, 4, '0');
    RETURN NEW;
END;
$$ language 'plpgsql';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'generate_payment_number_trigger') THEN
        CREATE TRIGGER generate_payment_number_trigger BEFORE INSERT ON payments
        FOR EACH ROW WHEN (NEW.payment_number IS NULL)
        EXECUTE FUNCTION generate_payment_number();
    END IF;
END $$;

-- Generate unique message ID
CREATE OR REPLACE FUNCTION generate_message_id()
RETURNS TRIGGER AS $$
BEGIN
    NEW.message_id := 'MSG' || to_char(NOW(), 'YYYYMMDDHH24MISS') || LPAD(CAST(floor(random() * 9999) AS TEXT), 4, '0');
    RETURN NEW;
END;
$$ language 'plpgsql';

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'generate_sms_message_id') THEN
        CREATE TRIGGER generate_sms_message_id BEFORE INSERT ON sms_logs
        FOR EACH ROW WHEN (NEW.message_id IS NULL)
        EXECUTE FUNCTION generate_message_id();
    END IF;
END $$;

-- Auto-deduct balance on SMS submission
CREATE OR REPLACE FUNCTION deduct_client_balance()
RETURNS TRIGGER AS $$
DECLARE
    client_balance DECIMAL(15,4);
    client_credit DECIMAL(15,4);
    total_cost DECIMAL(15,4);
    billing_mode VARCHAR(20);
BEGIN
    SELECT balance, credit_limit, billing_mode INTO client_balance, client_credit, billing_mode
    FROM clients WHERE id = NEW.client_id FOR UPDATE;
    total_cost := NEW.client_rate * NEW.message_parts;
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
    IF (bal + cred) >= estimated_cost THEN
        RETURN QUERY SELECT true, bal, bal + cred, 'Sufficient balance'::TEXT;
    ELSE
        RETURN QUERY SELECT false, bal, bal + cred, 'Insufficient balance. Please top up your account.'::TEXT;
    END IF;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- PART 5: COMMENTS
-- ============================================================

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
COMMENT ON TABLE notification_templates IS 'Email notification templates with variables';
COMMENT ON TABLE license IS 'Platform license and feature control';
COMMENT ON TABLE ott_devices IS 'OTT device connections (WhatsApp/Telegram) with QR pairing';
COMMENT ON TABLE api_connectors IS 'API gateway connectors with auth configs';
COMMENT ON TABLE voice_otp_logs IS 'Voice OTP call logs with retry tracking';
COMMENT ON TABLE campaigns IS 'Bulk SMS/OTT campaign management';
COMMENT ON TABLE translations IS 'Message routing and content translation rules';
COMMENT ON TABLE trunks IS 'Message routing trunks with priority and MCC/MNC filtering';
COMMENT ON TABLE routes IS 'Route definitions combining trunks with routing strategies';
COMMENT ON TABLE route_plans IS 'Grouped route plans assigned to clients';
COMMENT ON TABLE mccmnc IS 'MCC/MNC operator database for number lookups';
COMMENT ON TABLE payments IS 'Payment transactions against invoices';
COMMENT ON TABLE campaigns_recipients IS 'Individual recipient status within a campaign';
COMMENT ON TABLE notifications IS 'System notifications and alerts';

-- ============================================================
-- PART 6: SEED DATA (safe insert — skip if exists)
-- ============================================================

-- Seed platform_settings if empty
INSERT INTO platform_settings (key, value)
SELECT key, value FROM (VALUES
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
    ('voice_otp_max_retries', '4')
) AS v(key, value)
WHERE NOT EXISTS (SELECT 1 FROM platform_settings WHERE platform_settings.key = v.key);

COMMIT;
