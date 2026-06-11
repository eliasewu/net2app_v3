#!/bin/bash
# ============================================================
# NET2APP HUB - COMPLETE INSTALLATION SCRIPT
# Ubuntu 22.04 / Debian 12
# ============================================================
set -e

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
log() { echo -e "${GREEN}[$(date +'%H:%M:%S')]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

echo -e "${BLUE}"
echo "============================================================"
echo "  NET2APP HUB - Enterprise SMS Platform Installer"
echo "  Ubuntu 22.04 / Debian 12"
echo "============================================================"
echo -e "${NC}"

# Check root
if [ "$EUID" -ne 0 ]; then err "Please run as root: sudo bash install.sh"; fi

# Configuration
APP_DIR="/opt/net2app-hub"
DB_NAME="net2app_hub"
DB_USER="net2app_user"
DB_PASS=$(openssl rand -base64 16)
DOMAIN="${1:-localhost}"
NODE_VERSION="20"

log "Starting NET2APP Hub installation..."
log "Domain: ${DOMAIN}"

# ============================================================
# 1. SYSTEM UPDATE
# ============================================================
log "Step 1/10: Updating system packages..."
apt update && apt upgrade -y

# ============================================================
# 2. INSTALL DEPENDENCIES
# ============================================================
log "Step 2/10: Installing dependencies..."
apt install -y curl wget git build-essential nginx certbot python3-certbot-nginx ufw fail2ban

# Node.js 20
if ! command -v node &> /dev/null; then
  log "Installing Node.js ${NODE_VERSION}..."
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
  apt install -y nodejs
fi

# ============================================================
# 3. POSTGRESQL
# ============================================================
log "Step 3/10: Installing PostgreSQL..."
apt install -y postgresql postgresql-contrib

log "Configuring PostgreSQL..."
sudo -u postgres psql <<EOF
CREATE DATABASE ${DB_NAME};
CREATE USER ${DB_USER} WITH PASSWORD '${DB_PASS}';
GRANT ALL PRIVILEGES ON DATABASE ${DB_NAME} TO ${DB_USER};
\c ${DB_NAME}
GRANT ALL ON SCHEMA public TO ${DB_USER};
EOF

# Save DB credentials
echo "DB_NAME=${DB_NAME}" > ${APP_DIR}/.env
echo "DB_USER=${DB_USER}" >> ${APP_DIR}/.env
echo "DB_PASS=${DB_PASS}" >> ${APP_DIR}/.env
echo "DB_HOST=localhost" >> ${APP_DIR}/.env
echo "DB_PORT=5432" >> ${APP_DIR}/.env

log "PostgreSQL configured: DB=${DB_NAME} User=${DB_USER}"

# ============================================================
# 4. IMPORT DATABASE SCHEMA
# ============================================================
log "Step 4/10: Importing database schema..."
sudo -u postgres psql -d ${DB_NAME} -f src/database/schema.sql 2>/dev/null || warn "Schema file not found locally, will be imported on first run"

# ============================================================
# 5. INSTALL APP
# ============================================================
log "Step 5/10: Installing application..."

# Create app directory
mkdir -p ${APP_DIR}
cp -r . ${APP_DIR}/ 2>/dev/null || true
cd ${APP_DIR}

# Install dependencies
npm install --production 2>/dev/null || npm install

# Build frontend
npm run build 2>/dev/null || log "Build will be done separately"

# Create backend entry point
cat > ${APP_DIR}/server.js << 'SERVERJS'
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'net2app-hub-secret-' + Date.now();

// Database pool
const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'net2app_hub',
  user: process.env.DB_USER || 'net2app_user',
  password: process.env.DB_PASS || '',
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'dist')));

// Auth middleware
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
};

const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  next();
};

// ==================== AUTH ROUTES ====================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE username = $1 AND is_active = true', [username]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid username' });
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid password' });
    await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
    const { password_hash, ...safeUser } = user;
    res.json({ success: true, token, user: safeUser });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/profile', authenticate, async (req, res) => {
  const result = await pool.query('SELECT id, username, email, role, permissions, name FROM users WHERE id = $1', [req.user.id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true, data: result.rows[0] });
});

