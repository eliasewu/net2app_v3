const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'net2app_hub',
    user: 'net2app_user',
    password: 'Ariya@2024Net2App',
});

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

// Auth
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    if (result.rows.length === 0) return res.status(401).json({ error: 'Invalid' });
    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid' });
    const token = jwt.sign({ id: user.id, username: user.username }, 'net2app-hub-secret-key-2024', { expiresIn: '24h' });
    res.json({ success: true, token, user });
});

// CLIENTS
app.get('/api/clients', auth, async (req, res) => {
    const result = await pool.query('SELECT * FROM clients ORDER BY id');
    res.json({ success: true, data: result.rows });
});

app.post('/api/clients', auth, async (req, res) => {
    const { client_code, company_name, smpp_username, smpp_password, max_tps } = req.body;
    const result = await pool.query(
        'INSERT INTO clients (client_code, company_name, smpp_username, smpp_password, max_tps, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) RETURNING *',
        [client_code, company_name, smpp_username, smpp_password, max_tps || 100]
    );
    res.json({ success: true, data: result.rows[0] });
});

app.put('/api/clients/:id', auth, async (req, res) => {
    const { id } = req.params;
    const { company_name, max_tps } = req.body;
    const result = await pool.query(
        'UPDATE clients SET company_name = COALESCE($1, company_name), max_tps = COALESCE($2, max_tps), updated_at = NOW() WHERE id = $3 RETURNING *',
        [company_name, max_tps, id]
    );
    res.json({ success: true, data: result.rows[0] });
});

app.delete('/api/clients/:id', auth, async (req, res) => {
    const { id } = req.params;
    await pool.query('DELETE FROM clients WHERE id = $1', [id]);
    res.json({ success: true, message: 'Deleted' });
});

// SUPPLIERS
app.get('/api/suppliers', auth, async (req, res) => {
    const result = await pool.query('SELECT * FROM suppliers ORDER BY id');
    res.json({ success: true, data: result.rows });
});

app.post('/api/suppliers', auth, async (req, res) => {
    const { supplier_code, company_name, connection_type } = req.body;
    const result = await pool.query(
        'INSERT INTO suppliers (supplier_code, company_name, connection_type, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW()) RETURNING *',
        [supplier_code, company_name, connection_type]
    );
    res.json({ success: true, data: result.rows[0] });
});

app.put('/api/suppliers/:id', auth, async (req, res) => {
    const { id } = req.params;
    const { company_name } = req.body;
    const result = await pool.query(
        'UPDATE suppliers SET company_name = COALESCE($1, company_name), updated_at = NOW() WHERE id = $2 RETURNING *',
        [company_name, id]
    );
    res.json({ success: true, data: result.rows[0] });
});

app.delete('/api/suppliers/:id', auth, async (req, res) => {
    const { id } = req.params;
    await pool.query('DELETE FROM suppliers WHERE id = $1', [id]);
    res.json({ success: true, message: 'Deleted' });
});

// TRUNKS
app.get('/api/trunks', auth, async (req, res) => {
    const result = await pool.query('SELECT * FROM trunks ORDER BY id');
    res.json({ success: true, data: result.rows });
});

app.post('/api/trunks', auth, async (req, res) => {
    const { trunk_name, supplier_id, trunk_type } = req.body;
    const result = await pool.query(
        'INSERT INTO trunks (trunk_name, supplier_id, trunk_type, created_at, updated_at) VALUES ($1, $2, $3, NOW(), NOW()) RETURNING *',
        [trunk_name, supplier_id, trunk_type]
    );
    res.json({ success: true, data: result.rows[0] });
});

app.put('/api/trunks/:id', auth, async (req, res) => {
    const { id } = req.params;
    const { trunk_name } = req.body;
    const result = await pool.query(
        'UPDATE trunks SET trunk_name = COALESCE($1, trunk_name), updated_at = NOW() WHERE id = $2 RETURNING *',
        [trunk_name, id]
    );
    res.json({ success: true, data: result.rows[0] });
});

