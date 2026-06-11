const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'net2app-hub-secret-key-2024';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'net2app_hub',
  user: process.env.DB_USER || 'net2app_user',
  password: process.env.DB_PASS || 'Ariya@2024Net2App',
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'dist')));

const auth = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try { 
    req.user = jwt.verify(token, JWT_SECRET); 
    next(); 
  } catch(err) { 
    res.status(401).json({ error: 'Invalid token' }); 
  }
};

// Health check
app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'healthy', timestamp: new Date().toISOString() });
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const r = await pool.query('SELECT * FROM users WHERE username=$1 AND is_active=true', [username]);
    if (!r.rows.length) return res.status(401).json({ error: 'Invalid credentials' });
    const user = r.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
    const { password_hash, ...safe } = user;
    res.json({ success: true, token, user: safe });
  } catch (e) { 
    res.status(500).json({ error: e.message }); 
  }
});

// ===================== CLIENTS =====================
app.get('/api/clients', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM clients ORDER BY created_at DESC');
    res.json({ success: true, data: result.rows });
  } catch (e) { 
    res.status(500).json({ error: e.message }); 
  }
});

app.post('/api/clients', auth, async (req, res) => {
  try {
    const { client_code, company_name, contact_person, email, phone, address, country, smpp_username, smpp_password, status } = req.body;
    const result = await pool.query(
      `INSERT INTO clients (client_code, company_name, contact_person, email, phone, address, country, smpp_username, smpp_password, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()) RETURNING *`,
      [client_code, company_name, contact_person, email, phone, address, country, smpp_username, smpp_password, status || 'active']
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (e) { 
    res.status(500).json({ error: e.message }); 
  }
});

app.put('/api/clients/:id', auth, async (req, res) => {
  try {
    const { client_code, company_name, contact_person, email, phone, address, country, smpp_username, smpp_password, status, routing_plan_id, balance, credit_limit } = req.body;
    const result = await pool.query(
      `UPDATE clients SET client_code = COALESCE($1, client_code), company_name = COALESCE($2, company_name), contact_person = COALESCE($3, contact_person), email = COALESCE($4, email), phone = COALESCE($5, phone), address = COALESCE($6, address), country = COALESCE($7, country), smpp_username = COALESCE($8, smpp_username), smpp_password = COALESCE($9, smpp_password), status = COALESCE($10, status), routing_plan_id = COALESCE($11, routing_plan_id), balance = COALESCE($12, balance), credit_limit = COALESCE($13, credit_limit), updated_at = NOW() WHERE id = $14 RETURNING *`,
      [client_code, company_name, contact_person, email, phone, address, country, smpp_username, smpp_password, status, routing_plan_id, balance, credit_limit, req.params.id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (e) { 
    res.status(500).json({ error: e.message }); 
  }
});

// ===================== SUPPLIERS =====================
app.get('/api/suppliers', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM suppliers ORDER BY created_at DESC');
    res.json({ success: true, data: result.rows });
  } catch (e) { 
    res.status(500).json({ error: e.message }); 
  }
});

app.post('/api/suppliers', auth, async (req, res) => {
  try {
    const { supplier_code, company_name, contact_person, email, phone, connection_type, smpp_host, smpp_port, smpp_username, smpp_password, status } = req.body;
    const result = await pool.query(
      `INSERT INTO suppliers (supplier_code, company_name, contact_person, email, phone, connection_type, smpp_host, smpp_port, smpp_username, smpp_password, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW()) RETURNING *`,
      [supplier_code, company_name, contact_person, email, phone, connection_type, smpp_host, smpp_port, smpp_username, smpp_password, status || 'active']
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (e) { 
    res.status(500).json({ error: e.message }); 
  }
});

app.put('/api/suppliers/:id', auth, async (req, res) => {
  try {
    const { supplier_code, company_name, contact_person, email, phone, connection_type, smpp_host, smpp_port, smpp_username, smpp_password, status } = req.body;
    const result = await pool.query(
      `UPDATE suppliers SET supplier_code = COALESCE($1, supplier_code), company_name = COALESCE($2, company_name), contact_person = COALESCE($3, contact_person), email = COALESCE($4, email), phone = COALESCE($5, phone), connection_type = COALESCE($6, connection_type), smpp_host = COALESCE($7, smpp_host), smpp_port = COALESCE($8, smpp_port), smpp_username = COALESCE($9, smpp_username), smpp_password = COALESCE($10, smpp_password), status = COALESCE($11, status), updated_at = NOW() WHERE id = $12 RETURNING *`,
      [supplier_code, company_name, contact_person, email, phone, connection_type, smpp_host, smpp_port, smpp_username, smpp_password, status, req.params.id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (e) { 
    res.status(500).json({ error: e.message }); 
  }
});

// ===================== ROUTE PLANS =====================
app.get('/api/route-plans', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM route_plans ORDER BY id');
    res.json({ success: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/route-plans', auth, async (req, res) => {
  try {
    const { plan_name, route_ids, is_default } = req.body;
    const result = await pool.query(
      `INSERT INTO route_plans (plan_name, route_ids, is_default, created_at) VALUES ($1, $2, $3, NOW()) RETURNING *`,
      [plan_name, route_ids || [], is_default || false]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/route-plans/:id', auth, async (req, res) => {
  try {
    const { plan_name, route_ids, is_default } = req.body;
    const result = await pool.query(
      `UPDATE route_plans SET plan_name = COALESCE($1, plan_name), route_ids = COALESCE($2, route_ids), is_default = COALESCE($3, is_default), updated_at = NOW() WHERE id = $4 RETURNING *`,
      [plan_name, route_ids, is_default, req.params.id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/route-plans/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM route_plans WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===================== ROUTES =====================
app.get('/api/routes', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM routes ORDER BY id');
    res.json({ success: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/routes', auth, async (req, res) => {
  try {
    const { route_name, trunk_ids, route_method, is_active } = req.body;
    const result = await pool.query(
      `INSERT INTO routes (route_name, trunk_ids, route_method, is_active, created_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING *`,
      [route_name, trunk_ids || [], route_method || 'priority', is_active !== false]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/routes/:id', auth, async (req, res) => {
  try {
    const { route_name, trunk_ids, route_method, is_active } = req.body;
    const result = await pool.query(
      `UPDATE routes SET route_name = COALESCE($1, route_name), trunk_ids = COALESCE($2, trunk_ids), route_method = COALESCE($3, route_method), is_active = COALESCE($4, is_active), updated_at = NOW() WHERE id = $5 RETURNING *`,
      [route_name, trunk_ids, route_method, is_active, req.params.id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/routes/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM routes WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===================== TRUNKS =====================
app.get('/api/trunks', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM trunks ORDER BY id');
    res.json({ success: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/trunks', auth, async (req, res) => {
  try {
    const { trunk_name, trunk_type, supplier_id, priority, percentage, is_active, mccmnc_allowed } = req.body;
    const result = await pool.query(
      `INSERT INTO trunks (trunk_name, trunk_type, supplier_id, priority, percentage, is_active, mccmnc_allowed, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING *`,
      [trunk_name, trunk_type, supplier_id, priority || 1, percentage || 100, is_active !== false, mccmnc_allowed || ['*']]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/trunks/:id', auth, async (req, res) => {
  try {
    const { trunk_name, trunk_type, supplier_id, priority, percentage, is_active, mccmnc_allowed } = req.body;
    const result = await pool.query(
      `UPDATE trunks SET trunk_name = COALESCE($1, trunk_name), trunk_type = COALESCE($2, trunk_type), supplier_id = COALESCE($3, supplier_id), priority = COALESCE($4, priority), percentage = COALESCE($5, percentage), is_active = COALESCE($6, is_active), mccmnc_allowed = COALESCE($7, mccmnc_allowed), updated_at = NOW() WHERE id = $8 RETURNING *`,
      [trunk_name, trunk_type, supplier_id, priority, percentage, is_active, mccmnc_allowed, req.params.id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/trunks/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM trunks WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===================== ROUTE MAPS =====================
app.get('/api/route-maps', auth, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT rm.*, c.client_code, r.route_name, s.supplier_code 
      FROM route_maps rm
      LEFT JOIN clients c ON rm.client_id = c.id
      LEFT JOIN routes r ON rm.route_id = r.id
      LEFT JOIN suppliers s ON rm.supplier_id = s.id
      ORDER BY rm.id
    `);
    res.json({ success: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/route-maps', auth, async (req, res) => {
  try {
    const { client_id, route_id, supplier_id, mccmnc_pattern, priority, percentage, is_active } = req.body;
    const result = await pool.query(
      `INSERT INTO route_maps (client_id, route_id, supplier_id, mccmnc_pattern, priority, percentage, is_active, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING *`,
      [client_id, route_id, supplier_id, mccmnc_pattern || '*', priority || 1, percentage || 100, is_active !== false]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/route-maps/:id', auth, async (req, res) => {
  try {
    const { client_id, route_id, supplier_id, mccmnc_pattern, priority, percentage, is_active } = req.body;
    const result = await pool.query(
      `UPDATE route_maps SET client_id = COALESCE($1, client_id), route_id = COALESCE($2, route_id), supplier_id = COALESCE($3, supplier_id), mccmnc_pattern = COALESCE($4, mccmnc_pattern), priority = COALESCE($5, priority), percentage = COALESCE($6, percentage), is_active = COALESCE($7, is_active), updated_at = NOW() WHERE id = $8 RETURNING *`,
      [client_id, route_id, supplier_id, mccmnc_pattern, priority, percentage, is_active, req.params.id]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/route-maps/:id', auth, async (req, res) => {
  try {
    await pool.query('DELETE FROM route_maps WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===================== SMS =====================
app.post('/api/sms/send', auth, async (req, res) => {
  try {
    const { client_id, destination, sender_id, message, force_dlr = false } = req.body;
    const messageId = `MSG_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    // Get client rate for Bangladesh (MCC 470)
    const clientRateResult = await pool.query(
      "SELECT rate FROM rates WHERE entity_type = 'client' AND entity_id = $1 AND mcc = '470' AND is_active = true",
      [client_id]
    );
    const supplierRateResult = await pool.query(
      "SELECT rate FROM rates WHERE entity_type = 'supplier' AND entity_id = $1 AND mcc = '470' AND is_active = true",
      [7]
    );
    
    const clientRate = clientRateResult.rows[0]?.rate || 0.05;
    const supplierRate = supplierRateResult.rows[0]?.rate || 0.002;
    const profit = parseFloat(clientRate) - parseFloat(supplierRate);
    
    const clientResult = await pool.query('SELECT client_code FROM clients WHERE id = $1', [client_id]);
    const clientCode = clientResult.rows[0]?.client_code || 'UNKNOWN';
    
    const result = await pool.query(
      `INSERT INTO sms_logs (message_id, client_id, client_code, sender_id, destination, message, client_rate, supplier_rate, profit, status, submit_time, force_dlr)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', NOW(), $10) RETURNING *`,
      [messageId, client_id, clientCode, sender_id, destination, message, clientRate, supplierRate, profit, force_dlr]
    );
    
    res.json({ success: true, data: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/sms/logs', auth, async (req, res) => {
  try {
    const { limit = 100 } = req.body;
    const result = await pool.query('SELECT * FROM sms_logs ORDER BY submit_time DESC LIMIT $1', [limit]);
    res.json({ success: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===================== VOICE OTP =====================
app.post('/api/voice-otp/send', auth, async (req, res) => {
  try {
    const { destination, otp_code } = req.body;
    const finalOtp = otp_code || Math.floor(100000 + Math.random() * 900000).toString();
    const callId = `VOICE_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    
    const result = await pool.query(
      `INSERT INTO voice_otp_logs (call_id, destination, otp_code, codec, status, created_at) 
       VALUES ($1, $2, $3, 'G.729', 'initiated', NOW()) RETURNING *`,
      [callId, destination, finalOtp]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/voice-otp/logs', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM voice_otp_logs ORDER BY created_at DESC LIMIT 100');
    res.json({ success: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===================== BIND STATUS =====================
app.get('/api/bind/status', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT supplier_code, bind_status FROM suppliers');
    res.json({ success: true, data: result.rows });
  } catch (e) { 
    res.status(500).json({ error: e.message }); 
  }
});

// ===================== API CONNECTORS =====================
app.get('/api/api-connectors', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM api_connectors ORDER BY id');
    res.json({ success: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===================== RATES =====================
app.get('/api/rates', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM rates WHERE is_active = true ORDER BY entity_type, country');
    res.json({ success: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/rates', auth, async (req, res) => {
  try {
    const { entity_type, entity_id, mcc, mnc, country, operator, rate, currency, effective_from } = req.body;
    const result = await pool.query(
      `INSERT INTO rates (entity_type, entity_id, mcc, mnc, country, operator, rate, currency, effective_from, is_active, version, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, 1, NOW()) RETURNING *`,
      [entity_type, entity_id, mcc, mnc, country, operator, rate, currency, effective_from || new Date().toISOString().split('T')[0]]
    );
    res.json({ success: true, data: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===================== DASHBOARD STATS =====================
app.get('/api/dashboard/stats', auth, async (req, res) => {
  try {
    const clientCount = await pool.query("SELECT COUNT(*) as total FROM clients WHERE status = 'active'");
    const supplierCount = await pool.query("SELECT COUNT(*) as total FROM suppliers WHERE status = 'active'");
    const smsCount = await pool.query("SELECT COUNT(*) as total FROM sms_logs");
    res.json({ 
      success: true, 
      data: {
        total_clients: parseInt(clientCount.rows[0].total || 0),
        total_suppliers: parseInt(supplierCount.rows[0].total || 0),
        total_sms: parseInt(smsCount.rows[0].total || 0)
      }
    });
  } catch (e) { 
    res.status(500).json({ error: e.message }); 
  }
});

// ===================== SMS SHEBA DIRECT =====================
app.post('/api/sms-sheba/send', auth, async (req, res) => {
  try {
    const { client_id, destination, message, sender_id = '8809606776010' } = req.body;
    
    let msisdn = destination.replace(/[^0-9]/g, '');
    if (msisdn.startsWith('880')) {
      msisdn = msisdn.substring(3);
    }
    
    const apiUrl = `https://api.smssheba.com/smsapiv3?apikey=17a0c9ff557a81eccafefb624443573c&sender=${sender_id}&msisdn=${msisdn}&smstext=${encodeURIComponent(message)}`;
    
    const messageId = `SMS_SHEBA_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    
    const clientResult = await pool.query('SELECT client_code FROM clients WHERE id = $1', [client_id]);
    const clientCode = clientResult.rows[0]?.client_code || 'UNKNOWN';
    
    await pool.query(
      `INSERT INTO sms_logs (message_id, client_id, client_code, sender_id, destination, message, status, submit_time)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW())`,
      [messageId, client_id, clientCode, sender_id, destination, message]
    );
    
    const response = await axios.get(apiUrl, { timeout: 30000 });
    
    let apiResponse;
    if (response.data.response && response.data.response[0]) {
      apiResponse = response.data.response[0];
    } else {
      apiResponse = response.data;
    }
    
    if (apiResponse.status === 0) {
      await pool.query(
        `UPDATE sms_logs SET status = 'delivered', dlr_status = 'DELIVRD', delivery_time = NOW(), supplier_response = $1, smpp_message_id = $2 WHERE message_id = $3`,
        [JSON.stringify(apiResponse), apiResponse.id, messageId]
      );
      res.json({ success: true, message: 'SMS delivered', message_id: apiResponse.id });
    } else {
      await pool.query(
        `UPDATE sms_logs SET status = 'failed', error_message = $1 WHERE message_id = $2`,
        [`API status: ${apiResponse.status}`, messageId]
      );
      res.json({ success: false, error: 'SMS failed' });
    }
  } catch (e) {
    console.error('SMS Sheba error:', e);
    res.status(500).json({ error: e.message });
  }
});

// ===================== CATCH-ALL =====================
app.use((req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ NET2APP Hub running on port ${PORT}`);
  console.log(`📊 Database: ${pool.options.database}`);
  console.log(`🌐 Web UI: http://146.59.47.22:${PORT}`);
});