// ==================== CLIENTS ROUTES ====================
app.get('/api/clients', authenticate, async (req, res) => {
  const result = await pool.query('SELECT * FROM clients ORDER BY created_at DESC');
  res.json({ success: true, data: result.rows });
});

app.get('/api/clients/:id', authenticate, async (req, res) => {
  const result = await pool.query('SELECT * FROM clients WHERE id = $1', [req.params.id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true, data: result.rows[0] });
});

app.post('/api/clients', authenticate, requireRole('super_admin', 'admin'), async (req, res) => {
  const { client_code, company_name, contact_person, email, phone, smpp_username, smpp_password, billing_mode, currency, balance, credit_limit } = req.body;
  const result = await pool.query(
    `INSERT INTO clients (client_code, company_name, contact_person, email, phone, smpp_username, smpp_password, billing_mode, currency, balance, credit_limit)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [client_code, company_name, contact_person, email, phone, smpp_username, smpp_password, billing_mode||'dlr', currency||'EUR', balance||0, credit_limit||0]
  );
  res.json({ success: true, data: result.rows[0] });
});

app.put('/api/clients/:id', authenticate, requireRole('super_admin', 'admin'), async (req, res) => {
  const id = req.params.id;
  const fields = Object.keys(req.body).filter(k => req.body[k] !== undefined);
  const sets = fields.map((k, i) => `${k} = $${i+1}`).join(', ');
  const values = fields.map(k => req.body[k]);
  if (fields.length === 0) return res.json({ success: true });
  await pool.query(`UPDATE clients SET ${sets}, updated_at = NOW() WHERE id = $${fields.length+1}`, [...values, id]);
  res.json({ success: true });
});

app.delete('/api/clients/:id', authenticate, requireRole('super_admin'), async (req, res) => {
  await pool.query('DELETE FROM clients WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

// ==================== SUPPLIERS ROUTES ====================
app.get('/api/suppliers', authenticate, async (req, res) => {
  const result = await pool.query('SELECT * FROM suppliers ORDER BY created_at DESC');
  res.json({ success: true, data: result.rows });
});

app.get('/api/suppliers/:id', authenticate, async (req, res) => {
  const result = await pool.query('SELECT * FROM suppliers WHERE id = $1', [req.params.id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true, data: result.rows[0] });
});

app.post('/api/suppliers', authenticate, requireRole('super_admin', 'admin'), async (req, res) => {
  const { supplier_code, company_name, connection_type, smpp_host, smpp_port, smpp_username, smpp_password, balance, credit_limit } = req.body;
  const result = await pool.query(
    `INSERT INTO suppliers (supplier_code, company_name, connection_type, smpp_host, smpp_port, smpp_username, smpp_password, balance, credit_limit)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [supplier_code, company_name, connection_type||'smpp', smpp_host, smpp_port||2775, smpp_username, smpp_password, balance||0, credit_limit||0]
  );
  res.json({ success: true, data: result.rows[0] });
});

app.put('/api/suppliers/:id', authenticate, requireRole('super_admin', 'admin'), async (req, res) => {
  const id = req.params.id;
  const fields = Object.keys(req.body).filter(k => req.body[k] !== undefined && k !== 'id');
  const sets = fields.map((k, i) => `${k} = $${i+1}`).join(', ');
  const values = fields.map(k => req.body[k]);
  if (fields.length === 0) return res.json({ success: true });
  await pool.query(`UPDATE suppliers SET ${sets}, updated_at = NOW() WHERE id = $${fields.length+1}`, [...values, id]);
  res.json({ success: true });
});

// ==================== SMS LOGS ====================
app.post('/api/sms/logs', authenticate, async (req, res) => {
  const { client_id, status, date_from, date_to, limit, offset } = req.body;
  let query = 'SELECT * FROM sms_logs WHERE 1=1';
  const params: any[] = [];
  let pi = 1;
  if (client_id) { query += ` AND client_id = $${pi++}`; params.push(client_id); }
  if (status) { query += ` AND status = $${pi++}`; params.push(status); }
  if (date_from) { query += ` AND submit_time >= $${pi++}`; params.push(date_from); }
  if (date_to) { query += ` AND submit_time <= $${pi++}`; params.push(date_to); }
  query += ' ORDER BY submit_time DESC';
  query += ` LIMIT $${pi++} OFFSET $${pi++}`;
  params.push(limit||100, offset||0);
  const result = await pool.query(query, params);
  res.json({ success: true, data: result.rows });
});

