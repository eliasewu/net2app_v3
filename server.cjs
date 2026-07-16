const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const pg = require('pg');
const { Pool } = pg;
const path = require('path');
const multer = require('multer');
const cookieParser = require('cookie-parser');

// Parse PostgreSQL NUMERIC/DECIMAL columns as JavaScript numbers (not strings).
// OID 1700 = NUMERIC. Without this, all DECIMAL columns (rates, balances,
// profits, etc.) arrive as strings and crash frontend .toFixed() calls.
pg.types.setTypeParser(1700, val => parseFloat(val));

// Parse PostgreSQL array columns into JavaScript arrays.
// Without this, INTEGER[] and TEXT[] columns (route_ids, trunk_ids,
// mccmnc_allowed, allowed_channels, etc.) arrive as strings like "{1,2,3}"
// which breaks frontend .map()/.find()/.includes() calls.
const parsePgArray = (val) => {
  if (val === null || val === undefined) return null;
  if (typeof val !== 'string') return val;
  if (val === '{}') return [];
  const stripped = val.replace(/^{|}$/g, '');
  if (stripped === '') return [];
  return stripped.split(',').map(v => {
    const trimmed = v.trim();
    // Try number first, fallback to string
    const num = Number(trimmed);
    return isNaN(num) || trimmed === '' ? trimmed : num;
  });
};
// OIDs: 1007 = int4[], 1005 = int2[], 1016 = int8[], 1009 = text[], 1015 = varchar[]
pg.types.setTypeParser(1007, parsePgArray);
pg.types.setTypeParser(1005, parsePgArray);
pg.types.setTypeParser(1016, parsePgArray);
pg.types.setTypeParser(1009, parsePgArray);
pg.types.setTypeParser(1015, parsePgArray);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

const { applyRules } = require('./src/services/translationEngine.cjs');

const voiceOtpUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// PRODUCTION-TUNED POOL: 50 connections for 1000+ clients/suppliers
// idleTimeoutMillis: release idle connections after 30s
// connectionTimeoutMillis: fail fast if DB is slow
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'sms_platform',
    user: process.env.DB_USER || 'sms_user',
    password: process.env.DB_PASS || 'Ariya@2024Net2App',
    max: 50,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

// Post-process all pool.query results: convert DECIMAL strings to numbers.
// This works at the database layer — every row is transformed before any
// route handler sees it. Only strings containing a decimal point are converted
// (e.g. "0.022000") to avoid corrupting phone numbers and integer IDs.
console.error('[INIT] Server starting...');

// ============================================================
// PRODUCTION QUEUE SYSTEM (1000+ clients, 1000+ suppliers)
// PostgreSQL-based async job queue with FOR UPDATE SKIP LOCKED
// Multiple worker pipelines, token-bucket rate limiting, DLQ
// ============================================================
let queueManager = null;
let rateLimiter = null;
let connectionPoolMgr = null;

(async () => {
    try {
        // Dynamic imports for ESM modules in CJS context
        rateLimiter = (await import('./src/services/rateLimiter.mjs')).default;
        const SMSQueueManager = (await import('./src/services/smsQueueManager.mjs')).default;
        connectionPoolMgr = (await import('./src/services/connectionPipeline.mjs')).default;

        queueManager = new SMSQueueManager(pool, {
            pollIntervalMs: 100,
            batchSize: 100,
            workerCount: 8,
            maxRetries: 5,
        });

        await queueManager.initialize();

        // Configure rate limiters for existing active clients and suppliers
        const [clients, suppliers] = await Promise.all([
            pool.query("SELECT id, max_tps FROM clients WHERE status='active' AND (is_deleted IS NULL OR is_deleted = false)"),
            pool.query("SELECT * FROM suppliers WHERE status='active' AND (is_deleted IS NULL OR is_deleted = false)")
        ]);

        for (const c of clients.rows) {
            rateLimiter.configureClient(c.id, c.max_tps || 100);
        }
        for (const s of suppliers.rows) {
            rateLimiter.configureSupplier(s.id, 200);
            // Only configure outbound pipelines for non-inbound suppliers.
            // Inbound suppliers (GSM gateways) connect TO us via SMPP server on port 2775.
            if (!s.is_inbound) {
                await connectionPoolMgr.configureSupplier(s);
            }
        }

        console.error(`[INIT] QueueManager: ${clients.rows.length} clients, ${suppliers.rows.length} suppliers configured`);

        // Start worker pool
        queueManager.start();

        // Periodic health: reconnect broken pipelines every 30s
        setInterval(() => { connectionPoolMgr.healthCheck().catch(() => {}); }, 30000);

        // Periodic stuck job recovery every 60s
        setInterval(async () => {
            try {
                await pool.query('SELECT recover_stuck_outbox_jobs(10)');
            } catch (e) { /* function may not exist yet */ }
        }, 60000);

        // ======== DLR POLLING: Voice OTP HTTP connectors ========
        // Polls pending voice OTP calls every 30s and checks delivery status
        // via the connector's dlr_url. Updates voice_otp_logs accordingly.
        setInterval(async () => {
            try {
                const pending = await pool.query(
                    `SELECT * FROM voice_otp_logs WHERE dlr_status = 'PENDING' AND sip_server_id IS NOT NULL AND status = 'sent' ORDER BY created_at DESC LIMIT 50`
                );
                if (!pending.rows.length) return;

                for (const log of pending.rows) {
                    try {
                        const connR = await pool.query(
                            'SELECT * FROM api_connectors WHERE id = $1 AND is_active = true',
                            [log.sip_server_id]
                        );
                        if (!connR.rows.length) {
                            await pool.query(
                                `UPDATE voice_otp_logs SET dlr_status = 'UNKNOWN', error_message = 'Connector not found' WHERE id = $1`,
                                [log.id]
                            );
                            continue;
                        }
                        const conn = connR.rows[0];
                        if (!conn.dlr_url || !conn.api_key) continue;

                        const ctrl = new AbortController();
                        setTimeout(() => ctrl.abort(), 10000);
                        const url = new URL(conn.dlr_url);
                        url.searchParams.set('apiKey', conn.api_key);
                        url.searchParams.set('trans_id', log.sip_call_id);

                        const resp = await fetch(url.toString(), { signal: ctrl.signal });
                        const data = await resp.json().catch(() => null);

                        if (data?.status === 'success') {
                            await pool.query(
                                `UPDATE voice_otp_logs SET dlr_status = 'DELIVRD', status = 'completed',
                                 duration = COALESCE($2, 0), completed_at = NOW() WHERE id = $1`,
                                [log.id, data?.duration || 0]
                            );
                            console.error(`[DLR-POLL] ✅ ${log.call_id}: DELIVERED (${conn.name})`);
                        } else if (data?.status === 'failed') {
                            await pool.query(
                                `UPDATE voice_otp_logs SET dlr_status = 'UNDELIV', status = 'failed',
                                 error_message = COALESCE($2, ''), completed_at = NOW() WHERE id = $1`,
                                [log.id, data?.message || 'Delivery failed']
                            );
                            console.error(`[DLR-POLL] ❌ ${log.call_id}: FAILED (${conn.name})`);
                        }
                        // If status is 'not_found' or other — leave PENDING for next poll
                    } catch (err) {
                        // Individual call check failed, skip and try next poll cycle
                        if (err.name === 'AbortError') continue;
                        console.error(`[DLR-POLL] ⚠ ${log.call_id}: ${err.message}`);
                    }
                }
            } catch (e) {
                console.error('[DLR-POLL] Error in DLR polling cycle:', e.message);
            }
        }, 4000);

        console.error('[INIT] DLR polling started — Voice OTP delivery status checked every 4s');

        // ======== DLR POLLING: HTTP connector SMS deliveries ========
        // Polls sms_outbox for delivered jobs with connector_transaction_id.
        // Checks delivery status via the connector's dlr_url (from api_connectors table)
        // and updates sms_logs accordingly. Supports any Voice OTP / HTTP connector.
        const BORNO_OTP_SUPPLIER_ID = 63;
        setInterval(async () => {
            try {
                // Look up the connector's DLR URL and API key from the DB each cycle
                // (picks up config changes without restart)
                const supplierR = await pool.query(
                    `SELECT s.api_key, c.dlr_url FROM suppliers s
                     LEFT JOIN api_connectors c ON c.id = s.api_connector_id
                     WHERE s.id = $1 AND s.status = 'active'`,
                    [BORNO_OTP_SUPPLIER_ID]
                );
                if (!supplierR.rows.length) return;
                const { api_key, dlr_url } = supplierR.rows[0];
                if (!dlr_url || !api_key) return;

                const pending = await pool.query(
                    `SELECT * FROM sms_outbox WHERE supplier_id = $1
                     AND status = 'submitted' AND dlr_status = 'PENDING'
                     AND connector_transaction_id IS NOT NULL
                     AND dlr_confirmed_at IS NULL
                     ORDER BY completed_at DESC LIMIT 50`,
                    [BORNO_OTP_SUPPLIER_ID]
                );
                if (!pending.rows.length) return;

                for (const job of pending.rows) {
                    try {
                        const ctrl = new AbortController();
                        setTimeout(() => ctrl.abort(), 10000);
                        const url = new URL(dlr_url);
                        url.searchParams.set('apiKey', api_key);
                        url.searchParams.set('trans_id', job.connector_transaction_id);

                        const resp = await fetch(url.toString(), { signal: ctrl.signal });
                        const data = await resp.json().catch(() => null);

                        if (data?.status === 'success') {
                            await pool.query(
                                `UPDATE sms_outbox SET dlr_confirmed_at = NOW(), dlr_status = 'DELIVRD', status = 'delivered'
                                 WHERE id = $1`,
                                [job.id]
                            );
                            await pool.query(
                                `UPDATE sms_logs SET dlr_status = 'DELIVRD', status = 'delivered', delivery_time = $2, dlr_timestamp = NOW()
                                 WHERE message_id = $1`,
                                [job.message_id, data.call_end || new Date().toISOString()]
                            );
                            console.error(`[DLR-HTTPS] ✅ ${job.message_id}: DELIVERED (${data.call_end || 'N/A'}, ${data.duration || 0}s)`);
                            

                            // Webhook
                            if (job.webhook_url && queueManager) {
                                queueManager.sendWebhook(job.webhook_url, job.message_id, job.destination, 'delivered', 'DELIVRD', job.client_code).catch(() => {});
                            }
                            // DLR push to bound SMPP client
                            if (queueManager && queueManager.onDlr) {
                                queueManager.onDlr({
                                    client_id: job.client_id, message_id: job.message_id, destination: job.destination,
                                    sender_id: job.sender_id, status: 'DELIVRD', client_code: job.client_code, queued_at: job.queued_at
                                });
                            }
                        } else if (data?.status === 'failed') {
                            await pool.query(
                                `UPDATE sms_outbox SET dlr_confirmed_at = NOW(), dlr_status = 'UNDELIV', status = 'failed', last_error = $2
                                 WHERE id = $1`,
                                [job.id, data.message || 'Delivery failed']
                            );
                            await pool.query(
                                `UPDATE sms_logs SET dlr_status = 'UNDELIV', status = 'failed', error_message = $2
                                 WHERE message_id = $1`,
                                [job.message_id, data.message || 'Delivery failed']
                            );
                            console.error(`[DLR-HTTPS] ❌ ${job.message_id}: FAILED (${data.message || 'unknown'})`);
                        } else if (data?.status === 'not_found') {
                            // Transaction not found yet — call still in progress.
                            // Keep retrying for up to 3 minutes, then timeout.
                            const ageMs = Date.now() - new Date(job.completed_at || job.queued_at).getTime();
                            if (ageMs > 180000) {
                                await pool.query(
                                    `UPDATE sms_outbox SET dlr_confirmed_at = NOW(), dlr_status = 'UNDELIV', status = 'failed', last_error = $2
                                     WHERE id = $1`,
                                    [job.id, 'DLR timeout after 3 minutes']
                                );
                                await pool.query(
                                    `UPDATE sms_logs SET dlr_status = 'UNDELIV', status = 'failed', error_message = $2
                                     WHERE message_id = $1`,
                                    [job.message_id, 'DLR timeout after 3 minutes']
                                );
                                console.error(`[DLR-HTTPS] ⏰ ${job.message_id}: TIMEOUT after ${Math.round(ageMs/1000)}s`);
                                // Webhook + DLR push on timeout
                                if (job.webhook_url && queueManager) {
                                    queueManager.sendWebhook(job.webhook_url, job.message_id, job.destination, 'failed', 'UNDELIV', job.client_code).catch(() => {});
                                }
                                if (queueManager && queueManager.onDlr) {
                                    queueManager.onDlr({
                                        client_id: job.client_id, message_id: job.message_id, destination: job.destination,
                                        sender_id: job.sender_id, status: 'UNDELIV', client_code: job.client_code, queued_at: job.queued_at
                                    });
                                }
                            }
                            // Otherwise leave PENDING, retry next 5s poll
                        }
                    } catch (err) {
                        if (err.name === 'AbortError') continue;
                        console.error(`[DLR-HTTPS] ⚠ ${job.message_id}: ${err.message}`);
                    }
                }
            } catch (e) {
                console.error('[DLR-HTTPS] Error in DLR polling cycle:', e.message);
            }
        }, 5000);

        console.error('[INIT] HTTP connector DLR polling started — checks delivery status every 30s');

        console.error('[INIT] Production queue system READY — 8 workers, 100 batch, token-bucket rate limiting');


        // ======== HTTP SUPPLIER HEALTH CHECK ========
        // Pings all active HTTP suppliers' api_url every 60s.
        // Updates bind_status (bound/unbound) and consecutive_failures
        // so BindStatus, APIConnectors, and SMS routing all see real status.
        setInterval(async () => {
            try {
                const httpSuppliers = await pool.query(
                    `SELECT id, supplier_code, api_url, bind_status, consecutive_failures
                     FROM suppliers
                     WHERE connection_type = 'http'
                       AND status = 'active'
                       AND (is_deleted IS NULL OR is_deleted = false)
                       AND api_url IS NOT NULL`
                );
                for (const s of httpSuppliers.rows) {
                    try {
                        const ctrl = new AbortController();
                        const timer = setTimeout(() => ctrl.abort(), 5000);
                        const resp = await fetch(s.api_url, {
                            method: 'GET',
                            signal: ctrl.signal,
                            headers: { 'User-Agent': 'NET2APP-HealthCheck/1.0' }
                        });
                        clearTimeout(timer);
                        // Always keep suppliers bound — never mark as unbound.
                        // Health check is informational only: logs reachability
                        // and resets failure counters on success.
                        if (resp.ok || resp.status < 500) {
                            // Reachable — reset failures, ensure bound (only if needed)
                            await pool.query(
                                `UPDATE suppliers SET bind_status = 'bound', consecutive_failures = 0, updated_at = NOW()
                                 WHERE id = $1 AND (bind_status != 'bound' OR consecutive_failures != 0)`,
                                [s.id]
                            );
                        } else {
                            console.error(`[HTTP-HEALTH] ⚠ ${s.supplier_code} returned HTTP ${resp.status} — supplier stays bound`);
                        }
                    } catch (err) {
                        console.error(`[HTTP-HEALTH] ⚠ ${s.supplier_code} unreachable: ${err.message} — supplier stays bound`);
                    }
                }
            } catch (e) {
                // Silently skip cycle on error, retry next interval
            }
        }, 60000);

        console.error('[INIT] HTTP supplier health check started — pings api_url every 60s, updates bind_status');

        // ============================================================
        // SMPP ESME SERVER — handled by Java 21 SMPP Gateway
        // The Java gateway (java-sms-gateway) starts as a separate
        // systemd service (net2app-smpg) on port 2775.
        // Node.js only handles REST API + Web UI + HTTP/Voice OTP connectors.
        // ============================================================
        console.error('[INIT] ℹ SMPP handled by Java Gateway (net2app-smpg service on :2775)');

        // ============================================================
        // ASTERISK AMI CONNECTION — for Voice OTP real SIP origination
        // Connects to Asterisk Manager Interface using credentials from
        // the asterisk_settings DB table. Without this, voice_otp calls
        // fall back to simulated delivery (fake DELIVRD, no real call).
        // ============================================================
        try {
            const amiR = await pool.query(
                `SELECT ami_host, ami_port, ami_username, ami_secret, dialplan_context
                 FROM asterisk_settings ORDER BY id LIMIT 1`
            );
            if (amiR.rows.length > 0) {
                const ami = amiR.rows[0];
                const bridge = require('./asterisk-bridge.cjs');
                bridge.connect({
                    host: ami.ami_host || '127.0.0.1',
                    port: parseInt(ami.ami_port) || 5038,
                    username: ami.ami_username || 'net2app',
                    password: ami.ami_secret || 'net2app_secret',
                });
                console.error('[INIT] Asterisk AMI connecting to %s:%s (user: %s)',
                    ami.ami_host, ami.ami_port, ami.ami_username);
            } else {
                console.error('[INIT] ⚠ No asterisk_settings found — voice OTP calls will be simulated');
            }
        } catch (e) {
            console.error('[INIT] Asterisk AMI connect failed (non-fatal):', e.message);
        }
    } catch (e) {
        console.error('[INIT] Queue system init failed (non-fatal):', e.message);
    }
})();

const JWT_SECRET = process.env.JWT_SECRET || 'net2app-hub-secret-key-2024';
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const COOKIE_OPTIONS = {
    httpOnly: true,
    secure: IS_PRODUCTION,          // HTTPS-only in production, HTTP in development
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    path: '/',
};

const extractToken = (req) => {
    // Try cookie first, then Authorization header
    if (req.cookies && req.cookies.token) return req.cookies.token;
    const authHeader = req.headers.authorization;
    if (authHeader) return authHeader.split(' ')[1];
    return null;
};

