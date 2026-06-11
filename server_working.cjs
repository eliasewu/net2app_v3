#!/usr/bin/env node
// NET2APP Hub - Production Server
// All data PostgreSQL | External REST API for clients

const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'net2app-hub-' + Date.now();
const API_URL = process.env.API_URL || '';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'net2app_hub',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASS || '',
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'dist')));

// ===================== AUTH MIDDLEWARE =====================
const auth = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
};

// ===================== INTERNAL AUTH =====================
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const r = await pool.query('SELECT * FROM users WHERE username=$1 AND is_active=true', [username]);
    if (!r.rows.length) return res.status(401).json({ error: 'Invalid credentials' });
    const user = r.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    await pool.query('UPDATE users SET last_login=NOW() WHERE id=$1', [user.id]);
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
    const { password_hash, ...safe } = user;
    res.json({ success: true, token, user: safe });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ===================== CLIENTS API (admin) =====================
app.get('/api/clients', auth, async (req, res) => {
  const r = await pool.query('SELECT * FROM clients ORDER BY created_at DESC');
  res.json({ success: true, data: r.rows });
});
app.post('/api/clients', auth, async (req, res) => {
  const { client_code, company_name, email, smpp_username, smpp_password, billing_mode, currency, balance, credit_limit } = req.body;
  const r = await pool.query(`INSERT INTO clients (client_code,company_name,email,smpp_username,smpp_password,billing_mode,currency,balance,credit_limit) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [client_code,company_name,email,smpp_username,smpp_password,billing_mode||'dlr',currency||'EUR',balance||0,credit_limit||0]);
  res.json({ success: true, data: r.rows[0] });
});
app.put('/api/clients/:id', auth, async (req, res) => {
  const id = req.params.id;
  const keys = Object.keys(req.body).filter(k => req.body[k] !== undefined);
  if (keys.length === 0) return res.json({ success: true });
  const sets = keys.map((k, i) => `${k}=$${i+1}`).join(',');
  const vals = keys.map(k => req.body[k]);
  await pool.query(`UPDATE clients SET ${sets}, updated_at=NOW() WHERE id=$${keys.length+1}`, [...vals, id]);
  res.json({ success: true });
});
app.delete('/api/clients/:id', auth, async (req, res) => {
  await pool.query('DELETE FROM clients WHERE id=$1', [req.params.id]);
  res.json({ success: true });
});

// ===================== SUPPLIERS API =====================
app.get('/api/suppliers', auth, async (req, res) => {
  const r = await pool.query('SELECT * FROM suppliers ORDER BY created_at DESC');
  res.json({ success: true, data: r.rows });
});
app.put('/api/suppliers/:id', auth, async (req, res) => {
  const id = req.params.id;
  const keys = Object.keys(req.body).filter(k => req.body[k] !== undefined);
  if (keys.length === 0) return res.json({ success: true });
  const sets = keys.map((k, i) => `${k}=$${i+1}`).join(',');
  const vals = keys.map(k => req.body[k]);
  await pool.query(`UPDATE suppliers SET ${sets}, updated_at=NOW() WHERE id=$${keys.length+1}`, [...vals, id]);
  res.json({ success: true });
});

// ===================== BIND STATUS =====================
app.get('/api/bind/status', auth, async (req, res) => {
  const r = await pool.query('SELECT id,supplier_code,company_name,connection_type,bind_status,consecutive_failures,status FROM suppliers');
  res.json({ success: true, data: r.rows });
});

// ===================== RATES =====================
app.get('/api/rates', auth, async (req, res) => {
  const { entity_type, entity_id } = req.query;
  let q = 'SELECT * FROM rates WHERE 1=1'; const p = []; let i = 1;
  if (entity_type) { q += ` AND entity_type=$${i++}`; p.push(entity_type); }
  if (entity_id) { q += ` AND entity_id=$${i++}`; p.push(entity_id); }
  q += ' ORDER BY country, mcc, mnc';
  const r = await pool.query(q, p);
  res.json({ success: true, data: r.rows });
});
app.post('/api/rates', auth, async (req, res) => {
  const { entity_type, entity_id, mcc, mnc, country, operator, rate } = req.body;
  await pool.query("UPDATE rates SET is_active=false, effective_to=CURRENT_DATE WHERE entity_type=$1 AND entity_id=$2 AND mcc=$3 AND mnc=$4 AND is_active=true", [entity_type, entity_id, mcc, mnc]);
  const r = await pool.query(`INSERT INTO rates (entity_type,entity_id,mcc,mnc,country,operator,rate,effective_from,version) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,(SELECT COALESCE(MAX(version),0)+1 FROM rates WHERE entity_type=$1 AND entity_id=$2 AND mcc=$3 AND mnc=$4)) RETURNING *`, [entity_type,entity_id,mcc,mnc,country,operator||'All',rate,req.body.effective_from||new Date().toISOString().split('T')[0]]);
  res.json({ success: true, data: r.rows[0] });
});

// ===================== SMS SEND (internal) =====================
app.post('/api/sms/send', auth, async (req, res) => {
  try {
    const { client_id, destination, sender_id, message } = req.body;
    const client = await pool.query('SELECT * FROM clients WHERE id=$1 AND status=$2', [client_id, 'active']);
    if (!client.rows.length) return res.status(400).json({ error: 'Client not found' });
    const c = client.rows[0];
    const rateR = await pool.query("SELECT * FROM rates WHERE entity_type='client' AND entity_id=$1 AND is_active=true LIMIT 1", [client_id]);
    const clientRate = rateR.rows[0]?.rate || 0.025;
    const supRate = await pool.query("SELECT * FROM rates WHERE entity_type='supplier' AND is_active=true LIMIT 1");
    const supplierRate = supRate.rows[0]?.rate || 0.015;
    const parts = Math.ceil((message||'').length / 160);
    const profit = clientRate - supplierRate;
    if (profit <= 0) return res.status(400).json({ error: `ROUTE BLOCKED: No profit. Client €${clientRate.toFixed(4)} ≤ Supplier €${supplierRate.toFixed(4)}` });
    const available = parseFloat(c.balance) + parseFloat(c.credit_limit);
    const cost = clientRate * parts;
    if (available < cost) return res.status(402).json({ error: `Insufficient balance. Available: €${available.toFixed(2)}, Need: €${cost.toFixed(4)}` });
    const msgId = 'MSG' + Date.now();
    const ir = await pool.query(`INSERT INTO sms_logs (message_id,client_id,client_code,sender_id,destination,message,message_parts,client_rate,supplier_rate,profit,status,submit_time) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'submitted',NOW()) RETURNING *`, [msgId, client_id, c.client_code, sender_id, destination, message, parts, clientRate, supplierRate, profit]);
    if (c.billing_mode === 'submit') { await pool.query('UPDATE clients SET balance=balance-$1 WHERE id=$2', [cost, client_id]); }
    setTimeout(async () => {
      const delivered = Math.random() > 0.1;
      await pool.query(`UPDATE sms_logs SET status=$1,dlr_status=$2,dlr_timestamp=NOW(),delivery_time=NOW() WHERE message_id=$3`, [delivered?'delivered':'failed', delivered?'DELIVRD':'UNDELIV', msgId]);
      if (c.billing_mode === 'dlr' && delivered) { await pool.query('UPDATE clients SET balance=balance-$1 WHERE id=$2', [cost, client_id]); }
    }, 3000 + Math.random() * 5000);
    res.json({ success: true, data: { ...ir.rows[0], profit, billing_mode: c.billing_mode } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/sms/logs', auth, async (req, res) => {
  const { client_id, status, limit, offset } = req.body;
  let q = 'SELECT * FROM sms_logs WHERE 1=1'; const p = []; let i = 1;
  if (client_id) { q += ` AND client_id=$${i++}`; p.push(client_id); }
  if (status) { q += ` AND status=$${i++}`; p.push(status); }
  q += ' ORDER BY submit_time DESC LIMIT $' + (++i) + ' OFFSET $' + (++i);
  p.push(limit||100, offset||0);
  const r = await pool.query(q, p);
  res.json({ success: true, data: r.rows });
});

// ===================== DASHBOARD =====================
app.get('/api/dashboard/stats', auth, async (req, res) => {
  const r = await pool.query(`SELECT (SELECT COUNT(*) FROM clients) as tc, (SELECT COUNT(*) FROM clients WHERE status='active') as ac, (SELECT COUNT(*) FROM suppliers) as ts, (SELECT COUNT(*) FROM suppliers WHERE status='active') as asu, (SELECT COUNT(*) FROM sms_logs WHERE submit_time::date=CURRENT_DATE) as sms_t, (SELECT COUNT(*) FROM sms_logs WHERE submit_time::date=CURRENT_DATE AND status='delivered') as del_t, (SELECT COUNT(*) FROM suppliers WHERE bind_status='bound') as ab, (SELECT COUNT(*) FROM suppliers) as tb`);
  res.json({ success: true, data: r.rows[0] });
});

// ===================== GENERIC CRUD (all tables) =====================
const tables = ['mccmnc','trunks','routes','route_plans','route_maps','payments','invoices','campaigns','translations','notifications','notification_templates','ott_devices','api_connectors','voice_otp_configs','voice_otp_logs','platform_settings','smtp_config'];
tables.forEach(table => {
  app.get(`/api/${table}`, auth, async (req, res) => {
    try { const r = await pool.query(`SELECT * FROM ${table} ORDER BY id DESC LIMIT 500`); res.json({ success: true, data: r.rows }); }
    catch (e) { res.status(500).json({ error: e.message }); }
  });
  app.post(`/api/${table}`, auth, async (req, res) => {
    try {
      const keys = Object.keys(req.body).filter(k => req.body[k] !== undefined);
      const vals = keys.map(k => req.body[k]);
      const ph = keys.map((_, i) => '$' + (i + 1)).join(',');
      const r = await pool.query(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${ph}) RETURNING *`, vals);
      res.json({ success: true, data: r.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
});