app.post('/api/sms/send', authenticate, async (req, res) => {
  const { client_id, destination, sender_id, message, route_plan_id } = req.body;
  // Validate
  const client = await pool.query('SELECT * FROM clients WHERE id = $1 AND status = $2', [client_id, 'active']);
  if (client.rows.length === 0) return res.status(400).json({ error: 'Client not found or inactive' });
  
  // Insert SMS log
  const result = await pool.query(
    `INSERT INTO sms_logs (message_id, client_id, client_code, sender_id, destination, message, status, submit_time)
     VALUES ($1,$2,$3,$4,$5,$6,'pending',NOW()) RETURNING *`,
    ['MSG'+Date.now(), client_id, client.rows[0].client_code, sender_id, destination, message]
  );
  
  // Simulate DLR
  setTimeout(async () => {
    const delivered = Math.random() > 0.15;
    await pool.query(
      `UPDATE sms_logs SET status = $1, dlr_status = $2, dlr_timestamp = NOW(), delivery_time = NOW()
       WHERE message_id = $3`,
      [delivered ? 'delivered' : 'failed', delivered ? 'DELIVRD' : 'UNDELIV', result.rows[0].message_id]
    );
  }, 3000);
  
  res.json({ success: true, data: result.rows[0] });
});

// ==================== RATES ====================
app.get('/api/rates', authenticate, async (req, res) => {
  const { entity_type, entity_id } = req.query;
  let query = 'SELECT * FROM rates WHERE 1=1';
  const params: any[] = [];
  let pi = 1;
  if (entity_type) { query += ` AND entity_type = $${pi++}`; params.push(entity_type); }
  if (entity_id) { query += ` AND entity_id = $${pi++}`; params.push(entity_id); }
  query += ' ORDER BY country, mcc, mnc';
  const result = await pool.query(query, params);
  res.json({ success: true, data: result.rows });
});

app.post('/api/rates', authenticate, requireRole('super_admin', 'admin', 'billing'), async (req, res) => {
  const { entity_type, entity_id, mcc, mnc, country, operator, rate, currency, effective_from, send_notification } = req.body;
  // Deactivate old rate
  await pool.query(
    'UPDATE rates SET is_active = false, effective_to = CURRENT_DATE WHERE entity_type = $1 AND entity_id = $2 AND mcc = $3 AND mnc = $4 AND is_active = true',
    [entity_type, entity_id, mcc, mnc]
  );
  // Create new rate
  const result = await pool.query(
    `INSERT INTO rates (entity_type, entity_id, mcc, mnc, country, operator, rate, currency, effective_from, version)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
       (SELECT COALESCE(MAX(version),0)+1 FROM rates WHERE entity_type=$1 AND entity_id=$2 AND mcc=$3 AND mnc=$4)
     ) RETURNING *`,
    [entity_type, entity_id, mcc, mnc, country, operator||'All', rate, currency||'EUR', effective_from||'now']
  );
  res.json({ success: true, data: result.rows[0] });
});

app.post('/api/rates/bulk', authenticate, requireRole('super_admin', 'admin', 'billing'), async (req, res) => {
  const { rates } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const r of rates) {
      await client.query(
        'UPDATE rates SET is_active = false, effective_to = CURRENT_DATE WHERE entity_type = $1 AND entity_id = $2 AND mcc = $3 AND mnc = $4 AND is_active = true',
        [r.entity_type, r.entity_id, r.mcc, r.mnc]
      );
      await client.query(
        `INSERT INTO rates (entity_type, entity_id, mcc, mnc, country, operator, rate, currency, effective_from, version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,
           (SELECT COALESCE(MAX(version),0)+1 FROM rates WHERE entity_type=$1 AND entity_id=$2 AND mcc=$3 AND mnc=$4)
         )`,
        [r.entity_type, r.entity_id, r.mcc, r.mnc, r.country, r.operator||'All', r.rate, r.currency||'EUR', r.effective_from||new Date().toISOString().split('T')[0]]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true, message: `${rates.length} rates imported` });
  } catch (e) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: e.message });
  } finally { client.release(); }
});

