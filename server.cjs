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
    database: process.env.DB_NAME || 'sms_platform',
    user: process.env.DB_USER || 'sms_user',
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

// ==================== USERS ====================
app.get('/api/users', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, email, role, permissions, name, is_active, last_login, created_at FROM users ORDER BY id');
        res.json({ success: true, data: result.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/users', auth, async (req, res) => {
    try {
        const { username, password, email, role, permissions, name } = req.body;
        if (!username || !password) return res.status(400).json({ error: 'username and password required' });
        const hash = await bcrypt.hash(password, 10);
        const result = await pool.query(
            `INSERT INTO users (username, password_hash, email, role, permissions, name, is_active, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,true,NOW(),NOW()) RETURNING id, username, email, role, permissions, name, is_active, last_login, created_at`,
            [username, hash, email || '', role || 'client', permissions || [], name || '']
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/users/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const fields = req.body;
        if (fields.password) {
            fields.password_hash = await bcrypt.hash(fields.password, 10);
            delete fields.password;
        }
        delete fields.current_password;
        const setParts = []; const values = []; let idx = 1;
        for (const [key, value] of Object.entries(fields)) {
            if (value !== undefined && key !== 'id') {
                setParts.push(`${key} = $${idx++}`);
                values.push(value);
            }
        }
        if (setParts.length === 0) return res.status(400).json({ error: 'No fields to update' });
        setParts.push(`updated_at = NOW()`);
        values.push(id);
        const result = await pool.query(
            `UPDATE users SET ${setParts.join(', ')} WHERE id = $${values.length} RETURNING id, username, email, role, permissions, name, is_active, last_login, created_at`,
            values
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        res.json({ success: true, data: result.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/users/:id', auth, async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id, username', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        res.json({ success: true, message: 'User deleted', username: result.rows[0].username });
    } catch (e) { res.status(500).json({ error: e.message }); }
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

// ==================== API CONNECTORS ====================
app.get('/api/api-connectors', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM api_connectors ORDER BY id');
        res.json({ success: true, data: result.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/api-connectors', auth, async (req, res) => {
    try {
        const b = req.body || {};
        const result = await pool.query(
            `INSERT INTO api_connectors (name, type, base_url, api_key, api_secret, region, description, is_active, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING *`,
            [b.name || '', b.type || 'http', b.base_url || '', b.api_key || '', b.api_secret || '', b.region || '', b.description || '', b.is_active !== false]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/api-connectors/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const fields = req.body;
        const allowed = ['name','type','base_url','api_key','api_secret','region','description','is_active'];
        const setParts = []; const values = []; let idx = 1;
        for (const key of allowed) {
            if (fields[key] !== undefined) { setParts.push(`${key} = $${idx++}`); values.push(fields[key]); }
        }
        if (setParts.length === 0) return res.status(400).json({ error: 'No fields to update' });
        values.push(id);
        const result = await pool.query(`UPDATE api_connectors SET ${setParts.join(', ')} WHERE id = $${values.length} RETURNING *`, values);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json({ success: true, data: result.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/api-connectors/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM api_connectors WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        res.json({ success: true, message: 'API connector deleted' });
    } catch (e) { res.status(500).json({ error: e.message }); }
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
        const { trunk_name, supplier_id, trunk_type, priority, percentage, is_active, mccmnc_allowed, mccmnc_denied } = req.body;
        const result = await pool.query(
            `INSERT INTO trunks (trunk_name, supplier_id, trunk_type, priority, percentage, is_active, mccmnc_allowed, mccmnc_denied, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW()) RETURNING *`,
            [trunk_name, supplier_id, trunk_type || 'sim_otp', priority || 0, percentage || 100, is_active !== false, mccmnc_allowed || null, mccmnc_denied || null]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/trunks/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const fields = req.body;
        const allowed = ['trunk_name','supplier_id','trunk_type','priority','percentage','is_active','mccmnc_allowed','mccmnc_denied'];
        const setParts = []; const values = []; let idx = 1;
        for (const key of allowed) {
            if (fields[key] !== undefined) { setParts.push(`${key} = $${idx++}`); values.push(fields[key]); }
        }
        if (setParts.length === 0) return res.status(400).json({ error: 'No fields to update' });
        values.push(id);
        const result = await pool.query(
            `UPDATE trunks SET ${setParts.join(', ')} WHERE id = $${values.length} RETURNING *`,
            values
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
        const { route_name, trunk_ids, route_method, is_active, preferred_channel, mccmnc_allowed, mccmnc_denied } = req.body;
        const result = await pool.query(
            `INSERT INTO routes (route_name, trunk_ids, route_method, is_active, preferred_channel, mccmnc_allowed, mccmnc_denied, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING *`,
            [route_name, trunk_ids || null, route_method || 'priority', is_active !== false, preferred_channel || null, mccmnc_allowed || null, mccmnc_denied || null]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/routes/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const fields = req.body;
        const allowed = ['route_name','trunk_ids','route_method','is_active','preferred_channel','mccmnc_allowed','mccmnc_denied'];
        const setParts = []; const values = []; let idx = 1;
        for (const key of allowed) {
            if (fields[key] !== undefined) { setParts.push(`${key} = $${idx++}`); values.push(fields[key]); }
        }
        if (setParts.length === 0) return res.status(400).json({ error: 'No fields to update' });
        values.push(id);
        const result = await pool.query(
            `UPDATE routes SET ${setParts.join(', ')} WHERE id = $${values.length} RETURNING *`,
            values
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
        const { plan_name, route_ids, is_default, allowed_channels } = req.body;
        const result = await pool.query(
            `INSERT INTO route_plans (plan_name, route_ids, is_default, allowed_channels, created_at)
             VALUES ($1, $2, $3, $4, NOW()) RETURNING *`,
            [plan_name, route_ids || null, is_default || false, allowed_channels || null]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/route-plans/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const fields = req.body;
        const allowed = ['plan_name','route_ids','is_default','allowed_channels'];
        const setParts = []; const values = []; let idx = 1;
        for (const key of allowed) {
            if (fields[key] !== undefined) { setParts.push(`${key} = $${idx++}`); values.push(fields[key]); }
        }
        if (setParts.length === 0) return res.status(400).json({ error: 'No fields to update' });
        values.push(id);
        const result = await pool.query(
            `UPDATE route_plans SET ${setParts.join(', ')} WHERE id = $${values.length} RETURNING *`,
            values
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
        const { entity_type, entity_id, mcc, mnc, country, operator, rate, currency, effective_from, is_active } = req.body;
        const result = await pool.query(
            `INSERT INTO rates (entity_type, entity_id, mcc, mnc, country, operator, rate, currency, effective_from, is_active, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()) RETURNING *`,
            [entity_type || 'client', entity_id || '0', mcc || '', mnc || '*', country || '', operator || 'All', rate || 0, currency || 'EUR', effective_from || new Date().toISOString().split('T')[0], is_active !== false]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/rates/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const fields = req.body;
        const allowed = ['entity_type','entity_id','mcc','mnc','country','operator','rate','currency','effective_from','effective_to','is_active'];
        const setParts = []; const values = []; let idx = 1;
        for (const key of allowed) {
            if (fields[key] !== undefined) { setParts.push(`${key} = $${idx++}`); values.push(fields[key]); }
        }
        if (setParts.length === 0) return res.status(400).json({ error: 'No fields to update' });
        values.push(id);
        const result = await pool.query(
            `UPDATE rates SET ${setParts.join(', ')} WHERE id = $${values.length} RETURNING *`,
            values
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

// ==================== SMS LOGS ====================
app.post('/api/sms/logs', auth, async (req, res) => {
    try {
        const f = req.body || {};
        let q = 'SELECT * FROM sms_logs WHERE 1=1';
        const p = []; let i = 1;
        if (f.status)      { q += ` AND status = $${i++}`; p.push(f.status); }
        if (f.client_code) { q += ` AND client_code = $${i++}`; p.push(f.client_code); }
        if (f.supplier_code){ q += ` AND supplier_code = $${i++}`; p.push(f.supplier_code); }
        if (f.source)      { q += ` AND source = $${i++}`; p.push(f.source); }
        if (f.start_date)  { q += ` AND submit_time >= $${i++}`; p.push(f.start_date); }
        if (f.end_date)    { q += ` AND submit_time <= $${i++}`; p.push(f.end_date); }
        if (f.search)      { q += ` AND (destination ILIKE $${i} OR message_id ILIKE $${i} OR sender_id ILIKE $${i})`; p.push(`%${f.search}%`); i++; }
        q += ' ORDER BY submit_time DESC LIMIT 1000';
        const result = await pool.query(q, p);
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== INVOICES ====================
app.get('/api/invoices', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM invoices ORDER BY id DESC LIMIT 500');
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/invoices', auth, async (req, res) => {
    try {
        const b = req.body || {};
        if (!b.entity_type || !b.entity_id) return res.status(400).json({ error: 'entity_type and entity_id are required' });
        // Auto-generate invoice number if not provided
        let invNum = b.invoice_number;
        if (!invNum) {
            const seq = await pool.query("SELECT COUNT(*) + 1 AS next FROM invoices");
            invNum = `INV-${new Date().getFullYear()}-${String(seq.rows[0].next).padStart(4, '0')}`;
        }
        const result = await pool.query(
            `INSERT INTO invoices (invoice_number, entity_type, entity_id, entity_name,
             period_start, period_end, total_sms, total_amount, tax_amount, tax_rate, grand_total,
             currency, status, due_date, notes, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW()) RETURNING *`,
            [invNum, b.entity_type, b.entity_id, b.entity_name || '',
             b.period_start || new Date().toISOString().split('T')[0], b.period_end || new Date().toISOString().split('T')[0],
             b.total_sms || 0, b.total_amount || 0, b.tax_amount || 0, b.tax_rate || 0, b.grand_total || 0,
             b.currency || 'EUR', b.status || 'draft', b.due_date || null, b.notes || '']
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/invoices/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const fields = req.body;
        const allowed = ['invoice_number','entity_type','entity_id','entity_name',
            'period_start','period_end','total_sms','total_amount','tax_amount','tax_rate','grand_total',
            'currency','status','due_date','paid_date','payment_method','payment_reference','notes',
            'invoice_to_name','invoice_to_address','invoice_to_email',
            'invoice_by_name','invoice_by_address','invoice_by_email','invoice_by_vat',
            'bank_name','bank_account','bank_iban','bank_bic'];
        const setParts = []; const values = []; let idx = 1;
        for (const key of allowed) {
            if (fields[key] !== undefined) { setParts.push(`${key} = $${idx++}`); values.push(fields[key]); }
        }
        if (setParts.length === 0) return res.status(400).json({ error: 'No fields to update' });
        values.push(id);
        const result = await pool.query(
            `UPDATE invoices SET ${setParts.join(', ')} WHERE id = $${values.length} RETURNING *`,
            values
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Invoice not found' });
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/invoices/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM invoices WHERE id = $1 RETURNING invoice_number', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Invoice not found' });
        res.json({ success: true, message: 'Invoice deleted', invoice_number: result.rows[0].invoice_number });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== PAYMENTS ====================
app.get('/api/payments', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM payments ORDER BY id DESC LIMIT 500');
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/payments', auth, async (req, res) => {
    try {
        const b = req.body || {};
        if (!b.entity_type || !b.entity_id) return res.status(400).json({ error: 'entity_type and entity_id are required' });
        if (!b.amount) return res.status(400).json({ error: 'amount is required' });
        // Auto-generate payment number if not provided
        let payNum = b.payment_number;
        if (!payNum) {
            const seq = await pool.query("SELECT COUNT(*) + 1 AS next FROM payments");
            payNum = `PAY-${new Date().getFullYear()}-${String(seq.rows[0].next).padStart(4, '0')}`;
        }
        const result = await pool.query(
            `INSERT INTO payments (payment_number, entity_type, entity_id, entity_name,
             amount, currency, payment_method, reference, status, notes, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()) RETURNING *`,
            [payNum, b.entity_type, b.entity_id, b.entity_name || '',
             b.amount, b.currency || 'EUR', b.payment_method || 'bank_transfer', b.reference || '',
             b.status || 'completed', b.notes || '']
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/payments/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const fields = req.body;
        const allowed = ['payment_number','entity_type','entity_id','entity_name',
            'amount','currency','payment_method','reference','status','notes'];
        const setParts = []; const values = []; let idx = 1;
        for (const key of allowed) {
            if (fields[key] !== undefined) { setParts.push(`${key} = $${idx++}`); values.push(fields[key]); }
        }
        if (setParts.length === 0) return res.status(400).json({ error: 'No fields to update' });
        values.push(id);
        const result = await pool.query(
            `UPDATE payments SET ${setParts.join(', ')} WHERE id = $${values.length} RETURNING *`,
            values
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Payment not found' });
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/payments/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM payments WHERE id = $1 RETURNING payment_number', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Payment not found' });
        res.json({ success: true, message: 'Payment deleted', payment_number: result.rows[0].payment_number });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== CAMPAIGNS ====================
app.get('/api/campaigns', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM campaigns ORDER BY id DESC LIMIT 500');
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/campaigns', auth, async (req, res) => {
    try {
        const b = req.body || {};
        if (!b.campaign_name) return res.status(400).json({ error: 'campaign_name is required' });
        const result = await pool.query(
            `INSERT INTO campaigns (campaign_name, client_id, sender_id, message_template,
             recipients_count, sent_count, delivered_count, failed_count,
             status, scheduled_at, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW()) RETURNING *`,
            [b.campaign_name, b.client_id || null, b.sender_id || '', b.message_template || '',
             b.recipients_count || 0, 0, 0, 0,
             b.status || 'draft', b.scheduled_at || null]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/campaigns/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const fields = req.body;
        const allowed = ['campaign_name','client_id','sender_id','message_template',
            'recipients_count','sent_count','delivered_count','failed_count',
            'status','scheduled_at','started_at','completed_at'];
        const setParts = []; const values = []; let idx = 1;
        for (const key of allowed) {
            if (fields[key] !== undefined) { setParts.push(`${key} = $${idx++}`); values.push(fields[key]); }
        }
        if (setParts.length === 0) return res.status(400).json({ error: 'No fields to update' });
        values.push(id);
        const result = await pool.query(
            `UPDATE campaigns SET ${setParts.join(', ')} WHERE id = $${values.length} RETURNING *`,
            values
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Campaign not found' });
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/campaigns/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM campaigns WHERE id = $1 RETURNING campaign_name', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Campaign not found' });
        res.json({ success: true, message: 'Campaign deleted', campaign_name: result.rows[0].campaign_name });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== TRANSLATIONS ====================
app.get('/api/translations', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM translations ORDER BY id DESC LIMIT 500');
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/translations', auth, async (req, res) => {
    try {
        const b = req.body || {};
        if (!b.translation_type) return res.status(400).json({ error: 'translation_type is required' });
        if (!b.source_pattern) return res.status(400).json({ error: 'source_pattern is required' });
        if (b.target_value === undefined || b.target_value === null) return res.status(400).json({ error: 'target_value is required' });
        const result = await pool.query(
            `INSERT INTO translations (translation_type, source_pattern, target_value,
             client_id, supplier_id, route_id, mcc, mnc,
             name, description, subtype, priority, apply_to, apply_entity_id, is_active, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW()) RETURNING *`,
            [b.translation_type, b.source_pattern, b.target_value || '',
             b.client_id || null, b.supplier_id || null, b.route_id || null, b.mcc || null, b.mnc || null,
             b.name || '', b.description || '', b.subtype || '', b.priority || 1, b.apply_to || 'client', b.apply_entity_id || 'all', b.is_active !== false]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/translations/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const fields = req.body;
        const allowed = ['translation_type','source_pattern','target_value',
            'client_id','supplier_id','route_id','mcc','mnc',
            'name','description','subtype','priority','apply_to','apply_entity_id','is_active'];
        const setParts = []; const values = []; let idx = 1;
        for (const key of allowed) {
            if (fields[key] !== undefined) { setParts.push(`${key} = $${idx++}`); values.push(fields[key]); }
        }
        if (setParts.length === 0) return res.status(400).json({ error: 'No fields to update' });
        values.push(id);
        const result = await pool.query(
            `UPDATE translations SET ${setParts.join(', ')} WHERE id = $${values.length} RETURNING *`,
            values
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Translation not found' });
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/translations/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM translations WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Translation not found' });
        res.json({ success: true, message: 'Translation deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== MCCMNC ====================
app.get('/api/mccmnc', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM mccmnc ORDER BY id LIMIT 500');
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== BIND STATUS ====================
app.get('/api/bind/status', auth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT s.id, s.supplier_code, s.company_name, s.bind_status, s.consecutive_failures,
                    s.smpp_host, s.smpp_port, s.smpp_username, s.connection_type, s.status as supplier_status,
                    sess.system_id as session_system_id, sess.connected_at, sess.ip_address,
                    sess.status as session_status, sess.bind_mode,
                    CASE WHEN sess.id IS NOT NULL THEN 'connected' ELSE 'disconnected' END as session_state
             FROM suppliers s
             LEFT JOIN active_smpp_sessions sess ON s.id = sess.entity_id AND sess.entity_type = 'supplier'
             WHERE s.connection_type = 'smpp'
             ORDER BY s.id`
        );
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve static files — SPA fallback (middleware avoids path-to-regexp wildcard issue)
app.use(express.static('dist'));
app.use((req, res) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});

module.exports = app;
