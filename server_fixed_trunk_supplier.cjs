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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
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

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ==================== TRUNKS CRUD ====================
app.get('/api/trunks', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, trunk_name, supplier_id, trunk_type, created_at FROM trunks ORDER BY id');
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.json({ success: true, data: [] });
    }
});

app.get('/api/trunks/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT id, trunk_name, supplier_id, trunk_type FROM trunks WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Trunk not found' });
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/trunks', auth, async (req, res) => {
    try {
        const { trunk_name, supplier_id, trunk_type } = req.body;
        const result = await pool.query(
            `INSERT INTO trunks (trunk_name, supplier_id, trunk_type, created_at) VALUES ($1, $2, $3, NOW()) RETURNING *`,
            [trunk_name, supplier_id, trunk_type]
        );
        res.json({ success: true, data: result.rows[0], message: 'Trunk created' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/trunks/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const { trunk_name, supplier_id, trunk_type } = req.body;
        let query = 'UPDATE trunks SET updated_at = NOW()';
        let params = [];
        let paramCount = 1;
        
        if (trunk_name !== undefined) {
            query += `, trunk_name = $${paramCount}`;
            params.push(trunk_name);
            paramCount++;
        }
        if (supplier_id !== undefined) {
            query += `, supplier_id = $${paramCount}`;
            params.push(supplier_id);
            paramCount++;
        }
        if (trunk_type !== undefined) {
            query += `, trunk_type = $${paramCount}`;
            params.push(trunk_type);
            paramCount++;
        }
        
        query += ` WHERE id = $${paramCount} RETURNING *`;
        params.push(id);
        
        const result = await pool.query(query, params);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Trunk not found' });
        res.json({ success: true, data: result.rows[0], message: 'Trunk updated' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/trunks/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM trunks WHERE id = $1', [id]);
        res.json({ success: true, message: 'Trunk deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== SUPPLIERS CRUD ====================
app.get('/api/suppliers', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, supplier_code, company_name, connection_type, created_at FROM suppliers ORDER BY id');
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.json({ success: true, data: [] });
    }
});

app.get('/api/suppliers/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT id, supplier_code, company_name, connection_type FROM suppliers WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Supplier not found' });
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/suppliers', auth, async (req, res) => {
    try {
        const { supplier_code, company_name, connection_type } = req.body;
        const result = await pool.query(
            `INSERT INTO suppliers (supplier_code, company_name, connection_type, created_at) VALUES ($1, $2, $3, NOW()) RETURNING *`,
            [supplier_code, company_name, connection_type]
        );
        res.json({ success: true, data: result.rows[0], message: 'Supplier created' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/suppliers/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const { supplier_code, company_name, connection_type } = req.body;
        let query = 'UPDATE suppliers SET updated_at = NOW()';
        let params = [];
        let paramCount = 1;
        
        if (supplier_code !== undefined) {
            query += `, supplier_code = $${paramCount}`;
            params.push(supplier_code);
            paramCount++;
        }
        if (company_name !== undefined) {
            query += `, company_name = $${paramCount}`;
            params.push(company_name);
            paramCount++;
        }
        if (connection_type !== undefined) {
            query += `, connection_type = $${paramCount}`;
            params.push(connection_type);
            paramCount++;
        }
        
        query += ` WHERE id = $${paramCount} RETURNING *`;
        params.push(id);
        
        const result = await pool.query(query, params);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Supplier not found' });
        res.json({ success: true, data: result.rows[0], message: 'Supplier updated' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/suppliers/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM suppliers WHERE id = $1', [id]);
        res.json({ success: true, message: 'Supplier deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Catch-all for frontend
app.use((req, res, next) => {
    if (req.path.startsWith('/api')) {
        res.status(404).json({ error: 'API endpoint not found' });
    } else {
        res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📍 API: http://localhost:${PORT}/api`);
    console.log(`🌐 Frontend: http://localhost:${PORT}`);
});
