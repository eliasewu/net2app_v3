const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = 'net2app-hub-secret-key-2024';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'dist')));

const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'net2app_hub',
    user: 'net2app_user',
    password: 'Ariya@2024Net2App',
});

// Auth middleware
const auth = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ error: 'No token provided' });
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid token' });
    }
};

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await pool.query('SELECT * FROM users WHERE username = $1 OR email = $1', [username]);
        if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
        const user = result.rows[0];
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ success: true, token, user: { id: user.id, username: user.username, email: user.email, role: user.role } });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all MCCMNC records
app.get('/api/mccmnc', auth, async (req, res) => {
    try {
        const { mcc, country, limit = 100 } = req.query;
        let query = 'SELECT * FROM mccmnc WHERE 1=1';
        let params = [];
        
        if (mcc) {
            params.push(mcc);
            query += ` AND mcc = $${params.length}`;
        }
        if (country) {
            params.push(`%${country}%`);
            query += ` AND country ILIKE $${params.length}`;
        }
        
        query += ` ORDER BY country, operator LIMIT $${params.length + 1}`;
        params.push(limit);
        
        const result = await pool.query(query, params);
        res.json({ success: true, data: result.rows, count: result.rows.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get MCCMNC statistics
app.get('/api/mccmnc/stats/summary', auth, async (req, res) => {
    try {
        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total_records,
                COUNT(DISTINCT country) as total_countries,
                COUNT(DISTINCT mcc) as total_mccs,
                COUNT(CASE WHEN status = 'active' THEN 1 END) as active_records,
                COUNT(CASE WHEN network_type ILIKE '%GSM%' THEN 1 END) as gsm_networks,
                COUNT(CASE WHEN network_type ILIKE '%LTE%' OR network_type ILIKE '%4G%' THEN 1 END) as lte_networks,
                COUNT(CASE WHEN network_type ILIKE '%5G%' OR network_type ILIKE '%NR%' THEN 1 END) as nr_networks
            FROM mccmnc WHERE status = 'active'
        `);
        res.json({ success: true, statistics: stats.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get client info
app.get('/api/clients', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, client_code, company_name, max_tps, status FROM clients ORDER BY id LIMIT 50');
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve frontend for all other routes
app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    } else {
        res.status(404).json({ error: 'API endpoint not found' });
    }
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📍 API: http://localhost:${PORT}/api`);
    console.log(`🌐 Frontend: http://localhost:${PORT}`);
});

module.exports = app;
