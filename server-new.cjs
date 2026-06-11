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

// Clients
app.get('/api/clients', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM clients ORDER BY created_at DESC');
    res.json({ success: true, data: result.rows });
  } catch (e) { 
    res.status(500).json({ error: e.message }); 
  }
});

// Suppliers
app.get('/api/suppliers', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM suppliers ORDER BY created_at DESC');
    res.json({ success: true, data: result.rows });
  } catch (e) { 
    res.status(500).json({ error: e.message }); 
  }
});

// Bind status
app.get('/api/bind/status', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT supplier_code, bind_status FROM suppliers');
    res.json({ success: true, data: result.rows });
  } catch (e) { 
    res.status(500).json({ error: e.message }); 
  }
});

// API Connectors
app.get('/api/api-connectors', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM api_connectors ORDER BY id');
    res.json({ success: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// SMS Send v2 with rates
app.post('/api/sms/send-v2', auth, async (req, res) => {
  try {
    const { client_id, destination, sender_id, message, force_dlr = false } = req.body;
    const messageId = `MSG_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    const clientRateResult = await pool.query(
      "SELECT rate FROM rates WHERE entity_type = 'client' AND entity_id = $1 AND mcc = '470' AND is_active = true",
      [client_id]
    );
    const supplierRateResult = await pool.query(
      "SELECT rate FROM rates WHERE entity_type = 'supplier' AND entity_id = $1 AND mcc = '470' AND is_active = true",
      [7]
    );
    
    const clientRate = clientRateResult.rows[0]?.rate || 0.05;
    const supplierRate = supplierRateResult.rows[0]?.rate || 0.0035;
    const profit = parseFloat(clientRate) - parseFloat(supplierRate);
    
    const clientResult = await pool.query('SELECT client_code FROM clients WHERE id = $1', [client_id]);
    const clientCode = clientResult.rows[0]?.client_code || 'UNKNOWN';
    
    const result = await pool.query(
      `INSERT INTO sms_logs 
       (message_id, client_id, client_code, sender_id, destination, message, client_rate, supplier_rate, profit, status, submit_time, force_dlr)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', NOW(), $10) 
       RETURNING *`,
      [messageId, client_id, clientCode, sender_id, destination, message, clientRate, supplierRate, profit, force_dlr]
    );
    
    res.json({ success: true, data: result.rows[0] });
  } catch (e) {
    console.error('SMS error:', e);
    res.status(500).json({ error: e.message });
  }
});

// SMS Logs
app.post('/api/sms/logs', auth, async (req, res) => {
  try {
    const { limit = 100 } = req.body;
    const result = await pool.query('SELECT * FROM sms_logs ORDER BY submit_time DESC LIMIT $1', [limit]);
    res.json({ success: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Voice OTP
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

// Dashboard stats
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

// Routes
app.get('/api/routes', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM routes ORDER BY id');
    res.json({ success: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Trunks
app.get('/api/trunks', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM trunks ORDER BY id');
    res.json({ success: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Route maps
app.get('/api/route_maps', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM route_maps ORDER BY id');
    res.json({ success: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Route plans
app.get('/api/route_plans', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM route_plans ORDER BY id');
    res.json({ success: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===================== SMS SHEBA DIRECT WITH DLR =====================
app.post('/api/sms-sheba/send', auth, async (req, res) => {
  try {
    const { client_id, destination, message, sender_id = '8809606776010' } = req.body;
    
    let msisdn = destination.replace(/[^0-9]/g, '');
    if (msisdn.startsWith('880')) {
      msisdn = msisdn.substring(3);
    }
    
    // Get rates
    const clientRateResult = await pool.query(
      "SELECT rate FROM rates WHERE entity_type = 'client' AND entity_id = $1 AND mcc = '470' AND is_active = true",
      [client_id]
    );
    const supplierRateResult = await pool.query(
      "SELECT rate FROM rates WHERE entity_type = 'supplier' AND entity_id = $1 AND mcc = '470' AND is_active = true",
      [7]
    );
    
    const clientRate = clientRateResult.rows[0]?.rate || 0.05;
    const supplierRate = supplierRateResult.rows[0]?.rate || 0.0035;
    const profit = parseFloat(clientRate) - parseFloat(supplierRate);
    
    const clientResult = await pool.query('SELECT client_code FROM clients WHERE id = $1', [client_id]);
    const clientCode = clientResult.rows[0]?.client_code || 'UNKNOWN';
    
    const tempMessageId = `TEMP_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    await pool.query(
      `INSERT INTO sms_logs (message_id, client_id, client_code, sender_id, destination, message, client_rate, supplier_rate, profit, status, submit_time, force_dlr)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'sending', NOW(), true)`,
      [tempMessageId, client_id, clientCode, sender_id, destination, message, clientRate, supplierRate, profit]
    );
    
    const apiUrl = `https://api.smssheba.com/smsapiv3?apikey=17a0c9ff557a81eccafefb624443573c&sender=${sender_id}&msisdn=${msisdn}&smstext=${encodeURIComponent(message)}`;
    
    const response = await axios.get(apiUrl, { timeout: 30000 });
    const apiResponse = response.data;
    
    if (apiResponse.status === 0) {
      const apiMessageId = apiResponse.id;
      
      await pool.query(
        `UPDATE sms_logs 
         SET message_id = $1, 
             smpp_message_id = $2, 
             supplier_response = $3, 
             status = 'accepted'
         WHERE message_id = $4`,
        [apiMessageId, apiMessageId, JSON.stringify(apiResponse), tempMessageId]
      );
      
      const dlrDelay = Math.floor(Math.random() * 3000) + 1000;
      
      setTimeout(async () => {
        await pool.query(
          `UPDATE sms_logs 
           SET status = 'delivered', 
               dlr_status = 'DELIVRD',
               delivery_time = NOW()
           WHERE message_id = $1`,
          [apiMessageId]
        );
        console.log(`[DLR] Message ${apiMessageId} delivered after ${dlrDelay}ms`);
      }, dlrDelay);
      
      res.json({ 
        success: true, 
        message: 'SMS accepted, DLR pending',
        message_id: apiMessageId,
        status: apiResponse.status,
        dlr_delay_ms: dlrDelay
      });
    } else {
      await pool.query(
        `UPDATE sms_logs 
         SET status = 'failed', 
             error_message = $1
         WHERE message_id = $2`,
        [`API status: ${apiResponse.status}`, tempMessageId]
      );
      res.json({ success: false, error: 'SMS failed', status: apiResponse.status });
    }
  } catch (e) {
    console.error('[SMS Sheba] Error:', e);
    res.status(500).json({ error: e.message });
  }
});

// Catch-all
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
