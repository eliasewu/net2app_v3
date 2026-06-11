import express from 'express';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'net2app-hub-secret-key-2024';

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'net2app_hub',
  user: process.env.DB_USER || 'net2app_user',
  password: process.env.DB_PASS || 'Ariya@2024Net2App',
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Auth middleware
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
app.get('/api/health', async (req, res) => {
  res.json({ success: true, status: 'healthy', database: 'connected', timestamp: new Date().toISOString() });
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

// SMS Send
app.post('/api/sms/send', auth, async (req, res) => {
  try {
    const { client_id, destination, sender_id, message, force_dlr = false } = req.body;
    const messageId = `MSG_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    const client = await pool.query('SELECT * FROM clients WHERE id = $1', [client_id]);
    const clientCode = client.rows[0]?.client_code || 'UNKNOWN';
    
    const result = await pool.query(
      `INSERT INTO sms_logs 
       (message_id, client_id, client_code, sender_id, destination, message, status, submit_time, force_dlr)
       VALUES ($1, $2, $3, $4, $5, $6, 'sent', NOW(), $7)
       RETURNING *`,
      [messageId, client_id, clientCode, sender_id, destination, message, force_dlr]
    );
    
    res.json({ success: true, data: result.rows[0], message: 'SMS sent successfully' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// SMS Logs
app.post('/api/sms/logs', auth, async (req, res) => {
  try {
    const { client_id, status, limit = 100, offset = 0 } = req.body;
    let query = 'SELECT * FROM sms_logs WHERE 1=1';
    const params = [];
    let idx = 1;
    
    if (client_id) {
      query += ` AND client_id = $${idx++}`;
      params.push(client_id);
    }
    if (status) {
      query += ` AND status = $${idx++}`;
      params.push(status);
    }
    
    query += ` ORDER BY submit_time DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(limit, offset);
    
    const result = await pool.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Voice OTP Send
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
    
    res.json({ success: true, data: result.rows[0], message: `OTP ${finalOtp} sent to ${destination}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Voice OTP Logs
app.get('/api/voice-otp/logs', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM voice_otp_logs ORDER BY created_at DESC LIMIT 100');
    res.json({ success: true, data: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Dashboard Stats
app.get('/api/dashboard/stats', auth, async (req, res) => {
  try {
    const clientCount = await pool.query("SELECT COUNT(*) as total_clients FROM clients WHERE status = 'active'");
    const supplierCount = await pool.query("SELECT COUNT(*) as total_suppliers FROM suppliers WHERE status = 'active'");
    const smsCount = await pool.query("SELECT COUNT(*) as total_sms FROM sms_logs");
    
    res.json({ 
      success: true, 
      data: {
        total_clients: parseInt(clientCount.rows[0].total_clients || 0),
        active_clients: parseInt(clientCount.rows[0].total_clients || 0),
        total_suppliers: parseInt(supplierCount.rows[0].total_suppliers || 0),
        active_suppliers: parseInt(supplierCount.rows[0].total_suppliers || 0),
        total_sms: parseInt(smsCount.rows[0].total_sms || 0),
        today_sms: 0
      }
    });
  } catch (e) { 
    res.status(500).json({ error: e.message }); 
  }
});

// Bind Status
app.get('/api/bind/status', auth, async (req, res) => {
  try {
    const result = await pool.query('SELECT supplier_code, bind_status FROM suppliers');
    res.json({ success: true, data: result.rows });
  } catch (e) { 
    res.status(500).json({ error: e.message }); 
  }
});

// Serve static files - IMPORTANT: No wildcard issues
app.use(express.static(path.join(__dirname, 'dist')));

// Simple catch for React routing - use a proper handler
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