app.delete('/api/trunks/:id', auth, async (req, res) => {
    const { id } = req.params;
    await pool.query('DELETE FROM trunks WHERE id = $1', [id]);
    res.json({ success: true, message: 'Deleted' });
});

// ROUTES
app.get('/api/routes', auth, async (req, res) => {
    const result = await pool.query('SELECT * FROM routes ORDER BY id');
    res.json({ success: true, data: result.rows });
});

app.post('/api/routes', auth, async (req, res) => {
    const { route_name, trunk_ids } = req.body;
    const result = await pool.query(
        'INSERT INTO routes (route_name, trunk_ids, created_at, updated_at) VALUES ($1, $2, NOW(), NOW()) RETURNING *',
        [route_name, trunk_ids]
    );
    res.json({ success: true, data: result.rows[0] });
});

app.delete('/api/routes/:id', auth, async (req, res) => {
    const { id } = req.params;
    await pool.query('DELETE FROM routes WHERE id = $1', [id]);
    res.json({ success: true, message: 'Deleted' });
});

// ROUTE PLANS
app.get('/api/route-plans', auth, async (req, res) => {
    const result = await pool.query('SELECT * FROM route_plans ORDER BY id');
    res.json({ success: true, data: result.rows });
});

app.post('/api/route-plans', auth, async (req, res) => {
    const { plan_name, route_ids } = req.body;
    const result = await pool.query(
        'INSERT INTO route_plans (plan_name, route_ids, created_at, updated_at) VALUES ($1, $2, NOW(), NOW()) RETURNING *',
        [plan_name, route_ids]
    );
    res.json({ success: true, data: result.rows[0] });
});

app.delete('/api/route-plans/:id', auth, async (req, res) => {
    const { id } = req.params;
    await pool.query('DELETE FROM route_plans WHERE id = $1', [id]);
    res.json({ success: true, message: 'Deleted' });
});

// RATES
app.get('/api/rates', auth, async (req, res) => {
    const result = await pool.query('SELECT * FROM rates ORDER BY id');
    res.json({ success: true, data: result.rows });
});

app.post('/api/rates', auth, async (req, res) => {
    const { entity_id, mcc, rate, currency } = req.body;
    const result = await pool.query(
        'INSERT INTO rates (entity_id, mcc, rate, currency, created_at, updated_at) VALUES ($1, $2, $3, $4, NOW(), NOW()) RETURNING *',
        [entity_id, mcc, rate, currency]
    );
    res.json({ success: true, data: result.rows[0] });
});

app.put('/api/rates/:id', auth, async (req, res) => {
    const { id } = req.params;
    const { rate } = req.body;
    const result = await pool.query(
        'UPDATE rates SET rate = COALESCE($1, rate), updated_at = NOW() WHERE id = $2 RETURNING *',
        [rate, id]
    );
    res.json({ success: true, data: result.rows[0] });
});