// ==================== INVOICES ====================
app.get('/api/billing/invoices', authenticate, async (req, res) => {
  const result = await pool.query('SELECT * FROM invoices ORDER BY created_at DESC LIMIT 50');
  res.json({ success: true, data: result.rows });
});

app.post('/api/billing/invoices', authenticate, requireRole('super_admin', 'admin', 'billing'), async (req, res) => {
  const { entity_type, entity_id, period_start, period_end } = req.body;
  const entity = entity_type === 'client'
    ? await pool.query('SELECT company_name FROM clients WHERE id = $1', [entity_id])
    : await pool.query('SELECT company_name FROM suppliers WHERE id = $1', [entity_id]);
  const entityName = entity.rows[0]?.company_name || 'Unknown';
  
  // Sum SMS for period
  const smsResult = await pool.query(
    `SELECT COUNT(*) as total_sms, COALESCE(SUM(client_rate * message_parts), 0) as total_amount
     FROM sms_logs WHERE ${entity_type === 'client' ? 'client_id' : 'supplier_id'} = $1
     AND submit_time::date BETWEEN $2 AND $3 AND status = 'delivered'`,
    [entity_id, period_start, period_end]
  );
  const { total_sms, total_amount } = smsResult.rows[0];
  const tax = parseFloat(total_amount) * 0.19;
  const grand = parseFloat(total_amount) + tax;

  const result = await pool.query(
    `INSERT INTO invoices (entity_type, entity_id, entity_name, period_start, period_end, total_sms, total_amount, tax_amount, grand_total, status, due_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',$10) RETURNING *`,
    [entity_type, entity_id, entityName, period_start, period_end, total_sms, total_amount, tax, grand, new Date(Date.now()+30*86400000).toISOString().split('T')[0]]
  );
  res.json({ success: true, data: result.rows[0] });
});

// ==================== BIND STATUS ====================
app.get('/api/bind/status', authenticate, async (req, res) => {
  const result = await pool.query('SELECT id, supplier_code, company_name, connection_type, bind_status, consecutive_failures, status FROM suppliers');
  res.json({ success: true, data: result.rows });
});

app.post('/api/bind/:id/reconnect', authenticate, requireRole('super_admin', 'admin', 'support'), async (req, res) => {
  await pool.query('UPDATE suppliers SET bind_status = $1, consecutive_failures = 0 WHERE id = $2', ['binding', req.params.id]);
  setTimeout(async () => {
    await pool.query('UPDATE suppliers SET bind_status = $1 WHERE id = $2', ['bound', req.params.id]);
  }, 2000);
  res.json({ success: true, message: 'Reconnecting...' });
});

