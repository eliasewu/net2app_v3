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

// ==================== CLIENTS ====================
app.get('/api/clients', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, client_code, company_name, max_tps, status FROM clients ORDER BY id');
        res.json({ success: true, data: result.rows });
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
        res.json({ success: true, data: result.rows[0], message: 'Client created' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== RATES ====================
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
        res.json({ success: true, data: result.rows[0], message: 'Rate created' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/rates/export/csv', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, entity_id, mcc, mnc, rate, currency, is_active FROM rates ORDER BY id');
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
        let updated = 0;
        for (const update of updates) {
            await pool.query('UPDATE rates SET rate = $1, updated_at = NOW() WHERE id = $2', [update.rate, update.id]);
            updated++;
        }
        res.json({ success: true, message: `${updated} rates updated` });
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

// ==================== ROUTE PLANS ====================
app.get('/api/route-plans', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM route_plans ORDER BY id');
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.json({ success: true, data: [] });
    }
});

app.post('/api/route-plans', auth, async (req, res) => {
    try {
        const { plan_name, route_ids } = req.body;
        const result = await pool.query(
            `INSERT INTO route_plans (plan_name, route_ids, status, created_at, updated_at) 
             VALUES ($1, $2, 'active', NOW(), NOW()) RETURNING *`,
            [plan_name, route_ids || []]
        );
        res.json({ success: true, data: result.rows[0], message: 'Route plan created' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== SUPPLIERS ====================
app.get('/api/suppliers', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, supplier_code, company_name, connection_type, status FROM suppliers ORDER BY id');
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.json({ success: true, data: [] });
    }
});

// ==================== TRUNKS ====================
app.get('/api/trunks', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, trunk_name, supplier_id, trunk_type, status FROM trunks ORDER BY id');
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.json({ success: true, data: [] });
    }
});

// ==================== ROUTES ====================
app.get('/api/routes', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, route_name, trunk_ids, status FROM routes ORDER BY id');
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.json({ success: true, data: [] });
    }
});

// ==================== MCCMNC ====================
app.get('/api/mccmnc', auth, async (req, res) => {
    try {
        const { mcc, country, limit = 100 } = req.query;
        let query = 'SELECT id, country, country_code, mcc, mnc, operator, network_type, status FROM mccmnc WHERE 1=1';
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
        res.json({ success: true, data: [], count: 0 });
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
        res.json({ success: true, data: result.rows[0], message: 'MCCMNC saved' });
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
        let imported = 0, skipped = 0;
        
        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            const matches = lines[i].match(/(".*?"|[^,]+)(?=\s*,|\s*$)/g);
            if (matches && matches.length >= 7) {
                const country = matches[0].replace(/"/g, '');
                const country_code = matches[1];
                const mcc = matches[2];
                const mnc = matches[3];
                const operator = matches[4].replace(/"/g, '');
                const network_type = matches[5];
                const status = matches[6];
                
                try {
                    await pool.query(
                        `INSERT INTO mccmnc (country, country_code, mcc, mnc, operator, network_type, status, created_at) 
                         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) 
                         ON CONFLICT (mcc, mnc) DO NOTHING`,
                        [country, country_code, mcc, mnc, operator, network_type, status]
                    );
                    imported++;
                } catch (err) {
                    skipped++;
                }
            }
        }
        res.json({ success: true, imported, skipped, message: `Imported ${imported}, skipped ${skipped}` });
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
        res.json({ success: true, statistics: { total_records: 0, total_countries: 0, total_mccs: 0, active_records: 0 } });
    }
});

// ==================== SMS LOGS ====================
app.get('/api/sms/logs', auth, async (req, res) => {
    res.json({ success: true, data: [], count: 0 });
});

app.get('/api/sms/logs/export/csv', auth, async (req, res) => {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=sms_logs.csv');
    res.send('id,client_id,destination,message,status,created_at\n');
});

// ==================== SMS INBOX ====================
app.get('/api/sms/inbox', auth, async (req, res) => {
    res.json({ success: true, data: [] });
});

app.get('/api/sms/inbox/export/csv', auth, async (req, res) => {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=sms_inbox.csv');
    res.send('id,from_number,message,received_at,status\n');
});

// ==================== REPORTS ====================
app.get('/api/reports/realtime', auth, async (req, res) => {
    res.json({ success: true, data: { total_sms: 0, delivered: 0, failed: 0, timestamp: new Date().toISOString() } });
});

app.get('/api/reports/export/csv', auth, async (req, res) => {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=report.csv');
    res.send('date,total_sms,delivered,failed\n');
});

// ==================== CAMPAIGNS ====================
app.post('/api/campaigns', auth, async (req, res) => {
    try {
        const { name, message, scheduled_time, target_mcc } = req.body;
        const result = await pool.query(
            `INSERT INTO campaigns (name, message, scheduled_time, target_mcc, status, created_at, updated_at) 
             VALUES ($1, $2, $3, $4, 'draft', NOW(), NOW()) RETURNING *`,
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
        const { name, message, scheduled_time, target_mcc } = req.body;
        const result = await pool.query(
            `INSERT INTO campaigns (name, message, scheduled_time, target_mcc, status, created_at, updated_at) 
             VALUES ($1, $2, $3, $4, 'draft', NOW(), NOW()) RETURNING *`,
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
        await pool.query(`
            CREATE TABLE IF NOT EXISTS invoices (
                id SERIAL PRIMARY KEY,
                client_id INTEGER,
                month VARCHAR(7),
                amount DECIMAL(10,2),
                status VARCHAR(20) DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);
        const { client_id, month, amount } = req.body;
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

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve frontend
app.use(express.static(path.join(__dirname, 'dist')));
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
