#!/usr/bin/env node
const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'net2app-hub-secret-key-2024';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'net2app_hub',
  user: process.env.DB_USER || 'net2app_user',
  password: process.env.DB_PASS || 'Ariya@2024Net2App',
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ===================== AUTH MIDDLEWARE =====================
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

// ===================== HEALTH CHECK =====================
app.get('/api/health', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ success: true, status: 'healthy', database: 'connected', timestamp: result.rows[0].now });
  } catch (error) {
    res.status(500).json({ success: false, status: 'unhealthy', error: error.message });
  }
});

// ===================== AUTH =====================
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

// ===================== SUPPLIERS =====================
app.get('/api/suppliers', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM suppliers ORDER BY created_at DESC');
    res.json({ success: true, data: result.rows });
  } catch (e) { 
    res.status(500).json({ error: e.message }); 
  }
});

// ===================== SMS INBOX =====================
app.get('/api/sms/inbox', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM sms_inbox ORDER BY received_at DESC LIMIT 100');
    res.json({ success: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===================== VOICE OTP =====================
app.get('/api/voice-otp/logs', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM voice_otp_logs ORDER BY created_at DESC LIMIT 100');
    res.json({ success: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/voice-otp/send', auth, async (req, res) => {
  try {
    const { destination, otp_code, max_retries = 4, retry_delay = 60 } = req.body;
    const finalOtp = otp_code || Math.floor(100000 + Math.random() * 900000).toString();
    const callId = `VOICE_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    
    const result = await pool.query(
      `INSERT INTO voice_otp_logs (call_id, destination, otp_code, status, retry_count, max_retries, retry_delay, created_at) 
       VALUES ($1, $2, $3, 'initiated', 0, $4, $5, NOW()) RETURNING *`,
      [callId, destination, finalOtp, max_retries, retry_delay]
    );
    
    // Simulate call (remove in production)
    setTimeout(async () => {
      await pool.query(`UPDATE voice_otp_logs SET status = 'completed', dlr_status = 'DELIVRD', completed_at = NOW() WHERE call_id = $1`, [callId]);
    }, 5000);
    
    res.json({ success: true, data: result.rows[0], message: `OTP ${finalOtp} sent to ${destination}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ===================== DASHBOARD =====================
app.get('/api/dashboard/stats', auth, async (req, res) => {
  try {
    const result = await pool.query(`SELECT 
      (SELECT COUNT(*) FROM clients) as total_clients,
      (SELECT COUNT(*) FROM clients WHERE status='active') as active_clients,
      (SELECT COUNT(*) FROM suppliers) as total_suppliers,
      (SELECT COUNT(*) FROM suppliers WHERE status='active') as active_suppliers
    `);
    res.json({ success: true, data: result.rows[0] });
  } catch (e) { 
    res.status(500).json({ error: e.message }); 
  }
});

// ===================== BIND STATUS =====================
app.get('/api/bind/status', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, supplier_code, company_name, bind_status FROM suppliers');
    res.json({ success: true, data: result.rows });
  } catch (e) { 
    res.status(500).json({ error: e.message }); 
  }
});

// ===================== RATES =====================
app.get('/api/rates', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM rates WHERE is_active=true LIMIT 100');
    res.json({ success: true, data: result.rows });
  } catch (e) { 
    res.status(500).json({ error: e.message }); 
  }
});

// ===================== TENANTS =====================
app.get('/api/tenants', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM tenants');
    res.json({ success: true, data: result.rows });
  } catch (e) { 
    res.status(500).json({ error: e.message }); 
  }
});

// ===================== USERS =====================
app.get('/api/users', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, username, email, role, is_active FROM users');
    res.json({ success: true, data: result.rows });
  } catch (e) { 
    res.status(500).json({ error: e.message }); 
  }
});

// ===================== STATIC FILES =====================
app.use(express.static(path.join(__dirname, 'dist')));

// Catch-all for React routing - MUST be last
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ NET2APP Hub running on port ${PORT}`);
  console.log(`📊 Database: ${pool.options.database}`);
  console.log(`🌐 Web UI: http://146.59.47.22:${PORT}`);
  console.log(`🔗 API: http://146.59.47.22:${PORT}/api/health`);
});