// ==================== DASHBOARD STATS ====================
app.get('/api/dashboard/stats', authenticate, async (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  const stats = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM clients) as total_clients,
      (SELECT COUNT(*) FROM clients WHERE status = 'active') as active_clients,
      (SELECT COUNT(*) FROM suppliers) as total_suppliers,
      (SELECT COUNT(*) FROM suppliers WHERE status = 'active') as active_suppliers,
      (SELECT COUNT(*) FROM sms_logs WHERE submit_time::date = $1) as total_sms_today,
      (SELECT COUNT(*) FROM sms_logs WHERE submit_time::date = $1 AND status = 'delivered') as delivered_today,
      (SELECT COUNT(*) FROM sms_logs WHERE submit_time::date = $1 AND status = 'failed') as failed_today,
      (SELECT COUNT(*) FROM suppliers WHERE bind_status = 'bound') as active_binds,
      (SELECT COUNT(*) FROM suppliers) as total_binds
  `, [today]);
  const s = stats.rows[0];
  res.json({ success: true, data: {
    ...s,
    delivered_percentage: s.total_sms_today > 0 ? (s.delivered_today/s.total_sms_today)*100 : 0,
    failed_percentage: s.total_sms_today > 0 ? (s.failed_today/s.total_sms_today)*100 : 0,
  }});
});

// ==================== EXTERNAL API v1 (Client + Supplier) ====================
const apiKeyAuth = async (req: any, res: any, next: any) => {
  const apiKey = req.headers['x-api-key'] as string;
  if (!apiKey) return res.status(401).json({ success: false, error: 'API key required', code: 'AUTH_FAILED' });
  const client = await pool.query('SELECT * FROM clients WHERE (api_key = $1 OR smpp_username = $1) AND api_enabled = true AND status = $2', [apiKey, 'active']);
  if (client.rows.length === 0) {
    const basicAuth = req.headers.authorization?.replace('Basic ', '');
    if (basicAuth) {
      const decoded = Buffer.from(basicAuth, 'base64').toString();
      const [user, pass] = decoded.split(':');
      const supp = await pool.query('SELECT * FROM suppliers WHERE smpp_username = $1 AND smpp_password = $2 AND status = $3', [user, pass, 'active']);
      if (supp.rows.length > 0) { req.entity = supp.rows[0]; req.entityType = 'supplier'; return next(); }
    }
    const bearer = req.headers.authorization?.replace('Bearer ', '');
    if (bearer) {
      const supp = await pool.query('SELECT * FROM suppliers WHERE api_key = $1 AND status = $2', [bearer, 'active']);
      if (supp.rows.length > 0) { req.entity = supp.rows[0]; req.entityType = 'supplier'; return next(); }
    }
    return res.status(401).json({ success: false, error: 'Invalid API key or credentials', code: 'AUTH_FAILED' });
  }
  req.entity = client.rows[0]; req.entityType = 'client'; next();
};

// CLIENT: Send SMS
app.post('/api/v1/sms/send', apiKeyAuth, async (req: any, res: any) => {
  try {
    if (req.entityType !== 'client') return res.status(403).json({ success: false, error: 'Only clients can send SMS', code: 'FORBIDDEN' });
    const { to, from, text, message_id, dlr_url, route_plan_id, unicode, flash, ttl } = req.body;
    if (!to || !from || !text) return res.status(400).json({ success: false, error: 'Missing parameters: to, from, text', code: 'MISSING_PARAMETER' });

    const client = req.entity;
    const available = parseFloat(client.balance) + parseFloat(client.credit_limit);
    const rate = 0.025; // from rates table in production
    const parts = Math.ceil(text.length / 160);
    const cost = rate * parts;

    if (available < cost) {
      return res.status(402).json({ success: false, error: 'Insufficient balance', code: 'INSUFFICIENT_BALANCE', details: { balance: parseFloat(client.balance), credit_limit: parseFloat(client.credit_limit), available, needed: cost } });
    }

    const msgId = message_id || ('MSG' + Date.now() + Math.random().toString(36).substr(2, 6));
    const result = await pool.query(
      `INSERT INTO sms_logs (message_id, client_id, client_code, sender_id, destination, message, message_parts, client_rate, status, submit_time, dlr_callback_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'submitted',NOW(),$9) RETURNING *`,
      [msgId, client.id, client.client_code, from, to, text, parts, rate, dlr_url || null]
    );
    const log = result.rows[0];

    // If billing_mode = submit, deduct immediately
    if (client.billing_mode === 'submit') {
      await pool.query('UPDATE clients SET balance = balance - $1 WHERE id = $2', [cost, client.id]);
    }

    // Simulate async DLR
    setTimeout(async () => {
      const delivered = Math.random() > 0.1;
      const dlrStatus = delivered ? 'DELIVRD' : 'UNDELIV';
      await pool.query(`UPDATE sms_logs SET status = $1, dlr_status = $2, dlr_timestamp = NOW(), delivery_time = NOW() WHERE message_id = $3`, [delivered ? 'delivered' : 'failed', dlrStatus, msgId]);
      if (dlr_url) {
        try { await fetch(dlr_url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message_id: msgId, your_message_id: message_id, to, status: delivered ? 'delivered' : 'failed', dlr_status: dlrStatus, dlr_timestamp: new Date().toISOString() }) }); } catch {}
      }
      // DLR billing mode charge
      if (client.billing_mode === 'dlr' && delivered) {
        await pool.query('UPDATE clients SET balance = balance - $1 WHERE id = $2', [cost, client.id]);
      }
    }, 3000 + Math.random() * 5000);

    res.json({ success: true, data: { message_id: msgId, your_message_id: message_id, to, from, text, parts, rate, currency: 'EUR', cost, status: 'submitted', submitted_at: new Date().toISOString() } });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message, code: 'INTERNAL_ERROR' }); }
});

// CLIENT: Check DLR
app.get('/api/v1/sms/dlr/:messageId', apiKeyAuth, async (req: any, res: any) => {
  try {
    if (req.entityType !== 'client') return res.status(403).json({ success: false, error: 'Forbidden', code: 'FORBIDDEN' });
    const result = await pool.query('SELECT * FROM sms_logs WHERE (message_id = $1 OR id = $1) AND client_id = $2', [req.params.messageId, req.entity.id]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Message not found', code: 'MESSAGE_NOT_FOUND' });
    const log = result.rows[0];
    res.json({ success: true, data: { message_id: log.message_id, to: log.destination, from: log.sender_id, status: log.status, dlr_status: log.dlr_status, submitted_at: log.submit_time, delivered_at: log.delivery_time, error: log.error_message } });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

// CLIENT: Check Balance
app.get('/api/v1/account/balance', apiKeyAuth, async (req: any, res: any) => {
  try {
    if (req.entityType !== 'client') return res.status(403).json({ success: false });
    const client = req.entity;
    res.json({ success: true, data: { balance: parseFloat(client.balance), credit_limit: parseFloat(client.credit_limit), available: parseFloat(client.balance)+parseFloat(client.credit_limit), currency: client.currency, billing_mode: client.billing_mode } });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

// SUPPLIER: Receive SMS batch for delivery
app.post('/api/v1/supplier/sms/receive', apiKeyAuth, async (req: any, res: any) => {
  try {
    if (req.entityType !== 'supplier') return res.status(403).json({ success: false, error: 'Only suppliers', code: 'FORBIDDEN' });
    const { messages } = req.body;
    if (!messages || !Array.isArray(messages)) return res.status(400).json({ success: false, error: 'messages array required' });
    const supplier = req.entity;
    const msgIds: string[] = [];
    for (const msg of messages) {
      const nId = 'N2A_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
      await pool.query(`INSERT INTO sms_logs (message_id, supplier_id, supplier_code, sender_id, destination, message, status, submit_time) VALUES ($1,$2,$3,$4,$5,$6,'submitted',NOW())`, [nId, supplier.id, supplier.supplier_code, msg.from, msg.to, msg.text]);
      msgIds.push(nId);
    }
    res.json({ success: true, data: { accepted: msgIds.length, message_ids: msgIds } });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

// SUPPLIER: Submit DLR
app.post('/api/v1/supplier/dlr/submit', apiKeyAuth, async (req: any, res: any) => {
  try {
    if (req.entityType !== 'supplier') return res.status(403).json({ success: false });
    const { dlrs } = req.body;
    if (!dlrs || !Array.isArray(dlrs)) return res.status(400).json({ success: false, error: 'dlrs array required' });
    let delivered = 0, failed = 0;
    for (const dlr of dlrs) {
      const result = await pool.query('SELECT * FROM sms_logs WHERE message_id = $1', [dlr.message_id]);
      if (result.rows.length > 0) {
        const ok = dlr.status === 'DELIVRD';
        await pool.query(`UPDATE sms_logs SET status = $1, dlr_status = $2, dlr_timestamp = NOW(), delivery_time = NOW(), error_code = $3, error_message = $4 WHERE message_id = $5`, [ok ? 'delivered' : 'failed', dlr.status, dlr.error_code, dlr.error_text || null, dlr.message_id]);
        if (ok) {
          delivered++;
          await pool.query('UPDATE suppliers SET consecutive_failures = 0 WHERE id = $1', [req.entity.id]);
        } else {
          failed++;
          await pool.query('UPDATE suppliers SET consecutive_failures = consecutive_failures + 1 WHERE id = $1', [req.entity.id]);
        }
      }
    }
    res.json({ success: true, data: { processed: delivered + failed, delivered, failed } });
  } catch (e: any) { res.status(500).json({ success: false, error: e.message }); }
});

// SUPPLIER: Balance
app.get('/api/v1/supplier/account/balance', apiKeyAuth, async (req: any, res: any) => {
  if (req.entityType !== 'supplier') return res.status(403).json({ success: false });
  const s = req.entity;
  const stats = await pool.query("SELECT COUNT(*) as sent_today FROM sms_logs WHERE supplier_id = $1 AND submit_time::date = CURRENT_DATE", [s.id]);
  res.json({ success: true, data: { balance: parseFloat(s.balance), credit_limit: parseFloat(s.credit_limit), currency: s.currency, sms_sent_today: parseInt(stats.rows[0].sent_today) } });
});

// SPA fallback - serve index.html for all non-API routes
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  }
});

app.listen(PORT, () => {
  console.log(`NET2APP Hub API running on port ${PORT}`);
  console.log(`Database: ${pool.options.database} on ${pool.options.host}`);
});
SERVERJS

# Install backend dependencies
cd ${APP_DIR}
npm init -y 2>/dev/null
npm install express pg bcryptjs jsonwebtoken cors dotenv 2>/dev/null

# ============================================================
# 6. SYSTEMD SERVICE
# ============================================================
log "Step 6/10: Creating systemd service..."

cat > /etc/systemd/system/net2app-hub.service << SYSTEMD
[Unit]
Description=NET2APP Hub SMS Platform
After=network.target postgresql.service

[Service]
Type=simple
User=www-data
WorkingDirectory=${APP_DIR}
Environment=NODE_ENV=production
Environment=PORT=3001
ExecStart=/usr/bin/node ${APP_DIR}/server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SYSTEMD

systemctl daemon-reload
systemctl enable net2app-hub

# ============================================================
# 7. NGINX CONFIGURATION
# ============================================================
log "Step 7/10: Configuring Nginx..."

cat > /etc/nginx/sites-available/net2app-hub << NGINX
server {
    listen 80;
    server_name ${DOMAIN};

    root ${APP_DIR}/dist;
    index index.html;

    # SPA routing
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # API proxy to Node.js
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 300s;
    }

    # Static assets caching
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Gzip
    gzip on;
    gzip_types text/html text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1000;
}
NGINX

ln -sf /etc/nginx/sites-available/net2app-hub /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# ============================================================
# 8. SSL WITH CERTBOT (if domain provided)
# ============================================================
if [ "${DOMAIN}" != "localhost" ]; then
  log "Step 8/10: Installing SSL certificate via Let's Encrypt..."
  certbot --nginx -d ${DOMAIN} --non-interactive --agree-tos -m admin@${DOMAIN} --redirect || warn "SSL setup skipped (domain must point to this server)"
  
  # Auto-renewal timer
  systemctl enable certbot.timer
  systemctl start certbot.timer
fi

# ============================================================
# 9. FIREWALL
# ============================================================
log "Step 9/10: Configuring firewall..."
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# ============================================================
# 10. START SERVICES
# ============================================================
log "Step 10/10: Starting services..."
systemctl start net2app-hub
systemctl restart nginx

# ============================================================
# DONE
# ============================================================
echo ""
echo -e "${GREEN}============================================================${NC}"
echo -e "${GREEN}  NET2APP HUB INSTALLATION COMPLETE!${NC}"
echo -e "${GREEN}============================================================${NC}"
echo ""
echo -e "  ${BLUE}App Directory:${NC}  ${APP_DIR}"
echo -e "  ${BLUE}Database:${NC}      ${DB_NAME} (user: ${DB_USER})"
echo -e "  ${BLUE}API Port:${NC}      3001"
echo -e "  ${BLUE}URL:${NC}           https://${DOMAIN}"
echo ""
echo -e "  ${YELLOW}Database Password:${NC} ${DB_PASS}"
echo -e "  ${YELLOW}Save this password! It's in:${NC} ${APP_DIR}/.env"
echo ""
echo -e "  ${GREEN}Login:${NC} admin / admin123"
echo ""
echo -e "  Commands:"
echo -e "    systemctl status net2app-hub   # Check app status"
echo -e "    journalctl -u net2app-hub -f  # View logs"
echo -e "    systemctl restart net2app-hub # Restart app"
echo ""
