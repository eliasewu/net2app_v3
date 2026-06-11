const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');

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

// ==================== AUTH ====================
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

// ==================== CLIENTS CRUD ====================
app.get('/api/clients', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM clients ORDER BY id');
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/clients/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM clients WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Client not found' });
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/clients', auth, async (req, res) => {
    try {
        const { client_code, company_name, contact_person, phone, email, smpp_username, smpp_password, max_tps, routing_plan_id } = req.body;
        const result = await pool.query(
            `INSERT INTO clients (client_code, company_name, contact_person, phone, email, smpp_username, smpp_password, max_tps, routing_plan_id, status, created_at, updated_at) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active', NOW(), NOW()) RETURNING *`,
            [client_code, company_name, contact_person, phone, email, smpp_username, smpp_password, max_tps || 100, routing_plan_id || 3]
        );
        res.json({ success: true, data: result.rows[0], message: 'Client created successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/clients/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const { company_name, contact_person, phone, email, max_tps, status } = req.body;
        const result = await pool.query(
            `UPDATE clients SET company_name = COALESCE($1, company_name), contact_person = COALESCE($2, contact_person), phone = COALESCE($3, phone), email = COALESCE($4, email), max_tps = COALESCE($5, max_tps), status = COALESCE($6, status), updated_at = NOW() WHERE id = $7 RETURNING *`,
            [company_name, contact_person, phone, email, max_tps, status, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Client not found' });
        res.json({ success: true, data: result.rows[0], message: 'Client updated successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/clients/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM clients WHERE id = $1 RETURNING client_code', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Client not found' });
        res.json({ success: true, message: 'Client deleted successfully', client_code: result.rows[0].client_code });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== SUPPLIERS CRUD ====================
app.get('/api/suppliers', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM suppliers ORDER BY id');
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/suppliers', auth, async (req, res) => {
    try {
        const { supplier_code, company_name, connection_type } = req.body;
        const result = await pool.query(
            `INSERT INTO suppliers (supplier_code, company_name, connection_type, status, created_at, updated_at) 
             VALUES ($1, $2, $3, 'active', NOW(), NOW()) RETURNING *`,
            [supplier_code, company_name, connection_type]
        );
        res.json({ success: true, data: result.rows[0], message: 'Supplier created successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/suppliers/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const { company_name, connection_type, status } = req.body;
        const result = await pool.query(
            `UPDATE suppliers SET company_name = COALESCE($1, company_name), connection_type = COALESCE($2, connection_type), status = COALESCE($3, status), updated_at = NOW() WHERE id = $4 RETURNING *`,
            [company_name, connection_type, status, id]
        );
        res.json({ success: true, data: result.rows[0], message: 'Supplier updated successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/suppliers/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM suppliers WHERE id = $1', [id]);
        res.json({ success: true, message: 'Supplier deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== TRUNKS CRUD ====================
app.get('/api/trunks', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM trunks ORDER BY id');
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/trunks', auth, async (req, res) => {
    try {
        const { trunk_name, supplier_id, trunk_type } = req.body;
        const result = await pool.query(
            `INSERT INTO trunks (trunk_name, supplier_id, trunk_type, status, created_at, updated_at) 
             VALUES ($1, $2, $3, 'active', NOW(), NOW()) RETURNING *`,
            [trunk_name, supplier_id, trunk_type]
        );
        res.json({ success: true, data: result.rows[0], message: 'Trunk created successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/trunks/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const { trunk_name, trunk_type, status } = req.body;
        const result = await pool.query(
            `UPDATE trunks SET trunk_name = COALESCE($1, trunk_name), trunk_type = COALESCE($2, trunk_type), status = COALESCE($3, status), updated_at = NOW() WHERE id = $4 RETURNING *`,
            [trunk_name, trunk_type, status, id]
        );
        res.json({ success: true, data: result.rows[0], message: 'Trunk updated successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/trunks/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM trunks WHERE id = $1', [id]);
        res.json({ success: true, message: 'Trunk deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== ROUTES CRUD ====================
app.get('/api/routes', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM routes ORDER BY id');
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/routes', auth, async (req, res) => {
    try {
        const { route_name, trunk_ids } = req.body;
        const result = await pool.query(
            `INSERT INTO routes (route_name, trunk_ids, status, created_at, updated_at) 
             VALUES ($1, $2, 'active', NOW(), NOW()) RETURNING *`,
            [route_name, trunk_ids]
        );
        res.json({ success: true, data: result.rows[0], message: 'Route created successfully' });
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
        res.json({ success: true, data: result.rows[0], message: 'Route updated successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/routes/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM routes WHERE id = $1', [id]);
        res.json({ success: true, message: 'Route deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== ROUTE PLANS CRUD ====================
app.get('/api/route-plans', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM route_plans ORDER BY id');
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/route-plans', auth, async (req, res) => {
    try {
        const { plan_name, route_ids } = req.body;
        const result = await pool.query(
            `INSERT INTO route_plans (plan_name, route_ids, status, created_at, updated_at) 
             VALUES ($1, $2, 'active', NOW(), NOW()) RETURNING *`,
            [plan_name, route_ids]
        );
        res.json({ success: true, data: result.rows[0], message: 'Route plan created successfully' });
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
        res.json({ success: true, data: result.rows[0], message: 'Route plan updated successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/route-plans/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM route_plans WHERE id = $1', [id]);
        res.json({ success: true, message: 'Route plan deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== RATES CRUD ====================
app.get('/api/rates', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM rates ORDER BY id');
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/rates', auth, async (req, res) => {
    try {
        const { entity_id, mcc, mnc, rate, currency } = req.body;
        const result = await pool.query(
            `INSERT INTO rates (entity_id, mcc, mnc, rate, currency, is_active, created_at, updated_at) 
             VALUES ($1, $2, $3, $4, $5, true, NOW(), NOW()) RETURNING *`,
            [entity_id, mcc, mnc, rate, currency]
        );
        res.json({ success: true, data: result.rows[0], message: 'Rate created successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/rates/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const { rate, is_active } = req.body;
        const result = await pool.query(
            `UPDATE rates SET rate = COALESCE($1, rate), is_active = COALESCE($2, is_active), updated_at = NOW() WHERE id = $3 RETURNING *`,
            [rate, is_active, id]
        );
        res.json({ success: true, data: result.rows[0], message: 'Rate updated successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/rates/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM rates WHERE id = $1', [id]);
        res.json({ success: true, message: 'Rate deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== MCCMNC CRUD with Import/Export ====================
app.get('/api/mccmnc', auth, async (req, res) => {
    try {
        const { mcc, country, limit = 500 } = req.query;
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

app.post('/api/mccmnc', auth, async (req, res) => {
    try {
        const { country, country_code, mcc, mnc, operator, network_type, status } = req.body;
        const result = await pool.query(
            `INSERT INTO mccmnc (country, country_code, mcc, mnc, operator, network_type, status, created_at) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) 
             ON CONFLICT (mcc, mnc) DO UPDATE SET operator = EXCLUDED.operator, updated_at = NOW()
             RETURNING *`,
            [country, country_code, mcc, mnc, operator, network_type, status || 'active']
        );
        res.json({ success: true, data: result.rows[0], message: 'MCCMNC record saved successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/mccmnc/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const { country, country_code, mcc, mnc, operator, network_type, status } = req.body;
        const result = await pool.query(
            `UPDATE mccmnc SET country = COALESCE($1, country), country_code = COALESCE($2, country_code), mcc = COALESCE($3, mcc), mnc = COALESCE($4, mnc), operator = COALESCE($5, operator), network_type = COALESCE($6, network_type), status = COALESCE($7, status) WHERE id = $8 RETURNING *`,
            [country, country_code, mcc, mnc, operator, network_type, status, id]
        );
        res.json({ success: true, data: result.rows[0], message: 'MCCMNC record updated successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/mccmnc/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM mccmnc WHERE id = $1', [id]);
        res.json({ success: true, message: 'MCCMNC record deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/mccmnc/export/csv', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT country, country_code, mcc, mnc, operator, network_type, status FROM mccmnc ORDER BY country, operator');
        let csv = 'country,country_code,mcc,mnc,operator,network_type,status\n';
        for (const row of result.rows) {
            csv += `"${row.country}",${row.country_code},${row.mcc},${row.mnc},"${row.operator}",${row.network_type},${row.status}\n`;
        }
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=mccmnc_export.csv');
        res.send(csv);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/mccmnc/import/csv', auth, async (req, res) => {
    try {
        const { data } = req.body;
        const lines = data.split('\n');
        const headers = lines[0].split(',');
        let imported = 0, skipped = 0;
        
        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            const values = lines[i].split(',');
            if (values.length >= 7) {
                try {
                    await pool.query(
                        `INSERT INTO mccmnc (country, country_code, mcc, mnc, operator, network_type, status, created_at) 
                         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) 
                         ON CONFLICT (mcc, mnc) DO NOTHING`,
                        [values[0].replace(/"/g, ''), values[1], values[2], values[3], values[4].replace(/"/g, ''), values[5], values[6]]
                    );
                    imported++;
                } catch (err) {
                    skipped++;
                }
            }
        }
        res.json({ success: true, imported, skipped, message: `Imported ${imported} records, skipped ${skipped}` });
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

// Serve frontend
app.use(express.static(path.join(__dirname, 'dist')));
app.get(/^\/(?!api).*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Server running on port ${PORT}`);
    console.log(`📍 API: http://localhost:${PORT}/api`);
    console.log(`🌐 Frontend: http://localhost:${PORT}`);
});

// ==================== RATES EXPORT & BULK ====================
app.get('/api/rates/export/csv', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM rates ORDER BY id');
        let csv = 'id,entity_id,mcc,mnc,rate,currency,is_active\n';
        for (const row of result.rows) {
            csv += `${row.id},${row.entity_id},${row.mcc},${row.mnc},${row.rate},${row.currency},${row.is_active}\n`;
        }
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=rates_export.csv');
        res.send(csv);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/rates/bulk', auth, async (req, res) => {
    try {
        const { updates } = req.body;
        for (const update of updates) {
            await pool.query('UPDATE rates SET rate = $1, updated_at = NOW() WHERE id = $2', [update.rate, update.id]);
        }
        res.json({ success: true, message: `${updates.length} rates updated` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/rates/template/csv', auth, async (req, res) => {
    const template = 'supplier_code,mcc,mnc,rate,currency\nSUP001,470,01,0.0050,USD\nSUP001,470,02,0.0045,USD\n';
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=rates_template.csv');
    res.send(template);
});

app.post('/api/rates/bulk-upload', auth, async (req, res) => {
    try {
        const { records } = req.body;
        let imported = 0;
        for (const record of records) {
            const supplier = await pool.query('SELECT id FROM suppliers WHERE supplier_code = $1', [record.supplier_code]);
            if (supplier.rows.length > 0) {
                await pool.query(
                    `INSERT INTO rates (entity_id, mcc, mnc, rate, currency, is_active, created_at, updated_at) 
                     VALUES ($1, $2, $3, $4, $5, true, NOW(), NOW()) 
                     ON CONFLICT (entity_id, mcc, mnc) DO UPDATE SET rate = $4, updated_at = NOW()`,
                    [supplier.rows[0].id, record.mcc, record.mnc, record.rate, record.currency]
                );
                imported++;
            }
        }
        res.json({ success: true, imported, message: `Imported ${imported} rates` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== SMS LOGS ====================
app.get('/api/sms/logs', auth, async (req, res) => {
    try {
        const { limit = 100, offset = 0 } = req.query;
        const result = await pool.query('SELECT * FROM sms_logs ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]);
        res.json({ success: true, data: result.rows, count: result.rows.length });
    } catch (error) {
        // Return empty array if table doesn't exist
        res.json({ success: true, data: [], count: 0 });
    }
});

app.get('/api/sms/logs/export/csv', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM sms_logs ORDER BY created_at DESC');
        let csv = 'id,client_id,destination,message,status,created_at\n';
        for (const row of result.rows) {
            csv += `${row.id},${row.client_id},${row.destination},${row.message},${row.status},${row.created_at}\n`;
        }
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=sms_logs.csv');
        res.send(csv);
    } catch (error) {
        res.setHeader('Content-Type', 'text/csv');
        res.send('id,client_id,destination,message,status,created_at\n');
    }
});

// ==================== SMS INBOX ====================
app.get('/api/sms/inbox', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM sms_inbox ORDER BY received_at DESC LIMIT 100');
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.json({ success: true, data: [] });
    }
});

app.get('/api/sms/inbox/export/csv', auth, async (req, res) => {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=sms_inbox.csv');
    res.send('id,from_number,message,received_at,status\n');
});

// ==================== REPORTS ====================
app.get('/api/reports/realtime', auth, async (req, res) => {
    try {
        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total_sms,
                COUNT(CASE WHEN status = 'delivered' THEN 1 END) as delivered,
                COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed,
                NOW() as timestamp
            FROM sms_logs WHERE created_at > NOW() - INTERVAL '24 hours'
        `);
        res.json({ success: true, data: stats.rows[0] });
    } catch (error) {
        res.json({ success: true, data: { total_sms: 0, delivered: 0, failed: 0 } });
    }
});

app.get('/api/reports/export/csv', auth, async (req, res) => {
    const { type = 'daily' } = req.query;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=${type}_report.csv`);
    res.send('date,total_sms,delivered,failed\n');
});

// ==================== INVOICES ====================
app.post('/api/invoices/generate', auth, async (req, res) => {
    try {
        const { client_id, month, amount } = req.body;
        const result = await pool.query(
            `INSERT INTO invoices (client_id, month, amount, status, created_at) 
             VALUES ($1, $2, $3, 'pending', NOW()) RETURNING *`,
            [client_id, month, amount]
        );
        res.json({ success: true, data: result.rows[0], message: 'Invoice generated' });
    } catch (error) {
        // Create invoices table if not exists
        await pool.query(`
            CREATE TABLE IF NOT EXISTS invoices (
                id SERIAL PRIMARY KEY,
                client_id INTEGER REFERENCES clients(id),
                month VARCHAR(7),
                amount DECIMAL(10,2),
                status VARCHAR(20) DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        const result = await pool.query(
            `INSERT INTO invoices (client_id, month, amount, status, created_at) 
             VALUES ($1, $2, $3, 'pending', NOW()) RETURNING *`,
            [client_id, month, amount]
        );
        res.json({ success: true, data: result.rows[0], message: 'Invoice generated' });
    }
});

app.get('/api/invoices', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM invoices ORDER BY created_at DESC');
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.json({ success: true, data: [] });
    }
});

// ==================== CAMPAIGNS ====================
app.post('/api/campaigns', auth, async (req, res) => {
    try {
        const { name, message, scheduled_time, target_mcc } = req.body;
        const result = await pool.query(
            `INSERT INTO campaigns (name, message, scheduled_time, target_mcc, status, created_at) 
             VALUES ($1, $2, $3, $4, 'draft', NOW()) RETURNING *`,
            [name, message, scheduled_time, target_mcc]
        );
        res.json({ success: true, data: result.rows[0], message: 'Campaign created' });
    } catch (error) {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS campaigns (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255),
                message TEXT,
                scheduled_time TIMESTAMP,
                target_mcc VARCHAR(10),
                status VARCHAR(20) DEFAULT 'draft',
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);
        const result = await pool.query(
            `INSERT INTO campaigns (name, message, scheduled_time, target_mcc, status, created_at) 
             VALUES ($1, $2, $3, $4, 'draft', NOW()) RETURNING *`,
            [name, message, scheduled_time, target_mcc]
        );
        res.json({ success: true, data: result.rows[0], message: 'Campaign created' });
    }
});

app.get('/api/campaigns', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM campaigns ORDER BY created_at DESC');
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.json({ success: true, data: [] });
    }
});

app.put('/api/campaigns/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const { status, name, message, scheduled_time } = req.body;
        const result = await pool.query(
            `UPDATE campaigns SET status = COALESCE($1, status), name = COALESCE($2, name), message = COALESCE($3, message), scheduled_time = COALESCE($4, scheduled_time), updated_at = NOW() WHERE id = $5 RETURNING *`,
            [status, name, message, scheduled_time, id]
        );
        res.json({ success: true, data: result.rows[0], message: 'Campaign updated' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/campaigns/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM campaigns WHERE id = $1', [id]);
        res.json({ success: true, message: 'Campaign deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

