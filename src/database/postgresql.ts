// PostgreSQL Database Service
// All data is stored in PostgreSQL and loaded from database
// This service manages the database operations

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
}

// Table schemas matching PostgreSQL database
export const TABLES = {
  users: `CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    email VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'agent',
    permissions TEXT[] DEFAULT '{}',
    client_id INTEGER REFERENCES clients(id),
    supplier_id INTEGER REFERENCES suppliers(id),
    name VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  
  clients: `CREATE TABLE IF NOT EXISTS clients (
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
    smpp_ip VARCHAR(50),
    smpp_port INTEGER DEFAULT 2775,
    system_type VARCHAR(50) DEFAULT 'SMPP',
    max_tps INTEGER DEFAULT 100,
    billing_mode VARCHAR(20) DEFAULT 'dlr',
    currency VARCHAR(3) DEFAULT 'EUR',
    balance DECIMAL(15,2) DEFAULT 0,
    credit_limit DECIMAL(15,2) DEFAULT 0,
    api_enabled BOOLEAN DEFAULT false,
    webhook_url TEXT,
    force_dlr BOOLEAN DEFAULT false,
    dlr_timeout INTEGER DEFAULT 150,
    routing_plan_id INTEGER REFERENCES route_plans(id),
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  
  suppliers: `CREATE TABLE IF NOT EXISTS suppliers (
    id SERIAL PRIMARY KEY,
    supplier_code VARCHAR(50) UNIQUE NOT NULL,
    company_name VARCHAR(255) NOT NULL,
    contact_person VARCHAR(255),
    email VARCHAR(255),
    phone VARCHAR(50),
    connection_type VARCHAR(50) NOT NULL,
    smpp_host VARCHAR(255),
    smpp_port INTEGER DEFAULT 2775,
    smpp_username VARCHAR(100),
    smpp_password VARCHAR(255),
    system_id VARCHAR(100),
    api_url TEXT,
    api_key TEXT,
    api_method VARCHAR(10) DEFAULT 'POST',
    balance DECIMAL(15,2) DEFAULT 0,
    credit_limit DECIMAL(15,2) DEFAULT 0,
    currency VARCHAR(3) DEFAULT 'EUR',
    bind_status VARCHAR(20) DEFAULT 'unbound',
    consecutive_failures INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  
  trunks: `CREATE TABLE IF NOT EXISTS trunks (
    id SERIAL PRIMARY KEY,
    trunk_name VARCHAR(255) NOT NULL,
    trunk_type VARCHAR(50) NOT NULL,
    supplier_id INTEGER REFERENCES suppliers(id) NOT NULL,
    priority INTEGER DEFAULT 1,
    percentage INTEGER DEFAULT 100,
    is_active BOOLEAN DEFAULT true,
    mccmnc_allowed TEXT[] DEFAULT '{"*"}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  
  routes: `CREATE TABLE IF NOT EXISTS routes (
    id SERIAL PRIMARY KEY,
    route_name VARCHAR(255) NOT NULL,
    trunk_ids INTEGER[] DEFAULT '{}',
    route_method VARCHAR(20) DEFAULT 'priority',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  
  route_plans: `CREATE TABLE IF NOT EXISTS route_plans (
    id SERIAL PRIMARY KEY,
    plan_name VARCHAR(255) NOT NULL,
    route_ids INTEGER[] DEFAULT '{}',
    is_default BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  
  route_maps: `CREATE TABLE IF NOT EXISTS route_maps (
    id SERIAL PRIMARY KEY,
    client_id INTEGER REFERENCES clients(id) NOT NULL,
    route_id INTEGER REFERENCES routes(id) NOT NULL,
    supplier_id INTEGER REFERENCES suppliers(id) NOT NULL,
    mccmnc_pattern VARCHAR(50) NOT NULL DEFAULT '*',
    priority INTEGER DEFAULT 1,
    percentage INTEGER DEFAULT 100,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  
  rates: `CREATE TABLE IF NOT EXISTS rates (
    id SERIAL PRIMARY KEY,
    entity_type VARCHAR(20) NOT NULL,
    entity_id INTEGER NOT NULL,
    mcc VARCHAR(10) NOT NULL,
    mnc VARCHAR(10) NOT NULL DEFAULT '*',
    country VARCHAR(100) NOT NULL,
    operator VARCHAR(100) DEFAULT 'All',
    rate DECIMAL(10,4) NOT NULL,
    currency VARCHAR(3) DEFAULT 'EUR',
    effective_from DATE NOT NULL,
    effective_to DATE,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    version INTEGER DEFAULT 1
  )`,
  
  mccmnc: `CREATE TABLE IF NOT EXISTS mccmnc (
    id SERIAL PRIMARY KEY,
    country VARCHAR(100) NOT NULL,
    country_code VARCHAR(10) NOT NULL,
    mcc VARCHAR(10) NOT NULL,
    mnc VARCHAR(10) NOT NULL,
    operator VARCHAR(255) NOT NULL,
    network_type VARCHAR(50) DEFAULT 'GSM',
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  
  sms_logs: `CREATE TABLE IF NOT EXISTS sms_logs (
    id SERIAL PRIMARY KEY,
    message_id VARCHAR(100) UNIQUE NOT NULL,
    client_id INTEGER REFERENCES clients(id),
    supplier_id INTEGER REFERENCES suppliers(id),
    sender_id VARCHAR(100) NOT NULL,
    destination VARCHAR(50) NOT NULL,
    mcc VARCHAR(10),
    mnc VARCHAR(10),
    country VARCHAR(100),
    operator VARCHAR(100),
    message TEXT NOT NULL,
    message_parts INTEGER DEFAULT 1,
    client_rate DECIMAL(10,4) DEFAULT 0,
    supplier_rate DECIMAL(10,4) DEFAULT 0,
    profit DECIMAL(10,4) DEFAULT 0,
    currency VARCHAR(3) DEFAULT 'EUR',
    status VARCHAR(20) DEFAULT 'pending',
    dlr_status VARCHAR(20),
    dlr_timestamp TIMESTAMP,
    error_code VARCHAR(10),
    error_message TEXT,
    route_id INTEGER REFERENCES routes(id),
    trunk_id INTEGER REFERENCES trunks(id),
    smpp_message_id VARCHAR(100),
    registered_delivery INTEGER DEFAULT 1,
    data_coding INTEGER DEFAULT 0,
    esm_class INTEGER DEFAULT 0,
    submit_time TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    delivery_time TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  
  invoices: `CREATE TABLE IF NOT EXISTS invoices (
    id SERIAL PRIMARY KEY,
    invoice_number VARCHAR(100) UNIQUE NOT NULL,
    entity_type VARCHAR(20) NOT NULL,
    entity_id INTEGER NOT NULL,
    entity_name VARCHAR(255) NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    total_sms INTEGER DEFAULT 0,
    total_amount DECIMAL(15,2) DEFAULT 0,
    tax_amount DECIMAL(15,2) DEFAULT 0,
    grand_total DECIMAL(15,2) DEFAULT 0,
    currency VARCHAR(3) DEFAULT 'EUR',
    status VARCHAR(20) DEFAULT 'draft',
    due_date DATE,
    paid_date DATE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    sent_at TIMESTAMP
  )`,
  
  payments: `CREATE TABLE IF NOT EXISTS payments (
    id SERIAL PRIMARY KEY,
    payment_number VARCHAR(100) UNIQUE NOT NULL,
    entity_type VARCHAR(20) NOT NULL,
    entity_id INTEGER NOT NULL,
    entity_name VARCHAR(255) NOT NULL,
    amount DECIMAL(15,2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'EUR',
    payment_method VARCHAR(50) NOT NULL,
    reference VARCHAR(255),
    status VARCHAR(20) DEFAULT 'pending',
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  
  notification_templates: `CREATE TABLE IF NOT EXISTS notification_templates (
    id SERIAL PRIMARY KEY,
    template_name VARCHAR(255) NOT NULL,
    subject VARCHAR(500) NOT NULL,
    body TEXT NOT NULL,
    variables TEXT[] DEFAULT '{}',
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  
  notifications: `CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(20) DEFAULT 'info',
    entity_type VARCHAR(20),
    entity_id INTEGER,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  
  api_connectors: `CREATE TABLE IF NOT EXISTS api_connectors (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    provider VARCHAR(100) NOT NULL,
    region VARCHAR(100),
    auth_type VARCHAR(50) DEFAULT 'API_KEY',
    http_method VARCHAR(10) DEFAULT 'POST',
    api_key TEXT,
    send_url TEXT NOT NULL,
    dlr_url TEXT,
    submit_pattern VARCHAR(255),
    dlr_pattern VARCHAR(255),
    dlr_value VARCHAR(100),
    params TEXT,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  
  ott_devices: `CREATE TABLE IF NOT EXISTS ott_devices (
    id SERIAL PRIMARY KEY,
    device_name VARCHAR(255) NOT NULL,
    device_type VARCHAR(20) NOT NULL,
    phone_number VARCHAR(50),
    session_status VARCHAR(20) DEFAULT 'disconnected',
    qr_code TEXT,
    last_active TIMESTAMP,
    supplier_id INTEGER REFERENCES suppliers(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  
  voice_otp_configs: `CREATE TABLE IF NOT EXISTS voice_otp_configs (
    id SERIAL PRIMARY KEY,
    language VARCHAR(100) NOT NULL,
    language_code VARCHAR(10) NOT NULL,
    greeting_text TEXT NOT NULL,
    retry_text TEXT,
    audio_file_url TEXT,
    sip_host VARCHAR(255) DEFAULT 'sip.provider.com',
    sip_port INTEGER DEFAULT 5060,
    caller_id VARCHAR(50),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  
  voice_otp_logs: `CREATE TABLE IF NOT EXISTS voice_otp_logs (
    id SERIAL PRIMARY KEY,
    call_id VARCHAR(100) UNIQUE NOT NULL,
    destination VARCHAR(50) NOT NULL,
    otp_code VARCHAR(10) NOT NULL,
    language VARCHAR(100),
    duration INTEGER DEFAULT 0,
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 4,
    status VARCHAR(20) DEFAULT 'initiated',
    dlr_status VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  
  campaigns: `CREATE TABLE IF NOT EXISTS campaigns (
    id SERIAL PRIMARY KEY,
    campaign_name VARCHAR(255) NOT NULL,
    client_id INTEGER REFERENCES clients(id),
    sender_id VARCHAR(100) NOT NULL,
    message_template TEXT NOT NULL,
    recipients_count INTEGER DEFAULT 0,
    sent_count INTEGER DEFAULT 0,
    delivered_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    status VARCHAR(20) DEFAULT 'draft',
    scheduled_at TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  
  translations: `CREATE TABLE IF NOT EXISTS translations (
    id SERIAL PRIMARY KEY,
    translation_type VARCHAR(50) NOT NULL,
    source_pattern VARCHAR(255) NOT NULL,
    target_value VARCHAR(255) NOT NULL,
    client_id INTEGER REFERENCES clients(id),
    supplier_id INTEGER REFERENCES suppliers(id),
    route_id INTEGER REFERENCES routes(id),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  
  license: `CREATE TABLE IF NOT EXISTS license (
    id SERIAL PRIMARY KEY,
    license_key VARCHAR(255) UNIQUE NOT NULL,
    license_type VARCHAR(50) NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    issued_to VARCHAR(255),
    system_ip VARCHAR(50),
    system_mac VARCHAR(50),
    issued_date DATE,
    expiry_date DATE,
    features JSONB DEFAULT '{}',
    limits JSONB DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  
  tenants: `CREATE TABLE IF NOT EXISTS tenants (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE NOT NULL,
    status VARCHAR(20) DEFAULT 'active',
    features JSONB DEFAULT '{}',
    limits JSONB DEFAULT '{}',
    sms_this_month INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  
  platform_settings: `CREATE TABLE IF NOT EXISTS platform_settings (
    id SERIAL PRIMARY KEY,
    key VARCHAR(255) UNIQUE NOT NULL,
    value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  
  smtp_config: `CREATE TABLE IF NOT EXISTS smtp_config (
    id SERIAL PRIMARY KEY,
    host VARCHAR(255) NOT NULL,
    port INTEGER DEFAULT 587,
    encryption VARCHAR(10) DEFAULT 'tls',
    username VARCHAR(255),
    password TEXT,
    from_email VARCHAR(255),
    from_name VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`,
  
  dlr_queue: `CREATE TABLE IF NOT EXISTS dlr_queue (
    id SERIAL PRIMARY KEY,
    message_id VARCHAR(100) NOT NULL,
    smpp_message_id VARCHAR(100),
    destination VARCHAR(50) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending',
    retry_count INTEGER DEFAULT 0,
    max_retries INTEGER DEFAULT 150,
    force_dlr BOOLEAN DEFAULT false,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_retry_at TIMESTAMP,
    dlr_received_at TIMESTAMP
  )`,
};

// Database initialization script
export const INIT_DATABASE_SQL = `
  ${Object.values(TABLES).join(';\n\n')};
  
  -- Indexes for performance
  CREATE INDEX IF NOT EXISTS idx_sms_logs_message_id ON sms_logs(message_id);
  CREATE INDEX IF NOT EXISTS idx_sms_logs_client_id ON sms_logs(client_id);
  CREATE INDEX IF NOT EXISTS idx_sms_logs_supplier_id ON sms_logs(supplier_id);
  CREATE INDEX IF NOT EXISTS idx_sms_logs_status ON sms_logs(status);
  CREATE INDEX IF NOT EXISTS idx_sms_logs_submit_time ON sms_logs(submit_time);
  CREATE INDEX IF NOT EXISTS idx_rates_entity ON rates(entity_type, entity_id);
  CREATE INDEX IF NOT EXISTS idx_rates_active ON rates(is_active);
  CREATE INDEX IF NOT EXISTS idx_invoices_entity ON invoices(entity_type, entity_id);
  CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read);
  CREATE INDEX IF NOT EXISTS idx_dlr_queue_status ON dlr_queue(status);
  CREATE INDEX IF NOT EXISTS idx_route_maps_client ON route_maps(client_id);
  CREATE INDEX IF NOT EXISTS idx_route_maps_mccmnc ON route_maps(mccmnc_pattern);
  CREATE INDEX IF NOT EXISTS idx_trunks_supplier ON trunks(supplier_id);
  CREATE INDEX IF NOT EXISTS idx_routes_active ON routes(is_active);
  CREATE INDEX IF NOT EXISTS idx_mccmnc_mcc ON mccmnc(mcc);
  CREATE INDEX IF NOT EXISTS idx_payments_entity ON payments(entity_type, entity_id);
  CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
  CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
  
  -- Insert default data only if empty
  INSERT INTO users (username, password_hash, email, role, permissions, name, is_active)
  SELECT 'admin', 'pg_hash_admin', 'admin@net2app.com', 'super_admin', ARRAY['all'], 'Super Admin', true
  WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'admin');
  
  INSERT INTO users (username, password_hash, email, role, permissions, name, is_active)
  SELECT 'support', 'pg_hash_support', 'support@net2app.com', 'support', ARRAY['view_clients','view_suppliers','view_sms_logs','test_sms','manage_bind'], 'Support Team', true
  WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'support');
  
  INSERT INTO users (username, password_hash, email, role, permissions, name, is_active)
  SELECT 'billing', 'pg_hash_billing', 'billing@net2app.com', 'billing', ARRAY['manage_invoices','manage_payments','view_reports','view_clients'], 'Billing Team', true
  WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'billing');
  
  INSERT INTO users (username, password_hash, email, role, permissions, name, is_active)
  SELECT 'techcorp_user', 'pg_hash_techcorp', 'user@techcorp.com', 'client', ARRAY['view_own_cdr','view_own_usage','view_own_payments','test_sms'], 'TechCorp Client', true
  WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'techcorp_user');
  
  INSERT INTO users (username, password_hash, email, role, permissions, name, is_active)
  SELECT 'globalsms_user', 'pg_hash_globalsms', 'user@globalsms.com', 'supplier', ARRAY['view_own_cdr','view_own_usage','view_own_payments'], 'GlobalSMS Supplier', true
  WHERE NOT EXISTS (SELECT 1 FROM users WHERE username = 'globalsms_user');
`;

// This SQL runs on PostgreSQL server to create all tables
export const CREATE_ALL_TABLES = INIT_DATABASE_SQL;

// DLR/SMS Flow - How messages are processed
export const SMS_PROCESSING_FLOW = `
  SMS Sending Flow (Stored in PostgreSQL):
  
  1. Client submits message via SMPP/HTTP
     → INSERT INTO sms_logs (message_id, client_id, sender_id, destination, message, status='pending')
  
  2. Validation Check:
     → Check client balance (SELECT balance, credit_limit FROM clients WHERE id=?)
     → Check if client has route (SELECT route_id FROM route_maps WHERE client_id=? AND mccmnc_pattern LIKE ?)
     → Check rate exists (SELECT rate FROM rates WHERE entity_type='client' AND entity_id=? AND is_active=true)
  
  3. Route Selection:
     → Find route map (SELECT supplier_id, priority FROM route_maps WHERE client_id=? AND ? LIKE mccmnc_pattern)
     → Find trunk (SELECT * FROM trunks WHERE id IN (SELECT unnest(trunk_ids) FROM routes WHERE id=?) AND is_active=true)
     → Check supplier bind (SELECT bind_status, consecutive_failures FROM suppliers WHERE id=? AND status='active')
  
  4. Submit to Supplier (SMPP SUBMIT_SM):
     → INSERT INTO dlr_queue (message_id, destination, status='pending', submitted_at=NOW())
     → UPDATE sms_logs SET status='submitted', smpp_message_id=? WHERE message_id=?
  
  5. DLR Processing:
     → On DLR received: UPDATE sms_logs SET status='delivered', dlr_status=?, dlr_timestamp=NOW(), delivery_time=NOW()
     → On failure: UPDATE sms_logs SET status='failed', error_code=?, error_message=? WHERE message_id=?
     → Update supplier consecutive_failures on failure
     → If failures >= 20: UPDATE suppliers SET status='inactive', bind_status='unbound' WHERE id=?
  
  6. Billing:
     → If billing_mode='dlr' and status='delivered':
       UPDATE clients SET balance = balance - (rate * message_parts) WHERE id=?
     → If billing_mode='submit':
       UPDATE clients SET balance = balance - (rate * message_parts) WHERE id=?
  
  7. Rate Update Versioning:
     → When new rate added:
       BEGIN;
       UPDATE rates SET is_active=false, effective_to=CURRENT_DATE WHERE entity_type=? AND entity_id=? AND mcc=? AND mnc=? AND is_active=true;
       INSERT INTO rates (entity_type, entity_id, mcc, mnc, country, operator, rate, currency, effective_from, version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_DATE, (SELECT COALESCE(MAX(version),0)+1 FROM rates WHERE entity_type=? AND entity_id=? AND mcc=? AND mnc=?));
       COMMIT;
`;

export default {
  TABLES,
  INIT_DATABASE_SQL,
  CREATE_ALL_TABLES,
  SMS_PROCESSING_FLOW,
};
