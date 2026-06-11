const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

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
        if (!token) return res.status(401).json({ error: 'No token' });
        const decoded = jwt.verify(token, 'net2app-hub-secret-key-2024');
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
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
        const user = result.rows[0];
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
        const token = jwt.sign({ id: user.id, username: user.username }, 'net2app-hub-secret-key-2024', { expiresIn: '24h' });
        res.json({ success: true, token, user: { id: user.id, username: user.username, email: user.email, role: user.role } });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// MCCMNC endpoints
app.get('/api/mccmnc', auth, async (req, res) => {
    try {
        const { mcc, country } = req.query;
        let query = 'SELECT * FROM mccmnc WHERE status = "active"';
        let params = [];
        if (mcc) {
            query += ' AND mcc = $1';
            params.push(mcc);
        }
        if (country) {
            query += ' AND country ILIKE $' + (params.length + 1);
            params.push(`%${country}%`);
        }
        query += ' ORDER BY country, operator LIMIT 100';
        const result = await pool.query(query, params);
        res.json({ success: true, data: result.rows, count: result.rows.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/mccmnc/stats/summary', auth, async (req, res) => {
    try {
        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total_records,
                COUNT(DISTINCT country) as total_countries,
                COUNT(DISTINCT mcc) as total_mccs,
                COUNT(CASE WHEN status = 'active' THEN 1 END) as active_records
            FROM mccmnc
        `);
        res.json({ success: true, statistics: stats.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Catch-all for frontend
app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📍 API: http://localhost:${PORT}/api`);
    console.log(`🌐 Frontend: http://localhost:${PORT}`);
});

module.exports = app;