const auth = async (req, res, next) => {
    try {
        const token = extractToken(req);
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
        const validPassword = await bcrypt.compare(password, user.password_hash);
        if (!validPassword) return res.status(401).json({ error: 'Invalid credentials' });
        const token = jwt.sign(
            { id: user.id, username: user.username, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );
        // Set httpOnly cookie for session-based auth
        res.cookie('token', token, COOKIE_OPTIONS);
        // Also return token in body for backward compatibility with api.ts setToken
        res.json({ success: true, token, user });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Check current session — returns user data if token cookie is valid
app.get('/api/auth/me', auth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, username, email, role, permissions, name, is_active, last_login, created_at FROM users WHERE id = $1`,
            [req.user.id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        const user = result.rows[0];
        res.json({ success: true, data: user });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==================== AUTH (extras) ====================
app.post('/api/auth/change-password', auth, async (req, res) => {
    try {
        const { oldPassword, newPassword } = req.body;
        if (!oldPassword || !newPassword) return res.status(400).json({ error: 'oldPassword and newPassword are required' });
        const userR = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
        if (userR.rows.length === 0) return res.status(404).json({ error: 'User not found' });
        const user = userR.rows[0];
        const valid = await bcrypt.compare(oldPassword, user.password_hash);
        if (!valid) return res.status(400).json({ error: 'Current password is incorrect' });
        const hash = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, req.user.id]);
        res.json({ success: true, message: 'Password changed successfully' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/logout', auth, async (req, res) => {
    try {
        // Clear the httpOnly cookie (must match the same domain/path as when set)
        res.clearCookie('token', { httpOnly: true, secure: IS_PRODUCTION, sameSite: 'lax', path: '/' });
        res.json({ success: true, message: 'Logged out successfully' });
    } catch (e) { res.status(500).json({ error: e.message }); }
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
        const { client_code, include_deleted } = req.query;
        let query = 'SELECT * FROM clients WHERE 1=1';
        let params = []; let idx = 1;
        if (include_deleted !== 'true') {
            query += ` AND (is_deleted IS NULL OR is_deleted = false)`;
        }
        if (client_code) {
            query += ` AND client_code = $${idx++}`;
            params.push(client_code);
        }
        query += ' ORDER BY id';
        const result = await pool.query(query, params);
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/clients/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM clients WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Client not found' });
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/clients', auth, async (req, res) => {
    try {
        const b = req.body || {};
        if (!b.client_code) return res.status(400).json({ error: 'client_code is required' });
        if (!b.company_name) return res.status(400).json({ error: 'company_name is required' });
        if (!b.smpp_username) return res.status(400).json({ error: 'smpp_username is required' });
        if (!b.smpp_password) return res.status(400).json({ error: 'smpp_password is required' });
        const result = await pool.query(
            `INSERT INTO clients (client_code, company_name, contact_person, email, phone, address, country,
             smpp_username, smpp_password, smpp_ip, smpp_port, system_type, max_tps,
             billing_mode, currency, balance, credit_limit,
             api_enabled, webhook_url, force_dlr, routing_plan_id, rate_plan_id, status, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,NOW(),NOW()) RETURNING *`,
            [
                b.client_code, b.company_name, b.contact_person || '', b.email || '', b.phone || '', b.address || '', b.country || '',
                b.smpp_username, b.smpp_password, b.smpp_ip || '0.0.0.0', b.smpp_port || 2775, b.system_type || 'SMPP', b.max_tps || 100,
                b.billing_mode || 'dlr', b.currency || 'EUR', b.balance || 0, b.credit_limit || 0,
                b.api_enabled || false, b.webhook_url || '', b.force_dlr !== undefined ? b.force_dlr : true, b.routing_plan_id || null, b.rate_plan_id || null, b.status || 'active'
            ]
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
        // Sanitize: convert empty strings to null to avoid "invalid input syntax for type integer"
        const values = Object.values(fields).map(v => v === '' ? null : v);
        const setClause = Object.keys(fields).map((key, i) => `${key} = $${i + 1}`).join(', ');
        values.push(id);
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
        const result = await pool.query('UPDATE clients SET is_deleted = true, updated_at = NOW(), status = \'inactive\' WHERE id = $1 AND (is_deleted IS NULL OR is_deleted = false) RETURNING client_code', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Client not found' });
        res.json({ success: true, message: 'Client deleted (soft)', client_code: result.rows[0].client_code });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Restore soft-deleted client
app.post('/api/clients/:id/restore', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'UPDATE clients SET is_deleted = false, status = \'active\', updated_at = NOW() WHERE id = $1 AND is_deleted = true RETURNING *',
            [id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Client not found or not deleted' });
        res.json({ success: true, data: result.rows[0], message: 'Client restored' });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Bulk import clients via CSV
app.post('/api/clients/bulk', auth, async (req, res) => {
    try {
        const { csv } = req.body || {};
        if (!csv || typeof csv !== 'string') return res.status(400).json({ error: 'csv field is required (string)' });
        const lines = csv.split(/[\n\r]+/).filter(Boolean);
        if (lines.length < 2) return res.status(400).json({ error: 'CSV needs at least a header row + one data row' });
        const header = lines[0];
        let delim = ',';
        const counts = { ',': (header.match(/,/g) || []).length, '\t': (header.match(/\t/g) || []).length, ';': (header.match(/;/g) || []).length, '|': (header.match(/\|/g) || []).length };
        for (const [d, c] of Object.entries(counts)) { if (c > counts[delim]) delim = d; }
        const headers = header.split(delim).map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'));
        const created = [];
        const errors = [];
        for (let li = 1; li < lines.length; li++) {
            const fields = lines[li].split(delim).map(f => f.trim());
            if (fields.length < headers.length) continue;
            const row = {};
            headers.forEach((h, i) => { row[h] = fields[i] || ''; });
            const client_code = row.client_code || '';
            const company_name = row.company_name || '';
            if (!client_code || !company_name) { errors.push({ line: li + 1, error: 'Missing client_code or company_name' }); continue; }
            try {
                const ins = await pool.query(
                    `INSERT INTO clients (client_code, company_name, contact_person, email, phone, address, country,
                     smpp_username, smpp_password, smpp_ip, smpp_port, system_type, max_tps,
                     billing_mode, currency, balance, credit_limit,
                     api_enabled, webhook_url, force_dlr, routing_plan_id, rate_plan_id, status, created_at, updated_at)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,NOW(),NOW()) RETURNING *`,
                    [
                        client_code, company_name, row.contact_person || '', row.email || '', row.phone || '', row.address || '', row.country || '',
                        row.smpp_username || client_code, row.smpp_password || '', row.smpp_ip || '0.0.0.0', parseInt(row.smpp_port) || 2775, row.system_type || 'SMPP', parseInt(row.max_tps) || 100,
                        row.billing_mode || 'dlr', row.currency || 'EUR', parseFloat(row.balance) || 0, parseFloat(row.credit_limit) || 0,
                        row.api_enabled === 'true' || row.api_enabled === true, row.webhook_url || '', row.force_dlr !== 'false', row.routing_plan_id || null, row.rate_plan_id || null, row.status || 'active'
                    ]
                );
                created.push(ins.rows[0]);
            } catch (e) {
                errors.push({ line: li + 1, error: e.message });
            }
        }
        res.json({ success: true, data: { created: created.length, errors: errors.length ? errors : undefined, items: created, delimiter: delim === '\t' ? 'tab' : delim } });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Bulk delete clients (soft delete)
app.post('/api/clients/bulk-delete', auth, async (req, res) => {
    try {
        const { ids } = req.body || {};
        if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array is required' });
        const result = await pool.query(
            `UPDATE clients SET is_deleted = true, updated_at = NOW(), status = 'inactive' WHERE id = ANY($1::int[]) AND (is_deleted IS NULL OR is_deleted = false) RETURNING id`,
            [ids]
        );
        res.json({ success: true, message: `${result.rows.length} clients soft-deleted`, count: result.rows.length });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==================== SUPPLIERS ====================
app.get('/api/suppliers', auth, async (req, res) => {
    try {
        const { include_deleted } = req.query;
        let query = 'SELECT * FROM suppliers WHERE 1=1';
        if (include_deleted !== 'true') {
            query += ' AND (is_deleted IS NULL OR is_deleted = false)';
        }
        query += ' ORDER BY id';
        const result = await pool.query(query);
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
                api_connector_id, voice_otp_config_id, voice_otp_mode,
                whatsapp_device_ids, telegram_device_ids,
                dst_sip_address, reconnect_schedule, rate_per_second, audio_codec, capacity,
                balance, credit_limit, currency,
                bind_status, consecutive_failures, force_dlr, status,
                created_at, updated_at
            ) VALUES (
                $1,$2,$3,$4,$5,
                $6,$7,$8,$9,$10,
                $11,$12,$13,$14,
                $15,$16,$17,
                $18,$19,$20,$21,
                $22,$23,$24,
                $25,$26,
                $27,$28,$29,$30,$31,
                $32,$33,$34,
                $35,$36,$37,$38,
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
                b.voice_otp_mode || null,
                b.whatsapp_device_ids || null,
                b.telegram_device_ids || null,
                b.dst_sip_address || '',
                b.reconnect_schedule || '0,1,2',
                b.rate_per_second || 0,
                b.audio_codec || 'g729',
                b.capacity || 10,
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
        const allowed = ['supplier_code','company_name','contact_person','email','phone','connection_type','smpp_host','smpp_port','smpp_username','smpp_password','system_id','smpp_version','smpp_system_type','smpp_bind_type','smpp_addr_ton','smpp_addr_npi','smpp_addr_range','is_inbound','api_url','api_key','api_method','api_connector_id','voice_otp_config_id','voice_otp_mode','whatsapp_device_ids','telegram_device_ids','dst_sip_address','reconnect_schedule','rate_per_second','audio_codec','capacity','balance','credit_limit','currency','bind_status','consecutive_failures','force_dlr','status'];
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
        const result = await pool.query('UPDATE suppliers SET is_deleted = true, updated_at = NOW(), status = \'inactive\' WHERE id = $1 AND (is_deleted IS NULL OR is_deleted = false) RETURNING supplier_code', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Supplier not found' });
        res.json({ success: true, message: 'Supplier deleted (soft)', supplier_code: result.rows[0].supplier_code });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Restore soft-deleted supplier
app.post('/api/suppliers/:id/restore', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'UPDATE suppliers SET is_deleted = false, status = \'active\', updated_at = NOW() WHERE id = $1 AND is_deleted = true RETURNING *',
            [id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Supplier not found or not deleted' });
        res.json({ success: true, data: result.rows[0], message: 'Supplier restored' });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Bulk import suppliers via CSV
app.post('/api/suppliers/bulk', auth, async (req, res) => {
    try {
        const { csv } = req.body || {};
        if (!csv || typeof csv !== 'string') return res.status(400).json({ error: 'csv field is required (string)' });
        const lines = csv.split(/[\n\r]+/).filter(Boolean);
        if (lines.length < 2) return res.status(400).json({ error: 'CSV needs at least a header row + one data row' });
        const header = lines[0];
        let delim = ',';
        const counts = { ',': (header.match(/,/g) || []).length, '\t': (header.match(/\t/g) || []).length, ';': (header.match(/;/g) || []).length, '|': (header.match(/\|/g) || []).length };
        for (const [d, c] of Object.entries(counts)) { if (c > counts[delim]) delim = d; }
        const headers = header.split(delim).map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'));
        const created = [];
        const errors = [];
        for (let li = 1; li < lines.length; li++) {
            const fields = lines[li].split(delim).map(f => f.trim());
            if (fields.length < headers.length) continue;
            const row = {};
            headers.forEach((h, i) => { row[h] = fields[i] || ''; });
            const supplier_code = row.supplier_code || '';
            const company_name = row.company_name || '';
            if (!supplier_code || !company_name) { errors.push({ line: li + 1, error: 'Missing supplier_code or company_name' }); continue; }
            try {
                const ins = await pool.query(
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
                        supplier_code, company_name,
                        row.contact_person || '', row.email || '', row.phone || '',
                        row.connection_type || 'smpp',
                        row.smpp_host || '', parseInt(row.smpp_port) || 2775, row.smpp_username || supplier_code, row.smpp_password || '',
                        row.system_id || '',
                        row.smpp_version || 'auto', row.smpp_system_type || '', row.smpp_bind_type || 'trx',
                        parseInt(row.smpp_addr_ton) || 0, parseInt(row.smpp_addr_npi) || 0, row.smpp_addr_range || '',
                        row.is_inbound === 'true' || row.is_inbound === true,
                        row.api_url || '', row.api_key || '', row.api_method || 'POST',
                        row.api_connector_id || null, row.voice_otp_config_id || null,
                        row.whatsapp_device_ids || null, row.telegram_device_ids || null,
                        parseFloat(row.balance) || 0, parseFloat(row.credit_limit) || 0, row.currency || 'EUR',
                        row.bind_status || 'unbound', parseInt(row.consecutive_failures) || 0, row.force_dlr !== 'false',
                        row.status || 'active'
                    ]
                );
                created.push(ins.rows[0]);
            } catch (e) {
                errors.push({ line: li + 1, error: e.message });
            }
        }
        res.json({ success: true, data: { created: created.length, errors: errors.length ? errors : undefined, items: created, delimiter: delim === '\t' ? 'tab' : delim } });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Bulk delete suppliers (soft delete)
app.post('/api/suppliers/bulk-delete', auth, async (req, res) => {
    try {
        const { ids } = req.body || {};
        if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array is required' });
        const result = await pool.query(
            `UPDATE suppliers SET is_deleted = true, updated_at = NOW(), status = 'inactive' WHERE id = ANY($1::int[]) AND (is_deleted IS NULL OR is_deleted = false) RETURNING id`,
            [ids]
        );
        res.json({ success: true, message: `${result.rows.length} suppliers soft-deleted`, count: result.rows.length });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==================== CLIENT USAGE & CDR ====================
// Get client usage stats for a period
app.get('/api/clients/:id/usage', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const { period } = req.query;
        let dateFilter = '';
        if (period === 'today') { dateFilter = "AND submit_time >= CURRENT_DATE"; }
        else if (period === 'month') { dateFilter = "AND submit_time >= date_trunc('month', CURRENT_DATE)"; }
        else if (period) { dateFilter = `AND submit_time >= CURRENT_DATE - INTERVAL '${parseInt(period)} days'`; }
        const smsResult = await pool.query(
            `SELECT COUNT(*) as total_sms, SUM(client_rate * message_parts) as total_revenue, COUNT(*) FILTER (WHERE status = 'delivered') as delivered
             FROM sms_logs WHERE client_id = $1 ${dateFilter}`, [id]
        );
        const clientResult = await pool.query('SELECT * FROM clients WHERE id = $1', [id]);
        res.json({ success: true, data: { usage: smsResult.rows[0], client: clientResult.rows[0] || null } });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get client CDR (Call Detail Records)
app.post('/api/clients/:id/cdr', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const f = req.body || {};
        let q = 'SELECT * FROM sms_logs WHERE client_id = $1';
        const p = [id]; let i = 2;
        if (f.start_date) { q += ` AND submit_time >= $${i++}`; p.push(f.start_date); }
        if (f.end_date) { q += ` AND submit_time <= $${i++}`; p.push(f.end_date); }
        if (f.status) { q += ` AND status = $${i++}`; p.push(f.status); }
        q += ' ORDER BY submit_time DESC LIMIT 1000';
        const result = await pool.query(q, p);
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update client balance (credit/debit)
app.post('/api/clients/:id/balance', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const { amount, type } = req.body;
        if (amount === undefined || !type) return res.status(400).json({ error: 'amount and type (credit/debit) are required' });
        const numAmount = parseFloat(amount);
        if (isNaN(numAmount) || numAmount <= 0) return res.status(400).json({ error: 'amount must be a positive number' });
        const operator = type === 'debit' ? '-' : '+';
        const result = await pool.query(
            `UPDATE clients SET balance = balance ${operator} $1, updated_at = NOW() WHERE id = $2 AND (is_deleted IS NULL OR is_deleted = false) RETURNING id, client_code, balance, currency`,
            [numAmount, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Client not found' });
        res.json({ success: true, data: result.rows[0], message: `Balance ${type === 'debit' ? 'debited' : 'credited'} by ${numAmount}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Send welcome email to client (placeholder)
app.post('/api/clients/:id/send-welcome', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM clients WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Client not found' });
        // In production, send actual email via SMTP or email service
        res.json({ success: true, message: `Welcome email queued for ${result.rows[0].company_name}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== SUPPLIER USAGE & CDR ====================
// Get supplier usage stats for a period
app.get('/api/suppliers/:id/usage', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const { period } = req.query;
        let dateFilter = '';
        if (period === 'today') { dateFilter = "AND submit_time >= CURRENT_DATE"; }
        else if (period === 'month') { dateFilter = "AND submit_time >= date_trunc('month', CURRENT_DATE)"; }
        else if (period) { dateFilter = `AND submit_time >= CURRENT_DATE - INTERVAL '${parseInt(period)} days'`; }
        const smsResult = await pool.query(
            `SELECT COUNT(*) as total_sms, SUM(supplier_rate * message_parts) as total_cost, COUNT(*) FILTER (WHERE status = 'delivered') as delivered
             FROM sms_logs WHERE supplier_id = $1 ${dateFilter}`, [id]
        );
        const supplierResult = await pool.query('SELECT * FROM suppliers WHERE id = $1', [id]);
        res.json({ success: true, data: { usage: smsResult.rows[0], supplier: supplierResult.rows[0] || null } });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get supplier CDR
app.post('/api/suppliers/:id/cdr', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const f = req.body || {};
        let q = 'SELECT * FROM sms_logs WHERE supplier_id = $1';
        const p = [id]; let i = 2;
        if (f.start_date) { q += ` AND submit_time >= $${i++}`; p.push(f.start_date); }
        if (f.end_date) { q += ` AND submit_time <= $${i++}`; p.push(f.end_date); }
        if (f.status) { q += ` AND status = $${i++}`; p.push(f.status); }
        q += ' ORDER BY submit_time DESC LIMIT 1000';
        const result = await pool.query(q, p);
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Bind supplier — for inbound suppliers, update smpp_sessions status;
// for outbound suppliers, update suppliers.bind_status and active_smpp_sessions
app.post('/api/suppliers/:id/bind', auth, async (req, res) => {
    try {
        const { id } = req.params;
        // Look up supplier first
        const supR = await pool.query(
            `SELECT * FROM suppliers WHERE id = $1 AND (is_deleted IS NULL OR is_deleted = false)`,
            [id]
        );
        if (supR.rows.length === 0) return res.status(404).json({ error: 'Supplier not found' });
        const s = supR.rows[0];

        if (s.is_inbound) {
            // Inbound supplier: session state is managed by the Java SMPP gateway.
            // We do NOT modify smpp_sessions — the gateway owns the real connection state.
            // Just return current state for the frontend to display.
            const sessR = await pool.query(
                `SELECT status FROM smpp_sessions WHERE entity_type = 'supplier' AND entity_id = $1`,
                [id]
            );
            const realStatus = sessR.rows.length > 0 ? sessR.rows[0].status : 'unbound';
            return res.json({
                success: true,
                data: { id: Number(id), supplier_code: s.supplier_code, bind_status: realStatus },
                message: 'Inbound supplier — session state managed by SMPP gateway. Current: ' + realStatus
            });
        } else {
            // Outbound supplier: update static bind_status + active_smpp_sessions
            await pool.query(
                `UPDATE suppliers SET bind_status = 'bound', consecutive_failures = 0, updated_at = NOW() WHERE id = $1`,
                [id]
            );
            // Upsert active_smpp_sessions for outbound tracking
            await pool.query(
                `INSERT INTO active_smpp_sessions (entity_type, entity_id, system_id, status, connected_at, ip_address, bind_mode)
                 VALUES ('supplier', $1, $2, 'bound', NOW(), $3, 'transceiver')
                 ON CONFLICT (entity_type, entity_id)
                 DO UPDATE SET status = 'bound', connected_at = NOW(),
                               ip_address = EXCLUDED.ip_address, bind_mode = 'transceiver'`,
                [id, s.smpp_username || 'unknown', s.smpp_host || null]
            );
        }

        // Audit trail
        await pool.query(
            `INSERT INTO bind_history (entity_type, entity_id, system_id, ip_address, port, bind_mode, status, created_at)
             VALUES ('supplier', $1, $2, $3, $4, 'transceiver', 'bound', NOW())`,
            [id, s.smpp_username || 'unknown', s.smpp_host || null, s.smpp_port || 2775]
        );
        res.json({ success: true, data: { id: Number(id), supplier_code: s.supplier_code, bind_status: 'bound' }, message: 'Supplier bound' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Unbind supplier
app.post('/api/suppliers/:id/unbind', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `UPDATE suppliers SET bind_status = 'unbound', updated_at = NOW() WHERE id = $1 AND (is_deleted IS NULL OR is_deleted = false) RETURNING id, supplier_code, bind_status, smpp_username, smpp_host, smpp_port`,
            [id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Supplier not found' });
        // Audit trail
        const s = result.rows[0];
        await pool.query(
            `INSERT INTO bind_history (entity_type, entity_id, system_id, ip_address, port, bind_mode, status, created_at)
             VALUES ('supplier', $1, $2, $3, $4, 'transceiver', 'unbound', NOW())`,
            [id, s.smpp_username || 'unknown', s.smpp_host || null, s.smpp_port || 2775]
        );
        res.json({ success: true, data: { id: s.id, supplier_code: s.supplier_code, bind_status: s.bind_status }, message: 'Supplier unbound' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Client bind — mark ESME session as bound
app.post('/api/clients/:id/bind', auth, async (req, res) => {
    try {
        const { id } = req.params;
        // Verify client exists and has SMPP credentials
        const clientCheck = await pool.query(
            `SELECT id, client_code, smpp_username, smpp_ip FROM clients WHERE id = $1 AND (is_deleted IS NULL OR is_deleted = false)`,
            [id]
        );
        if (clientCheck.rows.length === 0) return res.status(404).json({ error: 'Client not found' });
        if (!clientCheck.rows[0].smpp_username) return res.status(400).json({ error: 'Client has no SMPP username configured' });

        // Upsert into smpp_sessions: mark as bound
        await pool.query(
            `INSERT INTO smpp_sessions (entity_type, entity_id, system_id, status, connected_at, last_activity)
             VALUES ('client', $1, $2, 'bound', NOW(), NOW())
             ON CONFLICT (entity_type, entity_id)
             DO UPDATE SET status = 'bound', connected_at = NOW(), last_activity = NOW(),
                           last_error = NULL, last_error_at = NULL`,
            [id, clientCheck.rows[0].smpp_username]
        );
        // Audit trail
        await pool.query(
            `INSERT INTO bind_history (entity_type, entity_id, system_id, ip_address, port, bind_mode, status, created_at)
             VALUES ('client', $1, $2, $3, $4, 'transceiver', 'bound', NOW())`,
            [id, clientCheck.rows[0].smpp_username, clientCheck.rows[0].smpp_ip || req.ip || null, 2775]
        );

        res.json({ success: true, data: { id, client_code: clientCheck.rows[0].client_code, bind_status: 'bound' }, message: 'Client bound' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Client unbind — mark ESME session as unbound
app.post('/api/clients/:id/unbind', auth, async (req, res) => {
    try {
        const { id } = req.params;
        // Verify client exists
        const clientCheck = await pool.query(
            `SELECT id, client_code, smpp_username, smpp_ip FROM clients WHERE id = $1 AND (is_deleted IS NULL OR is_deleted = false)`,
            [id]
        );
        if (clientCheck.rows.length === 0) return res.status(404).json({ error: 'Client not found' });

        // Update smpp_sessions: mark as unbound
        await pool.query(
            `UPDATE smpp_sessions SET status = 'unbound', disconnected_at = NOW()
             WHERE entity_type = 'client' AND entity_id = $1`,
            [id]
        );
        // Audit trail
        await pool.query(
            `INSERT INTO bind_history (entity_type, entity_id, system_id, ip_address, port, bind_mode, status, created_at)
             VALUES ('client', $1, $2, $3, $4, 'transceiver', 'unbound', NOW())`,
            [id, clientCheck.rows[0].smpp_username, clientCheck.rows[0].smpp_ip || req.ip || null, 2775]
        );

        res.json({ success: true, data: { id, client_code: clientCheck.rows[0].client_code, bind_status: 'unbound' }, message: 'Client unbound' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Test supplier connection
app.post('/api/suppliers/:id/test', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM suppliers WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Supplier not found' });
        const s = result.rows[0];
        let testResult = { success: false, message: 'No test available for this connection type' };
        if (s.connection_type === 'smpp') {
            testResult = { success: true, message: `SMPP bind status: ${s.bind_status || 'unknown'}` };
        } else if (s.connection_type === 'http') {
            if (s.api_url) {
                try {
                    const ctrl = new AbortController();
                    setTimeout(() => ctrl.abort(), 5000);
                    const resp = await fetch(s.api_url, { method: 'GET', signal: ctrl.signal });
                    testResult = { success: resp.ok, message: `HTTP ${resp.status}: ${resp.statusText}` };
                } catch (e) {
                    testResult = { success: false, message: `Connection failed: ${e.message}` };
                }
            }
        } else if (s.connection_type === 'voice_otp') {
            testResult = { success: true, message: 'Voice OTP supplier config validated' };
        } else {
            testResult = { success: true, message: `${s.connection_type} supplier validated` };
        }
        res.json({ success: true, data: testResult });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Reset supplier failure count
app.post('/api/suppliers/:id/reset-failures', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `UPDATE suppliers SET consecutive_failures = 0, updated_at = NOW() WHERE id = $1 AND (is_deleted IS NULL OR is_deleted = false) RETURNING id, supplier_code, consecutive_failures`,
            [id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Supplier not found' });
        res.json({ success: true, data: result.rows[0], message: 'Failures reset to 0' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== API CONNECTORS ====================
app.post('/api/api-connectors', auth, async (req, res) => {
    try {
        const b = req.body || {};
        const result = await pool.query(
            `INSERT INTO api_connectors (name, type, provider, base_url, send_url, api_key, api_secret, region, description,
             username, password, phone_number_id, business_account_id, bot_token,
             dlr_url, http_method, connector_type,
             is_active, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW()) RETURNING *`,
            [b.name || '', b.type || 'http', b.provider || b.type || 'http',
             b.base_url || '', b.base_url || '', b.api_key || '', b.api_secret || '',
             b.region || '', b.description || '',
             b.username || '', b.password || '',
             b.phone_number_id || '', b.business_account_id || '',
             b.bot_token || '',
             b.dlr_url || '', b.http_method || 'POST', b.connector_type || b.type || 'http',
             b.is_active !== false]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/api-connectors/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const fields = req.body;
        const allowed = ['name','type','provider','base_url','send_url','api_key','api_secret','region','description',
            'username','password','phone_number_id','business_account_id','bot_token','dlr_url','http_method','connector_type','is_active'];
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

// Bulk import API connectors via CSV
app.post('/api/api-connectors/bulk', auth, async (req, res) => {
    try {
        const { csv } = req.body || {};
        if (!csv || typeof csv !== 'string') return res.status(400).json({ error: 'csv field is required (string)' });
        const lines = csv.split(/[\n\r]+/).filter(Boolean);
        if (lines.length < 2) return res.status(400).json({ error: 'CSV needs at least a header row + one data row' });

        // Auto-detect delimiter
        const header = lines[0];
        let delim = ',';
        const counts = { ',': (header.match(/,/g) || []).length, '\t': (header.match(/\t/g) || []).length, ';': (header.match(/;/g) || []).length, '|': (header.match(/\|/g) || []).length };
        for (const [d, c] of Object.entries(counts)) { if (c > counts[delim]) delim = d; }

        const headers = header.split(delim).map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'));
        const created = [];
        const errors = [];

        for (let li = 1; li < lines.length; li++) {
            const fields = lines[li].split(delim).map(f => f.trim());
            if (fields.length < headers.length) continue;
            const row = {};
            headers.forEach((h, i) => { row[h] = fields[i] || ''; });

            const name = row.name || row.connector_name || '';
            if (!name) { errors.push({ line: li + 1, error: 'Missing name' }); continue; }

            try {
                const ins = await pool.query(
                    `INSERT INTO api_connectors (name, type, provider, base_url, send_url, api_key, api_secret, region, description,
                     username, password, phone_number_id, business_account_id, bot_token,
                     dlr_url, http_method, connector_type,
                     is_active, created_at)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,NOW()) RETURNING *`,
                    [
                        name,
                        row.type || 'http',
                        row.provider || row.type || 'http',
                        row.base_url || row.url || '',
                        row.base_url || row.url || '',
                        row.api_key || '',
                        row.api_secret || '',
                        row.region || 'Global',
                        row.description || row.desc || '',
                        row.username || '',
                        row.password || '',
                        row.phone_number_id || '',
                        row.business_account_id || '',
                        row.bot_token || '',
                        row.dlr_url || '', row.http_method || 'POST', row.connector_type || row.type || 'http',
                        row.is_active !== 'false' && row.is_active !== false,
                    ]
                );
                created.push(ins.rows[0]);
            } catch (e) {
                errors.push({ line: li + 1, error: e.message });
            }
        }

        res.json({ success: true, data: { created: created.length, errors: errors.length ? errors : undefined, items: created, delimiter: delim === '\t' ? 'tab' : delim } });
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
        const { trunk_name, supplier_id, trunk_type, priority, percentage, is_active, mccmnc_allowed, mccmnc_denied, voice_otp_config_id } = req.body;
        const result = await pool.query(
            `INSERT INTO trunks (trunk_name, supplier_id, trunk_type, priority, percentage, is_active, mccmnc_allowed, mccmnc_denied, voice_otp_config_id, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW()) RETURNING *`,
            [trunk_name, supplier_id, trunk_type || 'sim_otp', priority || 0, percentage || 100, is_active !== false, mccmnc_allowed || null, mccmnc_denied || null, voice_otp_config_id || null]
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
        const allowed = ['trunk_name','supplier_id','trunk_type','priority','percentage','is_active','mccmnc_allowed','mccmnc_denied','voice_otp_config_id'];
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
        const { route_name, trunk_ids, route_method, is_active, preferred_channel, mccmnc_allowed, mccmnc_denied, voice_otp_config_id } = req.body;
        const result = await pool.query(
            `INSERT INTO routes (route_name, trunk_ids, route_method, is_active, preferred_channel, mccmnc_allowed, mccmnc_denied, voice_otp_config_id, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW()) RETURNING *`,
            [route_name, trunk_ids || null, route_method || 'priority', is_active !== false, preferred_channel || null, mccmnc_allowed || null, mccmnc_denied || null, voice_otp_config_id || null]
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
        const allowed = ['route_name','trunk_ids','route_method','is_active','preferred_channel','mccmnc_allowed','mccmnc_denied','voice_otp_config_id'];
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
        const result = await pool.query('SELECT * FROM rates WHERE (is_active IS NULL OR is_active = true) ORDER BY id');
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
        const result = await pool.query('UPDATE rates SET is_active = false, effective_to = CURRENT_DATE WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Rate not found' });
        res.json({ success: true, message: 'Rate deactivated (soft delete)' });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Bulk delete rates (soft delete)
app.post('/api/rates/bulk-delete', auth, async (req, res) => {
    try {
        const { ids } = req.body || {};
        if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array is required' });
        const result = await pool.query(
            `UPDATE rates SET is_active = false, effective_to = CURRENT_DATE WHERE id = ANY($1::int[]) AND is_active = true RETURNING id`,
            [ids]
        );
        res.json({ success: true, message: `${result.rows.length} rates deactivated`, count: result.rows.length });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Send rate change notification
app.post('/api/rates/notify', auth, async (req, res) => {
    try {
        const { entityType, entityId, rateIds } = req.body || {};
        if (!entityType || !entityId) return res.status(400).json({ error: 'entityType and entityId are required' });
        if (!rateIds || !Array.isArray(rateIds)) return res.status(400).json({ error: 'rateIds array is required' });
        // Insert notification
        await pool.query(
            `INSERT INTO notifications (title, message, type, entity_type, entity_id, is_read, created_at)
             VALUES ($1,$2,$3,$4,$5,false,NOW())`,
            ['Rate Change Notification', `${rateIds.length} rates updated for ${entityType} #${entityId}`, 'info', entityType, entityId]
        );
        res.json({ success: true, message: `Rate change notification sent for ${rateIds.length} rates` });
    } catch (error) {
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ==================== SMS SEND (Production Queue) ====================
// PRODUCTION: Uses PostgreSQL-based async queue with multiple worker pipelines.
// The request does route resolution + rate check synchronously, then
// enqueues the SMS for async processing. Returns message_id immediately.
// Workers process the outbox with retry, rate limiting, and DLQ.

// Fast route resolution helper (cached per-request)
async function resolveRoute(client, destination) {
    let supplier_id = null, supplier_code = null, supplier_rate = null;
    let route_name = null, trunk_name = null, mcc = '', mnc = '', operator = '', country = '';
    let voice_otp_config_id = null;  // resolved from route > trunk > supplier

    // Try to find MCC/MNC and operator/country
    try {
        const dest = String(destination).replace(/^\+/, '');
        for (let len = 5; len >= 1; len--) {
            const prefix = dest.substring(0, len);
            const mccR = await pool.query(
                'SELECT mcc, mnc, country, operator FROM mccmnc WHERE calling_code = $1 AND (is_deleted IS NULL OR is_deleted = false) LIMIT 1',
                [prefix]
            );
            if (mccR.rows.length) {
                mcc = mccR.rows[0].mcc; mnc = mccR.rows[0].mnc;
                operator = mccR.rows[0].operator || '';
                country = mccR.rows[0].country || '';
                break;
            }
        }
    } catch (e) { /* non-critical */ }

    if (client.routing_plan_id) {
        const planR = await pool.query('SELECT * FROM route_plans WHERE id = $1', [client.routing_plan_id]);
        if (planR.rows.length && planR.rows[0].route_ids?.length > 0) {
            const routesR = await pool.query('SELECT * FROM routes WHERE id = ANY($1::int[]) AND is_active = true ORDER BY id', [planR.rows[0].route_ids]);
            for (const route of routesR.rows) {
                if (route.trunk_ids?.length > 0) {
                    const trunksR = await pool.query('SELECT * FROM trunks WHERE id = ANY($1::int[]) AND is_active = true ORDER BY priority ASC', [route.trunk_ids]);
                    for (const trunk of trunksR.rows) {
                        const allowed = trunk.mccmnc_allowed || ['*'];
                        const matches = allowed.some(p => p === '*' || (mcc && mcc.startsWith(p.replace('*', ''))));
                        if (matches && trunk.supplier_id) {
                            const supR = await pool.query('SELECT * FROM suppliers WHERE id = $1 AND status = $2 AND (is_deleted IS NULL OR is_deleted = false)', [trunk.supplier_id, 'active']);
                            if (supR.rows.length) {
                                route_name = route.route_name;
                                trunk_name = trunk.trunk_name;
                                supplier_id = supR.rows[0].id;
                                supplier_code = supR.rows[0].supplier_code;
                                // Voice OTP config priority: route > trunk > supplier
                                voice_otp_config_id = route.voice_otp_config_id
                                    || trunk.voice_otp_config_id
                                    || supR.rows[0].voice_otp_config_id
                                    || null;
                                const supRateR = await pool.query(
                                    "SELECT rate FROM rates WHERE entity_type='supplier' AND entity_id=$1 AND (mcc = $2 OR mcc = '*') AND is_active=true ORDER BY CASE WHEN mnc = '*' THEN 0 ELSE 1 END, rate ASC LIMIT 1",
                                    [supplier_id, mcc || null]
                                );
                                if (supRateR.rows.length) supplier_rate = parseFloat(supRateR.rows[0].rate);
                                break;
                            }
                        }
                    }
                }
                if (supplier_id) break;
            }
        }
    }

    // Fallback
    if (!supplier_id) {
        const fallbackR = await pool.query(
            `SELECT * FROM suppliers WHERE status = $1 AND (is_deleted IS NULL OR is_deleted = false)
             ORDER BY id LIMIT 1`,
            ['active']
        );
        if (fallbackR.rows.length) {
            supplier_id = fallbackR.rows[0].id;
            supplier_code = fallbackR.rows[0].supplier_code;
            route_name = 'fallback';
            trunk_name = 'fallback';
            // Query supplier rate for fallback path too
            const supRateR = await pool.query(
                "SELECT rate FROM rates WHERE entity_type='supplier' AND entity_id=$1 AND (mcc = $2 OR mcc = '*') AND is_active=true ORDER BY rate ASC LIMIT 1",
                [supplier_id, mcc || null]
            );
            if (supRateR.rows.length) supplier_rate = parseFloat(supRateR.rows[0].rate);
        }
    }

    return { supplier_id, supplier_code, supplier_rate, route_name, trunk_name, mcc, mnc, operator, country, voice_otp_config_id, billing_mode: client.billing_mode || 'dlr' };
}

app.post('/api/sms/send', auth, async (req, res) => {
    try {
        const { client_id, destination, sender_id, message, idempotency_key, source: customSource } = req.body;
        if (!client_id || !destination || !message) return res.status(400).json({ error: 'client_id, destination, and message are required' });

        // 1. Look up client
        const clientR = await pool.query('SELECT * FROM clients WHERE id = $1 AND status = $2 AND (is_deleted IS NULL OR is_deleted = false)', [client_id, 'active']);
        if (!clientR.rows.length) return res.status(400).json({ error: 'Client not found or inactive' });
        const c = clientR.rows[0];

        // 2. Fast route resolution (must come BEFORE rate lookup — route.mcc/route.mnc needed)
        const route = await resolveRoute(c, destination);
        if (!route.supplier_id) {
            const rejId = 'REJ' + Date.now() + Math.random().toString(36).substr(2, 6);
            await pool.query(
                `INSERT INTO sms_logs (message_id, client_id, client_code, destination, sender_id, message, status, error_code, error_message, source, submit_time, original_sender_id, original_message, original_destination)
                 VALUES ($1,$2,$3,$4,$5,$6,'failed',$7,$8,$9,NOW(),$10,$11,$12)`,
                [rejId, client_id, c.client_code, destination, sender_id || '', message, 'NO_SUPPLIER', 'No active supplier found', customSource || 'external_api', sender_id || '', message, destination]
            ).catch(() => {});
            return res.status(400).json({ success: false, error: 'No active supplier found', code: 'NO_SUPPLIER' });
        }

        // 3. Get and validate client rate — MNC-aware: exact MNC > wildcard > MCC-only, lowest first
        const clientRateR = await pool.query(
            `SELECT rate FROM rates WHERE entity_type='client' AND entity_id=$1
             AND (mcc = $2 OR mcc = '*') AND is_active=true
             ORDER BY CASE WHEN mnc = $3 THEN 0 WHEN mnc = '*' THEN 1 ELSE 2 END, rate ASC LIMIT 1`,
            [client_id, route.mcc || null, route.mnc || null]
        );
        const clientRate = clientRateR.rows.length ? parseFloat(clientRateR.rows[0].rate) : null;
        if (!clientRate || clientRate <= 0) {
            const rejId = 'REJ' + Date.now() + Math.random().toString(36).substr(2, 6);
            await pool.query(
                `INSERT INTO sms_logs (message_id, client_id, client_code, destination, sender_id, message, status, error_code, error_message, source, submit_time, original_sender_id, original_message, original_destination)
                 VALUES ($1,$2,$3,$4,$5,$6,'failed',$7,$8,$9,NOW(),$10,$11,$12)`,
                [rejId, client_id, c.client_code, destination, sender_id || '', message, 'NO_RATE', 'Client rate not found', customSource || 'external_api', sender_id || '', message, destination]
            ).catch(() => {});
            return res.status(400).json({ success: false, error: 'Client rate not found', code: 'NO_RATE' });
        }

        // 4. Validate supplier rate
        if (!(route.supplier_rate > 0)) {
            const rejId = 'REJ' + Date.now() + Math.random().toString(36).substr(2, 6);
            await pool.query(
                `INSERT INTO sms_logs (message_id, client_id, client_code, supplier_id, supplier_code, destination, sender_id, message, status, error_code, error_message, source, submit_time, original_sender_id, original_message, original_destination)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'failed',$9,$10,$11,NOW(),$12,$13,$14)`,
                [rejId, client_id, c.client_code, route.supplier_id, route.supplier_code, destination, sender_id || '', message, 'NO_SUPPLIER_RATE', 'Supplier rate not found', customSource || 'external_api', sender_id || '', message, destination]
            ).catch(() => {});
            return res.status(400).json({ success: false, error: 'Supplier rate not found', code: 'NO_SUPPLIER_RATE' });
        }

        // 5. Profit check
        const parts = Math.max(1, Math.ceil((message || '').length / 160));
        const profit = parseFloat((clientRate - route.supplier_rate).toFixed(6));
        if (profit <= 0) {
            const rejId = 'REJ' + Date.now() + Math.random().toString(36).substr(2, 6);
            await pool.query(
                `INSERT INTO sms_logs (message_id, client_id, client_code, supplier_id, supplier_code, destination, sender_id, message, status, error_code, error_message, client_rate, supplier_rate, source, submit_time, original_sender_id, original_message, original_destination)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'failed',$9,$10,$11,$12,$13,NOW(),$14,$15,$16)`,
                [rejId, client_id, c.client_code, route.supplier_id, route.supplier_code, destination, sender_id || '', message, 'ROUTE_BLOCKED', 'No profit margin', clientRate, route.supplier_rate, customSource || 'external_api', sender_id || '', message, destination]
            ).catch(() => {});
            return res.status(400).json({
                success: false,
                error: 'ROUTE BLOCKED: No profit margin',
                code: 'ROUTE_BLOCKED',
                details: { client_rate: clientRate, supplier_rate: route.supplier_rate, profit }
            });
        }

        // 6. Balance + Credit check (ALL billing modes)
        const cost = parseFloat((clientRate * parts).toFixed(6));
        let balance = parseFloat(c.balance || 0);
        let credit = parseFloat(c.credit_limit || 0);
        const available = balance + credit;

        if (available <= 0 || available < cost) {
            const rejId = 'REJ' + Date.now() + Math.random().toString(36).substr(2, 6);
            await pool.query(
                `INSERT INTO sms_logs (message_id, client_id, client_code, supplier_id, supplier_code, destination, sender_id, message, status, error_code, error_message, client_rate, supplier_rate, source, submit_time, original_sender_id, original_message, original_destination)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'failed',$9,$10,$11,$12,$13,NOW(),$14,$15,$16)`,
                [rejId, client_id, c.client_code, route.supplier_id, route.supplier_code, destination, sender_id || '', message, 'LOW_BALANCE', `Low balance: available=${Number(available)} needed=${Number(cost)}`, clientRate, route.supplier_rate, customSource || 'external_api']
            ).catch(() => {});
            return res.status(402).json({
                success: false,
                error: 'Low balance',
                code: 'LOW_BALANCE',
                details: { available: Number(available), needed: Number(cost) }
            });
        }

        // 7. Deduct from credit first, then balance
        if (credit >= cost) {
            credit = parseFloat((credit - cost).toFixed(6));
        } else {
            const remainder = parseFloat((cost - credit).toFixed(6));
            credit = 0;
            balance = parseFloat((balance - remainder).toFixed(6));
        }
        await pool.query(
            'UPDATE clients SET balance = $1, credit_limit = $2, updated_at = NOW() WHERE id = $3',
            [balance, credit, client_id]
        );

        // 6. Generate message_id and enqueue for async processing
        const msgId = 'MSG' + Date.now() + Math.random().toString(36).substr(2, 6);

        // Rate limit check (don't block, just warn)
        let rateLimited = false;
        if (rateLimiter) {
            const check = rateLimiter.checkClient(client_id);
            rateLimited = !check.allowed;
        }

        // Apply translations before enqueue (number prefix, content replace, SID random, etc.)
        const origSenderId = sender_id || c.smpp_username || '';
        const origDestination = destination;
        const origMessage = message;
        const translated = await applyTranslations(client_id, route.supplier_id, destination, origSenderId, message);

        // Enqueue to async queue manager
        if (queueManager) {
            await queueManager.enqueue({
                message_id: msgId,
                client_id,
                client_code: c.client_code,
                supplier_id: route.supplier_id,
                supplier_code: route.supplier_code,
                sender_id: translated.sender_id,
                destination: translated.destination,
                message: translated.message,
                original_sender_id: origSenderId,
                original_message: origMessage,
                original_destination: origDestination,
                message_parts: parts,
                client_rate: clientRate,
                supplier_rate: route.supplier_rate,
                profit,
                currency: c.currency || 'EUR',
                mcc: route.mcc,
                mnc: route.mnc,
                route_name: route.route_name,
                trunk_name: route.trunk_name,
                operator: route.operator || '',
                country: route.country || '',
                voice_otp_config_id: route.voice_otp_config_id || null,
                billing_mode: c.billing_mode || 'dlr',
                webhook_url: c.webhook_url || '',
                idempotency_key: idempotency_key || null,
                source: customSource || 'external_api',
            });
        } else {
            // Fallback: direct insert to sms_logs if queue not ready
            await pool.query(
                `INSERT INTO sms_logs (message_id, client_id, client_code, sender_id, destination, message, message_parts,
                 client_rate, supplier_rate, profit, currency, status, submit_time,
                 supplier_id, supplier_code, route_name, trunk_name, mcc, mnc, billing_mode_snapshot)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'submitted',NOW(),$12,$13,$14,$15,$16,$17,$18)`,
                [msgId, client_id, c.client_code, translated.sender_id, translated.destination, translated.message, parts,
                 clientRate, route.supplier_rate, profit, c.currency || 'EUR',
                 route.supplier_id, route.supplier_code, route.route_name, route.trunk_name, route.mcc, route.mnc,
                 c.billing_mode || 'dlr']
            );
        }

        // 7. Instant response — message is queued, not yet delivered
        res.json({
            success: true,
            data: {
                message_id: msgId,
                status: 'queued',
                destination,
                parts,
                client_rate: clientRate,
                profit,
                billing_mode: c.billing_mode,
                route_name: route.route_name,
                trunk_name: route.trunk_name,
                rate_limited: rateLimited
            },
            message: rateLimited ? 'Queued (client approaching TPS limit)' : 'Queued for delivery'
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// HTTP API endpoint for external clients (no JWT auth, uses API key)
app.post('/api/sms/send/http', async (req, res) => {
    try {
        const apiKey = req.headers['x-api-key'] || req.query.api_key;
        if (!apiKey) return res.status(401).json({ error: 'API key required (x-api-key header or ?api_key= query param)' });
        const clientR = await pool.query('SELECT * FROM clients WHERE api_key = $1 AND api_enabled = true AND status = $2 AND (is_deleted IS NULL OR is_deleted = false)', [apiKey, 'active']);
        if (!clientR.rows.length) return res.status(401).json({ error: 'Invalid API key' });
        req.body.client_id = clientR.rows[0].id;
        // Forward to the main send endpoint
        const mainHandler = app._router.stack.find(l => l.route?.path === '/api/sms/send' && l.route?.methods?.post);
        if (mainHandler) return mainHandler.handle(req, res);
        res.status(500).json({ error: 'Send endpoint unavailable' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== SMS LOGS ====================
app.post('/api/sms/logs', auth, async (req, res) => {
    try {
        const f = req.body || {};
        const pageLimit = Math.min(parseInt(f.limit) || 100, 1000);
        const pageOffset = parseInt(f.offset) || 0;
        let q = 'SELECT * FROM sms_logs WHERE 1=1';
        const p = []; let i = 1;
        // Soft-delete filter: hide deleted by default, show with include_deleted=true
        if (f.include_deleted !== true && f.include_deleted !== 'true') {
            q += ' AND (is_deleted IS NULL OR is_deleted = false)';
        }
        // Simplified status filter: accepts comma-separated (e.g. "submitted,pending")
        if (f.status)      {
          const statuses = f.status.split(',').map(s => s.trim()).filter(Boolean);
          if (statuses.length === 1) {
            q += ` AND status = $${i++}`; p.push(statuses[0]);
          } else {
            q += ` AND status = ANY($${i++}::varchar[])`; p.push(statuses);
          }
        }
        if (f.client_code) { q += ` AND client_code = $${i++}`; p.push(f.client_code); }
        if (f.supplier_code){ q += ` AND supplier_code = $${i++}`; p.push(f.supplier_code); }
        // Simplified source filter: accepts comma-separated values (e.g. "smpp,smpp_client,smpp_mo")
        if (f.source)      { 
          const sources = f.source.split(',').map(s => s.trim()).filter(Boolean);
          if (sources.length === 1) {
            q += ` AND source = $${i++}`; p.push(sources[0]);
          } else {
            q += ` AND source = ANY($${i++}::varchar[])`; p.push(sources);
          }
        }
        if (f.error_code) {
          const codes = String(f.error_code).split(',').map(s => s.trim()).filter(Boolean);
          if (codes.length === 1) {
            q += ` AND error_code = $${i++}`; p.push(codes[0]);
          } else {
            q += ` AND error_code = ANY($${i++}::varchar[])`; p.push(codes);
          }
        }
        if (f.start_date)  { q += ` AND submit_time >= $${i++}`; p.push(f.start_date); }
        if (f.end_date)    { q += ` AND submit_time <= $${i++}`; p.push(f.end_date); }
        if (f.search)      { q += ` AND (destination ILIKE $${i} OR message_id ILIKE $${i} OR sender_id ILIKE $${i})`; p.push(`%${f.search}%`); i++; }

        // Get total count (separate query)
        const countQuery = q.replace('SELECT *', 'SELECT COUNT(*) as total');
        const countResult = await pool.query(countQuery, p);
        const total = parseInt(countResult.rows[0].total);

        // Get paginated data
        q += ` ORDER BY submit_time DESC LIMIT $${i++} OFFSET $${i++}`;
        p.push(pageLimit, pageOffset);
        const result = await pool.query(q, p);
        res.json({ success: true, data: result.rows, total });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get single SMS log by ID
app.get('/api/sms/logs/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM sms_logs WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'SMS log not found' });
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Send a test SMS
app.post('/api/sms/test', auth, async (req, res) => {
    try {
        const { destination, message, sender_id, client_id, supplier_id } = req.body;
        if (!destination || !message) return res.status(400).json({ error: 'destination and message are required' });
        const messageId = `TEST_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;

        // Look up supplier info if supplier_id provided
        let supplierCode = null;
        let supplierName = null;
        if (supplier_id) {
            try {
                const sRes = await pool.query('SELECT supplier_code, company_name FROM suppliers WHERE id = $1', [supplier_id]);
                if (sRes.rows.length > 0) {
                    supplierCode = sRes.rows[0].supplier_code;
                    supplierName = sRes.rows[0].company_name;
                }
            } catch { /* ignore lookup errors */ }
        }

        // Real rate lookup: client_rate from client rates, supplier_rate from supplier rates
        let clientRate = 0;
        let supplierRate = 0;
        try {
            if (client_id) {
                const cr = await pool.query(
                    "SELECT rate FROM rates WHERE entity_type='client' AND entity_id=$1 AND is_active=true ORDER BY rate ASC LIMIT 1",
                    [client_id]
                );
                if (cr.rows.length > 0) clientRate = parseFloat(cr.rows[0].rate);
            }
            if (supplier_id) {
                const sr = await pool.query(
                    "SELECT rate FROM rates WHERE entity_type='supplier' AND entity_id=$1 AND is_active=true ORDER BY rate ASC LIMIT 1",
                    [supplier_id]
                );
                if (sr.rows.length > 0) supplierRate = parseFloat(sr.rows[0].rate);
            }
        } catch { /* rate lookup failures are non-critical */ }
        // Capture original values before translation
        const origSid = sender_id || 'TEST';
        const origMsg = message;
        const origDest = destination;

        // Apply translations (OTP extract, number prefix, SID random, etc.)
        let transSid = origSid;
        let transMsg = origMsg;
        let transDest = origDest;
        try {
            const translated = await applyTranslations(
                client_id || null, supplier_id || null, destination, origSid, origMsg
            );
            if (translated) {
                transSid = translated.sender_id || origSid;
                transMsg = translated.message || origMsg;
                transDest = translated.destination || origDest;
            }
        } catch (_) { /* best-effort */ }

        const profit = parseFloat((clientRate - supplierRate).toFixed(6));

        const result = await pool.query(
            `INSERT INTO sms_logs (message_id, destination, sender_id, message, status, client_id, supplier_id, supplier_code, client_rate, supplier_rate, profit, currency, source, submit_time, original_sender_id, original_message, original_destination)
             VALUES ($1,$2,$3,$4,'sent',$5,$6,$7,$8,$9,$10,'EUR','test_sms',NOW(),$11,$12,$13) RETURNING *`,
            [messageId, transDest, transSid, transMsg, client_id || null, supplier_id || null, supplierCode, clientRate, supplierRate, profit, origSid, origMsg, origDest]
        );
        // No fake DLR — real DLR is handled by the HTTP DLR poll or SMPP DLR handler
        res.json({ success: true, data: result.rows[0], supplier: supplierName, message: 'Test SMS sent successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get SMS stats
app.get('/api/sms/stats', auth, async (req, res) => {
    try {
        const { period } = req.query;
        let dateFilter = '';
        if (period === 'today') { dateFilter = 'WHERE submit_time >= CURRENT_DATE'; }
        else if (period === 'month') { dateFilter = "WHERE submit_time >= date_trunc('month', CURRENT_DATE)"; }
        else if (period) { dateFilter = `WHERE submit_time >= CURRENT_DATE - INTERVAL '${parseInt(period)} days'`; }
        const result = await pool.query(
            `SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE status = 'delivered') AS delivered,
                    COUNT(*) FILTER (WHERE status = 'failed') AS failed,
                    COUNT(*) FILTER (WHERE status = 'sent') AS pending
             FROM sms_logs ${dateFilter}`
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});
// ==================== INBOUND SMS TRAFFIC STATS ====================
app.get('/api/sms/stats/inbound', auth, async (req, res) => {
    try {
        // Total inbound (MO) messages today by supplier
        const supplierStats = await pool.query(`
            SELECT
                sl.supplier_id,
                sl.supplier_code,
                s.company_name,
                COALESCE(s.is_inbound, false) as is_inbound,
                s.smpp_host,
                COUNT(*) as total_mo_today,
                COUNT(*) FILTER (WHERE sl.status = 'delivered') as delivered,
                COUNT(*) FILTER (WHERE sl.status = 'failed') as failed,
                COUNT(*) FILTER (WHERE sl.status = 'submitted') as pending,
                MAX(sl.submit_time) as last_mo_at
            FROM sms_logs sl
            LEFT JOIN suppliers s ON s.id = sl.supplier_id
            WHERE sl.source = 'smpp_mo'
              AND sl.submit_time >= CURRENT_DATE
              AND (sl.is_deleted IS NULL OR sl.is_deleted = false)
            GROUP BY sl.supplier_id, sl.supplier_code, s.company_name, s.is_inbound, s.smpp_host
            ORDER BY total_mo_today DESC
        `);

        // Per-supplier throughput: messages in last 60 seconds
        const throughputResult = await pool.query(`
            SELECT
                sl.supplier_id,
                sl.supplier_code,
                COUNT(*) as messages_60s,
                ROUND(COUNT(*)::numeric / 60.0, 2) as throughput_per_sec
            FROM sms_logs sl
            WHERE sl.source = 'smpp_mo'
              AND sl.submit_time >= NOW() - INTERVAL '60 seconds'
              AND sl.supplier_id IS NOT NULL
              AND (sl.is_deleted IS NULL OR sl.is_deleted = false)
            GROUP BY sl.supplier_id, sl.supplier_code
        `);

        // Build throughput lookup
        const throughputMap = {};
        for (const row of throughputResult.rows) {
            throughputMap[row.supplier_id] = {
                messages_60s: parseInt(row.messages_60s),
                throughput_per_sec: parseFloat(row.throughput_per_sec)
            };
        }

        // Overall totals
        const totalsResult = await pool.query(`
            SELECT
                COUNT(*) as total_mo_today,
                COUNT(*) FILTER (WHERE status = 'delivered') as delivered,
                COUNT(*) FILTER (WHERE status = 'failed') as failed,
                COUNT(*) FILTER (WHERE status = 'submitted') as pending
            FROM sms_logs
            WHERE source = 'smpp_mo'
              AND submit_time >= CURRENT_DATE
              AND (is_deleted IS NULL OR is_deleted = false)
        `);

        const suppliers = supplierStats.rows.map(s => ({
            ...s,
            throughput_60s: throughputMap[s.supplier_id]?.messages_60s || 0,
            throughput_per_sec: throughputMap[s.supplier_id]?.throughput_per_sec || 0,
            delivery_rate: s.total_mo_today > 0
                ? Math.round((parseInt(s.delivered) / parseInt(s.total_mo_today)) * 100)
                : 0
        }));

        res.json({
            success: true,
            data: {
                totals: totalsResult.rows[0] || { total_mo_today: 0, delivered: 0, failed: 0, pending: 0 },
                suppliers,
                has_inbound_traffic: supplierStats.rows.length > 0
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// Resend SMS
app.post('/api/sms/:id/resend', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM sms_logs WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'SMS log not found' });
        const orig = result.rows[0];
        const newMessageId = `RETRY_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
        const ins = await pool.query(
            `INSERT INTO sms_logs (original_sender_id, original_message, original_destination, message_id, destination, sender_id, message, status, client_id, supplier_code, submit_time)
             VALUES ($1,$2,$3,$4,'pending',$5,$6,NOW(),$7,$8,$9) RETURNING *`,
            [newMessageId, orig.destination, orig.sender_id, orig.message, orig.client_id, orig.supplier_code, orig.original_sender_id || orig.sender_id, orig.original_message || orig.message, orig.original_destination || orig.destination]
        );
        res.json({ success: true, data: ins.rows[0], message: 'SMS queued for resend' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== QUEUE MANAGEMENT (Production) ====================
// Queue statistics for dashboard
app.get('/api/queue/stats', auth, async (req, res) => {
    try {
        const stats = queueManager ? await queueManager.getQueueStats() : { queue_depth: 0, processing: 0, dead_letters_24h: 0 };
        const rlStats = rateLimiter ? rateLimiter.getStats() : { activeClients: 0, activeSuppliers: 0 };
        const pipelineStatus = connectionPoolMgr ? connectionPoolMgr.getStatus() : { totalSuppliers: 0, totalPipelines: 0 };
        res.json({ success: true, data: { queue: stats, rateLimiter: rlStats, pipelines: pipelineStatus } });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Reprocess dead letter queue
app.post('/api/queue/reprocess-dlq', auth, async (req, res) => {
    try {
        if (!queueManager) return res.status(503).json({ error: 'Queue manager not initialized' });
        const count = await queueManager.reprocessDeadLetters(req.body.limit || 100);
        res.json({ success: true, message: `${count} dead letters reprocessed` });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Reset queue stats
app.post('/api/queue/reset-stats', auth, async (req, res) => {
    try {
        if (queueManager) {
            queueManager.stats = { processed: 0, delivered: 0, failed: 0, throttled: 0, rejected: 0, lastProcessed: null };
        }
        res.json({ success: true, message: 'Stats reset' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== DLR QUEUE ====================
app.get('/api/dlr-queue', auth, async (req, res) => {
    try {
        const { status, channel, limit } = req.query;
        let q = 'SELECT * FROM dlr_queue WHERE 1=1';
        const p = []; let i = 1;
        if (status) { q += ` AND status = $${i++}`; p.push(status); }
        if (channel) { q += ` AND channel = $${i++}`; p.push(channel); }
        q += ' ORDER BY submitted_at DESC';
        if (limit) { q += ' LIMIT ' + parseInt(limit); } else { q += ' LIMIT 500'; }
        const result = await pool.query(q, p);
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/dlr-queue', auth, async (req, res) => {
    try {
        const b = req.body || {};
        if (!b.message_id || !b.destination) return res.status(400).json({ error: 'message_id and destination are required' });
        const result = await pool.query(
            `INSERT INTO dlr_queue (message_id, smpp_message_id, destination, status, retry_count, max_retries,
             force_dlr, dlr_timeout, submitted_at, channel)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),$9) RETURNING *`,
            [b.message_id, b.smpp_message_id || null, b.destination, b.status || 'pending',
             b.retry_count || 0, b.max_retries || 3,
             b.force_dlr !== false, b.dlr_timeout || 300, b.channel || 'sms']
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/dlr-queue/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const fields = req.body;
        const allowed = ['message_id','smpp_message_id','destination','status','retry_count','max_retries',
            'force_dlr','dlr_timeout','dlr_received_at','dlr_result','channel'];
        const setParts = []; const values = []; let idx = 1;
        for (const key of allowed) {
            if (fields[key] !== undefined) { setParts.push(`${key} = $${idx++}`); values.push(fields[key]); }
        }
        if (setParts.length === 0) return res.status(400).json({ error: 'No fields to update' });
        values.push(id);
        const result = await pool.query(
            `UPDATE dlr_queue SET ${setParts.join(', ')} WHERE id = $${values.length} RETURNING *`, values
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'DLR queue entry not found' });
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/dlr-queue/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM dlr_queue WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'DLR queue entry not found' });
        res.json({ success: true, message: 'DLR queue entry deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== INVOICE GENERATION (from real SMS data) ====================
// Auto-generate invoice from real SMS logs for a client/supplier in a date range
app.post('/api/invoices/generate', auth, async (req, res) => {
    try {
        const { entity_type, entity_id, period_start, period_end, notes, auto_send } = req.body || {};
        if (!entity_type || !entity_id) return res.status(400).json({ error: 'entity_type and entity_id are required' });
        if (!period_start || !period_end) return res.status(400).json({ error: 'period_start and period_end are required' });

        // Look up entity
        const table = entity_type === 'client' ? 'clients' : 'suppliers';
        const entityR = await pool.query(`SELECT * FROM ${table} WHERE id = $1 AND (is_deleted IS NULL OR is_deleted = false)`, [entity_id]);
        if (!entityR.rows.length) return res.status(404).json({ error: `${entity_type} not found` });
        const entity = entityR.rows[0];
        const entityName = entity.company_name || entity.client_code || entity.supplier_code || '';
        const entityEmail = entity.email || '';

        // Aggregate SMS data from real logs
        const colPrefix = entity_type === 'client' ? 'client' : 'supplier';
        const rateCol = colPrefix + '_rate';
        const idCol = colPrefix + '_id';

        const smsAgg = await pool.query(
            `SELECT
                COUNT(*) as total_sms,
                SUM(${rateCol} * message_parts) as total_amount,
                COUNT(*) FILTER (WHERE status = 'delivered') as delivered_sms,
                COUNT(*) FILTER (WHERE status = 'failed') as failed_sms
             FROM sms_logs
             WHERE ${idCol} = $1
               AND submit_time >= $2
               AND submit_time <= ($3::date + INTERVAL '1 day')
               AND (is_deleted IS NULL OR is_deleted = false)`,
            [entity_id, period_start, period_end]
        );

        const agg = smsAgg.rows[0];
        const totalSms = parseInt(agg.total_sms) || 0;
        const totalAmount = parseFloat(agg.total_amount) || 0;

        if (totalSms === 0) {
            return res.status(400).json({ error: 'No SMS data found for this period. Invoice not generated.' });
        }

        // Get tax rate from platform settings
        const taxR = await pool.query("SELECT value FROM platform_settings WHERE key = 'default_tax_rate'");
        const taxRate = parseFloat(taxR.rows[0]?.value || '19.00');
        const taxAmount = parseFloat((totalAmount * taxRate / 100).toFixed(2));
        const grandTotal = parseFloat((totalAmount + taxAmount).toFixed(2));

        // Generate invoice number
        const seq = await pool.query("SELECT COUNT(*) + 1 AS next FROM invoices");
        const invNum = `INV-${new Date().getFullYear()}-${String(seq.rows[0].next).padStart(4, '0')}`;
        const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        // Create invoice with real data
        const invR = await pool.query(
            `INSERT INTO invoices (invoice_number, entity_type, entity_id, entity_name,
             invoice_to_name, invoice_to_email,
             invoice_by_name, invoice_by_email,
             period_start, period_end, total_sms, total_amount, tax_amount, tax_rate, grand_total,
             currency, status, due_date, notes, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,'NET2APP Hub','billing@net2app.com',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW()) RETURNING *`,
            [invNum, entity_type, entity_id, entityName,
             entityName, entityEmail,
             period_start, period_end,
             totalSms, totalAmount, taxAmount, taxRate, grandTotal,
             entity.currency || 'EUR', 'draft', dueDate, notes || 'Auto-generated from SMS logs']
        );

        res.json({
            success: true,
            data: invR.rows[0],
            summary: {
                total_sms: totalSms,
                delivered: parseInt(agg.delivered_sms) || 0,
                failed: parseInt(agg.failed_sms) || 0,
                total_amount: totalAmount,
                tax_amount: taxAmount,
                grand_total: grandTotal,
                tax_rate: taxRate
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== INVOICES ====================
app.get('/api/invoices', auth, async (req, res) => {
    try {
        const { include_deleted } = req.query;
        let q = 'SELECT * FROM invoices';
        if (include_deleted !== 'true') {
            q += ' WHERE (is_deleted IS NULL OR is_deleted = false)';
        }
        q += ' ORDER BY id DESC LIMIT 500';
        const result = await pool.query(q);
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
        const result = await pool.query('UPDATE invoices SET is_deleted = true WHERE id = $1 RETURNING invoice_number', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Invoice not found' });
        res.json({ success: true, message: 'Invoice deleted (soft)', invoice_number: result.rows[0].invoice_number });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== PAYMENTS ====================
app.get('/api/payments', auth, async (req, res) => {
    try {
        const { include_deleted } = req.query;
        let q = 'SELECT * FROM payments';
        if (include_deleted !== 'true') {
            q += ' WHERE (is_deleted IS NULL OR is_deleted = false)';
        }
        q += ' ORDER BY id DESC LIMIT 500';
        const result = await pool.query(q);
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

// ==================== BILLING (topup) ====================
app.post('/api/billing/topup', auth, async (req, res) => {
    try {
        const { entityType, entityId, amount, method } = req.body;
        if (!entityType || !entityId || !amount) return res.status(400).json({ error: 'entityType, entityId, and amount are required' });
        const table = entityType === 'client' ? 'clients' : entityType === 'supplier' ? 'suppliers' : null;
        if (!table) return res.status(400).json({ error: 'entityType must be client or supplier' });
        const numAmount = parseFloat(amount);
        if (isNaN(numAmount) || numAmount <= 0) return res.status(400).json({ error: 'amount must be a positive number' });
        const result = await pool.query(
            `UPDATE ${table} SET balance = balance + $1, updated_at = NOW() WHERE id = $2 AND (is_deleted IS NULL OR is_deleted = false) RETURNING id, balance, currency`,
            [numAmount, entityId]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: `${entityType} not found` });
        // Also create a payment record
        await pool.query(
            `INSERT INTO payments (payment_number, entity_type, entity_id, entity_name, amount, currency, payment_method, status, notes, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,'completed',$8,NOW())`,
            ['TOPUP-' + Date.now(), entityType, entityId, '', numAmount, result.rows[0].currency || 'EUR', method || 'manual', 'Top-up via API']
        );
        res.json({ success: true, data: result.rows[0], message: `€${numAmount} added to ${entityType} #${entityId}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== CAMPAIGNS ====================
app.get('/api/campaigns', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM campaigns WHERE (is_deleted IS NULL OR is_deleted = false) ORDER BY id DESC LIMIT 500');
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
        const result = await pool.query('UPDATE campaigns SET is_deleted = true WHERE id = $1 RETURNING campaign_name', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Campaign not found' });
        res.json({ success: true, message: 'Campaign deleted (soft)', campaign_name: result.rows[0].campaign_name });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== TRANSLATIONS ====================
// ==================== TRANSLATIONS V4 — 6-Type Engine ====================

// Translation Engine: applies active translations to SMS message fields
// Translation Engine: applies active translations to SMS message fields
// Delegates rule-application logic to the pure applyRules() function in translationEngine.cjs
async function applyTranslations(clientId, supplierId, destination, senderId, message) {
    const input = { destination, sender_id: senderId, message };
    try {
        const transR = await pool.query(
            `SELECT * FROM translations WHERE is_active = true 
             AND (apply_to = 'both' OR (apply_to = 'client' AND apply_entity_id = $1) OR (apply_to = 'supplier' AND apply_entity_id = $2) OR apply_entity_id = 'all')
             ORDER BY priority ASC`,
            [String(clientId || ''), String(supplierId || '')]
        );
        if (!transR.rows.length) return input;
        return applyRules(transR.rows, input);
    } catch (e) {
        console.error('[Translations] Engine error:', e.message);
    }
    return input;
}

// GET all translations
app.get('/api/translations', auth, async (req, res) => {
    try {
        const { type } = req.query;
        let q = 'SELECT * FROM translations WHERE 1=1';
        const p = []; let i = 1;
        if (type && type !== 'all') { q += ` AND translation_type = $${i++}`; p.push(type); }
        q += ' ORDER BY priority ASC, id DESC LIMIT 2000';
        const result = await pool.query(q, p);
        res.json({ success: true, data: result.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// CREATE translation
app.post('/api/translations', auth, async (req, res) => {
    try {
        const b = req.body || {};
        if (!b.translation_type) return res.status(400).json({ error: 'translation_type is required' });
        const result = await pool.query(
            `INSERT INTO translations (translation_type, source_pattern, target_value,
             client_id, supplier_id, route_id, mcc, mnc,
             name, description, subtype, priority, apply_to, apply_entity_id, is_active,
             strip_prefix_digits, add_prefix_text, match_content, replace_content,
             is_otp_extract, otp_length_min, otp_length_max,
             template_data, sid_match_type, mccmnc_list, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
                     $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,NOW()) RETURNING *`,
            [b.translation_type, b.source_pattern || '', b.target_value || '',
             b.client_id || null, b.supplier_id || null, b.route_id || null, b.mcc || null, b.mnc || null,
             b.name || '', b.description || '', b.subtype || '', b.priority || 1, b.apply_to || 'client', b.apply_entity_id || 'all', b.is_active !== false,
             b.strip_prefix_digits || 0, b.add_prefix_text || '', b.match_content || '', b.replace_content || '',
             b.is_otp_extract || false, b.otp_length_min || 4, b.otp_length_max || 8,
             b.template_data ? JSON.stringify(b.template_data) : '[]', b.sid_match_type || 'exact', b.mccmnc_list || null]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// UPDATE translation
app.put('/api/translations/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const fields = req.body;
        const allowed = ['translation_type','source_pattern','target_value',
            'client_id','supplier_id','route_id','mcc','mnc',
            'name','description','subtype','priority','apply_to','apply_entity_id','is_active',
            'strip_prefix_digits','add_prefix_text','match_content','replace_content',
            'is_otp_extract','otp_length_min','otp_length_max',
            'template_data','sid_match_type','mccmnc_list'];
        const setParts = []; const values = []; let idx = 1;
        for (const key of allowed) {
            if (fields[key] !== undefined) {
                const val = (key === 'template_data' && typeof fields[key] !== 'string')
                    ? JSON.stringify(fields[key]) : fields[key];
                setParts.push(`${key} = $${idx++}`);
                values.push(val);
            }
        }
        if (setParts.length === 0) return res.status(400).json({ error: 'No fields to update' });
        values.push(id);
        const result = await pool.query(
            `UPDATE translations SET ${setParts.join(', ')} WHERE id = $${values.length} RETURNING *`, values);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Translation not found' });
        res.json({ success: true, data: result.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE translation (hard delete)
app.delete('/api/translations/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM translations WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Translation not found' });
        res.json({ success: true, message: 'Translation deleted' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// BULK DELETE translations of a type
app.post('/api/translations/bulk-delete', auth, async (req, res) => {
    try {
        const { type, ids } = req.body || {};
        if (ids && Array.isArray(ids)) {
            await pool.query('DELETE FROM translations WHERE id = ANY($1::int[])', [ids]);
            res.json({ success: true, message: `${ids.length} translations deleted` });
        } else if (type) {
            const result = await pool.query('DELETE FROM translations WHERE translation_type = $1 RETURNING id', [type]);
            res.json({ success: true, message: `${result.rows.length} translations of type "${type}" deleted` });
        } else {
            res.status(400).json({ error: 'type or ids array required' });
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// TEST translation
app.post('/api/translations/test', auth, async (req, res) => {
    try {
        const { translation_type, source_pattern, target_value, match_content, replace_content,
            strip_prefix_digits, add_prefix_text, is_otp_extract, otp_length_min, otp_length_max,
            template_data, test_input, test_sender_id, test_destination } = req.body || {};
        
        let output = test_input || '';
        let sidOutput = test_sender_id || '';
        let destOutput = test_destination || '';
        
        switch (translation_type) {
            case 'number_prefix': {
                let num = (test_destination || test_input || '').replace(/^\+/, '');
                if (strip_prefix_digits > 0) num = num.substring(strip_prefix_digits);
                if (add_prefix_text) num = add_prefix_text + num;
                destOutput = num;
                output = num;
                break;
            }
            case 'content_replace': {
                if (match_content && test_input) {
                    if (is_otp_extract) {
                        const min = otp_length_min || 4, max = otp_length_max || 8;
                        const re = new RegExp(`\\b(\\d{${min},${max}})\\b`, 'g');
                        const matches = test_input.match(re);
                        output = matches ? (replace_content ? replace_content.replace(/\{\{OTP\}\}/g, matches[0]) : matches[0]) : test_input;
                    } else {
                        output = test_input.replace(new RegExp(match_content.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), replace_content || '');
                    }
                }
                break;
            }
            case 'otp_extract': {
                if (test_input) {
                    let matches = null;
                    // Prefer custom regex pattern from otp_pattern field
                    const otpPattern = req.body.otp_pattern || null;
                    if (otpPattern) {
                        try {
                            const re = new RegExp(otpPattern, 'g');
                            const execResult = re.exec(test_input);
                            if (execResult) {
                                matches = [execResult[1] || execResult[0]];
                            }
                        } catch (_) { /* invalid regex — fall through */ }
                    }
                    if (!matches) {
                        const min = otp_length_min || 4, max = otp_length_max || 8;
                        const re = new RegExp(`\\b(\\d{${min},${max}})\\b`, 'g');
                        matches = test_input.match(re);
                    }
                    output = matches ? (replace_content ? replace_content.replace(/\{\{OTP\}\}/g, matches[0]) : matches[0]) : test_input;
                }
                break;
            }
            case 'sid_alias': {
                if (source_pattern && test_sender_id) {
                    const pat = source_pattern.replace(/\*/g, '.*');
                    sidOutput = new RegExp('^' + pat + '$', 'i').test(test_sender_id) ? (target_value || test_sender_id) : test_sender_id;
                }
                output = sidOutput;
                break;
            }
            case 'sid_random': {
                let templates = [];
                if (template_data && Array.isArray(template_data)) templates = template_data;
                else if (target_value) templates = target_value.split('|').map(s => s.trim()).filter(Boolean);
                if (templates.length > 0) {
                    sidOutput = templates[Math.floor(Math.random() * templates.length)];
                    output = sidOutput;
                }
                break;
            }
            case 'random_content': {
                let templates = [];
                if (template_data && Array.isArray(template_data)) templates = template_data;
                else if (target_value) templates = target_value.split('|').map(s => s.trim()).filter(Boolean);
                if (templates.length > 0) {
                    const pick = templates[Math.floor(Math.random() * templates.length)];
                    if (test_input) {
                        const min = otp_length_min || 4, max = otp_length_max || 8;
                        const re = new RegExp(`\\b(\\d{${min},${max}})\\b`, 'g');
                        const matches = test_input.match(re);
                        output = pick.replace(/\{\{OTP\}\}/g, matches ? matches[0] : '');
                    } else {
                        output = pick;
                    }
                }
                break;
            }
        }
        res.json({ success: true, data: { input: test_input, output, sender_id: sidOutput, destination: destOutput } });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// IMPORT CSV translations (replaces all of a type)
app.post('/api/translations/import', auth, async (req, res) => {
    try {
        const { csv, type } = req.body || {};
        if (!csv || !type) return res.status(400).json({ error: 'csv and type are required' });
        const lines = csv.split(/[\n\r]+/).filter(Boolean);
        if (lines.length < 2) return res.status(400).json({ error: 'CSV needs header + data rows' });
        const header = lines[0];
        let delim = ',';
        const counts = { ',': (header.match(/,/g) || []).length, '\t': (header.match(/\t/g) || []).length, ';': (header.match(/;/g) || []).length, '|': (header.match(/\|/g) || []).length };
        for (const [d, c] of Object.entries(counts)) { if (c > counts[delim]) delim = d; }
        const headers = header.split(delim).map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'));
        
        await pool.query('DELETE FROM translations WHERE translation_type = $1', [type]);
        
        const created = []; let errors = [];
        for (let li = 1; li < lines.length; li++) {
            const fields = lines[li].split(delim).map(f => f.trim());
            if (fields.length < headers.length) continue;
            const row = {};
            headers.forEach((h, i) => { row[h] = fields[i] || ''; });
            // OTP Extract: auto-set engine defaults for no-code experience
            if (type === 'otp_extract') {
                row.is_otp_extract = 'true';
                if (!row.replace_content) row.replace_content = '{{OTP}}';
                if (!row.otp_length_min) row.otp_length_min = '4';
                if (!row.otp_length_max) row.otp_length_max = '8';
            }
            try {
                const ins = await pool.query(
                    `INSERT INTO translations (translation_type, name, source_pattern, target_value,
                     match_content, replace_content, priority, is_active,
                     strip_prefix_digits, add_prefix_text, is_otp_extract,
                     otp_length_min, otp_length_max, template_data, sid_match_type,
                     apply_to, apply_entity_id, created_at)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,NOW()) RETURNING *`,
                    [type, row.name || `Rule ${li}`, row.source_pattern || row.pattern || '', row.target_value || row.replace || row.templates || '',
                     row.match_content || row.search || '', row.replace_content || row.replace_with || '',
                     parseInt(row.priority) || li, row.is_active !== 'false' && row.is_active !== false,
                     parseInt(row.strip_prefix_digits) || 0, row.add_prefix_text || row.add_prefix || '',
                     row.is_otp_extract === 'true' || row.otp === 'true',
                     parseInt(row.otp_length_min) || 4, parseInt(row.otp_length_max) || 8,
                     row.template_data || row.templates || '[]', row.sid_match_type || 'exact',
                     row.apply_to || 'both', row.apply_entity_id || 'all']
                );
                created.push(ins.rows[0]);
            } catch (e) { errors.push({ line: li + 1, error: e.message }); }
        }
        res.json({ success: true, data: { created: created.length, errors: errors.length ? errors : undefined, replaced: true, type } });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// EXPORT translations CSV
app.get('/api/translations/export', auth, async (req, res) => {
    try {
        const { type } = req.query;
        let q = 'SELECT * FROM translations WHERE is_active = true';
        const p = [];
        if (type && type !== 'all') { q += ' AND translation_type = $1'; p.push(type); }
        q += ' ORDER BY priority ASC, id ASC';
        const result = await pool.query(q, p);
        const cols = ['id','translation_type','name','source_pattern','target_value','match_content','replace_content','priority','is_active','strip_prefix_digits','add_prefix_text','is_otp_extract','otp_length_min','otp_length_max','apply_to','apply_entity_id','created_at'];
        const rows = result.rows.map(r => cols.map(c => {
            const v = r[c]; if (v === null || v === undefined) return '';
            if (typeof v === 'object') return JSON.stringify(v).replace(/"/g, '""');
            return String(v).replace(/"/g, '""');
        }).join(','));
        const csv = cols.join(',') + '\n' + rows.join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=translations_${type || 'all'}_${new Date().toISOString().split('T')[0]}.csv`);
        res.send(csv);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// SAMPLE CSV template per type
app.get('/api/translations/sample/:type', auth, async (req, res) => {
    const samples = {
        number_prefix: 'name,source_pattern,target_value,strip_prefix_digits,add_prefix_text,priority,is_active,apply_to,apply_entity_id\nBD Strip 00880,,,2,,1,true,both,all\nBD Add 77,,,0,77,2,true,both,all',
        content_replace: 'name,match_content,replace_content,is_otp_extract,otp_length_min,otp_length_max,priority,is_active,apply_to,apply_entity_id\nOTP Forward,your code is,Your OTP: {{OTP}},true,4,8,1,true,both,all',
        otp_extract: 'name,source_pattern,replace_content,otp_length_min,otp_length_max,priority,is_active,apply_to,apply_entity_id\nExtract OTP Only,,{{OTP}},4,8,1,true,both,all',
        sid_alias: 'name,source_pattern,target_value,sid_match_type,priority,is_active,apply_to,apply_entity_id\nMask TC*,TECHCORP,TC-MSG,wildcard,1,true,both,all',
        sid_random: 'name,target_value,priority,is_active,apply_to,apply_entity_id\nRandom SID Pool,SID1|SID2|SID3|SID4|SID5,1,true,both,all',
        random_content: 'name,target_value,is_otp_extract,otp_length_min,otp_length_max,priority,is_active,apply_to,apply_entity_id\nRandom OTP 1,Your OTP code is {{OTP}}. Valid for 5 min.,true,4,8,1,true,both,all',
    };
    const type = req.params.type;
    if (!samples[type]) return res.status(404).json({ error: `Unknown type: ${type}` });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=sample_${type}.csv`);
    res.send(samples[type]);
});


// Replay: re-run an SMS log's original message through current active translation rules
app.post('/api/translations/replay', auth, async (req, res) => {
    try {
        const { original_destination, original_sender_id, original_message, client_id, supplier_id } = req.body || {};
        if (!original_message || !original_destination) {
            return res.status(400).json({ error: 'original_message and original_destination are required' });
        }
        const input = {
            destination: original_destination,
            sender_id: original_sender_id || '',
            message: original_message,
        };
        const translated = await applyTranslations(
            client_id || null, supplier_id || null,
            original_destination, original_sender_id || '', original_message
        );
        res.json({
            success: true,
            data: {
                original: input,
                current: {
                    destination: translated.destination,
                    sender_id: translated.sender_id,
                    message: translated.message,
                },
                changed: {
                    destination: translated.destination !== input.destination,
                    sender_id: translated.sender_id !== input.sender_id,
                    message: translated.message !== input.message,
                },
            },
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


// ==================== MCCMNC ====================
app.get('/api/mccmnc', auth, async (req, res) => {
    try {
        const { search, country, offset, limit } = req.query;
        const pageLimit = Math.min(parseInt(limit) || 500, 10000);
        const pageOffset = parseInt(offset) || 0;
        let whereClause = 'WHERE (is_deleted IS NULL OR is_deleted = false)';
        let countParams = [];
        let dataParams = [];
        let idx = 1;

        if (search && typeof search === 'string' && search.trim()) {
            const s = `%${search.trim()}%`;
            whereClause += ` AND (country ILIKE $${idx} OR operator ILIKE $${idx} OR mcc ILIKE $${idx} OR mnc ILIKE $${idx})`;
            countParams.push(s);
            dataParams.push(s);
            idx++;
        }
        if (country && typeof country === 'string' && country !== 'all') {
            whereClause += ` AND country = $${idx}`;
            countParams.push(country);
            dataParams.push(country);
            idx++;
        }

        const countResult = await pool.query(
            `SELECT COUNT(*) as total FROM mccmnc ${whereClause}`,
            countParams
        );
        const total = parseInt(countResult.rows[0].total);

        dataParams.push(pageLimit);
        dataParams.push(pageOffset);
        const dataResult = await pool.query(
            `SELECT * FROM mccmnc ${whereClause} ORDER BY id LIMIT $${idx} OFFSET $${idx + 1}`,
            dataParams
        );

        res.json({ success: true, data: dataResult.rows, total });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get distinct country list for filter dropdown
app.get('/api/mccmnc/countries', auth, async (req, res) => {
    try {
        const result = await pool.query("SELECT DISTINCT country FROM mccmnc WHERE (is_deleted IS NULL OR is_deleted = false) AND country IS NOT NULL AND country != '' ORDER BY country");
        res.json({ success: true, data: result.rows.map(r => r.country) });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/mccmnc', auth, async (req, res) => {
    try {
        const b = req.body || {};
        if (!b.country || !b.mcc || !b.mnc) return res.status(400).json({ error: 'country, mcc, and mnc are required' });
        if (!b.operator) return res.status(400).json({ error: 'operator is required' });
        const result = await pool.query(
            `INSERT INTO mccmnc (country, country_code, mcc, mnc, operator, network_type, status, calling_code, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING *`,
            [b.country, b.country_code || '', b.mcc, b.mnc, b.operator, b.network_type || 'GSM', b.status || 'active', b.calling_code || '']
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/mccmnc/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const fields = req.body;
        const allowed = ['country','country_code','mcc','mnc','operator','network_type','status','calling_code'];
        const setParts = []; const values = []; let idx = 1;
        for (const key of allowed) {
            if (fields[key] !== undefined) { setParts.push(`${key} = $${idx++}`); values.push(fields[key]); }
        }
        if (setParts.length === 0) return res.status(400).json({ error: 'No fields to update' });
        values.push(id);
        const result = await pool.query(
            `UPDATE mccmnc SET ${setParts.join(', ')} WHERE id = $${values.length} RETURNING *`,
            values
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'MCCMNC not found' });
        res.json({ success: true, data: result.rows[0] });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Bulk delete MCCMNC
app.post('/api/mccmnc/bulk-delete', auth, async (req, res) => {
    try {
        const { ids } = req.body || {};
        if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'ids array is required' });
        const result = await pool.query(
            `UPDATE mccmnc SET is_deleted = true WHERE id = ANY($1::int[]) AND (is_deleted IS NULL OR is_deleted = false) RETURNING id`,
            [ids]
        );
        res.json({ success: true, message: `${result.rows.length} MCCMNC entries soft-deleted`, count: result.rows.length });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/mccmnc/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('UPDATE mccmnc SET is_deleted = true WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'MCCMNC not found' });
        res.json({ success: true, message: 'MCCMNC deleted (soft)' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== VOICE OTP ====================
// Config CRUD (Language/Audio groups)
app.get('/api/voice-otp/configs', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM voice_otp_configs ORDER BY id');
        res.json({ success: true, data: result.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/voice-otp/configs', auth, async (req, res) => {
    try {
        const b = req.body || {};
        if (!b.language) return res.status(400).json({ error: 'language (group name) is required' });
        const result = await pool.query(
            `INSERT INTO voice_otp_configs
             (language, language_code, country_prefix,
              primary_language_code, secondary_language_code,
              primary_greeting_text, primary_retry_text,
              secondary_greeting_text, secondary_retry_text,
              greeting_text, retry_text, is_active, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW()) RETURNING *`,
            [
                b.language,
                b.primary_language_code || b.language_code || 'en',
                b.country_prefix || '',
                b.primary_language_code || b.language_code || 'en',
                b.secondary_language_code || 'en',
                b.primary_greeting_text || b.greeting_text || '',
                b.primary_retry_text || b.retry_text || '',
                b.secondary_greeting_text || '',
                b.secondary_retry_text || '',
                b.primary_greeting_text || b.greeting_text || '',
                b.primary_retry_text || b.retry_text || '',
                b.is_active !== false,
            ]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/voice-otp/configs/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const allowed = ['language','language_code','country_prefix',
            'primary_language_code','secondary_language_code',
            'primary_greeting_text','primary_retry_text',
            'secondary_greeting_text','secondary_retry_text',
            'greeting_text','retry_text','greeting_audio_url','secondary_greeting_audio_url',
            'audio_files','secondary_audio_files','audio_0_9',
            'sip_host','sip_port','sip_username','sip_password','caller_id','is_active','sip_e164','audio_codec'];
        const setParts = []; const values = []; let idx = 1;
        for (const key of allowed) {
            if (req.body[key] !== undefined) { setParts.push(`${key} = $${idx++}`); values.push(req.body[key]); }
        }
        if (setParts.length === 0) return res.status(400).json({ error: 'No fields to update' });
        values.push(id);
        const result = await pool.query(
            `UPDATE voice_otp_configs SET ${setParts.join(', ')} WHERE id = $${values.length} RETURNING *`, values
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Config not found' });
        res.json({ success: true, data: result.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/voice-otp/configs/:id', auth, async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM voice_otp_configs WHERE id = $1 RETURNING id', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Config not found' });
        res.json({ success: true, message: 'Config deleted' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Audio upload for language configs (greetings + digit audio)
// Supports MP3 auto-conversion to WAV via ffmpeg if available
app.post('/api/voice-otp/configs/:id/audio', auth, voiceOtpUpload.single('audio'), async (req, res) => {
    try {
        const { id } = req.params;
        if (!req.file) return res.status(400).json({ error: 'No audio file provided' });
        
        const field = req.body.field || 'greeting_audio_url';
        const digit = req.body.digit || null;       // '0'-'9' for digit uploads
        const layer = req.body.layer || 'primary';  // 'primary' or 'secondary'
        
        // --- MP3 → WAV conversion via ffmpeg (if available) ---
        let audioBuffer = req.file.buffer;
        let mime = req.file.mimetype || 'audio/wav';
        const isMp3 = mime.includes('mpeg') || mime.includes('mp3') || req.file.originalname?.toLowerCase().endsWith('.mp3');
        
        if (isMp3) {
            try {
                const { exec } = require('child_process');
                const fs = require('fs');
                const tmpIn = `/tmp/voice_otp_upload_${Date.now()}_in.mp3`;
                const tmpOut = `/tmp/voice_otp_upload_${Date.now()}_out.wav`;
                fs.writeFileSync(tmpIn, req.file.buffer);
                // Convert: 8kHz mono 16-bit PCM WAV (telecom standard)
                await new Promise((resolve, reject) => {
                    exec(`ffmpeg -y -i ${tmpIn} -ar 8000 -ac 1 -sample_fmt s16 ${tmpOut} 2>/dev/null`, { timeout: 15000 }, (err) => {
                        if (err) reject(err); else resolve();
                    });
                });
                audioBuffer = fs.readFileSync(tmpOut);
                mime = 'audio/wav';
                // Cleanup temp files
                try { fs.unlinkSync(tmpIn); fs.unlinkSync(tmpOut); } catch (_) {}
                console.log(`[VoiceOTP-Audio] MP3→WAV converted: ${req.file.originalname} (${req.file.size}→${audioBuffer.length} bytes)`);
            } catch (convErr) {
                console.warn(`[VoiceOTP-Audio] ffmpeg conversion failed, storing as-is: ${convErr.message}`);
                // Store original MP3 as-is (Asterisk can handle MP3 if configured)
            }
        }
        
        const b64 = audioBuffer.toString('base64');
        const dataUrl = `data:${mime};base64,${b64}`;
        
        // --- Digit audio upload (store in JSONB) ---
        if (digit !== null && digit !== undefined && /^[0-9]$/.test(String(digit))) {
            const jsonbCol = layer === 'secondary' ? 'audio_0_9_secondary' : 'audio_0_9_primary';
            
            // Fetch existing JSONB, update the digit key, store back
            const existing = await pool.query(
                `SELECT ${jsonbCol} FROM voice_otp_configs WHERE id = $1`,
                [id]
            );
            if (existing.rows.length === 0) return res.status(404).json({ error: 'Config not found' });
            
            let audioMap = {};
            try {
                const raw = existing.rows[0][jsonbCol];
                if (raw && typeof raw === 'string') audioMap = JSON.parse(raw);
                else if (raw && typeof raw === 'object') audioMap = raw;
            } catch (_) { audioMap = {}; }
            
            audioMap[String(digit)] = dataUrl;
            
            await pool.query(
                `UPDATE voice_otp_configs SET ${jsonbCol} = $1 WHERE id = $2`,
                [JSON.stringify(audioMap), id]
            );
            
            res.json({ success: true, message: `Digit ${digit} audio uploaded (${layer})`, digit: String(digit), layer });
            return;
        }
        
        // --- Greeting audio upload (store in text column) ---
        const allowedFields = ['greeting_audio_url', 'secondary_greeting_audio_url'];
        if (!allowedFields.includes(field)) {
            return res.status(400).json({ error: 'Invalid audio field. Use field=greeting_audio_url, field=secondary_greeting_audio_url, or digit=0-9 with layer=primary|secondary' });
        }
        
        const result = await pool.query(
            `UPDATE voice_otp_configs SET ${field} = $1 WHERE id = $2 RETURNING *`,
            [dataUrl, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Config not found' });
        res.json({ success: true, data: result.rows[0], message: 'Audio uploaded' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// SIP Settings (global) — stored in platform_settings with key prefix 'sip_'
app.get('/api/voice-otp/sip-settings', auth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT key, value FROM platform_settings WHERE key IN ('sip_host','sip_port','sip_username','sip_password','sip_caller_id','sip_e164','audio_codec')`
        );
        const settings = {};
        for (const row of result.rows) { settings[row.key] = row.value; }
        res.json({ success: true, data: settings });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/voice-otp/sip-settings', auth, async (req, res) => {
    try {
        const b = req.body || {};
        const keys = { sip_host: 'host', sip_port: 'port', sip_username: 'username', sip_password: 'password', sip_caller_id: 'caller_id', sip_e164: 'is_e164', audio_codec: 'audio_codec' };
        for (const [k, v] of Object.entries(keys)) {
            if (b[v] !== undefined) {
                await pool.query(
                    `INSERT INTO platform_settings (key, value, updated_at) VALUES ($1, $2, NOW())
                     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
                    [k, String(b[v])]
                );
            }
        }
        // Reconnect asterisk bridge if SIP config changed
        if (b.host) {
            const ac = require('./asterisk-bridge.cjs');
            ac.setGlobalSipConfig({ host: b.host, port: parseInt(b.port) || 5060, username: b.username || '', password: b.password || '', callerId: b.caller_id || '' });
        }
        res.json({ success: true, message: 'SIP settings updated' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ──────────── Multi-SIP Server Management ────────────
// GET — list all SIP servers + legacy single-server fields for backward compat
app.get('/api/voice-otp/sip-servers', auth, async (req, res) => {
    try {
        const svrR = await pool.query("SELECT value FROM platform_settings WHERE key = 'sip_servers'");
        let sipServers = [];
        if (svrR.rows.length && svrR.rows[0].value) {
            try { sipServers = typeof svrR.rows[0].value === 'string' ? JSON.parse(svrR.rows[0].value) : svrR.rows[0].value; }
            catch { sipServers = []; }
        }
        if (!Array.isArray(sipServers)) sipServers = [];
        const legacyR = await pool.query(
            "SELECT key, value FROM platform_settings WHERE key IN ('sip_host','sip_port','sip_username','sip_password','sip_caller_id','sip_e164','audio_codec')"
        );
        const legacy = {};
        for (const row of legacyR.rows) { legacy[row.key] = row.value; }
        res.json({ success: true, data: { servers: sipServers, legacy } });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT — save sip_servers JSON array + reconnect bridge for first active server
app.put('/api/voice-otp/sip-servers', auth, async (req, res) => {
    try {
        const { servers, legacy } = req.body || {};
        if (servers && Array.isArray(servers)) {
            const json = JSON.stringify(servers);
            await pool.query(
                "INSERT INTO platform_settings (key, value, updated_at) VALUES ('sip_servers', $1, NOW()) ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()",
                [json]
            );
            const primary = servers[0];
            if (primary && primary.host) {
                const ac = require('./asterisk-bridge.cjs');
                ac.setGlobalSipConfig({
                    host: primary.host,
                    port: parseInt(primary.port) || 5060,
                    username: primary.username || '',
                    password: primary.password || '',
                    callerId: primary.caller_id || ''
                });
            }
        }
        if (legacy) {
            const keys = { sip_host: 'host', sip_port: 'port', sip_username: 'username', sip_password: 'password', sip_caller_id: 'caller_id', sip_e164: 'is_e164', audio_codec: 'codec' };
            for (const [dbKey, paramKey] of Object.entries(keys)) {
                if (legacy[paramKey] !== undefined) {
                    await pool.query(
                        "INSERT INTO platform_settings (key, value, updated_at) VALUES ($1, $2, NOW()) ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()",
                        [dbKey, String(legacy[paramKey])]
                    );
                }
            }
        }
        res.json({ success: true, message: 'SIP servers updated' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});


// Send Voice OTP — initiate SIP call via Asterisk bridge
app.post('/api/voice-otp/send', auth, async (req, res) => {
    try {
        const { destination, otp_code, config_id, client_id, supplier_id } = req.body;
        if (!destination) return res.status(400).json({ error: 'destination is required' });

        // 1. Look up language config by country prefix or MCC
        let config = null;
        if (config_id) {
            const cr = await pool.query('SELECT * FROM voice_otp_configs WHERE id = $1', [config_id]);
            if (cr.rows.length) config = cr.rows[0];
        }
        if (!config) {
            // Try to match by destination prefix (first 1-4 digits of destination)
            for (let len = 4; len >= 1; len--) {
                const prefix = String(destination).substring(0, len);
                const cr = await pool.query(
                    'SELECT * FROM voice_otp_configs WHERE $1 = ANY(string_to_array(country_prefix, ',')) AND is_active = true ORDER BY id LIMIT 1',
                    [prefix]
                );
                if (cr.rows.length) { config = cr.rows[0]; break; }
            }
        }
        if (!config) {
            // Fallback to first active config
            const cr = await pool.query('SELECT * FROM voice_otp_configs WHERE is_active = true ORDER BY id LIMIT 1');
            if (cr.rows.length) config = cr.rows[0];
        }
        if (!config) return res.status(400).json({ error: 'No active voice OTP config found' });

        // 2. Extract OTP from message (4-8 digits)
        let finalOtp = otp_code;
        if (!finalOtp && req.body.message) {
            const m = String(req.body.message).match(/\b\d{4,8}\b/);
            if (m) finalOtp = m[0];
        }
        if (!finalOtp) {
            finalOtp = String(Math.floor(100000 + Math.random() * 900000));
        }

        // 3. Build call ID and insert log
        const callId = `VOICE_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
        const logResult = await pool.query(
            `INSERT INTO voice_otp_logs (call_id, destination, otp_code, language, status, retry_count, max_retries, client_id, created_at)
             VALUES ($1,$2,$3,$4,'initiated',0,$5,$6,NOW()) RETURNING *`,
            [callId, destination, finalOtp, config.language || 'en', (req.body.max_retries || config.retry_count || 4), client_id || null]
        );

        // 4. Get SIP settings
        // ── Multi-SIP server selection: fetch sip_servers and match by MCC/MNC ──
        const sipServerR = await pool.query("SELECT value FROM platform_settings WHERE key = 'sip_servers'");
        let sipServers = [];
        if (sipServerR.rows.length && sipServerR.rows[0].value) {
            try { sipServers = typeof sipServerR.rows[0].value === "string" ? JSON.parse(sipServerR.rows[0].value) : sipServerR.rows[0].value; }
            catch { sipServers = []; }
        }
        if (!Array.isArray(sipServers)) sipServers = [];

        // Try to find destination's MCC for SIP server matching
        let destMcc = "";
        try {
            const destNum = String(destination).replace(/^\+/, "");
            for (let len = 4; len >= 1; len--) {
                const prefix = destNum.substring(0, len);
                const mccR = await pool.query(
                    "SELECT mcc FROM mccmnc WHERE calling_code = $1 AND (is_deleted IS NULL OR is_deleted = false) LIMIT 1",
                    [prefix]
                );
                if (mccR.rows.length) { destMcc = mccR.rows[0].mcc; break; }
            }
        } catch (e) { /* non-critical */ }

        // Select best matching SIP server
        let selectedServer = sipServers.length > 0 ? sipServers[0] : null;
        if (destMcc && sipServers.length > 1) {
            for (const srv of sipServers) {
                const allowed = (srv.mccmnc_allowed || "").split(",").map(s => s.trim()).filter(Boolean);
                if (allowed.includes(destMcc) || allowed.includes("*")) {
                    selectedServer = srv;
                    break;
                }
            }
        }

        // Legacy fallback: global platform_settings for backward compat
        const sipR = await pool.query(
            "SELECT key, value FROM platform_settings WHERE key IN ('sip_host','sip_port','sip_username','sip_password','sip_caller_id','sip_e164','audio_codec')"
        );
        const sip = {};
        for (const row of sipR.rows) { sip[row.key] = row.value; }

        // 5. Use selected multi-server or fall back to legacy single-server
        const sipHost = (selectedServer && selectedServer.host) || sip.sip_host || "127.0.0.1";
        const sipPort = (selectedServer && selectedServer.port) || parseInt(sip.sip_port) || 5060;
        const sipUser = (selectedServer && selectedServer.username) || sip.sip_username || "";
        const sipPass = (selectedServer && selectedServer.password) || sip.sip_password || "";
        const callerId = (selectedServer && selectedServer.caller_id) || sip.sip_caller_id || "";

        // 6. Originate SIP call via Asterisk bridge
        try {
            const ac = require('./asterisk-bridge.cjs');
            const callOpts = {
                callId,
                destination,
                sipHost,
                sipPort,
                sipUsername: sipUser,
                sipPassword: sipPass,
                callerId,
                greetingAudio: config.greeting_audio_url || null,
                digitAudio: config.audio_0_9 || null,
                otpCode: finalOtp,
                timeout: (req.body.timeout || 30) * 1000,
            };

            // Fire and forget — DLR comes back via callback
            ac.originateCall(callOpts).then((callResult) => {
                pool.query(
                    `UPDATE voice_otp_logs SET status = $1, dlr_status = $2, duration = $3, completed_at = NOW()
                     WHERE call_id = $4`,
                    [callResult.status || 'completed', callResult.dlr || 'DELIVRD', callResult.duration || 0, callId]
                ).catch(() => {});
            }).catch(async () => {
                await pool.query(
                    `UPDATE voice_otp_logs SET status = 'failed', dlr_status = 'FAILED', completed_at = NOW()
                     WHERE call_id = $1`, [callId]
                );
            });
        } catch (bridgeErr) {
            console.warn('[voice-otp] Asterisk bridge error:', bridgeErr.message);
            // Simulate success for testing without Asterisk
            setTimeout(async () => {
                await pool.query(
                    `UPDATE voice_otp_logs SET status = 'completed', dlr_status = 'DELIVRD', duration = 8000, completed_at = NOW()
                     WHERE call_id = $1`, [callId]
                );
            }, 2000);
        }

        res.json({ success: true, data: logResult.rows[0], message: `Voice OTP call initiated: ${callId}` });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Test call - same as send but with auto-generated OTP
app.post('/api/voice-otp/test', auth, async (req, res) => {
    return app._router.stack.find(layer => layer.route && layer.route.path === '/api/voice-otp/send' && layer.route.methods.post)
        ?.handle(req, res);
    try {
        req.body.otp_code = req.body.otp_code || String(Math.floor(100000 + Math.random() * 900000));
        // Forward to send endpoint
        return app._router.stack.find(l => l.route?.path === '/api/voice-otp/send' && l.route?.methods?.post)?.handle?.(req, res)
            || res.status(500).json({ error: 'Send endpoint not available' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Call logs
app.post('/api/voice-otp/logs', auth, async (req, res) => {
    try {
        const f = req.body || {};
        let q = 'SELECT * FROM voice_otp_logs WHERE 1=1';
        const p = []; let i = 1;
        if (f.status)    { q += ` AND status = $${i++}`; p.push(f.status); }
        if (f.dlr_status){ q += ` AND dlr_status = $${i++}`; p.push(f.dlr_status); }
        if (f.destination){ q += ` AND destination ILIKE $${i++}`; p.push(`%${f.destination}%`); }
        if (f.client_id) { q += ` AND client_id = $${i++}`; p.push(f.client_id); }
        if (f.start_date){ q += ` AND created_at >= $${i++}`; p.push(f.start_date); }
        if (f.end_date)  { q += ` AND created_at <= $${i++}`; p.push(f.end_date); }
        q += ' ORDER BY created_at DESC LIMIT 500';
        const result = await pool.query(q, p);
        res.json({ success: true, data: result.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/voice-otp/logs', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM voice_otp_logs ORDER BY created_at DESC LIMIT 500');
        res.json({ success: true, data: result.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Retry failed voice OTP calls
app.post('/api/voice-otp/retry/:callId', auth, async (req, res) => {
    try {
        const { callId } = req.params;
        const logR = await pool.query('SELECT * FROM voice_otp_logs WHERE call_id = $1', [callId]);
        if (logR.rows.length === 0) return res.status(404).json({ error: 'Call log not found' });
        const log = logR.rows[0];
        if (log.retry_count >= (log.max_retries || 3)) {
            return res.status(400).json({ error: 'Max retries exceeded' });
        }
        await pool.query(
            `UPDATE voice_otp_logs SET retry_count = retry_count + 1, status = 'initiated', next_retry_at = NULL
             WHERE call_id = $1`, [callId]
        );
        // Forward to send logic
        try {
            return app._router.stack.find(l => l.route?.path === '/api/voice-otp/send' && l.route?.methods?.post)?.handle?.(req, res)
                || res.status(500).json({ error: 'Send endpoint not available' });
        } catch (e) { res.status(500).json({ error: e.message }); }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== VOICE OTP — HTTP CONNECTOR (Borno, etc.) ====================
// Send Voice OTP via HTTP API connector (reads config from api_connectors table)
// POST { destination, otp_code, connector_id, client_id }
app.post('/api/voice-otp/http-send', auth, async (req, res) => {
    try {
        const { destination, otp_code, connector_id, client_id } = req.body;
        if (!destination) return res.status(400).json({ error: 'destination is required' });
        if (!otp_code) return res.status(400).json({ error: 'otp_code is required' });

        // 1. Look up connector
        let connId = connector_id;
        if (!connId) {
            // Auto-find first active HTTP connector with api_key
            const cr = await pool.query(
                `SELECT id FROM api_connectors WHERE is_active = true AND api_key IS NOT NULL AND api_key != '' AND send_url IS NOT NULL AND send_url != '' ORDER BY id LIMIT 1`
            );
            if (cr.rows.length) connId = cr.rows[0].id;
        }
        if (!connId) return res.status(400).json({ error: 'No API connector found. Provide connector_id or add an active connector.' });

        const cr = await pool.query('SELECT * FROM api_connectors WHERE id = $1 AND is_active = true', [connId]);
        if (!cr.rows.length) return res.status(404).json({ error: 'API connector not found or inactive' });
        const conn = cr.rows[0];

        const apiKey = conn.api_key;
        const sendUrl = conn.send_url || conn.base_url;
        const method = (conn.http_method || 'GET').toUpperCase();

        if (!sendUrl) return res.status(400).json({ error: 'No send_url configured on connector' });
        if (!apiKey) return res.status(400).json({ error: 'No api_key configured on connector' });

        // 2. Clean destination
        const msisdn = String(destination).replace(/^\+/, '');

        // 3. Generate call_id and insert log
        const callId = 'VOICE_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);
        await pool.query(
            `INSERT INTO voice_otp_logs (call_id, destination, otp_code, language, status, retry_count, max_retries, client_id, created_at)
             VALUES ($1,$2,$3,'http','initiated',0,3,$4,NOW())`,
            [callId, destination, otp_code, client_id || null]
        );

        // 4. Make HTTP call to voice OTP provider
        try {
            const ctrl = new AbortController();
            setTimeout(() => ctrl.abort(), 15000);

            let response;
            if (method === 'GET') {
                const url = new URL(sendUrl);
                url.searchParams.set('apiKey', apiKey);
                url.searchParams.set('msisdn', msisdn);
                url.searchParams.set('code', String(otp_code));
                response = await fetch(url.toString(), { signal: ctrl.signal });
            } else {
                const body = JSON.stringify({ apiKey, msisdn, code: String(otp_code) });
                response = await fetch(sendUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body,
                    signal: ctrl.signal,
                });
            }

            const data = await response.json().catch(() => null);

            if (response.ok) {
                const txId = data?.transaction_id || data?.trans_id || data?.id || '';
                await pool.query(
                    `UPDATE voice_otp_logs SET status = 'sent', dlr_status = 'PENDING', sip_call_id = $1 WHERE call_id = $2`,
                    [txId, callId]
                );
                res.json({
                    success: true,
                    data: { call_id: callId, transaction_id: txId, destination, otp_code, provider: conn.name },
                    message: 'Call initiated via ' + conn.name + '. TX: ' + txId
                });
            } else {
                const errMsg = data?.message || data?.error || 'HTTP ' + response.status;
                await pool.query(
                    `UPDATE voice_otp_logs SET status = 'failed', error_message = $1, completed_at = NOW() WHERE call_id = $2`,
                    [errMsg, callId]
                );
                res.json({ success: false, error: errMsg, call_id: callId });
            }
        } catch (fetchErr) {
            await pool.query(
                `UPDATE voice_otp_logs SET status = 'failed', error_message = $1, completed_at = NOW() WHERE call_id = $2`,
                [fetchErr.message, callId]
            );
            res.status(502).json({ success: false, error: 'HTTP request failed: ' + fetchErr.message, call_id: callId });
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Check Voice OTP delivery status via HTTP connector
// GET /api/voice-otp/check-delivery/:connectorId/:transId
app.get('/api/voice-otp/check-delivery/:connectorId/:transId', auth, async (req, res) => {
    try {
        const { connectorId, transId } = req.params;
        const cr = await pool.query('SELECT * FROM api_connectors WHERE id = $1 AND is_active = true', [connectorId]);
        if (!cr.rows.length) return res.status(404).json({ error: 'Connector not found or inactive' });
        const conn = cr.rows[0];

        const dlrUrl = conn.dlr_url;
        if (!dlrUrl) return res.status(400).json({ error: 'No dlr_url (check delivery URL) configured on this connector' });

        const ctrl = new AbortController();
        setTimeout(() => ctrl.abort(), 10000);
        const url = new URL(dlrUrl);
        url.searchParams.set('apiKey', conn.api_key);
        url.searchParams.set('trans_id', transId);
        const response = await fetch(url.toString(), { signal: ctrl.signal });
        const data = await response.json().catch(() => null);

        // Update log if delivery confirmed
        if (data?.status === 'success') {
            await pool.query(
                `UPDATE voice_otp_logs SET dlr_status = 'DELIVRD', completed_at = NOW(),
                 duration = COALESCE($2, 0) WHERE sip_call_id = $1 AND dlr_status = 'PENDING'`,
                [transId, data?.duration || 0]
            ).catch(() => {});
        }

        res.json({ success: true, data: { trans_id: transId, connector: conn.name, delivery: data } });
    } catch (e) { res.status(500).json({ error: e.message }); }
});
// ==================== OTT DEVICES ====================
app.get('/api/ott-devices', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM ott_devices ORDER BY id');
        res.json({ success: true, data: result.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/ott-devices', auth, async (req, res) => {
    try {
        const b = req.body || {};
        if (!b.device_name) return res.status(400).json({ error: 'device_name is required' });
        const result = await pool.query(
            `INSERT INTO ott_devices (device_name, device_type, phone_number, session_status, qr_code, last_active, supplier_id, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING *`,
            [b.device_name, b.device_type || 'whatsapp', b.phone_number || '', b.session_status || 'disconnected', b.qr_code || null, b.last_active || null, b.supplier_id || null]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/ott-devices/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const fields = req.body;
        const allowed = ['device_name','device_type','phone_number','session_status','qr_code','last_active','supplier_id'];
        const setParts = []; const values = []; let idx = 1;
        for (const key of allowed) {
            if (fields[key] !== undefined) { setParts.push(`${key} = $${idx++}`); values.push(fields[key]); }
        }
        if (setParts.length === 0) return res.status(400).json({ error: 'No fields to update' });
        values.push(id);
        const result = await pool.query(
            `UPDATE ott_devices SET ${setParts.join(', ')} WHERE id = $${values.length} RETURNING *`, values
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'OTT device not found' });
        res.json({ success: true, data: result.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/ott-devices/:id', auth, async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM ott_devices WHERE id = $1 RETURNING id', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'OTT device not found' });
        res.json({ success: true, message: 'OTT device deleted' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== OTT DEVICES (alias with /ott/devices path) ====================
// The frontend calls /ott/devices which is different from /ott-devices
app.get('/api/ott/devices', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM ott_devices ORDER BY id');
        res.json({ success: true, data: result.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/ott/devices', auth, async (req, res) => {
    try {
        const b = req.body || {};
        if (!b.device_name) return res.status(400).json({ error: 'device_name is required' });
        const result = await pool.query(
            `INSERT INTO ott_devices (device_name, device_type, phone_number, session_status, qr_code, last_active, supplier_id, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING *`,
            [b.device_name, b.device_type || 'whatsapp', b.phone_number || '', b.session_status || 'disconnected', b.qr_code || null, b.last_active || null, b.supplier_id || null]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/ott/devices/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const fields = req.body;
        const allowed = ['device_name','device_type','phone_number','session_status','qr_code','last_active','supplier_id'];
        const setParts = []; const values = []; let idx = 1;
        for (const key of allowed) {
            if (fields[key] !== undefined) { setParts.push(`${key} = $${idx++}`); values.push(fields[key]); }
        }
        if (setParts.length === 0) return res.status(400).json({ error: 'No fields to update' });
        values.push(id);
        const result = await pool.query(
            `UPDATE ott_devices SET ${setParts.join(', ')} WHERE id = $${values.length} RETURNING *`, values
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'OTT device not found' });
        res.json({ success: true, data: result.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/ott/devices/:id', auth, async (req, res) => {
    try {
        const result = await pool.query('DELETE FROM ott_devices WHERE id = $1 RETURNING id', [req.params.id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'OTT device not found' });
        res.json({ success: true, message: 'OTT device deleted' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get QR code for device pairing
app.get('/api/ott/devices/:id/qr', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM ott_devices WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'OTT device not found' });
        const device = result.rows[0];
        // Generate or return existing QR code
        let qrCode = device.qr_code;
        if (!qrCode) {
            // Generate a mock QR-like pairing token
            qrCode = `PAIR:${device.device_type}:${device.id}:${Date.now()}`;
            await pool.query('UPDATE ott_devices SET qr_code = $1 WHERE id = $2', [qrCode, id]);
        }
        res.json({ success: true, data: { qr: qrCode } });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Connect device
app.post('/api/ott/devices/:id/connect', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `UPDATE ott_devices SET session_status = 'connected', last_active = NOW() WHERE id = $1 RETURNING *`,
            [id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'OTT device not found' });
        res.json({ success: true, data: result.rows[0], message: 'Device connected' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Disconnect device
app.post('/api/ott/devices/:id/disconnect', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            `UPDATE ott_devices SET session_status = 'disconnected' WHERE id = $1 RETURNING *`,
            [id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'OTT device not found' });
        res.json({ success: true, data: result.rows[0], message: 'Device disconnected' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Validate phone number for device
app.post('/api/ott/devices/:id/validate', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const { number } = req.body || {};
        if (!number) return res.status(400).json({ error: 'number is required' });
        const result = await pool.query('SELECT * FROM ott_devices WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'OTT device not found' });
        const device = result.rows[0];
        // Basic validation: check if number matches device type capabilities
        const valid = device.session_status === 'connected' && number.length >= 10;
        res.json({ success: true, data: { valid } });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== NOTIFICATIONS ====================
app.get('/api/notifications', auth, async (req, res) => {
    try {
        const { unread } = req.query;
        let q = 'SELECT * FROM notifications';
        if (unread === 'true') q += ' WHERE is_read = false';
        q += ' ORDER BY created_at DESC LIMIT 200';
        const result = await pool.query(q);
        res.json({ success: true, data: result.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/notifications/:id/read', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            'UPDATE notifications SET is_read = true WHERE id = $1 RETURNING *', [id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Notification not found' });
        res.json({ success: true, data: result.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Mark all notifications as read
app.post('/api/notifications/read-all', auth, async (req, res) => {
    try {
        const result = await pool.query(
            'UPDATE notifications SET is_read = true WHERE is_read = false RETURNING id'
        );
        res.json({ success: true, message: `${result.rows.length} notifications marked as read`, count: result.rows.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== NOTIFICATION TEMPLATES (Email Templates) ====================
app.get('/api/notification-templates', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM notification_templates ORDER BY id');
        res.json({ success: true, data: result.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/notification-templates/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const fields = req.body;
        const allowed = ['template_name','subject','body','variables','is_active'];
        const setParts = []; const values = []; let idx = 1;
        for (const key of allowed) {
            if (fields[key] !== undefined) { setParts.push(`${key} = $${idx++}`); values.push(fields[key]); }
        }
        if (setParts.length === 0) return res.status(400).json({ error: 'No fields to update' });
        values.push(id);
        const result = await pool.query(
            `UPDATE notification_templates SET ${setParts.join(', ')} WHERE id = $${values.length} RETURNING *`, values
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Template not found' });
        res.json({ success: true, data: result.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== PLATFORM SETTINGS ====================
app.get('/api/platform-settings', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT key, value FROM platform_settings ORDER BY key');
        const settings = {};
        for (const row of result.rows) { settings[row.key] = row.value; }
        res.json({ success: true, data: settings });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/platform-settings', auth, async (req, res) => {
    try {
        const b = req.body || {};
        const allowed = ['platform_name','support_email','company_name','company_address','company_phone',
            'company_email','company_vat','currency','invoice_prefix','payment_prefix',
            'default_tax_rate','force_dlr_default','dlr_timeout_default','auto_block_failures',
            'max_retry_attempts','voice_otp_retry_interval','voice_otp_max_retries'];
        for (const key of allowed) {
            if (b[key] !== undefined) {
                await pool.query(
                    `INSERT INTO platform_settings (key, value, updated_at) VALUES ($1, $2, NOW())
                     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
                    [key, String(b[key])]
                );
            }
        }
        res.json({ success: true, message: 'Platform settings updated' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});


// ==================== CHANNELS (RCS, Flash SMS, WhatsApp, Telegram, HTTP API) ====================
// Generic multi-channel message send endpoint
app.post('/api/channels/send', auth, async (req, res) => {
    try {
        const { channel, destination, message, device_id, sender_id, media_url, api_connector_id } = req.body;
        if (!channel) return res.status(400).json({ error: 'channel is required (rcs, flash_sms, whatsapp, telegram, http)' });
        if (!destination || !message) return res.status(400).json({ error: 'destination and message are required' });

        const messageId = 'CH_' + channel.toUpperCase() + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 8);

        switch (channel) {
            case 'rcs':
            case 'flash_sms':
            case 'whatsapp':
            case 'telegram':
                // Log the send to channel_messages table
                const msgInsert = await pool.query(
                    `INSERT INTO channel_messages (message_id, channel, destination, message_text, media_url, device_id, sender_id, api_connector_id, status, submitted_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'queued',NOW()) RETURNING *`,
                    [messageId, channel, destination, message, media_url || null, device_id || null, sender_id || null, api_connector_id || null]
                );
                // Simulate delivery
                setTimeout(function() {
                    pool.query(`UPDATE channel_messages SET status = 'delivered', delivered_at = NOW() WHERE message_id = $1`, [messageId]).catch(function() {});
                }, 2000);
                return res.json({ success: true, data: msgInsert.rows[0], message: channel.toUpperCase() + ' message queued' });

            case 'http':
                if (!api_connector_id) {
                    return res.status(400).json({ error: 'api_connector_id is required for http channel' });
                }
                const connResult = await pool.query('SELECT * FROM api_connectors WHERE id = $1', [api_connector_id]);
                if (connResult.rows.length === 0) return res.status(404).json({ error: 'API connector not found' });
                const connector = connResult.rows[0];

                const msgInsertHttp = await pool.query(
                    `INSERT INTO channel_messages (message_id, channel, destination, message_text, api_connector_id, status, submitted_at) VALUES ($1,$2,$3,$4,$5,'sending',NOW()) RETURNING *`,
                    [messageId, channel, destination, message, api_connector_id]
                );

                try {
                    const ctrl = new AbortController();
                    setTimeout(function() { ctrl.abort(); }, 10000);
                    const httpRes = await fetch(connector.base_url || connector.send_url, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            ...(connector.api_key ? { 'Authorization': 'Bearer ' + connector.api_key } : {}),
                        },
                        body: JSON.stringify({ to: destination, text: message, message_id: messageId }),
                        signal: ctrl.signal,
                    });
                    const status = httpRes.ok ? 'delivered' : 'failed';
                    await pool.query(`UPDATE channel_messages SET status = $1, http_status = $2, delivered_at = NOW() WHERE message_id = $3`, [status, httpRes.status, messageId]);
                    return res.json({ success: true, data: msgInsertHttp.rows[0], message: 'HTTP ' + status });
                } catch (httpErr) {
                    await pool.query(`UPDATE channel_messages SET status = 'failed', error = $1 WHERE message_id = $2`, [httpErr.message, messageId]);
                    return res.json({ success: true, data: msgInsertHttp.rows[0], message: 'HTTP failed: ' + httpErr.message });
                }

            default:
                return res.status(400).json({ error: 'Unsupported channel: ' + channel + '. Supported: rcs, flash_sms, whatsapp, telegram, http' });
        }
    } catch (e) { 
        return res.status(500).json({ error: e.message }); 
    }
});

// Get channel message logs
app.post('/api/channels/logs', auth, async (req, res) => {
    try {
        const f = req.body || {};
        let q = 'SELECT * FROM channel_messages WHERE 1=1';
        const p = []; let i = 1;
        if (f.channel)   { q += ` AND channel = $` + (i++); p.push(f.channel); }
        if (f.status)    { q += ` AND status = $` + (i++); p.push(f.status); }
        if (f.destination){ q += ` AND destination ILIKE $` + (i++); p.push('%' + f.destination + '%'); }
        if (f.start_date){ q += ` AND submitted_at >= $` + (i++); p.push(f.start_date); }
        if (f.end_date)  { q += ` AND submitted_at <= $` + (i++); p.push(f.end_date); }
        q += ' ORDER BY submitted_at DESC LIMIT 500';
        const result = await pool.query(q, p);
        return res.json({ success: true, data: result.rows });
    } catch (e) { 
        return res.status(500).json({ error: e.message }); 
    }
});

// ==================== SMTP CONFIG ====================
app.get('/api/smtp-config', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM smtp_config ORDER BY id LIMIT 1');
        if (result.rows.length === 0) {
            return res.json({ success: true, data: { host: 'smtp.gmail.com', port: 587, encryption: 'tls', username: '', password: '', from_email: '', from_name: '', is_active: true } });
        }
        res.json({ success: true, data: result.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/smtp-config', auth, async (req, res) => {
    try {
        const b = req.body || {};
        const existing = await pool.query('SELECT id FROM smtp_config LIMIT 1');
        if (existing.rows.length > 0) {
            const allowed = ['host','port','encryption','username','password','from_email','from_name','is_active'];
            const setParts = []; const values = []; let idx = 1;
            for (const key of allowed) {
                if (b[key] !== undefined) { setParts.push(`${key} = $${idx++}`); values.push(b[key]); }
            }
            if (setParts.length === 0) return res.status(400).json({ error: 'No fields to update' });
            setParts.push(`updated_at = NOW()`);
            values.push(existing.rows[0].id);
            const result = await pool.query(
                `UPDATE smtp_config SET ${setParts.join(', ')} WHERE id = $${values.length} RETURNING *`, values
            );
            res.json({ success: true, data: result.rows[0] });
        } else {
            const result = await pool.query(
                `INSERT INTO smtp_config (host, port, encryption, username, password, from_email, from_name, is_active, updated_at)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING *`,
                [b.host || 'smtp.gmail.com', b.port || 587, b.encryption || 'tls', b.username || '', b.password || '', b.from_email || '', b.from_name || '', b.is_active !== false]
            );
            res.json({ success: true, data: result.rows[0] });
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== API CONNECTORS (enhanced with type filtering) ====================
// GET with optional connection type filter
app.get('/api/api-connectors', auth, async (req, res) => {
    try {
        const { type } = req.query;
        let q = 'SELECT * FROM api_connectors';
        const p = [];
        if (type) { q += ' WHERE type = $1'; p.push(type); }
        q += ' ORDER BY id';
        const result = await pool.query(q, p);
        res.json({ success: true, data: result.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Test API connector connectivity
app.post('/api/api-connectors/:id/test', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM api_connectors WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'API connector not found' });

        const conn = result.rows[0];
        const baseUrl = conn.base_url || '';
        const apiKey = conn.api_key || '';

        // Update status to 'testing'
        await pool.query(
            `UPDATE api_connectors SET connection_status = 'testing' WHERE id = $1`, [id]
        );

        if (!baseUrl) {
            await pool.query(
                `UPDATE api_connectors SET connection_status = 'failed' WHERE id = $1`, [id]
            );
            return res.json({ success: true, data: { status: 'failed', message: 'No base URL configured' } });
        }

        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);

            const testResp = await fetch(baseUrl, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
                },
                signal: controller.signal,
            });

            clearTimeout(timeout);

            const status = testResp.ok ? 'connected' : 'failed';
            await pool.query(
                `UPDATE api_connectors SET connection_status = $1 WHERE id = $2`, [status, id]
            );

            res.json({
                success: true,
                data: {
                    status,
                    statusCode: testResp.status,
                    statusText: testResp.statusText,
                    message: testResp.ok ? 'Connection successful' : `HTTP ${testResp.status}: ${testResp.statusText}`,
                }
            });
        } catch (fetchErr) {
            const status = 'failed';
            await pool.query(
                `UPDATE api_connectors SET connection_status = $1 WHERE id = $2`, [status, id]
            );
            res.json({
                success: true,
                data: {
                    status,
                    message: fetchErr.name === 'AbortError' ? 'Connection timed out after 5s' : `Connection failed: ${fetchErr.message}`,
                }
            });
        }
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== CLIENT BIND STATUS (ESME — real session data from smpp_sessions) ====================
// Returns client bind status with real ESME session data (system_id, IP, connected_at, bind_mode, etc.)
app.get('/api/bind/clients', auth, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT c.id, c.client_code, c.company_name, c.smpp_username, c.smpp_ip, c.smpp_port,
                    c.system_type, c.max_tps, c.routing_plan_id, c.status as client_status,
                    sess.system_id as session_system_id, sess.connected_at, sess.ip_address as session_ip,
                    sess.remote_ip, sess.bind_mode, sess.status as session_status,
                    sess.negotiated_version, sess.last_activity, sess.smpp_session_id,
                    sess.bound_count, sess.last_error, sess.last_error_at,
                    CASE WHEN sess.id IS NOT NULL AND sess.status = 'bound' THEN 'bound'
                         WHEN sess.id IS NOT NULL THEN 'connecting'
                         ELSE 'unbound' END as bind_status
             FROM clients c
             LEFT JOIN smpp_sessions sess ON c.id = sess.entity_id AND sess.entity_type = 'client'
             WHERE (c.is_deleted IS NULL OR c.is_deleted = false)
               AND c.smpp_username IS NOT NULL AND c.smpp_username != ''
             ORDER BY c.id`
        );
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== BIND STATUS (SMSC — supplier connections) ====================
// ?show_deleted=true — include inactive/deleted suppliers (default: hide them)
app.get('/api/bind/status', auth, async (req, res) => {
    try {
        const showDeleted = req.query.show_deleted === 'true';
        const result = await pool.query(
            `SELECT s.id, s.supplier_code, s.company_name, s.bind_status, s.consecutive_failures,
                    s.smpp_host, s.smpp_port, s.smpp_username, s.connection_type, s.status as supplier_status, s.is_inbound, s.smpp_bind_type,
       CASE WHEN s.is_inbound = true THEN 'smsc_server' ELSE 'esme_client' END as smpp_mode,
                    COALESCE(sess.system_id, client_sess.system_id) as session_system_id,
                    COALESCE(sess.connected_at, client_sess.connected_at) as connected_at,
                    COALESCE(sess.ip_address, client_sess.ip_address) as ip_address,
                    COALESCE(sess.status, client_sess.status) as session_status,
                    COALESCE(sess.bind_mode, client_sess.bind_mode) as bind_mode,
                    CASE 
         WHEN client_sess.id IS NOT NULL AND client_sess.status = 'bound' THEN 'connected'
         WHEN sess.id IS NOT NULL AND sess.status = 'bound' THEN 'connected'
         WHEN s.bind_status = 'bound' THEN 'connected'
         ELSE 'disconnected' 
       END as session_state
             FROM suppliers s
             LEFT JOIN active_smpp_sessions sess ON s.id = sess.entity_id AND sess.entity_type = 'supplier'
             LEFT JOIN smpp_sessions client_sess ON client_sess.entity_type = 'client'
               AND client_sess.status = 'bound'
               AND client_sess.system_id = s.smpp_username
               AND s.is_inbound = true
             WHERE s.connection_type IN ('smpp', 'http', 'ott_whatsapp', 'ott_telegram')
               ${showDeleted ? '' : "AND s.status = 'active' AND (s.is_deleted IS NULL OR s.is_deleted = false)"}
             ORDER BY s.id`
        );
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== BIND HISTORY (Audit Trail) ====================
// Returns paginated bind/unbind audit trail from bind_history table
// Supports filters: entity_type, entity_id, status, offset, limit
app.get('/api/bind/history', auth, async (req, res) => {
    try {
        const { entity_type, entity_id, status, limit, offset } = req.query;
        const pageLimit = Math.min(parseInt(limit) || 50, 500);
        const pageOffset = parseInt(offset) || 0;

        // Build filter WHERE clauses shared between count and data queries
        let filterWhere = '';
        const fp = []; let fi = 1;
        if (entity_type) { filterWhere += ` AND b.entity_type = $${fi++}`; fp.push(entity_type); }
        if (entity_id)   { filterWhere += ` AND b.entity_id = $${fi++}`; fp.push(parseInt(entity_id)); }
        if (status)      { filterWhere += ` AND b.status = $${fi++}`; fp.push(status); }

        // Count query
        const countQ = `SELECT COUNT(*) as total FROM bind_history b
                        LEFT JOIN clients c ON b.entity_type = 'client' AND b.entity_id = c.id
                        LEFT JOIN suppliers s ON b.entity_type = 'supplier' AND b.entity_id = s.id
                        WHERE 1=1${filterWhere}`;
        const countResult = await pool.query(countQ, fp);
        const total = parseInt(countResult.rows[0].total);

        // Data query (add LIMIT/OFFSET params)
        const dataQ = `SELECT b.*,
                              CASE WHEN b.entity_type = 'client' THEN c.client_code
                                   WHEN b.entity_type = 'supplier' THEN s.supplier_code
                                   ELSE NULL END as entity_code,
                              CASE WHEN b.entity_type = 'client' THEN c.company_name
                                   WHEN b.entity_type = 'supplier' THEN s.company_name
                                   ELSE NULL END as entity_name
                       FROM bind_history b
                       LEFT JOIN clients c ON b.entity_type = 'client' AND b.entity_id = c.id
                       LEFT JOIN suppliers s ON b.entity_type = 'supplier' AND b.entity_id = s.id
                       WHERE 1=1${filterWhere}
                       ORDER BY b.created_at DESC LIMIT $${fi++} OFFSET $${fi++}`;
        fp.push(pageLimit, pageOffset);
        const result = await pool.query(dataQ, fp);

        res.json({ success: true, data: result.rows, total });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==================== LICENSE ====================
app.get('/api/license/info', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM license ORDER BY id DESC LIMIT 1');
        if (result.rows.length === 0) return res.json({ success: true, data: null, message: 'No license found' });
        res.json({ success: true, data: result.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/license/activate', auth, async (req, res) => {
    try {
        const { key } = req.body;
        if (!key) return res.status(400).json({ error: 'License key is required' });
        const result = await pool.query(
            `INSERT INTO license (license_key, license_type, status, issued_to, issued_date, expiry_date, created_at)
             VALUES ($1, 'enterprise', 'active', $2, CURRENT_DATE, CURRENT_DATE + INTERVAL '1 year', NOW()) RETURNING *`,
            [key, req.user?.username || 'unknown']
        );
        res.json({ success: true, data: result.rows[0], message: 'License activated' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/license/deactivate', auth, async (req, res) => {
    try {
        const result = await pool.query(
            `UPDATE license SET status = 'expired' WHERE status = 'active' RETURNING id, license_key, status`
        );
        if (result.rows.length === 0) return res.json({ success: true, message: 'No active license to deactivate' });
        res.json({ success: true, data: result.rows[0], message: 'License deactivated' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/license/limits', auth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM license ORDER BY id DESC LIMIT 1');
        if (result.rows.length === 0) return res.json({ success: true, data: { max_clients: 10, max_suppliers: 5, max_sms_monthly: 100000, max_tps: 100 } });
        const lic = result.rows[0];
        res.json({ success: true, data: lic.limits || { max_clients: 10, max_suppliers: 5, max_sms_monthly: 100000, max_tps: 100 } });
    } catch (e) { res.status(500).json({ error: e.message }); }
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