// ============================================================
// EXTERNAL REST API v1 — Client & Supplier Authentication
// Clients authenticate with smpp_username + smpp_password
// Requires api_enabled = true on client record
// ============================================================

app.post('/api/v1/sms/send', async (req, res) => {
  try {
    const { username, password, to, from, text, message_id, dlr_url } = req.body;
    if (!username || !password) return res.status(401).json({ success: false, error: 'Authentication required. Send username + password in request body.', code: 'AUTH_FAILED' });
    if (!to || !from || !text) return res.status(400).json({ success: false, error: 'Missing required fields: to, from, text', code: 'MISSING_PARAMETER' });

    // Authenticate using client's smpp_username + smpp_password (or api_key)
    const client = await pool.query(
      'SELECT * FROM clients WHERE (smpp_username=$1 OR api_key=$1) AND status=$2', [username, 'active']
    );
    if (!client.rows.length) return res.status(401).json({ success: false, error: 'Invalid credentials or account inactive', code: 'AUTH_FAILED' });
    const c = client.rows[0];

    // Check HTTP API enabled
    if (!c.api_enabled) return res.status(403).json({ success: false, error: 'HTTP API not enabled for this account. Enable in client settings.', code: 'FEATURE_DISABLED' });

    // Verify password if smpp_username used
    if (c.smpp_username === username && c.smpp_password !== password) return res.status(401).json({ success: false, error: 'Invalid password', code: 'AUTH_FAILED' });

    // Rate + Profit check
    const rateR = await pool.query("SELECT * FROM rates WHERE entity_type='client' AND entity_id=$1 AND is_active=true LIMIT 1", [c.id]);
    const clientRate = rateR.rows[0]?.rate || 0.025;
    const supRate = await pool.query("SELECT * FROM rates WHERE entity_type='supplier' AND is_active=true LIMIT 1");
    const supplierRate = supRate.rows[0]?.rate || 0.015;
    const parts = Math.ceil(text.length / 160);
    const profit = clientRate - supplierRate;
    if (profit <= 0) return res.status(400).json({ success: false, error: `ROUTE BLOCKED: No profit margin`, code: 'ROUTE_BLOCKED' });

    // Balance + Credit check
    const available = parseFloat(c.balance) + parseFloat(c.credit_limit);
    const cost = clientRate * parts;
    if (available < cost) return res.status(402).json({ success: false, error: 'Insufficient balance', code: 'INSUFFICIENT_BALANCE', details: { balance: parseFloat(c.balance), credit_limit: parseFloat(c.credit_limit), available, needed: cost } });

    // Insert SMS log
    const msgId = message_id || ('MSG' + Date.now() + Math.random().toString(36).substr(2, 6));
    const ir = await pool.query(
      `INSERT INTO sms_logs (message_id,client_id,client_code,sender_id,destination,message,message_parts,client_rate,supplier_rate,profit,status,submit_time,dlr_callback_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'submitted',NOW(),$11) RETURNING *`,
      [msgId, c.id, c.client_code, from, to, text, parts, clientRate, supplierRate, profit, dlr_url||null]
    );
    const log = ir.rows[0];

    // Billing: Submit mode = charge immediately
    if (c.billing_mode === 'submit') { await pool.query('UPDATE clients SET balance=balance-$1 WHERE id=$2', [cost, c.id]); }

    // DLR simulation (real SMPP DLR in production)
    setTimeout(async () => {
      const delivered = Math.random() > 0.1;
      const dlrStatus = delivered ? 'DELIVRD' : 'UNDELIV';
      await pool.query(`UPDATE sms_logs SET status=$1,dlr_status=$2,dlr_timestamp=NOW(),delivery_time=NOW() WHERE message_id=$3`, [delivered?'delivered':'failed', dlrStatus, msgId]);
      // Billing: DLR mode = charge only on delivery
      if (c.billing_mode === 'dlr' && delivered) { await pool.query('UPDATE clients SET balance=balance-$1 WHERE id=$2', [cost, c.id]); }
      // DLR Callback if URL provided
      if (dlr_url) {
        try { await fetch(dlr_url, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ message_id:msgId, your_message_id:message_id, to, status:delivered?'delivered':'failed', dlr_status:dlrStatus, dlr_timestamp:new Date().toISOString() }) }); } catch {}
      }
    }, 3000 + Math.random() * 5000);

    res.json({ success: true, data: { message_id: msgId, your_message_id: message_id, to, from, text, parts, rate: clientRate, currency: 'EUR', cost, profit, status: 'submitted', submitted_at: new Date().toISOString() } });
  } catch (e) { res.status(500).json({ success: false, error: e.message, code: 'INTERNAL_ERROR' }); }
});