app.delete('/api/rates/:id', auth, async (req, res) => {
    const { id } = req.params;
    await pool.query('DELETE FROM rates WHERE id = $1', [id]);
    res.json({ success: true, message: 'Deleted' });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// ==================== MCCMNC ENDPOINTS ====================

// Get all MCCMNC records (with optional filters)
app.get('/api/mccmnc', auth, async (req, res) => {
    try {
        const { mcc, country, operator, status } = req.query;
        let query = 'SELECT * FROM mccmnc WHERE 1=1';
        let params = [];
        let paramIndex = 1;
        
        if (mcc) {
            query += ` AND mcc = $${paramIndex}`;
            params.push(mcc);
            paramIndex++;
        }
        if (country) {
            query += ` AND country ILIKE $${paramIndex}`;
            params.push(`%${country}%`);
            paramIndex++;
        }
        if (operator) {
            query += ` AND operator ILIKE $${paramIndex}`;
            params.push(`%${operator}%`);
            paramIndex++;
        }
        if (status) {
            query += ` AND status = $${paramIndex}`;
            params.push(status);
            paramIndex++;
        }
        
        query += ' ORDER BY country, operator';
        const result = await pool.query(query, params);
        res.json({ success: true, data: result.rows, count: result.rows.length });
    } catch (error) {
        console.error('Error fetching MCCMNC:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get single MCCMNC by ID
app.get('/api/mccmnc/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM mccmnc WHERE id = $1', [id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'MCCMNC record not found' });
        }
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get MCCMNC by MCC code (all operators in a country)
app.get('/api/mccmnc/mcc/:mcc', auth, async (req, res) => {
    try {
        const { mcc } = req.params;
        const result = await pool.query(
            'SELECT * FROM mccmnc WHERE mcc = $1 AND status = "active" ORDER BY operator',
            [mcc]
        );
        res.json({ success: true, data: result.rows, count: result.rows.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create new MCCMNC record
app.post('/api/mccmnc', auth, async (req, res) => {
    try {
        const { country, country_code, mcc, mnc, operator, network_type, status } = req.body;
        
        // Validate required fields
        if (!country || !country_code || !mcc || !mnc || !operator) {
            return res.status(400).json({ 
                error: 'Missing required fields: country, country_code, mcc, mnc, operator' 
            });
        }
        
        // Check if duplicate exists
        const checkDuplicate = await pool.query(
            'SELECT id FROM mccmnc WHERE mcc = $1 AND mnc = $2',
            [mcc, mnc]
        );
        
        if (checkDuplicate.rows.length > 0) {
            return res.status(409).json({ 
                error: 'MCCMNC combination already exists',
                existing_id: checkDuplicate.rows[0].id
            });
        }
        
        const result = await pool.query(
            `INSERT INTO mccmnc (country, country_code, mcc, mnc, operator, network_type, status, created_at) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) 
             RETURNING *`,
            [country, country_code, mcc, mnc, operator, network_type || 'GSM', status || 'active']
        );
        
        res.json({ 
            success: true, 
            data: result.rows[0], 
            message: 'MCCMNC record created successfully' 
        });
    } catch (error) {
        console.error('Error creating MCCMNC:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update MCCMNC record
app.put('/api/mccmnc/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const { country, country_code, mcc, mnc, operator, network_type, status } = req.body;
        
        const result = await pool.query(
            `UPDATE mccmnc SET 
                country = COALESCE($1, country),
                country_code = COALESCE($2, country_code),
                mcc = COALESCE($3, mcc),
                mnc = COALESCE($4, mnc),
                operator = COALESCE($5, operator),
                network_type = COALESCE($6, network_type),
                status = COALESCE($7, status)
             WHERE id = $8 
             RETURNING *`,
            [country, country_code, mcc, mnc, operator, network_type, status, id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'MCCMNC record not found' });
        }
        
        res.json({ 
            success: true, 
            data: result.rows[0], 
            message: 'MCCMNC record updated successfully' 
        });
    } catch (error) {
        console.error('Error updating MCCMNC:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete MCCMNC record (soft delete by setting status to inactive)
app.delete('/api/mccmnc/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const { permanent } = req.query;
        
        if (permanent === 'true') {
            // Permanent delete
            const result = await pool.query('DELETE FROM mccmnc WHERE id = $1 RETURNING operator', [id]);
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'MCCMNC record not found' });
            }
            res.json({ 
                success: true, 
                message: `MCCMNC record for ${result.rows[0].operator} permanently deleted` 
            });
        } else {
            // Soft delete (set status to inactive)
            const result = await pool.query(
                'UPDATE mccmnc SET status = "inactive" WHERE id = $1 RETURNING operator',
                [id]
            );
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'MCCMNC record not found' });
            }
            res.json({ 
                success: true, 
                message: `MCCMNC record for ${result.rows[0].operator} deactivated`,
                soft_delete: true
            });
        }
    } catch (error) {
        console.error('Error deleting MCCMNC:', error);
        res.status(500).json({ error: error.message });
    }
});

// Bulk import MCCMNC records
app.post('/api/mccmnc/bulk-import', auth, async (req, res) => {
    try {
        const { records } = req.body;
        
        if (!records || !Array.isArray(records) || records.length === 0) {
            return res.status(400).json({ error: 'No records provided for import' });
        }
        
        let imported = 0;
        let skipped = 0;
        let errors = [];
        
        for (const record of records) {
            try {
                const { country, country_code, mcc, mnc, operator, network_type, status } = record;
                
                // Check if exists
                const exists = await pool.query(
                    'SELECT id FROM mccmnc WHERE mcc = $1 AND mnc = $2',
                    [mcc, mnc]
                );
                
                if (exists.rows.length > 0) {
                    skipped++;
                    continue;
                }
                
                await pool.query(
                    `INSERT INTO mccmnc (country, country_code, mcc, mnc, operator, network_type, status, created_at) 
                     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
                    [country, country_code, mcc, mnc, operator, network_type || 'GSM', status || 'active']
                );
                imported++;
            } catch (err) {
                errors.push({ record, error: err.message });
            }
        }
        
        res.json({
            success: true,
            message: `Bulk import completed: ${imported} imported, ${skipped} skipped`,
            imported,
            skipped,
            errors: errors.length > 0 ? errors : undefined
        });
    } catch (error) {
        console.error('Error in bulk import:', error);
        res.status(500).json({ error: error.message });
    }
});

// Export MCCMNC records to CSV/JSON
app.get('/api/mccmnc/export/:format', auth, async (req, res) => {
    try {
        const { format } = req.params;
        const { status } = req.query;
        
        let query = 'SELECT id, country, country_code, mcc, mnc, operator, network_type, status, created_at FROM mccmnc';
        let params = [];
        
        if (status) {
            query += ' WHERE status = $1';
            params.push(status);
        }
        
        query += ' ORDER BY country, operator';
        
        const result = await pool.query(query, params);
        
        if (format === 'csv') {
            // Export as CSV
            const headers = ['id', 'country', 'country_code', 'mcc', 'mnc', 'operator', 'network_type', 'status', 'created_at'];
            const csvRows = [];
            csvRows.push(headers.join(','));
            
            for (const row of result.rows) {
                const values = headers.map(header => {
                    let value = row[header];
                    if (value === null) return '';
                    if (typeof value === 'string') return `"${value.replace(/"/g, '""')}"`;
                    if (value instanceof Date) return value.toISOString();
                    return value;
                });
                csvRows.push(values.join(','));
            }
            
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename=mccmnc_export.csv');
            return res.send(csvRows.join('\n'));
        } else {
            // Export as JSON
            res.json({
                success: true,
                count: result.rows.length,
                data: result.rows,
                exported_at: new Date().toISOString()
            });
        }
    } catch (error) {
        console.error('Error exporting MCCMNC:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get statistics
app.get('/api/mccmnc/stats/summary', auth, async (req, res) => {
    try {
        const stats = await pool.query(`
            SELECT 
                COUNT(*) as total_records,
                COUNT(DISTINCT country) as total_countries,
                COUNT(DISTINCT mcc) as total_mccs,
                COUNT(CASE WHEN status = 'active' THEN 1 END) as active_records,
                COUNT(CASE WHEN network_type = 'GSM' THEN 1 END) as gsm_networks,
                COUNT(CASE WHEN network_type = 'CDMA' THEN 1 END) as cdma_networks,
                COUNT(CASE WHEN network_type = '4G' THEN 1 END) as lte_networks,
                COUNT(CASE WHEN network_type = '5G' THEN 1 END) as nr_networks
            FROM mccmnc
        `);
        
        const topCountries = await pool.query(`
            SELECT country, COUNT(*) as operator_count 
            FROM mccmnc 
            GROUP BY country 
            ORDER BY operator_count DESC 
            LIMIT 10
        `);
        
        res.json({
            success: true,
            statistics: stats.rows[0],
            top_countries: topCountries.rows
        });
    } catch (error) {
        console.error('Error fetching stats:', error);
        res.status(500).json({ error: error.message });
    }
});

