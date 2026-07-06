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

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'net2app_hub',
    user: process.env.DB_USER || 'net2app_user',
    password: process.env.DB_PASS || 'Ariya@2024Net2App',
});

const auth = async (req, res, next) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];
        if (!token) return res.status(401).json({ error: 'No token provided' });
        const decoded = jwt.verify(token, process.env.JWT_SECRET || 'net2app-hub-secret-key-2024');
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid token' });
    }
};

// ==================== AUTH ====================
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const result = await pool.query('SELECT * FROM users WHERE username = $1 OR email = $1', [username]);
        if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid credentials' });
        const user = result.rows[0];
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) return res.status(401).json({ error: 'Invalid credentials' });
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            process.env.JWT_SECRET || 'net2app-hub-secret-key-2024',
            { expiresIn: '24h' }
        );
        res.json({ success: true, token, user });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==================== CLIENTS ====================
app.get('/api/clients', auth, async (req, res) => {
    try {
        const { client_code } = req.query;
        let query = 'SELECT * FROM clients';
        let params = [];
        if (client_code) {
            query += ' WHERE client_code = $1';
            params.push(client_code);
        }
        query += ' ORDER BY id';
        const result = await pool.query(query, params);
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/clients', auth, async (req, res) => {
    try {
        const { client_code, company_name, contact_person, email, phone, address, country, smpp_username, smpp_password, status, routing_plan_id, max_tps, currency, credit_limit, balance } = req.body;
        const result = await pool.query(
            `INSERT INTO clients (client_code, company_name, contact_person, email, phone, address, country, smpp_username, smpp_password, status, routing_plan_id, max_tps, currency, credit_limit, balance, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW(), NOW()) RETURNING *`,
            [client_code, company_name, contact_person, email, phone, address, country, smpp_username, smpp_password, status || 'active', routing_plan_id, max_tps || 100, currency || 'USD', credit_limit || 0, balance || 0]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/clients/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const fields = req.body;
        const setClause = Object.keys(fields).map((key, i) => `${key} = $${i + 1}`).join(', ');
        const values = [...Object.values(fields), id];
        const result = await pool.query(`UPDATE clients SET ${setClause}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`, values);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Client not found' });
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/clients/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM clients WHERE id = $1 RETURNING client_code', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Client not found' });
        res.json({ success: true, message: 'Client deleted', client_code: result.rows[0].client_code });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==================== SUPPLIERS ====================
app.get('/api/suppliers', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM suppliers ORDER BY id');
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/suppliers/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM suppliers WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Supplier not found' });
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/suppliers', auth, async (req, res) => {
    try {
        const b = req.body || {};
        if (!b.supplier_code) return res.status(400).json({ error: 'supplier_code is required' });
        if (!b.company_name) return res.status(400).json({ error: 'company_name is required' });
        const result = await pool.query(
            `INSERT INTO suppliers (
                supplier_code, company_name, contact_person, email, phone,
                connection_type, smpp_host, smpp_port, smpp_username, smpp_password,
                system_id, smpp_version, smpp_system_type, smpp_bind_type,
                smpp_addr_ton, smpp_addr_npi, smpp_addr_range,
                is_inbound, api_url, api_key, api_method,
                api_connector_id, voice_otp_config_id,
                whatsapp_device_ids, telegram_device_ids,
                balance, credit_limit, currency,
                bind_status, consecutive_failures, force_dlr, status,
                created_at, updated_at
            ) VALUES (
                $1,$2,$3,$4,$5,
                $6,$7,$8,$9,$10,
                $11,$12,$13,$14,
                $15,$16,$17,
                $18,$19,$20,$21,
                $22,$23,
                $24,$25,
                $26,$27,$28,
                $29,$30,$31,$32,
                NOW(), NOW()
            ) RETURNING *`,
            [
                b.supplier_code,
                b.company_name,
                b.contact_person || '',
                b.email || '',
                b.phone || '',
                b.connection_type || 'smpp',
                b.smpp_host || '',
                b.smpp_port || 2775,
                b.smpp_username || '',
                b.smpp_password || '',
                b.system_id || '',
                b.smpp_version || 'auto',
                b.smpp_system_type || '',
                b.smpp_bind_type || 'trx',
                b.smpp_addr_ton ?? 0,
                b.smpp_addr_npi ?? 0,
                b.smpp_addr_range || '',
                b.is_inbound || false,
                b.api_url || '',
                b.api_key || '',
                b.api_method || 'POST',
                b.api_connector_id || null,
                b.voice_otp_config_id || null,
                b.whatsapp_device_ids || null,
                b.telegram_device_ids || null,
                b.balance || 0,
                b.credit_limit || 0,
                b.currency || 'EUR',
                b.bind_status || 'unbound',
                b.consecutive_failures || 0,
                b.force_dlr !== undefined ? b.force_dlr : false,
                b.status || 'active'
            ]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/suppliers/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const fields = req.body;
        // Build dynamic SET clause for any field passed
        const allowed = ['supplier_code','company_name','contact_person','email','phone','connection_type','smpp_host','smpp_port','smpp_username','smpp_password','system_id','smpp_version','smpp_system_type','smpp_bind_type','smpp_addr_ton','smpp_addr_npi','smpp_addr_range','is_inbound','api_url','api_key','api_method','api_connector_id','voice_otp_config_id','whatsapp_device_ids','telegram_device_ids','balance','credit_limit','currency','bind_status','consecutive_failures','force_dlr','status'];
        const setParts = [];
        const values = [];
        let idx = 1;
        for (const key of allowed) {
            if (fields[key] !== undefined) {
                setParts.push(`${key} = $${idx++}`);
                values.push(fields[key]);
            }
        }
        if (setParts.length === 0) return res.status(400).json({ error: 'No fields to update' });
        setParts.push(`updated_at = NOW()`);
        values.push(id);
        const result = await pool.query(
            `UPDATE suppliers SET ${setParts.join(', ')} WHERE id = $${values.length} RETURNING *`,
            values
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Supplier not found' });
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/suppliers/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM suppliers WHERE id = $1 RETURNING supplier_code', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Supplier not found' });
        res.json({ success: true, message: 'Supplier deleted', supplier_code: result.rows[0].supplier_code });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==================== TRUNKS ====================
app.get('/api/trunks', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM trunks ORDER BY id');
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/trunks/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM trunks WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Trunk not found' });
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/trunks', auth, async (req, res) => {
    try {
        const { trunk_name, supplier_id, trunk_type, status } = req.body;
        const result = await pool.query(
            `INSERT INTO trunks (trunk_name, supplier_id, trunk_type, status, created_at, updated_at) VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING *`,
            [trunk_name, supplier_id, trunk_type, status || 'active']
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/trunks/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const { trunk_name, supplier_id, trunk_type, status } = req.body;
        const result = await pool.query(
            `UPDATE trunks SET trunk_name = COALESCE($1, trunk_name), supplier_id = COALESCE($2, supplier_id), trunk_type = COALESCE($3, trunk_type), status = COALESCE($4, status), updated_at = NOW() WHERE id = $5 RETURNING *`,
            [trunk_name, supplier_id, trunk_type, status, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Trunk not found' });
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/trunks/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM trunks WHERE id = $1 RETURNING trunk_name', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Trunk not found' });
        res.json({ success: true, message: 'Trunk deleted', trunk_name: result.rows[0].trunk_name });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==================== ROUTES ====================
app.get('/api/routes', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM routes ORDER BY id');
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/routes/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM routes WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Route not found' });
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/routes', auth, async (req, res) => {
    try {
        const { route_name, trunk_ids, status } = req.body;
        const result = await pool.query(
            `INSERT INTO routes (route_name, trunk_ids, status, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW()) RETURNING *`,
            [route_name, trunk_ids, status || 'active']
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/routes/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const { route_name, trunk_ids, status } = req.body;
        const result = await pool.query(
            `UPDATE routes SET route_name = COALESCE($1, route_name), trunk_ids = COALESCE($2, trunk_ids), status = COALESCE($3, status), updated_at = NOW() WHERE id = $4 RETURNING *`,
            [route_name, trunk_ids, status, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Route not found' });
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/routes/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM routes WHERE id = $1 RETURNING route_name', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Route not found' });
        res.json({ success: true, message: 'Route deleted', route_name: result.rows[0].route_name });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==================== ROUTE PLANS ====================
app.get('/api/route-plans', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM route_plans ORDER BY id');
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/route-plans/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM route_plans WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Route plan not found' });
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/route-plans', auth, async (req, res) => {
    try {
        const { plan_name, route_ids, status } = req.body;
        const result = await pool.query(
            `INSERT INTO route_plans (plan_name, route_ids, status, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW()) RETURNING *`,
            [plan_name, route_ids, status || 'active']
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/route-plans/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const { plan_name, route_ids, status } = req.body;
        const result = await pool.query(
            `UPDATE route_plans SET plan_name = COALESCE($1, plan_name), route_ids = COALESCE($2, route_ids), status = COALESCE($3, status), updated_at = NOW() WHERE id = $4 RETURNING *`,
            [plan_name, route_ids, status, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Route plan not found' });
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/route-plans/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM route_plans WHERE id = $1 RETURNING plan_name', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Route plan not found' });
        res.json({ success: true, message: 'Route plan deleted', plan_name: result.rows[0].plan_name });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==================== RATES ====================
app.get('/api/rates', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM rates ORDER BY id');
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/rates/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM rates WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Rate not found' });
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/rates', auth, async (req, res) => {
    try {
        const { entity_id, mcc, prefix, rate, currency, rate_type, is_active } = req.body;
        const result = await pool.query(
            `INSERT INTO rates (entity_id, mcc, prefix, rate, currency, rate_type, is_active, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW()) RETURNING *`,
            [entity_id, mcc, prefix, rate, currency, rate_type, is_active !== false]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/rates/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const { rate, currency, is_active } = req.body;
        const result = await pool.query(
            `UPDATE rates SET rate = COALESCE($1, rate), currency = COALESCE($2, currency), is_active = COALESCE($3, is_active), updated_at = NOW() WHERE id = $4 RETURNING *`,
            [rate, currency, is_active, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Rate not found' });
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/rates/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM rates WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Rate not found' });
        res.json({ success: true, message: 'Rate deleted' });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve static files
app.use(express.static('dist'));
app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});

module.exports = app;