// DLR Inquiry
app.get('/api/v1/sms/dlr/:messageId', async (req, res) => {
  try {
    const { username, password } = req.query;
    if (!username || !password) return res.status(401).json({ success: false, error: 'Authentication required. Pass username + password as query params.', code: 'AUTH_FAILED' });
    const client = await pool.query('SELECT * FROM clients WHERE (smpp_username=$1 OR api_key=$1) AND smpp_password=$2 AND status=$3', [username, password, 'active']);
    if (!client.rows.length) return res.status(401).json({ success: false, error: 'Invalid credentials or account inactive', code: 'AUTH_FAILED' });
    const result = await pool.query('SELECT * FROM sms_logs WHERE (message_id=$1 OR id=$1) AND client_id=$2', [req.params.messageId, client.rows[0].id]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, error: 'Message not found', code: 'MESSAGE_NOT_FOUND' });
    const log = result.rows[0];
    res.json({ success: true, data: { message_id: log.message_id, to: log.destination, from: log.sender_id, status: log.status, dlr_status: log.dlr_status, submitted_at: log.submit_time, delivered_at: log.delivery_time, error: log.error_message, rate: log.client_rate, cost: log.client_rate * log.message_parts, profit: log.profit } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Balance inquiry
app.get('/api/v1/account/balance', async (req, res) => {
  try {
    const { username, password } = req.query;
    if (!username || !password) return res.status(401).json({ success: false, error: 'Authentication required', code: 'AUTH_FAILED' });
    const client = await pool.query('SELECT * FROM clients WHERE (smpp_username=$1 OR api_key=$1) AND smpp_password=$2 AND status=$3', [username, password, 'active']);
    if (!client.rows.length) return res.status(401).json({ success: false, error: 'Invalid credentials', code: 'AUTH_FAILED' });
    const c = client.rows[0];
    res.json({ success: true, data: { balance: parseFloat(c.balance), credit_limit: parseFloat(c.credit_limit), available: parseFloat(c.balance)+parseFloat(c.credit_limit), currency: c.currency, billing_mode: c.billing_mode } });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// SPA fallback
app.get('*', (req, res) => { if (!req.path.startsWith('/api')) res.sendFile(path.join(__dirname, 'dist', 'index.html')); });

app.listen(PORT, () => {
  console.log(`✅ NET2APP Hub running on port ${PORT}`);
  console.log(`📊 Database: ${pool.options.database} on ${pool.options.host}`);
  console.log(`🔗 External API: http://YOUR_IP:${PORT}/api/v1/sms/send`);
});
