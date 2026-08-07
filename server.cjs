// ── Startup timing metric ──
// Records high-resolution process start time for measuring
// time-to-first-HTTP-response (TTFR). Used by the self-probe
// in app.listen() and exposed via /api/startup-metric.
const PROCESS_START_HR = process.hrtime();
let _startupMetric = { ttfrMs: null, ttfrHuman: null, probeAttempts: 0, status: 'pending' };

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

const dns = require('dns');

// ── DNS optimization: prefer IPv4 (faster), use Google/Cloudflare DNS ──
// Without this, Node.js's default DNS resolution (getaddrinfo in libuv
// thread pool) can stall the event loop for seconds per hostname lookup
// when connecting to SMPP suppliers with slow or unreachable DNS servers.
dns.setDefaultResultOrder('ipv4first');
try { dns.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']); } catch (_) { /* setServers is Windows-only; Linux uses /etc/resolv.conf */ }

// ── DNS CACHE WRAPPER ──
// Monkey-patch dns.lookup() to cache both successful and failed results.
// Without this, SMPP client reconnect loops for unreachable hosts like
// "suppliersmpp.com" call dns.lookup() repeatedly — each call goes to
// libuv's thread pool (4 threads). When many reconnect loops fire
// simultaneously, the thread pool saturates and ALL I/O (including HTTP)
// stalls. This cache keeps ENOTFOUND lookups from clogging the pool.
const dnsLookupCache = new Map();
const DNS_CACHE_TTL_MS = 300000; // 5 min TTL for both positive + negative (reconnect backoff is 10-60s)

// Periodic DNS cache cleanup: evict expired entries every 10 minutes.
// Without this, the Map grows unboundedly over months of uptime.
setInterval(() => {
    const now = Date.now();
    for (const [key, val] of dnsLookupCache) {
        if (now - val.time > DNS_CACHE_TTL_MS) dnsLookupCache.delete(key);
    }
}, 600000).unref(); // .unref() so it doesn't keep the process alive
const origLookup = dns.lookup;
dns.lookup = function (hostname, options, callback) {
    if (typeof options === 'function') { callback = options; options = {}; }
    const family = options.family || 0;
    const cacheKey = `${hostname}:${family}`;
    const cached = dnsLookupCache.get(cacheKey);
    if (cached && (Date.now() - cached.time) < DNS_CACHE_TTL_MS) {
        if (cached.error) {
            return process.nextTick(() => callback(cached.error));
        }
        return process.nextTick(() => callback(null, cached.address, cached.family));
    }
    origLookup.call(dns, hostname, options, (err, address, family) => {
        dnsLookupCache.set(cacheKey, { time: Date.now(), error: err || null, address, family });
        callback(err, address, family);
    });
};

const app = express();
const PORT = process.env.PORT || 3001;

// ==================== GLOBAL CRASH HANDLERS ====================
// Catches errors thrown OUTSIDE Express request/response cycle
// (setInterval callbacks, async IIFEs, unhandled promises).
// Without these, a single throw in a DLR poller, health check,
// or queue worker callback crashes the entire Node.js process.
// PM2 restarts it, but during the restart window (2-5s), all API
// calls fail → frontend white screens. These handlers log the
// error and keep the process alive.
process.on('uncaughtException', (err) => {
    console.error('[UNCAUGHT]', err.stack || err.message || err);
    // Exit so PM2 restarts a clean process. Continuing after an
    // uncaught exception risks corrupted state, leaked connections,
    // and silently wrong results. A 2-5s restart is safer.
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    console.error('[UNHANDLED-REJECTION]', reason?.stack || reason?.message || reason);
});


app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

const { applyRules, checkBlocks } = require('./src/services/translationEngine.cjs');
const callerIdPool = require('./src/services/callerIdPool.cjs');
const { execFile } = require('child_process');
const nodemailer = require('nodemailer');

const voiceOtpUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ── Pure numeric message ID generator ──
// Prefixes: '0'=external API/SMPP client, '1'=internal (test_sms/campaign/voice_otp),
//           '2'=rejected, '3'=MO/GSM inbound, '4'=SMPP server direct, '7'=channel (WhatsApp/Telegram)
// Format: PREFIX + timestamp(ms) + 5-digit random → ~19-digit pure numeric ID
function genNumericMsgId(prefix) {
  const ts = Date.now().toString();
  const rand = Math.floor(Math.random() * 100000).toString().padStart(5, '0');
  return (prefix || '0') + ts + rand;
}

// ── SMS Message Parts Calculator ──
// Detects whether a message uses GSM-7 or Unicode (UCS-2) encoding
// and returns the correct number of SMS segments per 3GPP TS 23.038.
//
// GSM-7 (160-char single, 153-char multi-part with 7-byte UDH)
// Unicode/UCS-2 (70-char single, 67-char multi-part with 6-byte UDH)
//
// Any character outside the GSM-7 basic set forces Unicode encoding.
function calculateMessageParts(message) {
    if (!message) return 1;
    // GSM-7 basic character set (3GPP TS 23.038)
    // Build a Set for O(1) lookup per character
    const GSM7_CHARS = new Set([
        '@','£','$','¥','è','é','ù','ì','ò','Ç','\n','Ø','ø','\r','Å','å',
        'Δ','_','Φ','Γ','Λ','Ω','Π','Ψ','Σ','Θ','Ξ','\x1B','Æ','æ','ß','É',
        ' ','!','"','#','¤','%','&','\'','(',')','*','+',',','-','.','/',
        '0','1','2','3','4','5','6','7','8','9',':',';','<','=','>','?',
        '¡','A','B','C','D','E','F','G','H','I','J','K','L','M','N','O',
        'P','Q','R','S','T','U','V','W','X','Y','Z','Ä','Ö','Ñ','Ü','§',
        '¿','a','b','c','d','e','f','g','h','i','j','k','l','m','n','o',
        'p','q','r','s','t','u','v','w','x','y','z','ä','ö','ñ','ü','à',
        // Extended GSM-7 (count as 2 chars for length but still GSM encoding)
        '\f','^','{','}','\\','[','~',']','|','€',
    ]);
    let isGSM7 = true;
    for (let i = 0; i < message.length; i++) {
        if (!GSM7_CHARS.has(message[i])) {
            isGSM7 = false;
            break;
        }
    }
    if (isGSM7) {
        if (message.length <= 160) return 1;
        return Math.ceil(message.length / 153);
    } else {
        // Unicode (UCS-2): 70 chars/single, 67/multi-part (6-byte UDH)
        if (message.length <= 70) return 1;
        return Math.ceil(message.length / 67);
    }
}

// PRODUCTION-TUNED POOL: 50 connections for 1000+ clients/suppliers
// idleTimeoutMillis: release idle connections after 30s
// connectionTimeoutMillis: fail fast if DB is slow
const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'sms_platform',
    user: process.env.DB_USER || 'sms_user',
    password: process.env.DB_PASS || 'Ariya@2024Net2App',
    max: 100,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
});

// Post-process all pool.query results: convert DECIMAL strings to numbers.
// This works at the database layer — every row is transformed before any
// route handler sees it. Only strings containing a decimal point are converted
// (e.g. "0.022000") to avoid corrupting phone numbers and integer IDs.
console.error('[INIT] Server starting...');

// Internal message sources — get numeric prefix '1' for distinguishable IDs
// Also skipped by DLR outbox (only EXTERNAL_DLR_SOURCES trigger DLR push)
const INTERNAL_SOURCES = ['test_sms', 'campaign', 'voice_otp', 'e2e_test'];

// ============================================================
// PRODUCTION QUEUE SYSTEM (1000+ clients, 1000+ suppliers)
// PostgreSQL-based async job queue with FOR UPDATE SKIP LOCKED
// Multiple worker pipelines, token-bucket rate limiting, DLQ
// ============================================================
let queueManager = null;
let rateLimiter = null;
let connectionPoolMgr = null;
let smppServer = null; // Set by SmppServer import (for Android Gateway DLR push)

(async () => {
    try {
        // Dynamic imports for ESM modules in CJS context
        rateLimiter = (await import('./src/services/rateLimiter.mjs')).default;
        const SMSQueueManager = (await import('./src/services/smsQueueManager.mjs')).default;
        connectionPoolMgr = (await import('./src/services/connectionPipeline.mjs')).default;

        queueManager = new SMSQueueManager(pool, {
            pollIntervalMs: 50,          // Aggressive polling for 100+ TPS
            batchSize: 200,              // Larger batches for high throughput
            workerCount: 12,             // Start with 12 workers
            minWorkers: 8,               // Never drop below 8
            maxWorkers: 24,              // Auto-scale up to 24 under load
            maxRetries: 5,
            bufferFlushSize: 200,        // Flush in-memory buffer every 200 jobs
            bufferMaxSize: 5000,         // Max 5000 in-memory buffer before rejection
            bufferFlushMs: 30,           // Flush every 30ms max
            overloadThreshold: 20000,    // Alert when queue depth > 20k
            connectionPoolMgr,
        });

        await queueManager.initialize();

        // Wire up inbound supplier delivery via Java SMPP gateway REST bridge.
        // When the queue manager tries to deliver to an inbound supplier (GSM gateway
        // behind NAT with no public IP), it calls this callback which POSTs to the
        // Java gateway's /deliver endpoint. The Java gateway sends submit_sm through
        // the existing inbound SMPP session.
        queueManager.onDeliverToInboundSupplier = async (supplierId, job) => {
            try {
                const http = require('http');
                const ourMsgId = job.message_id || '';
                console.error(`[InboundDeliver] → Sending ${ourMsgId} to supplier #${supplierId} (sender=${job.sender_id} dest=${job.destination})`);
                const payload = JSON.stringify({
                    supplier_id: supplierId,
                    source_addr: job.sender_id || 'NET2APP',
                    dest_addr: job.destination,
                    message: job.message || '',
                    our_message_id: ourMsgId
                });
                const result = await new Promise((resolve, reject) => {
                    const req = http.request({
                        hostname: '127.0.0.1',
                        port: 9091,
                        path: '/deliver',
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
                        timeout: 15000
                    }, (res) => {
                        let data = '';
                        res.on('data', c => data += c);
                        res.on('end', () => {
                            if (res.statusCode === 200) {
                                try { resolve(JSON.parse(data)); } catch { resolve({ success: true }); }
                            } else {
                                reject(new Error(`Java gateway returned ${res.statusCode}: ${data}`));
                            }
                        });
                    });
                    req.on('error', reject);
                    req.on('timeout', () => { req.destroy(); reject(new Error('Java gateway /deliver timeout')); });
                    req.write(payload);
                    req.end();
                });

                // Store the gateway's message_id (from test192) so DLR deliver_sm receipts
                // from the GSM modem can be matched back to our sms_logs.
                // test192 sends DLRs with its own msgId format (e.g. 0030f100221f-582550200).
                const gatewayMsgId = result?.gateway_message_id || '';
                if (ourMsgId && gatewayMsgId) {
                    await pool.query(
                        `UPDATE sms_logs SET smpp_message_id = $1 WHERE message_id = $2 AND smpp_message_id IS NULL`,
                        [gatewayMsgId, ourMsgId]
                    ).catch(e => console.error(`[InboundDeliver] ⚠ Failed to store smpp_message_id for ${ourMsgId}: ${e.message}`));
                    console.error(`[InboundDeliver] ✓ ${ourMsgId}: Delivered via Java gateway → supplier #${supplierId}, gateway msgId=${gatewayMsgId}`);
                } else {
                    console.error(`[InboundDeliver] ✓ ${ourMsgId}: Delivered via Java gateway to supplier #${supplierId} (no gateway msgId in response)`);
                }
                return true;
            } catch (e) {
                console.error(`[InboundDeliver] ✗ ${job.message_id}: Failed — ${e.message}`);
                return false;
            }
        };

        // Configure rate limiters for existing active clients and suppliers
        const [clients, suppliers] = await Promise.all([
            pool.query("SELECT id, max_tps FROM clients WHERE status='active' AND (is_deleted IS NULL OR is_deleted = false)"),
            pool.query("SELECT * FROM suppliers WHERE status='active' AND (is_deleted IS NULL OR is_deleted = false)")
        ]);

        for (const c of clients.rows) {
            rateLimiter.configureClient(c.id, c.max_tps || 100);
        }
        // Rate limiters for all suppliers (fast, local config)
        for (const s of suppliers.rows) {
            rateLimiter.configureSupplier(s.id, 200);
        }

        // ── DEFERRED SUPPLIER PIPELINE CONNECTIONS ──
        // Previously: await connectionPoolMgr.configureSupplier(s) for each
        // outbound SMPP supplier INLINE during startup. This blocked the event
        // loop for 5-60s per supplier (DNS + TCP connect timeouts), preventing
        // HTTP from being served until ALL suppliers connected or timed out.
        //
        // NOW: Supplier connections are deferred via setTimeout with 1s stagger.
        // The HTTP server is already listening (app.listen ran before this IIFE
        // could block). Each supplier connects one-at-a-time with a 1s gap.
        // Failed connections are logged but don't block later suppliers.
        const outboundSuppliers = suppliers.rows.filter(s => !s.is_inbound);
        if (outboundSuppliers.length > 0) {
            let connectIdx = 0;
            const connectNext = () => {
                if (connectIdx >= outboundSuppliers.length) {
                    console.error(`[INIT] All ${outboundSuppliers.length} outbound supplier connections attempted`);
                    return;
                }
                const s = outboundSuppliers[connectIdx++];
                const host = s.smpp_host || '';
                // Pre-flight DNS check for SMPP suppliers. If DNS fails,
                // skip configureSupplier entirely to prevent the SMPP client
                // from starting its internal reconnect loop (which hammers
                // the libuv thread pool with repeated getaddrinfo calls).
                // The health check (every 30s) will retry DNS + connection.
                const doConnect = () => {
                    console.error(`[INIT] Connecting supplier ${s.supplier_code} (${connectIdx}/${outboundSuppliers.length})...`);
                    connectionPoolMgr.configureSupplier(s).catch(e =>
                        console.error(`[INIT] Supplier ${s.supplier_code} connection failed (will retry via health check): ${e.message}`)
                    );
                    setTimeout(connectNext, 1200);
                };
                if (host && s.connection_type === 'smpp') {
                    // Use a short timeout (3s) for DNS pre-flight — don't block startup
                    const dnsTimer = setTimeout(() => {
                        console.error(`[INIT] DNS pre-check timeout for ${s.supplier_code} (${host}) — skipping`);
                        setTimeout(connectNext, 1200);
                    }, 3000);
                    dns.lookup(host, { family: 4 }, (err) => {
                        clearTimeout(dnsTimer);
                        if (err) {
                            console.error(`[INIT] DNS failed for ${s.supplier_code} (${host}): ${err.code} — skipping connection, health check will retry`);
                            setTimeout(connectNext, 1200);
                            return;
                        }
                        doConnect();
                    });
                } else {
                    doConnect();
                }
            };
            // Start connections 2s after HTTP is serving (enough time for Express
            // to finish binding and the event loop to settle)
            setTimeout(connectNext, 2000);
        }

        console.error(`[INIT] QueueManager: ${clients.rows.length} clients, ${suppliers.rows.length} suppliers configured`);

        // Start worker pool (async — orphan recovery runs before workers)
        await queueManager.start();

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

                            // DLR billing via unified applyBilling helper.
                            // Charges remaining parties whose billing_mode='dlr' only on DELIVRD.
                            if (log.client_id) {
                                try {
                                    const outboxR = await pool.query(
                                        `SELECT o.billing_mode, o.supplier_billing_mode, o.client_rate, o.supplier_rate, o.supplier_id, o.message_parts, o.message_id
                                         FROM sms_outbox o
                                         WHERE o.client_id = $1 AND o.destination = $2
                                           AND o.completed_at BETWEEN $3 - INTERVAL '10 seconds' AND $3 + INTERVAL '120 seconds'
                                           AND o.status IN ('submitted','delivered')
                                         ORDER BY o.completed_at DESC LIMIT 1`,
                                        [log.client_id, log.destination, log.created_at]
                                    );
                                    if (outboxR.rows.length) {
                                        const clientBillingMode = outboxR.rows[0].billing_mode || 'dlr';
                                        const supplierBillingMode = outboxR.rows[0].supplier_billing_mode || 'dlr';
                                        const clientCost = parseFloat(((outboxR.rows[0].client_rate || 0) * (parseInt(outboxR.rows[0].message_parts) || 1)).toFixed(6));
                                        const supplierCost = parseFloat(((outboxR.rows[0].supplier_rate || 0) * (parseInt(outboxR.rows[0].message_parts) || 1)).toFixed(6));
                                        await applyBilling({
                                            messageId: outboxR.rows[0].message_id,
                                            clientId: log.client_id,
                                            supplierId: outboxR.rows[0].supplier_id,
                                            clientCost, supplierCost,
                                            clientBillingMode, supplierBillingMode,
                                            isSubmit: false,
                                            dlrStatus: 'DELIVRD'
                                        });
                                    }
                                } catch (e) {
                                    console.error(`[DLR-POLL] ⚠ Billing lookup failed for ${log.call_id}: ${e.message}`);
                                }
                            }
                        } else if (data?.status === 'failed') {
                            await pool.query(
                                `UPDATE voice_otp_logs SET dlr_status = 'UNDELIV', status = 'failed',
                                 error_message = COALESCE($2, ''), completed_at = NOW() WHERE id = $1`,
                                [log.id, data?.message || 'Delivery failed']
                            );
                            console.error(`[DLR-POLL] ❌ ${log.call_id}: FAILED (${conn.name})`);
                            // DLR push on Voice OTP failure
                            if (queueManager && queueManager.onDlr) {
                                queueManager.onDlr({
                                    client_id: log.client_id, message_id: log.call_id, destination: log.destination,
                                    sender_id: '', status: 'UNDELIV', client_code: '', queued_at: log.created_at,
                                    source: 'voice_otp'
                                });
                            }
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

                            // DLR billing via unified applyBilling helper.
                            // Charges remaining parties whose billing_mode='dlr' only on DELIVRD.
                            const clientBillingMode = job.billing_mode_snapshot || job.billing_mode || 'dlr';
                            const supplierBillingMode = job.supplier_billing_mode || 'dlr';
                            const clientDlrCost = parseFloat(((job.client_rate || 0) * (job.message_parts || 1)).toFixed(6));
                            const supplierDlrCost = parseFloat(((job.supplier_rate || 0) * (job.message_parts || 1)).toFixed(6));
                            await applyBilling({
                                messageId: job.message_id,
                                clientId: job.client_id,
                                supplierId: job.supplier_id,
                                clientCost: clientDlrCost,
                                supplierCost: supplierDlrCost,
                                clientBillingMode, supplierBillingMode,
                                isSubmit: false,
                                dlrStatus: 'DELIVRD'
                            });
                            

                            // Webhook
                            if (job.webhook_url && queueManager) {
                                queueManager.sendWebhook(job.webhook_url, job.message_id, job.destination, 'delivered', 'DELIVRD', job.client_code).catch(() => {});
                            }
                            // DLR push to bound SMPP client
                            if (queueManager && queueManager.onDlr) {
                                queueManager.onDlr({
                                    client_id: job.client_id, message_id: job.message_id, destination: job.destination,
                                    sender_id: job.sender_id, status: 'DELIVRD', client_code: job.client_code, queued_at: job.queued_at,
                                    source: job.source || ''
                                });
                            }
                        } else if (data?.status === 'failed') {
                            await pool.query(
                                `UPDATE sms_outbox SET dlr_confirmed_at = NOW(), dlr_status = 'UNDELIV', status = 'failed', last_error = $2
                                 WHERE id = $1`,
                                [job.id, data.message || 'Delivery failed']
                            );
                            await pool.query(
                                `UPDATE sms_logs SET dlr_status = 'UNDELIV', status = 'failed', error_code = 'UNDELIV', error_message = $2
                                 WHERE message_id = $1`,
                                [job.message_id, data.message || 'Delivery failed']
                            );
                            console.error(`[DLR-HTTPS] ❌ ${job.message_id}: FAILED (${data.message || 'unknown'})`);
                            // Webhook + DLR push on failure
                            if (job.webhook_url && queueManager) {
                                queueManager.sendWebhook(job.webhook_url, job.message_id, job.destination, 'failed', 'UNDELIV', job.client_code).catch(() => {});
                            }
                            if (queueManager && queueManager.onDlr) {
                                queueManager.onDlr({
                                    client_id: job.client_id, message_id: job.message_id, destination: job.destination,
                                    sender_id: job.sender_id, status: 'UNDELIV', client_code: job.client_code, queued_at: job.queued_at,
                                    source: job.source || ''
                                });
                            }
                        } else if (data?.status === 'not_found') {
                            // Transaction not found yet — call still in progress.
                            // Keep retrying for up to 3 minutes, then timeout.
                            const ageMs = Date.now() - new Date(job.completed_at || job.queued_at).getTime();
                            if (ageMs > 75000) {
                                await pool.query(
                                    `UPDATE sms_outbox SET dlr_confirmed_at = NOW(), dlr_status = 'UNDELIV', status = 'failed', last_error = $2
                                     WHERE id = $1`,
                                    [job.id, 'DLR timeout after 3 minutes']
                                );
                                await pool.query(
                                    `UPDATE sms_logs SET dlr_status = 'UNDELIV', status = 'failed', error_code = 'DLR_TIMEOUT', error_message = $2
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
                                        sender_id: job.sender_id, status: 'UNDELIV', client_code: job.client_code, queued_at: job.queued_at,
                                        source: job.source || ''
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
        }, 4000);

        console.error('[INIT] HTTP connector DLR polling started — checks delivery status every 4s (75s timeout)');

        console.error('[INIT] Production queue system READY — 12 workers (auto-scale 8-24), 200 batch, 50ms poll, in-memory buffer (200 flush/5000 max), 100 DB pool, overload protection at 20k queue depth');

        // ======== DLR OUTBOX: stores pending DLRs for external client delivery ========
        // External SMPP clients bind to the Java Gateway (port 2775), which holds
        // their TCP connections. Node.js handles routing + DLR polling but cannot
        // directly push deliver_sm to Java Gateway sessions. This outbox bridges
        // the gap: DLRs are written here, then delivered via:
        //   1. Webhook (if client has webhook_url configured)
        //   2. Marked for Java Gateway SMPP push (polled by a future Java-side poller)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS dlr_outbox (
                id BIGSERIAL PRIMARY KEY,
                message_id VARCHAR(100) UNIQUE NOT NULL,
                entity_type VARCHAR(20) DEFAULT 'client',
                entity_id INTEGER,
                client_id INTEGER,
                client_code VARCHAR(50),
                destination VARCHAR(50),
                sender_id VARCHAR(100),
                status VARCHAR(20) NOT NULL,
                dlr_receipt TEXT,
                submit_time TIMESTAMP,
                webhook_url TEXT,
                webhook_sent BOOLEAN DEFAULT false,
                smpp_pushed BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT NOW(),
                completed_at TIMESTAMP
            );
            ALTER TABLE dlr_outbox ADD COLUMN IF NOT EXISTS entity_type VARCHAR(20) DEFAULT 'client';
            ALTER TABLE dlr_outbox ADD COLUMN IF NOT EXISTS entity_id INTEGER;
            ALTER TABLE dlr_outbox ALTER COLUMN client_id DROP NOT NULL;
            CREATE INDEX IF NOT EXISTS idx_dlr_outbox_pending ON dlr_outbox(completed_at) WHERE completed_at IS NULL;
        `).catch(() => {});

        // Wire DLR callback: stores pending DLRs for delivery to EXTERNAL clients only.
        // WHITELIST approach: only push DLR for external sources.
        // Internal sources (test_sms, campaign, voice_otp, e2e_test) — DLR stays in sms_logs only.
        // Source is passed by callers — no extra DB query needed.
        const EXTERNAL_DLR_SOURCES = ['smpp_client', 'external_api', 'smpp_esme', 'smpp'];

        queueManager.onDlr = async (job) => {
            try {
                // Determine originator: client or supplier
                let entityType = 'client';
                let entityId = job.client_id;
                let entityCode = job.client_code || '';
                let webhookUrl = '';

                if (!job.client_id) {
                    // No client — check if this was supplier-originated
                    try {
                        const outboxR = await pool.query(
                            `SELECT supplier_id, supplier_code FROM sms_outbox
                             WHERE message_id = $1 AND supplier_id IS NOT NULL
                             LIMIT 1`,
                            [job.message_id]
                        );
                        if (outboxR.rows.length > 0 && outboxR.rows[0].supplier_id) {
                            entityType = 'supplier';
                            entityId = outboxR.rows[0].supplier_id;
                            entityCode = outboxR.rows[0].supplier_code || '';
                            // Suppliers don't have webhooks — SMPP delivery only
                        } else {
                            // Neither client nor supplier originator — internal DLR, skip push
                            console.error(`[DLR-OUTBOX] 🔒 Skipping DLR ${job.message_id} → ${job.status} (no client or supplier originator)`);
                            return;
                        }
                    } catch (e) {
                        console.error(`[DLR-OUTBOX] ⚠ Originator lookup failed for ${job.message_id}: ${e.message} — storing as undeliverable`);
                        // Store anyway so DLR isn't lost — Java Gateway will try delivery or mark as dead
                        entityType = 'client';
                        entityId = 0;
                        entityCode = 'unknown';
                    }
                }

                // WHITELIST: Only push DLR for external client sources.
                // Supplier-originated messages ALWAYS get DLR pushed (they are external SMPP clients).
                const messageSource = job.source || '';
                if (entityType === 'client' && !EXTERNAL_DLR_SOURCES.includes(messageSource)) {
                    console.error(`[DLR-OUTBOX] 🔒 Internal DLR (${messageSource || 'unknown'}): ${job.message_id} → ${job.status} (no external push)`);
                    return;
                }

                // External client SMS — push DLR via webhook + SMPP
                // Look up webhook URL only for client-type entities
                if (entityType === 'client') {
                    const clientR = await pool.query(
                        'SELECT webhook_url FROM clients WHERE id = $1 LIMIT 1',
                        [entityId]
                    );
                    webhookUrl = clientR.rows[0]?.webhook_url || '';
                }
                const receipt = `id:${job.message_id} sub:001 dlvrd:001 submit date:${new Date().toISOString().slice(0,16).replace(/[-:T]/g,'')} done date:${new Date().toISOString().slice(0,16).replace(/[-:T]/g,'')} stat:${job.status} err:000 text:${job.status === 'DELIVRD' ? 'Delivery success' : 'Delivery failed'}`;
                let webhookSent = false;

                // 1. Send webhook immediately if configured
                if (webhookUrl) {
                    try {
                        await fetch(webhookUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                message_id: job.message_id,
                                destination: job.destination,
                                status: job.status,
                                dlr_receipt: receipt,
                                timestamp: new Date().toISOString()
                            }),
                            signal: AbortSignal.timeout(5000)
                        });
                        webhookSent = true;
                        console.error(`[DLR-OUTBOX] 📤 Webhook DLR sent to client ${job.client_code}: ${job.message_id} → ${job.status}`);
                    } catch (e) {
                        console.error(`[DLR-OUTBOX] ⚠ Webhook failed for ${job.message_id}: ${e.message}`);
                    }
                }

                // 2. Store in dlr_outbox for SMPP push (Java Gateway polls this)
                await pool.query(
                    `INSERT INTO dlr_outbox (message_id, entity_type, entity_id, client_id, client_code, destination, sender_id, status, dlr_receipt, submit_time, webhook_url, webhook_sent)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
                     ON CONFLICT (message_id) DO UPDATE SET entity_type = EXCLUDED.entity_type, entity_id = EXCLUDED.entity_id, webhook_sent = EXCLUDED.webhook_sent`,
                    [job.message_id, entityType, entityId, entityType === 'client' ? entityId : null, entityCode, job.destination, job.sender_id, job.status, receipt, job.submit_time || job.queued_at, webhookUrl, webhookSent]
                );
                console.error(`[DLR-OUTBOX] 📝 DLR stored: ${job.message_id} → ${job.status} (${entityType}=${entityCode}, source=${messageSource}, webhook=${webhookSent ? 'sent' : 'none'})`);
            } catch (e) {
                console.error(`[DLR-OUTBOX] ⚠ Failed to store DLR for ${job.message_id}: ${e.message}`);
            }
        };
        console.error('[INIT] DLR outbox ready — webhook delivery + SMPP queue for Java Gateway');

        // Wire SMPP DLR callback: when smppClient.mjs receives deliver_sm from a supplier,
        // it updates sms_outbox + sms_logs directly, then forwards DLR here for external push
        // (webhook + SMPP via dlr_outbox + Java Gateway).
        if (connectionPoolMgr && typeof connectionPoolMgr.setDlrCallback === 'function') {
            connectionPoolMgr.setDlrCallback((dlr) => {
                if (queueManager && queueManager.onDlr) {
                    queueManager.onDlr(dlr).catch(e =>
                        console.error('[SMPP-DLR] DLR callback failed:', e.message));
                }
            });
            console.error('[INIT] SMPP DLR callback wired → real-time sms_logs updates + external client DLR push');
        }

        // ======== REAL-TIME DLR PUSHER ========
        // Polls dlr_outbox every 5s and pushes DLRs to external clients:
        //   1. Webhook — immediate push for clients with webhook_url
        //   2. SMPP — stored for Java Gateway to push deliver_sm to connected clients
        setInterval(async () => {
            try {
                const pending = await pool.query(
                    `SELECT * FROM dlr_outbox WHERE completed_at IS NULL ORDER BY created_at ASC LIMIT 30`
                );
                if (!pending.rows.length) return;

                for (const dlr of pending.rows) {
                    let delivered = false;
                    let smppQueued = false;
                    try {
                        // 1. Retry webhook if not yet sent and client has webhook_url
                        if (!dlr.webhook_sent && dlr.webhook_url) {
                            try {
                                await fetch(dlr.webhook_url, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        message_id: dlr.message_id,
                                        destination: dlr.destination,
                                        status: dlr.status,
                                        dlr_receipt: dlr.dlr_receipt,
                                        timestamp: new Date().toISOString()
                                    }),
                                    signal: AbortSignal.timeout(5000)
                                });
                                await pool.query(
                                    'UPDATE dlr_outbox SET webhook_sent = true WHERE id = $1',
                                    [dlr.id]
                                ).catch(() => {});
                                console.error(`[DLR-PUSH] 📤 Webhook retry OK: ${dlr.message_id} → ${dlr.client_code}`);
                                delivered = true;
                            } catch (e) {
                                // webhook still unreachable, retry next cycle
                            }
                        }

                        // 2. SMPP DLR push — check if entity has active session via Java Gateway
                        // Checks both client and supplier sessions.
                        const dlrAgeMs = Date.now() - new Date(dlr.created_at).getTime();
                        const smppStale = dlrAgeMs > 60000 && !dlr.smpp_pushed;
                        const entType = dlr.entity_type || 'client';
                        const entId = dlr.entity_id || dlr.client_id;

                        if (!dlr.smpp_pushed && !smppStale && entId) {
                            const sessionR = await pool.query(
                                `SELECT id FROM smpp_sessions
                                 WHERE entity_type = $1
                                   AND entity_id = $2
                                   AND status = 'bound'
                                 LIMIT 1`,
                                [entType, entId]
                            );
                            if (sessionR.rows.length > 0) {
                                smppQueued = true;
                                console.error(`[DLR-PUSH] 📡 SMPP DLR queued for Java Gateway: ${dlr.message_id} → ${dlr.client_code} (${entType} session active)`);
                            }
                        }

                        // If SMPP is stale (>60s) and client has webhook_url, fall back to webhook
                        if (smppStale && !dlr.webhook_sent && dlr.webhook_url) {
                            console.error(`[DLR-PUSH] ⏰ SMPP stale after ${Math.round(dlrAgeMs/1000)}s — falling back to webhook: ${dlr.message_id} → ${dlr.client_code}`);
                            try {
                                await fetch(dlr.webhook_url, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({
                                        message_id: dlr.message_id,
                                        destination: dlr.destination,
                                        status: dlr.status,
                                        dlr_receipt: dlr.dlr_receipt,
                                        timestamp: new Date().toISOString()
                                    }),
                                    signal: AbortSignal.timeout(5000)
                                });
                                await pool.query(
                                    'UPDATE dlr_outbox SET webhook_sent = true WHERE id = $1',
                                    [dlr.id]
                                ).catch(() => {});
                                delivered = true;
                                console.error(`[DLR-PUSH] 📤 Webhook fallback OK: ${dlr.message_id} → ${dlr.client_code}`);
                            } catch (e) {
                                console.error(`[DLR-PUSH] ⚠ Webhook fallback failed for ${dlr.message_id}: ${e.message}`);
                            }
                        }

                        // 3. Mark completed if webhook delivered successfully
                        if (delivered && !dlr.smpp_pushed) {
                            await pool.query(
                                'UPDATE dlr_outbox SET completed_at = NOW() WHERE id = $1',
                                [dlr.id]
                            ).catch(() => {});
                            console.error(`[DLR-PUSH] ✅ DLR completed (webhook): ${dlr.message_id}`);
                        }

                        // 4. Timeout: if DLR is older than 24h and undeliverable, mark complete.
                        // NEVER set smpp_pushed=true — the Java Gateway handles SMPP delivery
                        // and polls dlr_outbox WHERE smpp_pushed=false. Setting it prematurely
                        // would permanently block the SMPP client from ever receiving the DLR.
                        const ageMs = Date.now() - new Date(dlr.created_at).getTime();
                        const TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours
                        if (ageMs > TIMEOUT_MS && !delivered && !smppQueued && !dlr.completed_at) {
                            // Only set completed_at — leave smpp_pushed=false for Java Gateway
                            await pool.query(
                                'UPDATE dlr_outbox SET completed_at = NOW() WHERE id = $1',
                                [dlr.id]
                            ).catch(() => {});
                            console.error(`[DLR-PUSH] ⏰ DLR stale after ${Math.round(ageMs/3600000)}h: ${dlr.message_id} (marked complete, SMPP push still queued for Java Gateway)`);
                        }
                    } catch (e) {
                        console.error(`[DLR-PUSH] ⚠ ${dlr.message_id}: ${e.message}`);
                    }
                }
            } catch (e) {
                // Silently skip on error, retry next cycle
            }
        }, 5000);

        console.error('[INIT] Real-time DLR pusher started — pushes webhooks every 5s, queues SMPP for Java Gateway');


        // ======== UNIVERSAL SUPPLIER HEALTH MONITOR ========
        // Runs every 30s. Checks ALL active suppliers regardless of connection_type.
        // Updates bind_status (bound/unbound) and consecutive_failures in real time.
        // Routes skip unbound suppliers (see resolveRoute below).
        // Auto-blocks at 20 consecutive failures → status='inactive', bind_status='unbound'.

        // ======== AUTO-BLOCK ALERT NOTIFICATION ========
        // Called when a supplier is auto-blocked at 20 consecutive failures.
        // Sends: 1) Email via SMTP config  2) Webhook via platform_settings alert_webhook_url  3) In-app notification
        async function sendAutoBlockAlert(supplier) {
            try {
                const now = new Date().toISOString();
                const alertMsg = `Supplier ${supplier.supplier_code} (${supplier.company_name || supplier.supplier_code}) was AUTO-BLOCKED to status=inactive after ${supplier.consecutive_failures} consecutive failures. Type: ${supplier.connection_type}.`;
                let emailSent = false, webhookSent = false;

                // 1. Email via SMTP config
                try {
                    const smtpR = await pool.query("SELECT * FROM smtp_config WHERE is_active = true AND from_email != '' AND username != '' LIMIT 1");
                    if (smtpR.rows.length > 0) {
                        const smtp = smtpR.rows[0];
                        // Find admin email from platform_settings or users table
                        const adminR = await pool.query("SELECT value FROM platform_settings WHERE key = 'admin_email' LIMIT 1");
                        const adminEmail = adminR.rows[0]?.value || smtp.from_email;
                        const alertPort = parseInt(smtp.port) || 587;
                        const alertSecure = alertPort === 465 || smtp.encryption === 'ssl';
                        const transporter = nodemailer.createTransport({
                            host: smtp.host,
                            port: alertPort,
                            secure: alertSecure,
                            auth: { user: smtp.username, pass: smtp.password },
                            tls: { rejectUnauthorized: false },
                        });
                        await transporter.sendMail({
                            from: `"${smtp.from_name || 'NET2APP'}" <${smtp.from_email}>`,
                            to: adminEmail,
                            subject: `🚫 AUTO-BLOCKED: ${supplier.supplier_code}`,
                            text: `${alertMsg}\n\nTime: ${now}\nSupplier ID: ${supplier.id}\nConnection: ${supplier.connection_type}\n\nAction required: Check connectivity and reactivate from the Suppliers page.`,
                        });
                        emailSent = true;
                        console.error(`[ALERT] 📧 Email sent to ${adminEmail}: ${supplier.supplier_code} auto-blocked`);
                    }
                } catch (e) {
                    console.error(`[ALERT] ⚠ Email failed: ${e.message}`);
                }

                // 2. Webhook via platform_settings
                try {
                    const whR = await pool.query("SELECT value FROM platform_settings WHERE key = 'alert_webhook_url' LIMIT 1");
                    const whUrl = whR.rows[0]?.value;
                    if (whUrl) {
                        await fetch(whUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                event: 'supplier_auto_blocked',
                                supplier_id: supplier.id,
                                supplier_code: supplier.supplier_code,
                                connection_type: supplier.connection_type,
                                consecutive_failures: supplier.consecutive_failures,
                                timestamp: now,
                            }),
                            signal: AbortSignal.timeout(5000),
                        });
                        webhookSent = true;
                        console.error(`[ALERT] 📡 Webhook sent: ${supplier.supplier_code} auto-blocked`);
                    }
                } catch (e) {
                    console.error(`[ALERT] ⚠ Webhook failed: ${e.message}`);
                }

                // 3. In-app notification
                try {
                    await pool.query(
                        `INSERT INTO notifications (title, message, type, is_read, created_at)
                         VALUES ($1, $2, 'alert', false, NOW())`,
                        [`Supplier Auto-Blocked: ${supplier.supplier_code}`, alertMsg]
                    );
                } catch (e) {
                    console.error(`[ALERT] ⚠ In-app notification failed: ${e.message}`);
                }

                if (emailSent || webhookSent) {
                    console.error(`[ALERT] ✅ Auto-block notification for ${supplier.supplier_code}: email=${emailSent} webhook=${webhookSent}`);
                }
            } catch (e) {
                console.error(`[ALERT] ❌ sendAutoBlockAlert failed: ${e.message}`);
            }
        }

        setInterval(async () => {
            try {
                const allSuppliers = await pool.query(
                    `SELECT id, supplier_code, company_name, connection_type, is_inbound, api_url,
                            smpp_host, smpp_port, bind_status, consecutive_failures
                     FROM suppliers
                     WHERE status = 'active'
                       AND (is_deleted IS NULL OR is_deleted = false)`
                );
                for (const s of allSuppliers.rows) {
                    let healthy = false;
                    try {
                        const connType = (s.connection_type || '').toLowerCase();

                        if (connType === 'smpp' && s.is_inbound) {
                            // Inbound SMPP (GSM gateway) — check smpp_sessions for bound + recent activity.
                            // Java Gateway updates last_activity on every enquire_link and submit_sm.
                            const sessR = await pool.query(
                                `SELECT last_activity FROM smpp_sessions
                                 WHERE entity_type='supplier' AND entity_id=$1
                                   AND status='bound'
                                   AND last_activity > NOW() - INTERVAL '120 seconds'
                                 LIMIT 1`,
                                [s.id]
                            );
                            healthy = sessR.rows.length > 0;

                        } else if (connType === 'smpp' && !s.is_inbound) {
                            // Outbound SMPP — check smpp_sessions (reliable, synced on every bind/unbind).
                            // Pipeline isConnected can go stale, but smppClient.mjs syncs
                            // smpp_sessions on every connect/disconnect event.
                            const sessR = await pool.query(
                                `SELECT status FROM smpp_sessions
                                 WHERE entity_type='supplier' AND entity_id=$1
                                   AND status='bound'
                                   AND last_activity > NOW() - INTERVAL '120 seconds'
                                 LIMIT 1`,
                                [s.id]
                            );
                            healthy = sessR.rows.length > 0;

                        } else if (connType === 'http' && s.api_url) {
                            // HTTP supplier — active means bound (no health ping penalty)
                            healthy = true;

                        } else if (connType === 'voice_otp') {
                            // Voice OTP — active means bound (call outcomes / DLR polling handle real status)
                            healthy = true;

                        } else if (['rcs', 'ott', 'whatsapp', 'telegram'].includes(connType)) {
                            // RCS/OTT — active means bound (device sessions handle real connectivity)
                            healthy = true;

                        } else if (['flash_sms', 'whatsapp_business', 'telegram_business', 'android_SMS'].includes(connType)) {
                            // Flash SMS / WhatsApp Business / Telegram Business / Android SMS — active means bound
                            healthy = true;

                        } else {
                            // Unknown/unspecified type — treat as HTTP if api_url exists, else skip
                            if (s.api_url) {
                                try {
                                    const ctrl = new AbortController();
                                    const timer = setTimeout(() => ctrl.abort(), 5000);
                                    const resp = await fetch(s.api_url, {
                                        method: 'GET', signal: ctrl.signal,
                                        headers: { 'User-Agent': 'NET2APP-HealthCheck/1.0' }
                                    });
                                    clearTimeout(timer);
                                    healthy = resp.ok || resp.status < 500;
                                } catch (err) { /* stays unhealthy */ }
                            } else {
                                // No health check mechanism — leave bind_status as-is
                                continue;
                            }
                        }

                        // Apply health result
                        if (healthy) {
                            // Reset failures, ensure bound
                            if (s.bind_status !== 'bound' || s.consecutive_failures > 0) {
                                await pool.query(
                                    `UPDATE suppliers SET bind_status='bound',
                                     consecutive_failures=0, updated_at=NOW() WHERE id=$1`,
                                    [s.id]
                                );
                                console.error(`[HEALTH] ✅ ${s.supplier_code}: Recovered → bound (was ${s.bind_status})`);
                            }
                        } else if (connType === 'smpp' || s.is_inbound) {
                            // SMPP + inbound GSM gateways — never penalize.
                            // Keep bind_status as-is. The /api/bind/status endpoint
                            // reflects real-time smpp_sessions state via LEFT JOIN.
                            // No failure increment, no auto-block.
                        } else {
                            // Unhealthy — increment failures atomically
                            const updR = await pool.query(
                                `UPDATE suppliers SET
                                 consecutive_failures = consecutive_failures + 1,
                                 bind_status = CASE WHEN consecutive_failures + 1 >= 3 THEN 'unbound' ELSE bind_status END,
                                 updated_at = NOW()
                                 WHERE id=$1
                                 RETURNING consecutive_failures, bind_status`,
                                [s.id]
                            );
                            if (updR.rows.length) {
                                const newFails = parseInt(updR.rows[0].consecutive_failures);
                                const newBind = updR.rows[0].bind_status;
                                if (newBind === 'unbound' && s.bind_status === 'bound') {
                                    console.error(`[HEALTH] ❌ ${s.supplier_code}: Unbound after ${newFails} failures`);
                                }
                                // Auto-block at 20 consecutive failures
                                if (newFails >= 20) {
                                    await pool.query(
                                        `UPDATE suppliers SET status='inactive',
                                         bind_status='unbound', updated_at=NOW() WHERE id=$1 AND status='active'`,
                                        [s.id]
                                    );
                                    console.error(`[HEALTH] 🚫 ${s.supplier_code}: AUTO-BLOCKED — ${newFails} consecutive failures → status=inactive`);
                                    // Send alert notification to admins (use newFails for correct count)
                                    sendAutoBlockAlert({...s, consecutive_failures: newFails}).catch(
                                        e => console.error('[ALERT] Failed to send auto-block notification:', e.message)
                                    );
                                }
                            }
                        }
                    } catch (err) {
                        // Individual supplier check failed — skip, retry next cycle
                    }
                }
            } catch (e) {
                // Silently skip cycle on error, retry next interval
            }
        }, 30000);

        console.error('[INIT] Universal supplier health monitor started — checks ALL types every 30s, auto-blocks at 20 failures');

        // ======== SMPP MESSAGE RELAY POLLER ========
        // The Java SMPP Gateway's Database.insertSmsLog() only does a bare INSERT
        // into sms_logs (no routing, no supplier, no delivery). This poller picks
        // up unrouted SMPP messages and routes them through the full pipeline:
        // resolveRoute → applyTranslations → rate/profit check → enqueue.
        setInterval(async () => {
            try {
                const unrouted = await pool.query(
                    `SELECT * FROM sms_logs
                     WHERE source = 'smpp'
                       AND error_code IS NULL
                       AND status = 'submitted'
                       AND (supplier_id IS NULL
                            OR (supplier_id IS NOT NULL AND client_id IS NULL))
                     ORDER BY submit_time ASC
                     LIMIT 20`
                );
                if (!unrouted.rows.length) return;

                for (const log of unrouted.rows) {
                    try {
                        // Reject messages where destination is a server IP.
                        // Safety net: the Java Gateway now validates this at entry,
                        // but legacy messages may still exist in the DB.
                        const dest = String(log.destination || '');
                        if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(dest)) {
                            await pool.query(
                                `UPDATE sms_logs SET error_code = 'INVALID_DEST',
                                 error_message = 'Destination is server IP, not a phone number',
                                 status = 'rejected' WHERE id = $1`,
                                [log.id]
                            );
                            console.error(`[SMPP-RELAY] 🚫 ${log.message_id}: Rejected — destination is server IP (${dest})`);
                            continue;
                        }

                        let client = null;

                        // INBOUND SUPPLIER ROUTING: When a GSM gateway sends submit_sm TO us,
                        // we need to find the right client by matching the destination number.
                        // Look up MCC/MNC → find client with active rate for that MCC/MNC.
                        if (log.supplier_id && !log.client_id) {
                            // 1. Look up MCC/MNC from destination number (same logic as resolveRoute)
                            let dstMcc = '', dstMnc = '', dstOperator = '', dstCountry = '';
                            try {
                                const dest = String(log.destination).replace(/^\+/, '');
                                for (let len = 6; len >= 1; len--) {
                                    const prefix = dest.substring(0, len);
                                    const mccR = await pool.query(
                                        'SELECT mcc, mnc, country, operator FROM mccmnc WHERE calling_code = $1 AND (is_deleted IS NULL OR is_deleted = false) LIMIT 1',
                                        [prefix]
                                    );
                                    if (mccR.rows.length) {
                                        dstMcc = mccR.rows[0].mcc; dstMnc = mccR.rows[0].mnc;
                                        dstOperator = mccR.rows[0].operator || '';
                                        dstCountry = mccR.rows[0].country || '';
                                        break;
                                    }
                                }
                            } catch (e) { /* MCC lookup failed, dstMcc stays empty */ }

                            // 2. Find a client with an active rate for this MCC/MNC
                            // Prefer clients with a routing plan, then fall back to any active client with rates
                            if (dstMcc) {
                                const clientMatchR = await pool.query(
                                    `SELECT c.* FROM clients c
                                     INNER JOIN rates r ON r.entity_type='client' AND r.entity_id=c.id
                                     WHERE (r.mcc = $1 OR r.mcc = '*') AND r.is_active=true
                                       AND c.status='active' AND (c.is_deleted IS NULL OR c.is_deleted=false)
                                     ORDER BY CASE WHEN r.mnc = $2 THEN 0 WHEN r.mnc = '*' THEN 1 ELSE 2 END,
                                              r.rate ASC
                                     LIMIT 1`,
                                    [dstMcc, dstMnc || null]
                                );
                                if (clientMatchR.rows.length) {
                                    client = clientMatchR.rows[0];
                                    // Update sms_logs with the resolved client for future reference
                                    await pool.query(
                                        `UPDATE sms_logs SET client_id = $1, client_code = $2,
                                         mcc = $3, mnc = $4, operator = $5, country = $6
                                         WHERE id = $7`,
                                        [client.id, client.client_code, dstMcc, dstMnc,
                                         dstOperator, dstCountry, log.id]
                                    );
                                    log.client_id = client.id;
                                    log.client_code = client.client_code;
                                    console.error(`[SMPP-RELAY] 🔀 Inbound routing: ${log.message_id} → client ${client.client_code} (mcc=${dstMcc} mnc=${dstMnc})`);
                                }
                            }

                            if (!client) {
                                await pool.query(
                                    `UPDATE sms_logs SET error_code = 'INBOUND_NO_CLIENT',
                                     error_message = 'No client with rates for destination MCC/MNC',
                                     status = 'failed' WHERE id = $1`,
                                    [log.id]
                                );
                                console.error(`[SMPP-RELAY] ❌ ${log.message_id}: Inbound — no client matches destination ${log.destination} (mcc=${dstMcc || '?'})`);
                                await pushInboundSupplierDlr(log, 'INBOUND_NO_CLIENT', 'No client with rates for this destination');
                                continue;
                            }
                        } else {
                            // Normal client-originated message — look up client by ID
                            const clientR = await pool.query(
                                'SELECT * FROM clients WHERE id = $1 AND status = $2 AND (is_deleted IS NULL OR is_deleted = false)',
                                [log.client_id, 'active']
                            );
                            if (!clientR.rows.length) {
                                await pool.query(
                                    `UPDATE sms_logs SET error_code = 'CLIENT_NOT_FOUND',
                                     error_message = 'Client not found or inactive', status = 'failed'
                                     WHERE id = $1`,
                                    [log.id]
                                );
                                console.error(`[SMPP-RELAY] ❌ ${log.message_id}: Client #${log.client_id} not active`);
                                await pushInboundSupplierDlr(log, 'CLIENT_NOT_FOUND', 'Client not found or inactive');
                                continue;
                            }
                            client = clientR.rows[0];

                            // Tenant checks: expiry + SMS quota
                            if (client.tenant_id) {
                                const tR = await pool.query('SELECT * FROM tenants WHERE id = $1', [client.tenant_id]);
                                if (tR.rows.length > 0) {
                                    const t = tR.rows[0];
                                    // Check expiry
                                    if (t.expiry_date && new Date(t.expiry_date) < new Date()) {
                                        console.error('[SMPP-RELAY] Blocked ' + log.message_id + ': tenant ' + t.code + ' expired');
                                        await pool.query('UPDATE sms_logs SET error_code=$1,error_message=$2,status=$3 WHERE id=$4', ['TENANT_EXPIRED','Tenant licence expired ('+t.code+')','failed',log.id]);
                                        await pushInboundSupplierDlr(log, 'TENANT_EXPIRED', 'Tenant licence expired');
                                        continue;
                                    }
                                    // Check SMS quota
                                    const maxSMS = (t.limits && t.limits.max_sms_monthly) ? parseInt(t.limits.max_sms_monthly) : 0;
                                    if (maxSMS > 0) {
                                        const usedR = await pool.query(
                                            `SELECT COALESCE(SUM(COALESCE(message_parts,1)),0)::int AS used FROM sms_logs
                                             WHERE client_id IN (SELECT id FROM clients WHERE tenant_id=$1)
                                               AND created_at > date_trunc('month',NOW())`,
                                            [client.tenant_id]
                                        );
                                        const used = parseInt(usedR.rows[0]?.used) || 0;
                                        if (used >= maxSMS) {
                                            console.error('[SMPP-RELAY] Blocked ' + log.message_id + ': tenant ' + t.code + ' quota exceeded ('+used+'/'+maxSMS+')');
                                            await pool.query('UPDATE sms_logs SET error_code=$1,error_message=$2,status=$3 WHERE id=$4', ['TENANT_QUOTA_EXCEEDED','Monthly SMS limit reached ('+t.code+': '+used+'/'+maxSMS+')','failed',log.id]);
                                            await pushInboundSupplierDlr(log, 'TENANT_QUOTA_EXCEEDED', 'Monthly SMS limit reached');
                                            continue;
                                        }
                                    }
                                }
                            }
                        }

                        // Resolve route (MCC/MNC → supplier, trunk, supplier_rate)
                        // Note: resolveRoute does NOT return client_rate — we look that up separately
                        const route = await resolveRoute(client, log.destination);
                        if (!route || !route.supplier_id) {
                            await pool.query(
                                `UPDATE sms_logs SET error_code = 'NO_ROUTE',
                                 error_message = 'No matching supplier for destination',
                                 mcc = $2, mnc = $3, operator = $4, country = $5, status = 'failed'
                                 WHERE id = $1`,
                                [log.id, route?.mcc || '', route?.mnc || '', route?.operator || '', route?.country || '']
                            );
                            console.error(`[SMPP-RELAY] ❌ ${log.message_id}: No route for ${log.destination}`);
                            await pushInboundSupplierDlr(log, 'NO_ROUTE', 'No matching supplier for destination');
                            continue;
                        }

                        // Look up client rate (resolveRoute only returns supplier_rate)
                        const clientRateR = await pool.query(
                            `SELECT rate FROM rates WHERE entity_type='client' AND entity_id=$1
                             AND (mcc = $2 OR mcc = '*') AND is_active=true
                             ORDER BY CASE WHEN mnc = $3 THEN 0 WHEN mnc = '*' THEN 1 ELSE 2 END, rate ASC LIMIT 1`,
                            [log.client_id, route.mcc || null, route.mnc || null]
                        );
                        // NO_RATE gate — client must have a rate configured for this MCC/MNC
                        if (!clientRateR.rows.length || !(clientRateR.rows[0].rate > 0)) {
                            await pool.query(
                                `UPDATE sms_logs SET error_code = 'NO_RATE',
                                 error_message = 'No client rate for this MCC/MNC',
                                 mcc = $2, mnc = $3, operator = $4, country = $5, status = 'failed'
                                 WHERE id = $1`,
                                [log.id, route.mcc || '', route.mnc || '', route.operator || '', route.country || '']
                            );
                            console.error(`[SMPP-RELAY] ❌ ${log.message_id}: No client rate for mcc=${route.mcc} mnc=${route.mnc}`);
                            await pushInboundSupplierDlr(log, 'NO_RATE', 'No client rate for this MCC/MNC');
                            continue;
                        }
                        const clientRate = parseFloat(clientRateR.rows[0].rate);
                        const supplierRate = parseFloat(route.supplier_rate || 0);
                        const profit = parseFloat((clientRate - supplierRate).toFixed(6));

                        // Profit gate — skip if client rate ≤ supplier rate (unless both are 0 = default route)
                        if (profit <= 0 && supplierRate > 0) {
                            await pool.query(
                                `UPDATE sms_logs SET error_code = 'NO_PROFIT',
                                 error_message = 'Client rate ≤ supplier rate',
                                 mcc = $2, mnc = $3, operator = $4, country = $5,
                                 route_name = $6, trunk_name = $7, status = 'failed'
                                 WHERE id = $1`,
                                [log.id, route.mcc || '', route.mnc || '', route.operator || '', route.country || '',
                                 route.route_name || '', route.trunk_name || '']
                            );
                            console.error(`[SMPP-RELAY] ❌ ${log.message_id}: No profit — client=€${clientRate} ≤ supplier=€${supplierRate}`);
                            await pushInboundSupplierDlr(log, 'NO_PROFIT', 'Client rate ≤ supplier rate');
                            continue;
                        }

                        // Apply translations (number prefix, content replace, SID alias)
                        const origSender = log.sender_id || client.smpp_username || '';
                        const translated = await applyTranslations(
                            log.client_id, route.supplier_id,
                            log.destination, origSender, log.message
                        );

                        // Check OTP extract translation blocking: Voice OTP suppliers require numeric codes.
                        // Text-only messages like "Browser verify test" are rejected before routing.
                        // Only block for Voice OTP suppliers — standard SMS suppliers don't need OTP extraction.
                        if (translated.blocked) {
                            const isVoiceOtpSupplier = route.supplier_id
                                ? (await pool.query('SELECT connection_type FROM suppliers WHERE id=$1', [route.supplier_id])).rows[0]?.connection_type === 'voice_otp'
                                : false;
                            if (isVoiceOtpSupplier) {
                                await pool.query(
                                    `UPDATE sms_logs SET error_code = 'OTP_EXTRACT_FAILED',
                                     error_message = $2, status = 'rejected'
                                     WHERE id = $1`,
                                    [log.id, translated.block_reason || 'No numeric OTP code found']
                                );
                                console.error(`[SMPP-RELAY] 🚫 ${log.message_id}: OTP EXTRACT FAILED — ${translated.block_reason}`);
                                await pushInboundSupplierDlr(log, 'OTP_EXTRACT_FAILED', translated.block_reason);
                                continue;
                            }
                            // Non-Voice-OTP supplier: OTP extract failed but that's OK — just ignore
                            console.error(`[SMPP-RELAY] ⚠ ${log.message_id}: OTP extract failed but supplier is not voice_otp — ignoring`);
                        }

                        // Check blocking rules (DND, keyword blacklist/whitelist, URL block)
                        const blockCheck = await checkTranslationsBlock(client.id, route.supplier_id, log.destination, log.message);
                        if (blockCheck) {
                            await pool.query(
                                `UPDATE sms_logs SET error_code = 'BLOCKED',
                                 error_message = $2, status = 'rejected'
                                 WHERE id = $1`,
                                [log.id, blockCheck.reason]
                            );
                            console.error(`[SMPP-RELAY] 🚫 ${log.message_id}: BLOCKED — ${blockCheck.reason}`);
                            await pushInboundSupplierDlr(log, 'BLOCKED', blockCheck.reason);
                            continue;
                        }

                        // Enqueue FIRST — if this fails, supplier_id stays NULL and poller retries
                        if (!queueManager) {
                            console.error(`[SMPP-RELAY] ⚠ ${log.message_id}: Queue manager not available — will retry next cycle`);
                            continue; // Don't set error_code — retry when queue is ready
                        }
                        const parts = calculateMessageParts(translated.message);
                        await queueManager.enqueue({
                                message_id: log.message_id,
                                client_id: log.client_id,
                                client_code: log.client_code,
                                supplier_id: route.supplier_id,
                                supplier_code: route.supplier_code,
                                sender_id: translated.sender_id,
                                destination: translated.destination,
                                message: translated.message,
                                message_parts: parts,
                                client_rate: clientRate,
                                supplier_rate: supplierRate,
                                profit,
                                currency: 'EUR',
                                mcc: route.mcc || '',
                                mnc: route.mnc || '',
                                operator: route.operator || '',
                                country: route.country || '',
                                route_name: route.route_name || 'SMPP',
                                trunk_name: route.trunk_name || 'SMPP',
                                billing_mode: client.billing_mode || 'dlr',
                                supplier_billing_mode: supplierBillingMode,
                                webhook_url: client.webhook_url || '',
                                source: 'smpp_client',
                            });
                        // Submit-mode billing: charge client AND/OR supplier based on their billing_mode.
                        // Uses unified applyBilling helper — charges submit-mode parties immediately,
                        // defers DLR-mode parties to DLR confirmation.
                        const clientBillingMode = client.billing_mode || 'dlr';
                        const supplierBillingMode = route.supplier_billing_mode || 'dlr';
                        const clientCost = parseFloat((clientRate * parts).toFixed(6));
                        const supplierCost = parseFloat((supplierRate * parts).toFixed(6));
                        await applyBilling({
                            messageId: log.message_id,
                            clientId: log.client_id,
                            supplierId: route.supplier_id,
                            clientCost, supplierCost,
                            clientBillingMode, supplierBillingMode,
                            clientForceDlr: client.force_dlr || false,
                            supplierForceDlr: route.supplier_force_dlr || false,
                            isSubmit: true
                        });

                        // Auto-DLR: if force_dlr is enabled, schedule a fake DELIVRD after timeout.
                        const hasForceDlr = (client.force_dlr || route.supplier_force_dlr);
                        if (hasForceDlr) {
                            const timeoutSec = Math.max(
                                client.force_dlr ? (parseInt(client.force_dlr_timeout) || 0) : 0,
                                route.supplier_force_dlr ? (route.supplier_force_dlr_timeout || 0) : 0
                            );
                            const scheduleDlr = async () => {
                                try {
                                    await pool.query(
                                        `UPDATE sms_logs SET dlr_status = 'DELIVRD', status = 'delivered', delivery_time = NOW(), dlr_timestamp = NOW(), is_force_dlr = true WHERE message_id = $1 AND dlr_status = 'PENDING'`,
                                        [log.message_id]
                                    );
                                    await pool.query(
                                        `UPDATE sms_outbox SET dlr_status = 'DELIVRD', status = 'delivered', dlr_confirmed_at = NOW(), completed_at = NOW() WHERE message_id = $1 AND dlr_status = 'PENDING'`,
                                        [log.message_id]
                                    ).catch(() => {});
                                    console.error(`[FORCE-DLR] ⚡ ${log.message_id}: Auto-DLR set to DELIVRD after ${timeoutSec}s (SMPP relay force_dlr override)`);
                                } catch (e) { /* best-effort */ }
                            };
                            setTimeout(scheduleDlr, timeoutSec * 1000);
                        }

                        // Only AFTER successful enqueue, update sms_logs with routing info
                        await pool.query(
                            `UPDATE sms_logs SET
                             supplier_id = $2, supplier_code = $3,
                             client_rate = $4, supplier_rate = $5, profit = $6,
                             mcc = $7, mnc = $8, operator = $9, country = $10,
                             route_name = $11, trunk_name = $12,
                             sender_id = $13, destination = $14, message = $15,
                             original_sender_id = $16, original_destination = $17, original_message = $18,
                             message_parts = $19, billing_mode_snapshot = $20,
                             supplier_billing_mode_snapshot = $21
                             WHERE id = $1`,
                            [
                                log.id,
                                route.supplier_id, route.supplier_code,
                                clientRate, supplierRate, profit,
                                route.mcc || '', route.mnc || '', route.operator || '', route.country || '',
                                route.route_name || 'SMPP', route.trunk_name || 'SMPP',
                                translated.sender_id, translated.destination, translated.message,
                                origSender, log.destination, log.message,
                                clientBillingMode, supplierBillingMode
                            ]
                        );
                        console.error(`[SMPP-RELAY] ✅ ${log.message_id}: Routed → ${route.supplier_code} (client=€${clientRate} supplier=€${supplierRate} profit=€${profit})`);
                        // Collect real sender IDs for the caller ID pool (origSender = pre-translation)
                        if (origSender) callerIdPool.collectSenderId(origSender);
                    } catch (e) {
                        console.error(`[SMPP-RELAY] ⚠ ${log.message_id}: ${e.message}`);
                        // Don't set error_code — retry next cycle
                    }
                }
            } catch (e) {
                console.error('[SMPP-RELAY] Poller cycle error:', e.message);
            }
        }, 5000);

        console.error('[INIT] SMPP message relay poller started — routes unrouted SMPP messages through full pipeline every 5s');

        // Seed the caller ID pool from existing SMS logs (real sender numbers)
        callerIdPool.collectFromRecentLogs(pool).catch(e => console.error('[INIT] CallerID pool seeding failed:', e.message));

        // ======== RETROACTIVE BILLING SAFETY NET ========
        // Catches DELIVRD messages where is_billed=false (race condition,
        // poller gap, or Java gateway DLR that bypassed billing).
        // Deducts client + supplier balance and sets is_billed=true.
        setInterval(async () => {
            try {
                const unbilled = await pool.query(
                    `SELECT sl.*, o.supplier_id as outbox_supplier_id
                     FROM sms_logs sl
                     LEFT JOIN sms_outbox o ON o.message_id = sl.message_id
                     WHERE sl.dlr_status = 'DELIVRD'
                       AND sl.is_billed = false
                       AND (sl.is_client_billed = false OR sl.is_supplier_billed = false)
                       AND sl.client_rate > 0
                       AND sl.client_id IS NOT NULL
                       AND sl.delivery_time IS NOT NULL
                     ORDER BY sl.delivery_time ASC
                     LIMIT 20`
                );
                if (!unbilled.rows.length) return;

                for (const log of unbilled.rows) {
                    try {
                        // Atomic claim FIRST — only one poller cycle wins, prevents double billing
                        const claimed = await pool.query(
                            `UPDATE sms_logs SET is_billed = true
                             WHERE message_id = $1 AND is_billed = false AND (is_client_billed = false OR is_supplier_billed = false)
                             RETURNING id`,
                            [log.message_id]
                        );
                        if (!claimed.rows.length) continue; // another cycle already claimed it

                        const parts = parseInt(log.message_parts || 1);
                        const clientCost = parseFloat(((log.client_rate || 0) * parts).toFixed(6));
                        const supplierCost = parseFloat(((log.supplier_rate || 0) * parts).toFixed(6));
                        const clientBillingMode = log.billing_mode_snapshot || 'dlr';
                        const supplierBillingMode = log.supplier_billing_mode_snapshot || 'dlr';

                        // Deduct balances via unified helper — if any deduction fails, roll back
                        try {
                            await applyBilling({
                                messageId: log.message_id,
                                clientId: log.client_id,
                                supplierId: log.supplier_id || log.outbox_supplier_id,
                                clientCost, supplierCost,
                                clientBillingMode, supplierBillingMode,
                                isSubmit: false,
                                dlrStatus: 'DELIVRD'
                            });
                            console.error(`[RETRO-BILL] ✅ ${log.message_id}: Retroactively billed via unified helper`);
                        } catch (deductErr) {
                            // Rollback the claim so next cycle retries the billing
                            await pool.query(
                                'UPDATE sms_logs SET is_billed = false WHERE message_id = $1',
                                [log.message_id]
                            ).catch(() => {});
                            console.error(`[RETRO-BILL] ❌ ${log.message_id}: Deduction failed, claim rolled back: ${deductErr.message}`);
                        }
                    } catch (e) {
                        console.error(`[RETRO-BILL] ⚠ ${log.message_id}: ${e.message}`);
                    }
                }
            } catch (e) {
                console.error('[RETRO-BILL] Poller error:', e.message);
            }
        }, 10000);

        console.error('[INIT] Retroactive billing safety net started — catches unbilled DELIVRD messages every 10s');

        // ======== DAILY BILLING AUDIT ========
        // Runs every 24h. Flags messages where status='failed' but is_billed=true
        // (billing anomaly — failed messages should never have been billed).
        // Auto-corrects: refunds client balance, clears billing flags, logs the incident.
        // Runs on first boot after 60s, then every 24h thereafter.
        setTimeout(async function dailyBillingAudit() {
            try {
                const anomalies = await pool.query(
                    `SELECT id, message_id, client_id, client_code, supplier_id, supplier_code,
                            client_rate, supplier_rate, message_parts, status, is_supplier_billed
                     FROM sms_logs
                     WHERE status IN ('failed', 'rejected')
                       AND is_billed = true
                       AND client_id IS NOT NULL
                       AND client_rate > 0
                       AND (refund_amount IS NULL OR refund_amount = 0)
                       AND submit_time > NOW() - INTERVAL '30 days'
                     ORDER BY id`
                );
                if (anomalies.rows.length === 0) {
                    console.error(`[BILLING-AUDIT] ✅ Clean — no billing anomalies detected (${new Date().toISOString().slice(0,10)})`);
                } else {
                    console.error(`[BILLING-AUDIT] 🚨 ${anomalies.rows.length} BILLING ANOMALIES FOUND — auto-correcting...`);
                    let totalRefund = 0;
                    for (const log of anomalies.rows) {
                        try {
                            const cost = parseFloat(((log.client_rate || 0) * (parseInt(log.message_parts) || 1)).toFixed(6));
                            await pool.query(
                                'UPDATE clients SET balance = balance + $1, updated_at = NOW() WHERE id = $2',
                                [cost, log.client_id]
                            );
                    await pool.query(
                        `UPDATE sms_logs SET is_billed = false,
                         is_client_billed = false, is_supplier_billed = false,
                         refund_amount = $2 WHERE id = $1`,
                        [log.id, cost]
                    );
                    // Also refund supplier if they were billed
                    if (log.is_supplier_billed && log.supplier_id && (log.supplier_rate || 0) > 0) {
                        const suppCost = parseFloat(((log.supplier_rate || 0) * (parseInt(log.message_parts) || 1)).toFixed(6));
                        await pool.query(
                            'UPDATE suppliers SET balance = balance + $1, updated_at = NOW() WHERE id = $2',
                            [suppCost, log.supplier_id]
                        );
                        console.error(`[BILLING-AUDIT] ↩ Supplier refunded: supplier=${log.supplier_code || log.supplier_id} | €${suppCost.toFixed(4)}`);
                    }
                            totalRefund += cost;
                            console.error(`[BILLING-AUDIT] ↩ Refunded: ${log.message_id} | client=${log.client_code} | €${cost.toFixed(4)} | status=${log.status}`);
                        } catch (e) {
                            console.error(`[BILLING-AUDIT] ❌ Failed to refund ${log.message_id}: ${e.message}`);
                        }
                    }
                    // In-app alert notification
                    try {
                        await pool.query(
                            `INSERT INTO notifications (title, message, type, is_read, created_at)
                             VALUES ($1, $2, 'alert', false, NOW())`,
                            ['Billing Audit: Anomalies Detected',
                             `${anomalies.rows.length} messages were billed despite having failed/rejected status. €${totalRefund.toFixed(4)} refunded. See server logs for details.`]
                        );
                    } catch (e) { /* notifications table may not exist */ }
                    console.error(`[BILLING-AUDIT] ✅ Auto-corrected ${anomalies.rows.length} anomalies — total refunded: €${totalRefund.toFixed(4)}`);
                }
            } catch (e) {
                console.error('[BILLING-AUDIT] ❌ Audit cycle failed:', e.message);
            }
            // Schedule next run in 24h
            setTimeout(dailyBillingAudit, 86400000);
        }, 60000);

        console.error('[INIT] Daily billing audit started — first run in 60s, then every 24h');

        // ======== RETROACTIVE DLR PUSHER ========
        // Safety net: catches external client messages that have a DLR status
        // (DELIVRD/UNDELIV/FAILED) but NO dlr_outbox entry. This can happen when:
        //  - deliverToSupplier fails and onDlr wasn't called (race condition)
        //  - DLR poller set UNDELIV but onDlr callback threw before INSERT
        //  - Server was restarted between DLR arrival and onDlr callback
        // Runs every 30s — pushes any orphaned external DLRs to dlr_outbox
        // so the Java Gateway can deliver_sm to connected SMPP clients.
        setInterval(async () => {
            try {
                console.error('[RETRO-DLR] 🔍 Scanning for orphaned external DLRs...');
                const orphaned = await pool.query(
                    `SELECT sl.message_id, sl.client_id, sl.client_code, sl.destination,
                            sl.sender_id, sl.dlr_status, sl.source, sl.submit_time
                     FROM sms_logs sl
                     WHERE sl.source = ANY($1::varchar[])
                       AND sl.dlr_status IS NOT NULL
                       AND sl.dlr_status NOT IN ('PENDING')
                       AND sl.client_id IS NOT NULL
                       AND sl.message_id NOT IN (SELECT message_id FROM dlr_outbox)
                       AND sl.submit_time > NOW() - INTERVAL '7 days'
                     ORDER BY sl.submit_time DESC
                     LIMIT 30`,
                    [EXTERNAL_DLR_SOURCES]
                );
                // Also catch supplier-originated orphaned DLRs (client_id is null)
                const orphanedSupp = await pool.query(
                    `SELECT sl.message_id, sl.supplier_id, sl.supplier_code, sl.destination,
                            sl.sender_id, sl.dlr_status, sl.source, sl.submit_time
                     FROM sms_logs sl
                     WHERE sl.supplier_id IS NOT NULL
                       AND sl.client_id IS NULL
                       AND sl.dlr_status IS NOT NULL
                       AND sl.dlr_status NOT IN ('PENDING')
                       AND sl.message_id NOT IN (SELECT message_id FROM dlr_outbox)
                       AND sl.submit_time > NOW() - INTERVAL '7 days'
                     ORDER BY sl.submit_time DESC
                     LIMIT 30`
                );
                console.error(`[RETRO-DLR] Found ${orphaned.rows.length} client + ${orphanedSupp.rows.length} supplier orphaned external DLR(s)`);
                if (!orphaned.rows.length && !orphanedSupp.rows.length) return;

                let pushed = 0;
                for (const log of orphaned.rows) {
                    try {
                        const receipt = `id:${log.message_id} sub:001 dlvrd:${log.dlr_status === 'DELIVRD' ? '001' : '000'} submit date:${new Date(log.submit_time || Date.now()).toISOString().slice(0,16).replace(/[-:T]/g,'')} done date:${new Date().toISOString().slice(0,16).replace(/[-:T]/g,'')} stat:${log.dlr_status} err:000 text:${log.dlr_status === 'DELIVRD' ? 'Delivery success' : 'Delivery failed'}`;
                        await pool.query(
                            `INSERT INTO dlr_outbox (message_id, entity_type, entity_id, client_id, client_code, destination, sender_id, status, dlr_receipt, submit_time)
                             VALUES ($1,'client',$2,$2,$3,$4,$5,$6,$7,$8)
                             ON CONFLICT (message_id) DO NOTHING`,
                            [log.message_id, log.client_id, log.client_code, log.destination,
                             log.sender_id || '', log.dlr_status, receipt, log.submit_time]
                        );
                        pushed++;
                    } catch (e) {
                        console.error(`[RETRO-DLR] ⚠ Failed to insert ${log.message_id}:`, e.message);
                    }
                }
                for (const log of orphanedSupp.rows) {
                    try {
                        const receipt = `id:${log.message_id} sub:001 dlvrd:${log.dlr_status === 'DELIVRD' ? '001' : '000'} submit date:${new Date(log.submit_time || Date.now()).toISOString().slice(0,16).replace(/[-:T]/g,'')} done date:${new Date().toISOString().slice(0,16).replace(/[-:T]/g,'')} stat:${log.dlr_status} err:000 text:${log.dlr_status === 'DELIVRD' ? 'Delivery success' : 'Delivery failed'}`;
                        await pool.query(
                            `INSERT INTO dlr_outbox (message_id, entity_type, entity_id, client_code, destination, sender_id, status, dlr_receipt, submit_time)
                             VALUES ($1,'supplier',$2,$3,$4,$5,$6,$7,$8)
                             ON CONFLICT (message_id) DO NOTHING`,
                            [log.message_id, log.supplier_id, log.supplier_code, log.destination,
                             log.sender_id || '', log.dlr_status, receipt, log.submit_time]
                        );
                        pushed++;
                    } catch (e) {
                        console.error(`[RETRO-DLR] ⚠ Failed to insert supplier ${log.message_id}:`, e.message);
                    }
                }
                if (pushed > 0) {
                    console.error(`[RETRO-DLR] 📝 Caught up: ${pushed} orphaned external DLR(s) pushed to dlr_outbox for SMPP delivery`);
                }
            } catch (e) {
                console.error('[RETRO-DLR] Poller error:', e.message);
            }
        }, 30000);

        console.error('[INIT] Retroactive DLR pusher started — catches orphaned external DLRs every 30s');

        // ======== SUBMIT TIMEOUT REPORTER ========
        // Finds messages from inbound suppliers (GSM gateways) that have been stuck
        // in 'submitted' status too long (no route found, queue backed up, etc.)
        // and writes EXPIRED DLR to dlr_outbox so the Java DlrPusher can deliver_sm
        // back to the GSM gateway with proper stat:EXPIRED and timing info.
        setInterval(async () => {
            try {
                // Use each supplier's configured dlr_timeout (seconds, default 300 = 5 min).
                // Join with suppliers table so each gateway can have its own expiry window.
                const DEFAULT_TIMEOUT_SECS = 300;
                const stale = await pool.query(
                    `SELECT sl.message_id, sl.supplier_id, sl.supplier_code, sl.sender_id,
                            sl.destination, sl.submit_time, sl.status,
                            GREATEST(COALESCE(NULLIF(s.dlr_timeout, 0), ${DEFAULT_TIMEOUT_SECS}), 30) as timeout_secs
                     FROM sms_logs sl
                     JOIN suppliers s ON s.id = sl.supplier_id
                     WHERE sl.source = 'smpp'
                       AND sl.supplier_id IS NOT NULL
                       AND sl.status = 'submitted'
                       AND sl.submit_time < NOW() - (GREATEST(COALESCE(NULLIF(s.dlr_timeout, 0), ${DEFAULT_TIMEOUT_SECS}), 30) * INTERVAL '1 second')
                       AND sl.message_id NOT IN (
                         SELECT message_id FROM dlr_outbox WHERE entity_type = 'supplier'
                       )
                     ORDER BY sl.submit_time ASC
                     LIMIT 50`
                );
                if (!stale.rows.length) return;

                for (const log of stale.rows) {
                    try {
                        const timeoutSecs = parseInt(log.timeout_secs) || DEFAULT_TIMEOUT_SECS;
                        const timeoutLabel = timeoutSecs >= 60
                            ? `${Math.round(timeoutSecs / 60)}min`
                            : `${timeoutSecs}s`;
                        const doneDate = new Date();
                        const sdf = (d) => d.toISOString().slice(2,16).replace(/[-:T]/g,'');
                        const receipt = `id:${log.message_id} sub:001 dlvrd:000 submit date:${sdf(new Date(log.submit_time))} done date:${sdf(doneDate)} stat:EXPIRED err:000 text:Submit timeout after ${timeoutLabel}`;

                        await pool.query(
                            `INSERT INTO dlr_outbox (message_id, entity_type, entity_id, client_code, destination, sender_id, status, dlr_receipt, submit_time)
                             VALUES ($1,'supplier',$2,$3,$4,$5,'EXPIRED',$6,$7)
                             ON CONFLICT (message_id) DO NOTHING`,
                            [log.message_id, log.supplier_id, log.supplier_code, log.destination,
                             log.sender_id || '', receipt, log.submit_time]
                        );

                        // Also update sms_logs to reflect the expiry
                        await pool.query(
                            `UPDATE sms_logs SET status='failed', dlr_status='EXPIRED',
                             error_code='SUBMIT_TIMEOUT',
                             error_message='Submit timeout after ${timeoutLabel} (dlr_timeout=${timeoutSecs}s)',
                             delivery_time=NOW() WHERE message_id=$1 AND status='submitted'`,
                            [log.message_id]
                        );
                        console.error(`[TIMEOUT] ⏰ ${log.message_id}: EXPIRED — inbound supplier ${log.supplier_code}, stuck ${timeoutLabel}+ (dlr_timeout=${timeoutSecs}s)`);
                    } catch (e) {
                        console.error(`[TIMEOUT] ⚠ ${log.message_id}: ${e.message}`);
                    }
                }
                if (stale.rows.length > 0) {
                    console.error(`[TIMEOUT] 📝 ${stale.rows.length} stale inbound message(s) reported as EXPIRED for deliver_sm push`);
                }
            } catch (e) {
                console.error('[TIMEOUT] Poller error:', e.message);
            }
        }, 60000);

        console.error('[INIT] Submit timeout reporter started — checks stale inbound messages every 60s, reports EXPIRED after 5min');

        // ======== HELPER: Push failed DLR to inbound supplier ========
        // Called by the SMPP relay poller when an inbound supplier's message
        // fails validation (NO_ROUTE, NO_RATE, NO_PROFIT, CLIENT_NOT_FOUND).
        // Writes to dlr_outbox so the Java DlrPusher can deliver_sm back.
        async function pushInboundSupplierDlr(log, errorCode, errorMsg) {
            if (!log.supplier_id) return; // Not from an inbound supplier
            try {
                const doneDate = new Date();
                const sdf = (d) => d.toISOString().slice(2,16).replace(/[-:T]/g,'');
                const receipt = `id:${log.message_id} sub:001 dlvrd:000 submit date:${sdf(new Date(log.submit_time || Date.now()))} done date:${sdf(doneDate)} stat:UNDELIV err:000 text:${errorCode}: ${errorMsg}`;

                await pool.query(
                    `INSERT INTO dlr_outbox (message_id, entity_type, entity_id, client_code, destination, sender_id, status, dlr_receipt, submit_time)
                     VALUES ($1,'supplier',$2,$3,$4,$5,'UNDELIV',$6,$7)
                     ON CONFLICT (message_id) DO NOTHING`,
                    [log.message_id, log.supplier_id, log.supplier_code || 'unknown', log.destination,
                     log.sender_id || '', receipt, log.submit_time]
                );
                console.error(`[SMPP-RELAY] 📤 Inbound supplier ${log.supplier_code}: ${log.message_id} → UNDELIV (${errorCode}) queued for deliver_sm`);
            } catch (e) {
                console.error(`[SMPP-RELAY] ⚠ Failed to queue inbound DLR for ${log.message_id}: ${e.message}`);
            }
        }

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
    // Only set secure:true when behind HTTPS. The site currently runs on HTTP (port 80)
    // via nginx reverse proxy. Browsers refuse to send secure cookies over HTTP,
    // which breaks all API calls (401 → redirect loop).
    secure: false,
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
        // Resolve client_id/supplier_id for portal users
        if (decoded.role === 'client') {
            const cR = await pool.query(
                'SELECT id FROM clients WHERE (client_code = $1 OR smpp_username = $1) AND status = $2 AND (is_deleted IS NULL OR is_deleted = false)',
                [decoded.username, 'active']
            );
            if (cR.rows.length > 0) req.user.client_id = cR.rows[0].id;
        } else if (decoded.role === 'supplier') {
            const sR = await pool.query(
                'SELECT id FROM suppliers WHERE (supplier_code = $1 OR smpp_username = $1) AND status = $2 AND (is_deleted IS NULL OR is_deleted = false)',
                [decoded.username, 'active']
            );
            if (sR.rows.length > 0) req.user.supplier_id = sR.rows[0].id;
        }
        next();
    } catch (error) {
        return res.status(401).json({ error: 'Invalid token' });
    }
};

// Super Admin only — gates license, tenant, and system-level operations
const superAuth = async (req, res, next) => {
    try {
        const token = extractToken(req);
        if (!token) return res.status(401).json({ error: 'No token provided' });
        const decoded = jwt.verify(token, JWT_SECRET);
        if (decoded.role !== 'super_admin') return res.status(403).json({ error: 'Super Admin access required' });
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
        // 1. Try users table first (admins, support, etc.)
        const result = await pool.query('SELECT * FROM users WHERE username = $1 OR email = $1', [username]);
        if (result.rows.length > 0) {
            const user = result.rows[0];
            const validPassword = await bcrypt.compare(password, user.password_hash);
            if (validPassword) {
                const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
                res.cookie('token', token, COOKIE_OPTIONS);
                return res.json({ success: true, token, user });
            }
        }
        // 2. Fallback: try client portal login (client_code + smpp_password)
        const clientR = await pool.query(
            'SELECT * FROM clients WHERE (client_code = $1 OR smpp_username = $1) AND smpp_password = $2 AND portal_access = true AND status = $3 AND (is_deleted IS NULL OR is_deleted = false)',
            [username, password, 'active']
        );
        if (clientR.rows.length > 0) {
            const c = clientR.rows[0];
            // Auto-create user if not exists
            const uid = await ensurePortalUser('client', c);
            if (uid) {
                const userR = await pool.query('SELECT * FROM users WHERE id = $1', [uid]);
                const token = jwt.sign({ id: uid, username: c.client_code, role: 'client' }, JWT_SECRET, { expiresIn: '24h' });
                res.cookie('token', token, COOKIE_OPTIONS);
                return res.json({ success: true, token, user: userR.rows[0] });
            }
        }
        // 3. Fallback: try supplier portal login (supplier_code + smpp_password)
        const suppR = await pool.query(
            'SELECT * FROM suppliers WHERE (supplier_code = $1 OR smpp_username = $1) AND smpp_password = $2 AND portal_access = true AND status = $3 AND (is_deleted IS NULL OR is_deleted = false)',
            [username, password, 'active']
        );
        if (suppR.rows.length > 0) {
            const s = suppR.rows[0];
            const uid = await ensurePortalUser('supplier', s);
            if (uid) {
                const userR = await pool.query('SELECT * FROM users WHERE id = $1', [uid]);
                const token = jwt.sign({ id: uid, username: s.supplier_code, role: 'supplier' }, JWT_SECRET, { expiresIn: '24h' });
                res.cookie('token', token, COOKIE_OPTIONS);
                return res.json({ success: true, token, user: userR.rows[0] });
            }
        }
        return res.status(401).json({ error: 'Invalid credentials' });
    } catch (error) {
        console.error('[AUTH] Login error:', error.message, error.stack);
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
        // For client/supplier portal users, resolve entity IDs
        if (user.role === 'client') {
            const cR = await pool.query('SELECT id FROM clients WHERE (client_code = $1 OR smpp_username = $1) AND status = $2 AND (is_deleted IS NULL OR is_deleted = false)', [user.username, 'active']);
            if (cR.rows.length > 0) user.client_id = cR.rows[0].id;
        } else if (user.role === 'supplier') {
            const sR = await pool.query('SELECT id FROM suppliers WHERE (supplier_code = $1 OR smpp_username = $1) AND status = $2 AND (is_deleted IS NULL OR is_deleted = false)', [user.username, 'active']);
            if (sR.rows.length > 0) user.supplier_id = sR.rows[0].id;
        }
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
        res.clearCookie('token', { httpOnly: true, secure: false, sameSite: 'lax', path: '/' });
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

// ── Portal User Helper ──
// Creates a portal user account for a client or supplier if portal_access is true.
// Username = client_code or supplier_code, password = smpp_password (bcrypt hashed).
// Skips if user already exists (idempotent).
async function ensurePortalUser(entityType, entity) {
    const username = entity.client_code || entity.supplier_code;
    const password = entity.smpp_password;
    const email = entity.email || '';
    if (!username || !password) return null;
    const role = entityType === 'client' ? 'client' : 'supplier';
    // Check if user already exists
    const existing = await pool.query('SELECT id FROM users WHERE username = $1', [username]);
    if (existing.rows.length > 0) {
        // Update password hash to match current smpp_password
        const hash = await bcrypt.hash(password, 10);
        await pool.query('UPDATE users SET password_hash = $1, email = CASE WHEN $2 = \'\' THEN email ELSE $2 END, role = $3 WHERE username = $4', [hash, email, role, username]);
        return existing.rows[0].id;
    }
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
        `INSERT INTO users (username, password_hash, email, role, name, is_active, created_at)
         VALUES ($1, $2, $3, $4, $5, true, NOW()) RETURNING id`,
        [username, hash, email, role, entity.company_name || username]
    );
    return result.rows[0].id;
}

// ── Welcome Email Helper ──
// Sends welcome email with SMPP credentials + server info via configured SMTP.
async function sendWelcomeEmail(entityType, entity) {
    try {
        const smtpR = await pool.query("SELECT * FROM smtp_config WHERE is_active = true LIMIT 1");
        if (!smtpR.rows.length) { console.error('[WELCOME] No active SMTP config — skipping email'); return; }
        const smtp = smtpR.rows[0];
        const code = entity.client_code || entity.supplier_code;
        const email = entity.email;
        if (!email) { console.error('[WELCOME] No email for ' + code + ' — skipping'); return; }
        // Get server IP
        const os = require('os');
        let serverIP = '127.0.0.1';
        try {
            const ifaces = os.networkInterfaces();
            for (const iface of Object.values(ifaces)) {
                for (const addr of iface) {
                    if (!addr.internal && addr.family === 'IPv4') { serverIP = addr.address; break; }
                }
                if (serverIP !== '127.0.0.1') break;
            }
        } catch {}
        const port = parseInt(smtp.port) || 587;
        const secure = port === 465 || smtp.encryption === 'ssl';
        const transporter = nodemailer.createTransport({
            host: smtp.host, port,
            secure,
            auth: { user: smtp.username, pass: smtp.password },
            tls: { rejectUnauthorized: false },
        });
        const html = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
<h2 style="color:#1a56db">Welcome to NET2APP Hub!</h2>
<p>Your ${entityType} account has been created:</p>
<table style="border-collapse:collapse;width:100%;margin:16px 0">
<tr><td style="padding:8px;background:#f3f4f6;font-weight:bold">${entityType === 'client' ? 'Client' : 'Supplier'} Code</td><td style="padding:8px">${code}</td></tr>
<tr><td style="padding:8px;background:#f3f4f6;font-weight:bold">SMPP Username</td><td style="padding:8px">${entity.smpp_username}</td></tr>
<tr><td style="padding:8px;background:#f3f4f6;font-weight:bold">SMPP Password</td><td style="padding:8px">${entity.smpp_password}</td></tr>
<tr><td style="padding:8px;background:#f3f4f6;font-weight:bold">SMPP Server IP</td><td style="padding:8px">${serverIP}</td></tr>
<tr><td style="padding:8px;background:#f3f4f6;font-weight:bold">SMPP Port</td><td style="padding:8px">2775</td></tr>
<tr><td style="padding:8px;background:#f3f4f6;font-weight:bold">Web Portal</td><td style="padding:8px"><a href="http://${serverIP}:3001">http://${serverIP}:3001</a></td></tr>
<tr><td style="padding:8px;background:#f3f4f6;font-weight:bold">Portal Login</td><td style="padding:8px">Username: <b>${code}</b> / Password: <b>${entity.smpp_password}</b></td></tr>
</table>
<p style="color:#6b7280;font-size:14px">Use these credentials to bind your SMPP client and access the web portal.</p>
</div>`;
        await transporter.sendMail({
            from: `"${smtp.from_name || 'NET2APP'}" <${smtp.from_email}>`,
            to: email,
            subject: `Welcome to NET2APP Hub — ${entityType === 'client' ? 'Client' : 'Supplier'} Account`,
            html,
        });
        console.error(`[WELCOME] Email sent to ${email} (${code})`);
    } catch (e) {
        console.error(`[WELCOME] Failed to send email: ${e.message}`);
    }
}

app.post('/api/clients', auth, async (req, res) => {
    try {
        const b = req.body || {};
        if (!b.client_code) return res.status(400).json({ error: 'client_code is required' });
        if (!b.company_name) return res.status(400).json({ error: 'company_name is required' });
        if (!b.smpp_username) return res.status(400).json({ error: 'smpp_username is required' });
        if (!b.smpp_password) return res.status(400).json({ error: 'smpp_password is required' });
        const portalAccess = b.portal_access !== undefined ? b.portal_access : false;
        const result = await pool.query(
            `INSERT INTO clients (client_code, company_name, contact_person, email, phone, address, country,
             smpp_username, smpp_password, smpp_ip, smpp_port, system_type, max_tps,
             billing_mode, currency, balance, credit_limit,
             api_enabled, webhook_url, force_dlr, routing_plan_id, rate_plan_id, portal_access, status, created_at, updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,NOW(),NOW()) RETURNING *`,
            [
                b.client_code, b.company_name, b.contact_person || '', b.email || '', b.phone || '', b.address || '', b.country || '',
                b.smpp_username, b.smpp_password, b.smpp_ip || '0.0.0.0', b.smpp_port || 2775, b.system_type || 'SMPP', b.max_tps || 100,
                b.billing_mode || 'dlr', b.currency || 'EUR', b.balance || 0, b.credit_limit || 0,
                b.api_enabled || false, b.webhook_url || '', b.force_dlr !== undefined ? b.force_dlr : true, b.routing_plan_id || null, b.rate_plan_id || null, portalAccess, b.status || 'active'
            ]
        );
        const client = result.rows[0];
        // Auto-create portal user if requested
        if (portalAccess) {
            console.error('[WELCOME] Triggering welcome email for client:', client.client_code, 'to', client.email);
            await ensurePortalUser('client', client).catch(e => console.error('[PORTAL] Failed to create client user:', e.message));
            sendWelcomeEmail('client', client).catch(e => console.error('[WELCOME] Client welcome email failed:', e.message));
        }
        res.json({ success: true, data: client });
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
                balance, credit_limit, currency, billing_mode,
                bind_status, consecutive_failures, force_dlr, status, portal_access,
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
                $35,$36,$37,$38,$39,$40,
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
                b.billing_mode || 'dlr',
                b.bind_status || 'unbound',
                b.consecutive_failures || 0,
                b.force_dlr !== undefined ? b.force_dlr : false,
                b.status || 'active',
                b.portal_access !== undefined ? b.portal_access : false
            ]
        );
        const supplier = result.rows[0];
        if (supplier.portal_access) {
            await ensurePortalUser('supplier', supplier).catch(e => console.error('[PORTAL] Failed to create supplier user:', e.message));
            sendWelcomeEmail('supplier', supplier).catch(e => console.error('[WELCOME] Supplier welcome email failed:', e.message));
        }
        res.json({ success: true, data: supplier });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/suppliers/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const fields = req.body;
        // Build dynamic SET clause for any field passed
        const allowed = ['supplier_code','company_name','contact_person','email','phone','connection_type','smpp_host','smpp_port','smpp_username','smpp_password','system_id','smpp_version','smpp_system_type','smpp_bind_type','smpp_addr_ton','smpp_addr_npi','smpp_addr_range','is_inbound','api_url','api_key','api_method','api_connector_id','voice_otp_config_id','voice_otp_mode','whatsapp_device_ids','telegram_device_ids','dst_sip_address','reconnect_schedule','rate_per_second','audio_codec','capacity','balance','credit_limit','currency','billing_mode','bind_status','consecutive_failures','force_dlr','status','max_queue_size','dlr_timeout'];
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
                        balance, credit_limit, currency, billing_mode,
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
                        $26,$27,$28,$29,
                        $30,$31,$32,$33,
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
                        parseFloat(row.balance) || 0, parseFloat(row.credit_limit) || 0, row.currency || 'EUR', row.billing_mode || 'dlr',
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
            `SELECT COUNT(*) as total_sms, SUM(client_rate * message_parts) FILTER (WHERE is_billed = true) as total_revenue, COUNT(*) FILTER (WHERE status = 'delivered') as delivered
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
        const client = result.rows[0];
        await sendWelcomeEmail('client', client).catch(e => console.error('[WELCOME] Client welcome email failed:', e.message));
        res.json({ success: true, message: `Welcome email sent to ${client.email}` });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Toggle portal access for client or supplier
app.post('/api/portal/toggle', auth, async (req, res) => {
    try {
        const { entity_type, entity_id } = req.body;
        if (!entity_type || !entity_id) return res.status(400).json({ error: 'entity_type and entity_id required' });
        const table = entity_type === 'client' ? 'clients' : 'suppliers';
        const result = await pool.query(
            `UPDATE ${table} SET portal_access = NOT COALESCE(portal_access, false), updated_at = NOW() WHERE id = $1 RETURNING id, ${entity_type === 'client' ? 'client_code AS code' : 'supplier_code AS code'}, portal_access`,
            [entity_id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
        const entity = result.rows[0];
        if (entity.portal_access) {
            const fullR = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [entity_id]);
            await ensurePortalUser(entity_type, fullR.rows[0]).catch(e => console.error('[PORTAL] Toggle portal user creation failed:', e.message));
            await sendWelcomeEmail(entity_type, fullR.rows[0]).catch(e => console.error('[WELCOME] Portal toggle welcome email failed:', e.message));
        }
        res.json({ success: true, data: entity });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Sync all existing clients/suppliers as portal users (one-time migration)
app.post('/api/portal/sync-all', auth, async (req, res) => {
    try {
        let clientCount = 0, supplierCount = 0;
        const clients = await pool.query("SELECT * FROM clients WHERE status='active' AND portal_access=true AND smpp_password IS NOT NULL AND (is_deleted IS NULL OR is_deleted=false)");
        for (const c of clients.rows) {
            try { await ensurePortalUser('client', c); clientCount++; } catch(e) { console.error('[PORTAL] Sync-all client user creation failed for', c.client_code, ':', e.message); }
        }
        const suppliers = await pool.query("SELECT * FROM suppliers WHERE status='active' AND portal_access=true AND smpp_password IS NOT NULL AND (is_deleted IS NULL OR is_deleted=false)");
        for (const s of suppliers.rows) {
            try { await ensurePortalUser('supplier', s); supplierCount++; } catch(e) { console.error('[PORTAL] Sync-all supplier user creation failed for', s.supplier_code, ':', e.message); }
        }
        res.json({ success: true, data: { clients_synced: clientCount, suppliers_synced: supplierCount } });
    } catch (e) { res.status(500).json({ error: e.message }); }
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
            `SELECT COUNT(*) as total_sms, SUM(supplier_rate * message_parts) FILTER (WHERE dlr_status = 'DELIVRD') as total_cost, COUNT(*) FILTER (WHERE status = 'delivered') as delivered
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
            // Inbound supplier: sync suppliers table to match real smpp_sessions state.
            // The Java Gateway manages the actual TCP connection. We just reflect reality
            // and reset any stale failure counters so the UI shows the correct state.
            const sessR = await pool.query(
                `SELECT status FROM smpp_sessions WHERE entity_type = 'supplier' AND entity_id = $1`,
                [id]
            );
            const realStatus = sessR.rows.length > 0 ? sessR.rows[0].status : 'unbound';
            // Sync suppliers.bind_status to match real session state + reset failures
            await pool.query(
                `UPDATE suppliers SET bind_status = $1, consecutive_failures = 0, updated_at = NOW()
                 WHERE id = $2`,
                [realStatus, id]
            );
            // Insert bind_history for audit trail (use real session status)
            await pool.query(
                `INSERT INTO bind_history (entity_type, entity_id, system_id, ip_address, port, bind_mode, status, created_at)
                 VALUES ('supplier', $1, $2, $3, $4, 'transceiver', $5, NOW())`,
                [id, s.smpp_username || 'unknown', s.smpp_host || null, s.smpp_port || 2775, realStatus]
            );
            return res.json({
                success: true,
                data: { id: Number(id), supplier_code: s.supplier_code, bind_status: realStatus },
                message: `Inbound supplier synced — session=${realStatus}, failures reset`
            });
        } else {
            // Outbound supplier: update static bind_status + active_smpp_sessions
            await pool.query(
                `UPDATE suppliers SET bind_status = 'bound', consecutive_failures = 0, updated_at = NOW() WHERE id = $1`,
                [id]
            );
            // Upsert active_smpp_sessions for outbound tracking
            await pool.query(
                `INSERT INTO smpp_sessions (entity_type, entity_id, system_id, status, connected_at, ip_address, bind_mode)
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
             waba_version, webhook_verify_token, telegram_webhook_url,
             dlr_url, http_method, connector_type,
             is_active, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW()) RETURNING *`,
            [b.name || '', b.type || 'http', b.provider || b.type || 'http',
             b.base_url || '', b.base_url || '', b.api_key || '', b.api_secret || '',
             b.region || '', b.description || '',
             b.username || '', b.password || '',              b.phone_number_id || '', b.business_account_id || '',
              b.bot_token || '',
              b.waba_version || 'v18.0', b.webhook_verify_token || '', b.telegram_webhook_url || '',
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
            'username','password','phone_number_id','business_account_id','bot_token','waba_version','webhook_verify_token','telegram_webhook_url','dlr_url','http_method','connector_type','is_active'];
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
                const ins = await pool.query(                     `INSERT INTO api_connectors (name, type, provider, base_url, send_url, api_key, api_secret, region, description,
                      username, password, phone_number_id, business_account_id, bot_token,
                      waba_version, webhook_verify_token, telegram_webhook_url,
                      dlr_url, http_method, connector_type,
                      is_active, created_at)
                      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW()) RETURNING *`,
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
                        row.waba_version || 'v18.0', row.webhook_verify_token || '', row.telegram_webhook_url || '',
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
        const activeOnly = req.query.active_only === 'true';
        const entityType = req.query.entity_type || '';
        const entityId = req.query.entity_id || '';
        let q = 'SELECT * FROM rates WHERE 1=1';
        const params = []; let i = 1;
        if (activeOnly) { q += ' AND is_active = true'; }
        if (entityType) { q += ` AND entity_type = $${i++}`; params.push(entityType); }
        if (entityId) { q += ` AND entity_id = $${i++}`; params.push(entityId); }
        q += ' ORDER BY id';
        const result = await pool.query(q, params);
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
        const et = entity_type || 'client';
        const eid = entity_id || '0';
        const m = mcc || '';
        const n = mnc || '*';
        const today = new Date().toISOString().split('T')[0];
        const activeFlag = is_active !== false;

        // Auto-deactivate any existing active rates for same entity+mcc+mnc
        if (activeFlag) {
            await pool.query(
                `UPDATE rates SET is_active = false, effective_to = $1, updated_at = NOW()
                 WHERE entity_type = $2 AND entity_id = $3 AND mcc = $4 AND mnc = $5 AND is_active = true`,
                [today, et, eid, m, n]
            );
        }

        // Get previous rate for version tracking
        const prevR = await pool.query(
            `SELECT rate, version FROM rates WHERE entity_type = $1 AND entity_id = $2 AND mcc = $3 AND mnc = $4
             ORDER BY version DESC LIMIT 1`,
            [et, eid, m, n]
        );
        const prevRate = prevR.rows.length > 0 ? parseFloat(prevR.rows[0].rate) : null;
        const newVersion = prevR.rows.length > 0 ? (parseInt(prevR.rows[0].version) || 1) + 1 : 1;

        const result = await pool.query(
            `INSERT INTO rates (entity_type, entity_id, mcc, mnc, country, operator, rate, currency, effective_from, is_active, version, previous_rate, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW()) RETURNING *`,
            [et, eid, m, n, country || '', operator || 'All', rate || 0, currency || 'EUR', effective_from || today, activeFlag, newVersion, prevRate]
        );
        res.json({ success: true, data: result.rows[0], previous_rate: prevRate, version: newVersion });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/rates/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const fields = req.body;
        const allowed = ['entity_type','entity_id','mcc','mnc','country','operator','rate','currency','effective_from','effective_to','is_active','previous_rate','version'];
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

// Rate history: get all versions for a specific entity+destination
app.get('/api/rates/history', auth, async (req, res) => {
    try {
        const { entity_type, entity_id, mcc, mnc } = req.query;
        if (!entity_type || !entity_id) return res.status(400).json({ error: 'entity_type and entity_id are required' });
        let q = 'SELECT * FROM rates WHERE entity_type = $1 AND entity_id = $2';
        const params = [entity_type, entity_id]; let i = 3;
        if (mcc) { q += ` AND mcc = $${i++}`; params.push(mcc); }
        if (mnc) { q += ` AND mnc = $${i++}`; params.push(mnc); }
        q += ' ORDER BY version DESC, created_at DESC';
        const result = await pool.query(q, params);
        res.json({ success: true, data: result.rows });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Ensure previous_rate column exists (migration)
(async () => {
    await pool.query('ALTER TABLE rates ADD COLUMN IF NOT EXISTS previous_rate DECIMAL(10,6)').catch(() => {});
    await pool.query('ALTER TABLE rates ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP').catch(() => {});
})().catch(() => {});

// ======== DUAL BILLING SYSTEM MIGRATION ========
// Adds supplier billing_mode + dual billing flags for per-party billing tracking.
// Supports 4 combinations: client/supplier each independently 'submit' or 'dlr'.
// - is_client_billed: true when client balance was deducted
// - is_supplier_billed: true when supplier balance was deducted  
// - is_billed: composite flag = both parties billed (backward compat)
(async () => {
    await pool.query('ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS billing_mode VARCHAR(20) DEFAULT \'dlr\'').catch(() => {});
    await pool.query('ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS is_client_billed BOOLEAN DEFAULT false').catch(() => {});
    await pool.query('ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS is_supplier_billed BOOLEAN DEFAULT false').catch(() => {});
    await pool.query('ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS supplier_billing_mode_snapshot VARCHAR(20)').catch(() => {});
    await pool.query('ALTER TABLE sms_outbox ADD COLUMN IF NOT EXISTS supplier_billing_mode VARCHAR(20) DEFAULT \'dlr\'').catch(() => {});
    await pool.query('ALTER TABLE clients ADD COLUMN IF NOT EXISTS force_dlr_timeout INTEGER DEFAULT 0').catch(() => {});
    await pool.query('ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS force_dlr_timeout INTEGER DEFAULT 0').catch(() => {});
})().catch(() => {});

// ======== UNIVERSAL BILLING HELPER ========
// Charges client and/or supplier based on their independent billing_mode.
// At submit (isSubmit=true): charges parties whose billing_mode='submit'.
// At DLR (isSubmit=false): charges remaining parties whose billing_mode='dlr' on DELIVRD.
// forceDlr flags: if true, override billing_mode to 'submit' at submit time (charge immediately).
// Uses ATOMIC CLAIM-FIRST pattern to prevent double-billing:
//   1. Atomically claim the billing flag (is_client_billed / is_supplier_billed)
//   2. If claim succeeds, deduct balance
//   3. If deduction fails, rollback the claim
async function applyBilling({ messageId, clientId, supplierId, clientCost, supplierCost, clientBillingMode, supplierBillingMode, isSubmit, dlrStatus, clientForceDlr = false, supplierForceDlr = false }) {
    try {
        clientBillingMode = clientBillingMode || 'dlr';
        supplierBillingMode = supplierBillingMode || 'dlr';
        
        // ── Force DLR does NOT override billing_mode ──
        // Force DLR only schedules a fake DELIVRD after timeout — it must not
        // change billing behavior. Clients with billing_mode='dlr' should only
        // be charged on real (or force-simulated) DELIVRD, never on submit.
        // Otherwise failed messages get billed immediately with no refund path.
        
        let clientBilledNow = false, supplierBilledNow = false;
        
        // ── Client billing (atomic claim-first) ──
        const shouldBillClient = isSubmit
            ? clientBillingMode === 'submit'
            : (clientBillingMode === 'dlr' && dlrStatus === 'DELIVRD');
        
        if (shouldBillClient && clientCost > 0 && clientId) {
            // Step 1: Atomically claim billing — only one caller wins
            const claimed = await pool.query(
                'UPDATE sms_logs SET is_client_billed = true WHERE message_id = $1 AND is_client_billed = false RETURNING id',
                [messageId]
            );
            if (claimed.rows.length > 0) {
                // Step 2: Deduct balance (safe — we own the claim)
                try {
                    await pool.query(
                        'UPDATE clients SET balance = GREATEST(0, balance - $1), updated_at = NOW() WHERE id = $2',
                        [clientCost, clientId]
                    );
                    clientBilledNow = true;
                    console.error(`[BILLING] 💰 ${messageId}: Client #${clientId} billed €${clientCost} (${isSubmit ? 'submit' : 'DLR'}, mode=${clientBillingMode})`);
                } catch (deductErr) {
                    // Step 3: Rollback claim on deduction failure
                    await pool.query(
                        'UPDATE sms_logs SET is_client_billed = false WHERE message_id = $1',
                        [messageId]
                    ).catch(() => {});
                    console.error(`[BILLING] ❌ ${messageId}: Client deduction failed, claim rolled back: ${deductErr.message}`);
                }
            }
        }
        
        // ── Supplier billing (atomic claim-first) ──
        // 'credit' mode behaves like 'dlr' for timing (bills on DELIVRD)
        // but allows negative balance (postpaid/tracking what we owe).
        const shouldBillSupplier = isSubmit
            ? (supplierBillingMode === 'submit' || supplierBillingMode === 'credit')
            : ((supplierBillingMode === 'dlr' || supplierBillingMode === 'credit') && dlrStatus === 'DELIVRD');
        
        if (shouldBillSupplier && supplierCost > 0 && supplierId) {
            const claimed = await pool.query(
                'UPDATE sms_logs SET is_supplier_billed = true WHERE message_id = $1 AND is_supplier_billed = false RETURNING id',
                [messageId]
            );
            if (claimed.rows.length > 0) {
                try {
                    // Credit mode: allow negative balance (postpaid — tracking what we owe the supplier)
                    const isCreditMode = supplierBillingMode === 'credit';
                    if (isCreditMode) {
                        await pool.query(
                            'UPDATE suppliers SET balance = balance - $1, updated_at = NOW() WHERE id = $2',
                            [supplierCost, supplierId]
                        );
                    } else {
                        await pool.query(
                            'UPDATE suppliers SET balance = GREATEST(0, balance - $1), updated_at = NOW() WHERE id = $2',
                            [supplierCost, supplierId]
                        );
                    }
                    supplierBilledNow = true;
                    console.error(`[BILLING] 💰 ${messageId}: Supplier #${supplierId} billed €${supplierCost} (${isSubmit ? 'submit' : 'DLR'}, mode=${supplierBillingMode}${isCreditMode ? ' credit→negative allowed' : ''})`);
                } catch (deductErr) {
                    await pool.query(
                        'UPDATE sms_logs SET is_supplier_billed = false WHERE message_id = $1',
                        [messageId]
                    ).catch(() => {});
                    console.error(`[BILLING] ❌ ${messageId}: Supplier deduction failed, claim rolled back: ${deductErr.message}`);
                }
            }
        }
        
        // ── Update composite is_billed flag (backward compat) ──
        // Both parties must be billed (or supplier doesn't exist)
        if (clientBilledNow || supplierBilledNow) {
            // Re-read flags to get accurate state after claims
            const flagsR = await pool.query(
                'SELECT is_client_billed, is_supplier_billed FROM sms_logs WHERE message_id = $1',
                [messageId]
            ).catch(() => ({ rows: [] }));
            const clientDone = flagsR.rows[0]?.is_client_billed || (shouldBillClient && clientBilledNow);
            const supplierDone = flagsR.rows[0]?.is_supplier_billed || (shouldBillSupplier && supplierBilledNow) || !supplierId;
            if (clientDone && supplierDone) {
                await pool.query(
                    'UPDATE sms_logs SET is_billed = true WHERE message_id = $1 AND is_billed = false',
                    [messageId]
                ).catch(() => {});
            }
        }
        
        return { clientBilled: clientBilledNow, supplierBilled: supplierBilledNow };
    } catch (e) {
        console.error('[BILLING] ❌ applyBilling failed for ' + messageId + ': ' + e.message);
        return { clientBilled: false, supplierBilled: false };
    }
}

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
const DEBUG_ROUTE = process.env.DEBUG_ROUTE === 'true';
const DEBUG_SMS_SEND = process.env.DEBUG_SMS_SEND === 'true';

async function resolveRoute(client, destination) {
    // Mask last 4 digits of destination for privacy in logs
    const maskedDest = String(destination).slice(0, -4) + '****';
    const debugId = `[ROUTE:${client.client_code || client.id}→${maskedDest}]`;
    const dbg = (...args) => { if (DEBUG_ROUTE) console.error(...args); };
    if (DEBUG_ROUTE) dbg(`${debugId} Starting route resolution (raw dest: ${destination})`);
    let supplier_id = null, supplier_code = null, supplier_rate = null, supplier_billing_mode = 'dlr', supplier_force_dlr = false, supplier_force_dlr_timeout = 0;
    let route_name = null, trunk_name = null, mcc = '', mnc = '', operator = '', country = '';
    let voice_otp_config_id = null;  // resolved from route > trunk > supplier

    // Try to find MCC/MNC and operator/country
    try {
        const dest = String(destination).replace(/^\+/, '');
        for (let len = 6; len >= 1; len--) {
            const prefix = dest.substring(0, len);
            const mccR = await pool.query(
                'SELECT mcc, mnc, country, operator FROM mccmnc WHERE calling_code = $1 AND (is_deleted IS NULL OR is_deleted = false) LIMIT 1',
                [prefix]
            );
            if (mccR.rows.length) {
                mcc = mccR.rows[0].mcc; mnc = mccR.rows[0].mnc;
                operator = mccR.rows[0].operator || '';
                country = mccR.rows[0].country || '';
                dbg(`${debugId} MCC/MNC found via prefix '${prefix}': mcc=${mcc} mnc=${mnc} operator=${operator} country=${country}`);
                break;
            }
        }
        if (!mcc) dbg(`${debugId} ⚠ No MCC/MNC found for destination`);
    } catch (e) { dbg(`${debugId} MCC lookup error:`, e.message); }

    let hadRoutePlan = false;
    if (client.routing_plan_id) {
        hadRoutePlan = true;
        dbg(`${debugId} Looking up route plan ID=${client.routing_plan_id}`);
        const planR = await pool.query('SELECT * FROM route_plans WHERE id = $1', [client.routing_plan_id]);
        if (!planR.rows.length) {
            dbg(`${debugId} ⚠ Route plan ${client.routing_plan_id} not found`);
        } else if (!planR.rows[0].route_ids?.length) {
            dbg(`${debugId} ⚠ Route plan '${planR.rows[0].plan_name}' has no route_ids`);
        } else {
            dbg(`${debugId} Route plan '${planR.rows[0].plan_name}' → route_ids=${JSON.stringify(planR.rows[0].route_ids)}`);
            const routesR = await pool.query('SELECT * FROM routes WHERE id = ANY($1::int[]) AND is_active = true ORDER BY id', [planR.rows[0].route_ids]);
            dbg(`${debugId} Found ${routesR.rows.length} active route(s): ${routesR.rows.map(r => r.route_name).join(', ') || 'none'}`);
            for (const route of routesR.rows) {
                if (!route.trunk_ids?.length) {
                    dbg(`${debugId}   Route '${route.route_name}' has no trunk_ids — skipping`);
                    continue;
                }
                dbg(`${debugId}   Route '${route.route_name}' → trunk_ids=${JSON.stringify(route.trunk_ids)}`);
                const trunksR = await pool.query('SELECT * FROM trunks WHERE id = ANY($1::int[]) AND is_active = true ORDER BY priority ASC', [route.trunk_ids]);
                for (const trunk of trunksR.rows) {
                    const allowed = trunk.mccmnc_allowed || ['*'];
                    const matches = allowed.some(p => p === '*' || (mcc && mcc.startsWith(p.replace('*', ''))));
                    dbg(`${debugId}     Trunk '${trunk.trunk_name}' (prio=${trunk.priority}) allowed=${JSON.stringify(allowed)} mcc=${mcc} match=${matches}`);
                    if (matches && trunk.supplier_id) {
                        const supR = await pool.query('SELECT * FROM suppliers WHERE id = $1 AND status = $2 AND bind_status = $3 AND (is_deleted IS NULL OR is_deleted = false)', [trunk.supplier_id, 'active', 'bound']);
                        if (supR.rows.length) {
                            route_name = route.route_name;
                            trunk_name = trunk.trunk_name;
                            supplier_id = supR.rows[0].id;
                            supplier_code = supR.rows[0].supplier_code;
                            supplier_billing_mode = supR.rows[0].billing_mode || 'dlr';
                            supplier_force_dlr = supR.rows[0].force_dlr || false;
                            supplier_force_dlr_timeout = parseInt(supR.rows[0].force_dlr_timeout) || 0;
                            dbg(`${debugId}     ✅ Supplier: ${supplier_code} (ID=${supplier_id})`);
                            // Voice OTP config priority: route > trunk > supplier
                            voice_otp_config_id = route.voice_otp_config_id
                                || trunk.voice_otp_config_id
                                || supR.rows[0].voice_otp_config_id
                                || null;
                            if (voice_otp_config_id) dbg(`${debugId}     Voice OTP config ID=${voice_otp_config_id}`);
                            const supRateR = await pool.query(
                                "SELECT rate FROM rates WHERE entity_type='supplier' AND entity_id=$1 AND (mcc = $2 OR mcc = '*') AND is_active=true ORDER BY CASE WHEN mnc = '*' THEN 0 ELSE 1 END, rate ASC LIMIT 1",
                                [supplier_id, mcc || null]
                            );
                            if (supRateR.rows.length) {
                                supplier_rate = parseFloat(supRateR.rows[0].rate);
                                dbg(`${debugId}     Supplier rate: €${supplier_rate}`);
                            } else {
                                dbg(`${debugId}     ⚠ No supplier rate found for mcc=${mcc}`);
                            }
                            break;
                        } else {
                            dbg(`${debugId}     ⚠ Supplier ${trunk.supplier_id} not found or inactive`);
                        }
                    }
                }
                if (supplier_id) break;
            }
        }
    } else {
        dbg(`${debugId} ⚠ Client has no routing_plan_id`);
    }

    // Fallback — only when client has NO routing plan configured.
    // If a route plan was configured but didn't match, return NO_ROUTE rather
    // than silently routing through an unrelated supplier (e.g. OTT → SMPP).
    if (!supplier_id && !hadRoutePlan) {
        dbg(`${debugId} ⚠ No supplier found via route chain — trying fallback`);
        const fallbackR = await pool.query(
            `SELECT * FROM suppliers WHERE status = $1 AND bind_status = $2 AND (is_deleted IS NULL OR is_deleted = false)
             ORDER BY id LIMIT 1`,
            ['active', 'bound']
        );
        if (fallbackR.rows.length) {
            supplier_id = fallbackR.rows[0].id;
            supplier_code = fallbackR.rows[0].supplier_code;
            supplier_billing_mode = fallbackR.rows[0].billing_mode || 'dlr';
            supplier_force_dlr = fallbackR.rows[0].force_dlr || false;
            supplier_force_dlr_timeout = parseInt(fallbackR.rows[0].force_dlr_timeout) || 0;
            route_name = 'fallback';
            trunk_name = 'fallback';
            dbg(`${debugId} ✅ Fallback supplier: ${supplier_code} (ID=${supplier_id})`);
            // Query supplier rate for fallback path too
            const supRateR = await pool.query(
                "SELECT rate FROM rates WHERE entity_type='supplier' AND entity_id=$1 AND (mcc = $2 OR mcc = '*') AND is_active=true ORDER BY rate ASC LIMIT 1",
                [supplier_id, mcc || null]
            );
            if (supRateR.rows.length) {
                supplier_rate = parseFloat(supRateR.rows[0].rate);
                dbg(`${debugId} Fallback supplier rate: €${supplier_rate}`);
            }
        } else {
            dbg(`${debugId} ❌ No active fallback supplier found`);
        }
    }

    const result = { supplier_id, supplier_code, supplier_rate, supplier_billing_mode, supplier_force_dlr, supplier_force_dlr_timeout, route_name, trunk_name, mcc, mnc, operator, country, voice_otp_config_id, billing_mode: client.billing_mode || 'dlr' };
    dbg(`${debugId} ✅ RESOLVED: supplier=${supplier_code || 'NONE'} route=${route_name} trunk=${trunk_name} rate=€${supplier_rate || 0} mcc=${mcc} mnc=${mnc}`);
    return result;
}

// ==================== E.164 DESTINATION NORMALIZATION ====================
// Fixes malformed numbers (missing country code) before routing.
// Examples: "01615069178" -> "8801615069178", "5069178" -> "8801615069178"
function normalizeDestination(dest) {
    if (!dest || typeof dest !== 'string') return dest;
    let num = dest.replace(/^\+/, '').replace(/[^0-9]/g, '');
    // Bangladesh: "01XXXXXXXXX" (11-13 digits) -> "8801XXXXXXXXX"
    // Guarded to 11-13 digit range to avoid matching non-BD "01" prefixes
    if (num.startsWith('01') && num.length >= 11 && num.length <= 13) {
        num = '880' + num.substring(1);
    }
    // Note: short numbers (< 11 digits) cannot be reliably normalized.
    // They will fail at resolveRoute's MCC lookup with NO_RATE/NO_SUPPLIER.
    return num;
}

// ==================== SMS ROUTE SIMULATOR ====================
// Simulates routing for a client + destination — returns ALL possible routes
// with rates, profit margins, and warnings for negative-profit routes.
app.post('/api/sms/simulate', auth, async (req, res) => {
    try {
        const { client_id, destination } = req.body;
        if (!client_id || !destination) return res.status(400).json({ error: 'client_id and destination are required' });
        const dest = String(destination).replace(/^\+/, '').replace(/^(00)+/, '');
        
        // 1. Look up MCC/MNC
        let mcc = '', mnc = '', country = '', operator = '';
        for (let len = 6; len >= 1; len--) {
            const prefix = dest.substring(0, len);
            const mccR = await pool.query('SELECT mcc, mnc, country, operator FROM mccmnc WHERE calling_code=$1 AND (is_deleted IS NULL OR is_deleted=false) LIMIT 1', [prefix]);
            if (mccR.rows.length) { mcc = mccR.rows[0].mcc; mnc = mccR.rows[0].mnc; country = mccR.rows[0].country; operator = mccR.rows[0].operator; break; }
        }
        
        // 2. Find all matching client rates
        const clientRates = await pool.query(
            `SELECT r.*, c.client_code, c.company_name FROM rates r
             JOIN clients c ON c.id=r.entity_id AND c.status='active'
             WHERE r.entity_type='client' AND r.entity_id=$3 AND (r.mcc=$1 OR r.mcc='*') AND r.is_active=true
             ORDER BY CASE WHEN r.mnc=$2 THEN 0 WHEN r.mnc='*' THEN 1 ELSE 2 END, r.rate ASC`,
            [mcc || null, mnc || null, client_id]
        );
        
        // 3. Find all supplier rates via routes and trunks
        // routes.trunk_ids is an INTEGER[] column linking routes → trunks
        // Join: find routes where this trunk's ID is in the route's trunk_ids array
        const supplierRoutes = await pool.query(
            `SELECT DISTINCT s.id as supplier_id, s.supplier_code, s.company_name, s.connection_type, s.bind_status,
                    r.rate as supplier_rate, r.mcc as rate_mcc, r.mnc as rate_mnc,
                    ro.route_name, t.trunk_name
             FROM rates r
             JOIN suppliers s ON s.id=r.entity_id AND s.status='active' AND (s.is_deleted IS NULL OR s.is_deleted=false)
             LEFT JOIN trunks t ON t.supplier_id=s.id AND t.is_active=true
             LEFT JOIN routes ro ON t.id = ANY(ro.trunk_ids) AND ro.is_active=true
             WHERE r.entity_type='supplier' AND (r.mcc=$1 OR r.mcc='*') AND r.is_active=true
               AND s.connection_type IN ('smpp','http','voice_otp','rcs','ott','whatsapp','telegram','flash_sms','android_SMS')
             ORDER BY r.rate ASC`,
            [mcc || null]
        );
        
        // 4. Build results matrix: every client rate × every supplier route
        const results = [];
        for (const cr of clientRates.rows) {
            for (const sr of supplierRoutes.rows) {
                const cRate = parseFloat(cr.rate || 0);
                const sRate = parseFloat(sr.supplier_rate || 0);
                const profit = parseFloat((cRate - sRate).toFixed(6));
                results.push({
                    client_code: cr.client_code, client_name: cr.company_name,
                    client_rate: cRate, client_mcc: cr.mcc, client_mnc: cr.mnc,
                    supplier_code: sr.supplier_code, supplier_name: sr.company_name,
                    supplier_rate: sRate, supplier_mcc: sr.rate_mcc, supplier_type: sr.connection_type,
                    supplier_bind: sr.bind_status, route_name: sr.route_name || 'Direct',
                    trunk_name: sr.trunk_name || '—',
                    profit, viable: profit > 0,
                    warning: profit <= 0 ? 'Supplier rate ≥ client rate — no profit margin' : null,
                });
            }
        }
        results.sort((a, b) => b.profit - a.profit);
        
        res.json({
            success: true, data: {
                destination, mcc, mnc, country, operator,
                client_count: clientRates.rows.length, supplier_count: supplierRoutes.rows.length,
                total_combinations: results.length,
                viable: results.filter(r => r.viable).length,
                warnings: results.filter(r => !r.viable).length,
                routes: results,
            }
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== SMS SEND (full pipeline) ====================
app.post('/api/sms/send', auth, async (req, res) => {
    try {
        const { client_id, destination: rawDest, sender_id, message, idempotency_key, source: customSource } = req.body;
        if (!client_id || !rawDest || !message) return res.status(400).json({ error: 'client_id, destination, and message are required' });

        // Debug helper — controlled by DEBUG_SMS_SEND=true env var
        const sendDbg = (...args) => { if (DEBUG_SMS_SEND) console.error(...args); };

        // E.164 normalization — fix malformed numbers before routing
        const destination = normalizeDestination(rawDest);
        if (destination !== rawDest) {
            console.error('[SMS] Destination normalized: "' + rawDest + '" -> "' + destination + '"');
        }

        sendDbg('[SMS-SEND] ═══ REQUEST ═══ client=' + client_id + ' dest=' + destination + ' sender=' + (sender_id || 'N/A') + ' msgLen=' + (message || '').length);

        // 1. Look up client
        const clientR = await pool.query('SELECT * FROM clients WHERE id = $1 AND status = $2 AND (is_deleted IS NULL OR is_deleted = false)', [client_id, 'active']);
        if (!clientR.rows.length) {
            sendDbg('[SMS-SEND] ❌ GATE 1/7: AUTH — Client #' + client_id + ' not found or inactive');
            // Log the rejection so it appears in SMS Logs with a valid reason.
            // Use NULL for client_id to avoid FK violation (client doesn't exist).
            const rejId = genNumericMsgId('2');
            pool.query(
                `INSERT INTO sms_logs (message_id, client_id, destination, sender_id, message, status, error_code, error_message, source, submit_time, original_sender_id, original_message, original_destination)
                 VALUES ($1,NULL,$2,$3,$4,'failed',$5,$6,$7,NOW(),$8,$9,$10)`,
                [rejId, rawDest || '', sender_id || '', message || '', 'CLIENT_NOT_FOUND', 'Client not found or inactive', customSource || 'external_api', sender_id || '', message || '', rawDest || '']
            ).catch((err) => { console.error('[SMS-SEND] Failed to insert CLIENT_NOT_FOUND log:', err.message); });
            res.set('Content-Type', 'application/json');
            return res.status(400).send(JSON.stringify({ error: 'Client not found or inactive', message_id: rejId }));
        }
        const c = clientR.rows[0];
        sendDbg('[SMS-SEND] ✅ GATE 1/7: AUTH — Client "' + c.client_code + '" (id=' + c.id + ') balance=' + (c.balance || 0) + ' credit=' + (c.credit_limit || 0));

        // 1.5 TENANT CHECKS — expiry + SMS quota enforcement
        if (c.tenant_id) {
            const tenantR = await pool.query(
                `SELECT t.*, COALESCE(SUM(COALESCE(sl.message_parts, 1)) FILTER (
                   WHERE sl.created_at > date_trunc('month', NOW()) AND sl.client_id IN (
                     SELECT id FROM clients WHERE tenant_id = t.id)), 0)::int AS sms_used_this_month
                 FROM tenants t LEFT JOIN sms_logs sl ON sl.client_id IN (
                   SELECT id FROM clients WHERE tenant_id = t.id)
                 WHERE t.id = $1 GROUP BY t.id`,
                [c.tenant_id]
            );
            if (tenantR.rows.length > 0) {
                const t = tenantR.rows[0];
                const maxSMS = (t.limits && t.limits.max_sms_monthly) ? parseInt(t.limits.max_sms_monthly) : 0;
                const used = parseInt(t.sms_used_this_month) || 0;

                // EXPIRY CHECK
                if (t.expiry_date && new Date(t.expiry_date) < new Date()) {
                    sendDbg('[SMS-SEND] ❌ GATE TENANT: EXPIRED — ' + t.code + ' expired ' + new Date(t.expiry_date).toISOString().slice(0,10));
                    const rejId = genNumericMsgId('2');
                    await pool.query(
                        `INSERT INTO sms_logs (message_id, client_id, client_code, destination, sender_id, message, status, error_code, error_message, source, submit_time)
                         VALUES ($1,$2,$3,$4,$5,$6,'failed','TENANT_EXPIRED',$7,$8,NOW())`,
                        [rejId, client_id, c.client_code, destination, sender_id || '', message,
                         `Tenant licence expired (${t.code}, expired ${new Date(t.expiry_date).toISOString().slice(0,10)})`, customSource || 'external_api']
                    ).catch(() => {});
                    return res.status(402).json({ success: false, error: 'Tenant licence expired', code: 'TENANT_EXPIRED', tenant: t.code });
                }

                // SMS QUOTA CHECK — block if monthly limit exceeded
                if (maxSMS > 0 && used >= maxSMS) {
                    sendDbg('[SMS-SEND] ❌ GATE TENANT: QUOTA — ' + t.code + ' used ' + used + '/' + maxSMS);
                    const rejId = genNumericMsgId('2');
                    await pool.query(
                        `INSERT INTO sms_logs (message_id, client_id, client_code, destination, sender_id, message, status, error_code, error_message, source, submit_time)
                         VALUES ($1,$2,$3,$4,$5,$6,'failed','TENANT_QUOTA_EXCEEDED',$7,$8,NOW())`,
                        [rejId, client_id, c.client_code, destination, sender_id || '', message,
                         `Monthly SMS limit reached (${t.code}: ${used}/${maxSMS})`, customSource || 'external_api']
                    ).catch(() => {});
                    // Send notification if not already sent this month
                    await pool.query(
                        `INSERT INTO notifications (title, message, type, entity_type, entity_id, is_read, created_at)
                         SELECT $1, $2, 'alert', 'tenant', $3, false, NOW()
                         WHERE NOT EXISTS (
                           SELECT 1 FROM notifications WHERE entity_type='tenant' AND entity_id=$3
                             AND type='alert' AND message LIKE $4 AND created_at > date_trunc('month', NOW())
                         )`,
                        ['SMS Quota Exceeded: ' + t.code,
                         `Tenant ${t.name || t.code} has reached its monthly SMS limit (${used}/${maxSMS}). Upgrade package to continue.`,
                         c.tenant_id, `%${used}/${maxSMS}%`]
                    ).catch(() => {});
                    return res.status(402).json({ success: false, error: 'Monthly SMS limit reached', code: 'TENANT_QUOTA_EXCEEDED', tenant: t.code, used, limit: maxSMS });
                }

                // 80% WARNING notification
                if (maxSMS > 0 && used >= maxSMS * 0.8 && used < maxSMS) {
                    await pool.query(
                        `INSERT INTO notifications (title, message, type, entity_type, entity_id, is_read, created_at)
                         SELECT $1, $2, 'warning', 'tenant', $3, false, NOW()
                         WHERE NOT EXISTS (
                           SELECT 1 FROM notifications WHERE entity_type='tenant' AND entity_id=$3
                             AND type='warning' AND message LIKE $4 AND created_at > date_trunc('month', NOW())
                         )`,
                        ['SMS Quota 80%: ' + t.code,
                         `Tenant ${t.name || t.code} has used ${used}/${maxSMS} SMS (${Math.round(used/maxSMS*100)}%). Consider upgrading.`,
                         c.tenant_id, `%${Math.round(used/maxSMS*100)}%%`]
                    ).catch(() => {});
                }
            }
        }

        // 2. Fast route resolution (must come BEFORE rate lookup — route.mcc/route.mnc needed)
        const route = await resolveRoute(c, destination);
        if (!route.supplier_id) {
            sendDbg('[SMS-SEND] ❌ GATE 2/7: ROUTE — No active supplier found for ' + c.client_code + ' → ' + destination);
            const rejId = genNumericMsgId('2'); // REJECTED: pure numeric ID
            await pool.query(
                `INSERT INTO sms_logs (message_id, client_id, client_code, destination, sender_id, message, status, error_code, error_message, source, submit_time, original_sender_id, original_message, original_destination)
                 VALUES ($1,$2,$3,$4,$5,$6,'failed',$7,$8,$9,NOW(),$10,$11,$12)`,
                [rejId, client_id, c.client_code, destination, sender_id || '', message, 'NO_SUPPLIER', 'No active supplier found', customSource || 'external_api', sender_id || '', message, destination]
            ).catch(() => {});
            return res.status(400).json({ success: false, error: 'No active supplier found', code: 'NO_SUPPLIER' });
        }
        sendDbg('[SMS-SEND] ✅ GATE 2/7: ROUTE — supplier=' + route.supplier_code + ' mcc=' + (route.mcc || '?') + ' mnc=' + (route.mnc || '?') + ' rate=€' + (route.supplier_rate || 0));

        // 3. Get and validate client rate — MNC-aware: exact MNC > wildcard > MCC-only, lowest first
        const clientRateR = await pool.query(
            `SELECT rate FROM rates WHERE entity_type='client' AND entity_id=$1
             AND (mcc = $2 OR mcc = '*') AND is_active=true
             ORDER BY CASE WHEN mnc = $3 THEN 0 WHEN mnc = '*' THEN 1 ELSE 2 END, rate ASC LIMIT 1`,
            [client_id, route.mcc || null, route.mnc || null]
        );
        const clientRate = clientRateR.rows.length ? parseFloat(clientRateR.rows[0].rate) : null;
        if (!clientRate || clientRate <= 0) {
            sendDbg('[SMS-SEND] ❌ GATE 3/7: CLIENT_RATE — No rate for client=' + c.client_code + ' mcc=' + (route.mcc || '?') + ' mnc=' + (route.mnc || '?'));
            const rejId = genNumericMsgId('2'); // REJECTED: pure numeric ID
            await pool.query(
                `INSERT INTO sms_logs (message_id, client_id, client_code, destination, sender_id, message, status, error_code, error_message, source, submit_time, original_sender_id, original_message, original_destination)
                 VALUES ($1,$2,$3,$4,$5,$6,'failed',$7,$8,$9,NOW(),$10,$11,$12)`,
                [rejId, client_id, c.client_code, destination, sender_id || '', message, 'NO_RATE', 'Client rate not found', customSource || 'external_api', sender_id || '', message, destination]
            ).catch(() => {});
            return res.status(400).json({ success: false, error: 'Client rate not found', code: 'NO_RATE' });
        }
        sendDbg('[SMS-SEND] ✅ GATE 3/7: CLIENT_RATE — €' + clientRate);

        // 4. Validate supplier rate
        if (!(route.supplier_rate > 0)) {
            sendDbg('[SMS-SEND] ❌ GATE 4/7: SUPPLIER_RATE — No rate for supplier=' + route.supplier_code + ' mcc=' + (route.mcc || '?') + ' mnc=' + (route.mnc || '?'));
            const rejId = genNumericMsgId('2'); // REJECTED: pure numeric ID
            await pool.query(
                `INSERT INTO sms_logs (message_id, client_id, client_code, supplier_id, supplier_code, destination, sender_id, message, status, error_code, error_message, source, submit_time, original_sender_id, original_message, original_destination)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'failed',$9,$10,$11,NOW(),$12,$13,$14)`,
                [rejId, client_id, c.client_code, route.supplier_id, route.supplier_code, destination, sender_id || '', message, 'NO_SUPPLIER_RATE', 'Supplier rate not found', customSource || 'external_api', sender_id || '', message, destination]
            ).catch(() => {});
            return res.status(400).json({ success: false, error: 'Supplier rate not found', code: 'NO_SUPPLIER_RATE' });
        }
        sendDbg('[SMS-SEND] ✅ GATE 4/7: SUPPLIER_RATE — €' + route.supplier_rate);

        // 5. Profit check
        const parts = calculateMessageParts(message);
        const profit = parseFloat((clientRate - route.supplier_rate).toFixed(6));
        if (profit <= 0) {
            sendDbg('[SMS-SEND] ❌ GATE 5/7: PROFIT — client=€' + clientRate + ' supplier=€' + route.supplier_rate + ' profit=€' + profit + ' (BLOCKED)');
            const rejId = genNumericMsgId('2'); // REJECTED: pure numeric ID
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
        sendDbg('[SMS-SEND] ✅ GATE 5/7: PROFIT — client=€' + clientRate + ' supplier=€' + route.supplier_rate + ' profit=€' + profit + ' (OK)');

        // 6. Balance + Credit check (ALL billing modes)
        const cost = parseFloat((clientRate * parts).toFixed(6));
        let balance = parseFloat(c.balance || 0);
        let credit = parseFloat(c.credit_limit || 0);
        const available = balance + credit;

        if (available <= 0 || available < cost) {
            sendDbg('[SMS-SEND] ❌ GATE 6/7: BALANCE — available=€' + available + ' needed=€' + cost + ' (INSUFFICIENT)');
            const rejId = genNumericMsgId('2'); // REJECTED: pure numeric ID
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
        sendDbg('[SMS-SEND] ✅ GATE 6/7: BALANCE — available=€' + available + ' needed=€' + cost + ' (SUFFICIENT)');

        // 7. Submit-mode billing via unified applyBilling helper.
        // Charges client AND/OR supplier immediately if their billing_mode='submit'.
        // DLR-mode parties are deferred to DLR confirmation (charged on DELIVRD).
        sendDbg('[SMS-SEND] 💳 BILLING: client mode=' + (c.billing_mode || 'dlr') + ' supplier mode=' + (route.supplier_billing_mode || 'dlr'));
        const clientBillingMode = c.billing_mode || 'dlr';
        const supplierBillingMode = route.supplier_billing_mode || 'dlr';
        const clientSubmitCost = parseFloat((clientRate * parts).toFixed(6));
        const supplierSubmitCost = parseFloat((route.supplier_rate * parts).toFixed(6));
        // Billing will be applied AFTER enqueue so sms_logs row exists with billing_mode_snapshots
        // Store for deferred billing call (includes force_dlr flags + timeout for auto-DLR)
        const billingContext = {
            clientBillingMode, supplierBillingMode,
            clientSubmitCost, supplierSubmitCost,
            client_id, supplier_id: route.supplier_id,
            clientForceDlr: c.force_dlr || false,
            supplierForceDlr: route.supplier_force_dlr || false,
            clientForceDlrTimeout: parseInt(c.force_dlr_timeout) || 0,
            supplierForceDlrTimeout: route.supplier_force_dlr_timeout || 0
        };

        // 6. Generate message_id and enqueue for async processing
        const isInternal = INTERNAL_SOURCES.includes(customSource || '');
        const msgId = genNumericMsgId(isInternal ? '1' : '0'); // prefix=1 for internal, 0 for external

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

        // Check OTP extract translation blocking: Voice OTP suppliers require numeric codes.
        // Text-only messages like "Browser verify test" are rejected before routing.
        // Only block for Voice OTP suppliers — standard SMS suppliers don't need OTP extraction.
        if (translated.blocked) {
            const isVoiceOtpSupplier = route.supplier_id
                ? (await pool.query('SELECT connection_type FROM suppliers WHERE id=$1', [route.supplier_id])).rows[0]?.connection_type === 'voice_otp'
                : false;
            if (isVoiceOtpSupplier) {
                await pool.query(
                    `INSERT INTO sms_logs (message_id, client_id, client_code, supplier_id, supplier_code, destination, sender_id, message, status, error_code, error_message, source, submit_time, original_sender_id, original_message, original_destination)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'rejected',$9,$10,$11,NOW(),$12,$13,$14)`,
                    [msgId, client_id, c.client_code, route.supplier_id, route.supplier_code, destination, sender_id || '', message, 'OTP_EXTRACT_FAILED', translated.block_reason || 'No numeric OTP code found', customSource || 'external_api', origSenderId || '', origMessage, origDestination]
                ).catch(() => {});
                // DLR push for failed OTP extract
                if (queueManager && queueManager.onDlr) {
                    queueManager.onDlr({
                        client_id, message_id: msgId, destination,
                        sender_id: sender_id || '', status: 'REJECTED',
                        client_code: c.client_code || '', queued_at: new Date().toISOString(),
                        source: customSource || 'external_api'
                    }).catch(() => {});
                }
                return res.status(403).json({ error: 'OTP extraction failed', reason: translated.block_reason, message_id: msgId });
            }
            // Non-Voice-OTP supplier: OTP extract failed but that's OK — just log and continue
            console.error(`[SMS-SEND] ⚠ ${msgId}: OTP extract failed but supplier is not voice_otp — ignoring block_reason=${translated.block_reason}`);
        }

        // Check blocking rules (DND, keyword blacklist/whitelist, URL block)
        const blockCheck = await checkTranslationsBlock(c.id, route.supplier_id, destination, message);
        if (blockCheck) {
            await pool.query(
                `INSERT INTO sms_logs (message_id, client_id, client_code, supplier_id, supplier_code, destination, sender_id, message, status, error_code, error_message, source, submit_time, original_sender_id, original_message, original_destination)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'rejected',$9,$10,$11,NOW(),$12,$13,$14)`,
                [msgId, client_id, c.client_code, route.supplier_id, route.supplier_code, destination, sender_id || '', message, 'BLOCKED', blockCheck.reason, customSource || 'external_api', origSenderId || '', origMessage, origDestination]
            ).catch(() => {});
            // DLR push for blocked messages (immediate feedback to external client)
            if (queueManager && queueManager.onDlr) {
                queueManager.onDlr({
                    client_id, message_id: msgId, destination,
                    sender_id: sender_id || '', status: 'REJECTED',
                    client_code: c.client_code || '', queued_at: new Date().toISOString(),
                    source: customSource || 'external_api'
                }).catch(() => {});
            }
            return res.status(403).json({ error: 'Message blocked', reason: blockCheck.reason, message_id: msgId });
        }

        // Enqueue to async queue manager AND insert into sms_logs immediately
        // so the log appears in SMS Logs page right away (not just after worker processing).
        // The queue worker will UPDATE this row on delivery/DLR.
        const logInsert = await pool.query(
            `INSERT INTO sms_logs (message_id, client_id, client_code, sender_id, destination, message, message_parts,
             client_rate, supplier_rate, profit, currency, status, dlr_status, submit_time,
             supplier_id, supplier_code, route_name, trunk_name, mcc, mnc, operator, country,
             original_sender_id, original_message, original_destination,
             billing_mode_snapshot, supplier_billing_mode_snapshot, source)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'submitted','PENDING',NOW(),$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25)
             RETURNING id`,
            [msgId, client_id, c.client_code, translated.sender_id, translated.destination, translated.message, parts,
             clientRate, route.supplier_rate, profit, c.currency || 'EUR',
             route.supplier_id, route.supplier_code, route.route_name, route.trunk_name, route.mcc, route.mnc, route.operator || '', route.country || '',
             origSenderId, origMessage, origDestination,
             c.billing_mode || 'dlr', route.supplier_billing_mode || 'dlr', customSource || 'external_api']
        );

        if (queueManager) {
            sendDbg('[SMS-SEND] ✅ GATE 7/7: ENQUEUED — msgId=' + msgId + ' → supplier=' + route.supplier_code + ' profit=€' + profit + (rateLimited ? ' (RATE-LIMITED)' : ''));
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
                supplier_billing_mode: route.supplier_billing_mode || 'dlr',
                webhook_url: c.webhook_url || '',
                idempotency_key: idempotency_key || null,
                source: customSource || 'external_api',
            });
        } else {
            // Fallback: queue not ready, but log is already inserted above
            console.error('[SMS-SEND] ⚠ Queue manager not available — sms_logs inserted but not enqueued: ' + msgId);
        }

        // 8. Apply submit-mode billing (after sms_logs insert + enqueue so row exists).
        // Force DLR entries bypass the billing_mode gate — they always charge immediately.
        const hasSubmitBilling = billingContext.clientBillingMode === 'submit'
                             || billingContext.supplierBillingMode === 'submit'
                             || billingContext.clientForceDlr
                             || billingContext.supplierForceDlr;
        console.error('[DIAG] hasSubmitBilling=%s clientMode=%s suppMode=%s clientFD=%s suppFD=%s',
            hasSubmitBilling, billingContext.clientBillingMode, billingContext.supplierBillingMode,
            billingContext.clientForceDlr, billingContext.supplierForceDlr);
        if (hasSubmitBilling) {
            await applyBilling({
                messageId: msgId,
                clientId: billingContext.client_id,
                supplierId: billingContext.supplier_id,
                clientCost: billingContext.clientSubmitCost,
                supplierCost: billingContext.supplierSubmitCost,
                clientBillingMode: billingContext.clientBillingMode,
                supplierBillingMode: billingContext.supplierBillingMode,
                clientForceDlr: billingContext.clientForceDlr,
                supplierForceDlr: billingContext.supplierForceDlr,
                isSubmit: true
            });
        }

        // 9. Auto-DLR: if force_dlr is enabled, schedule a fake DELIVRD after force_dlr_timeout seconds.
        //    timeout=0 means instant (setImmediate). Charges immediately regardless of billing_mode.
        if (billingContext.clientForceDlr || billingContext.supplierForceDlr) {
            const timeoutSec = Math.max(
                billingContext.clientForceDlr ? billingContext.clientForceDlrTimeout : 0,
                billingContext.supplierForceDlr ? billingContext.supplierForceDlrTimeout : 0
            );
            const scheduleDlr = async () => {
                try {
                    await pool.query(
                        `UPDATE sms_logs SET dlr_status = 'DELIVRD', status = 'delivered', delivery_time = NOW(), dlr_timestamp = NOW(), is_force_dlr = true WHERE message_id = $1 AND dlr_status = 'PENDING'`,
                        [msgId]
                    );
                    await pool.query(
                        `UPDATE sms_outbox SET dlr_status = 'DELIVRD', status = 'delivered', dlr_confirmed_at = NOW(), completed_at = NOW() WHERE message_id = $1 AND dlr_status = 'PENDING'`,
                        [msgId]
                    ).catch(() => {});
                    console.error(`[FORCE-DLR] ⚡ ${msgId}: Auto-DLR set to DELIVRD after ${timeoutSec}s (force_dlr override, client=${billingContext.clientForceDlr}, supplier=${billingContext.supplierForceDlr})`);
                } catch (e) { /* best-effort */ }
            };
            if (timeoutSec <= 0) {
                setTimeout(scheduleDlr, 0);
            } else {
                setTimeout(scheduleDlr, timeoutSec * 1000);
            }
        }

        // 10. Instant response — message is queued, not yet delivered
        const logId = logInsert?.rows?.[0]?.id;
        res.json({
            success: true,
            data: {
                id: logId,
                message_id: msgId,
                status: 'queued',
                destination,
                parts,
                client_rate: clientRate,
                profit,
                billing_mode: c.billing_mode,
                route_name: route.route_name,
                trunk_name: route.trunk_name,
                supplier_code: route.supplier_code,
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
        req.body.source = req.body.source || 'external_api';
        // Generate short-lived internal JWT to call the main send endpoint (which requires auth)
        const internalToken = jwt.sign({ id: 1, username: 'system', role: 'super_admin' }, JWT_SECRET, { expiresIn: '30s' });
        const response = await fetch(`http://127.0.0.1:${PORT}/api/sms/send`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${internalToken}`,
            },
            body: JSON.stringify(req.body),
        });
        const result = await response.json();
        res.status(response.status).json(result);
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
        // Portal user scoping: client sees only own, supplier sees only own
        if (req.user.client_id) { q += ` AND client_id = $${i++}`; p.push(req.user.client_id); }
        if (req.user.supplier_id) { q += ` AND supplier_id = $${i++}`; p.push(req.user.supplier_id); }
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
    // Forward to the full /api/sms/send pipeline so test messages actually:
    // 1) pass all 7 validation gates (auth, route, rate, profit, balance),
    // 2) get enqueued to sms_outbox with connector_transaction_id,
    // 3) get submitted to the supplier via HTTP/SMPP connector, and
    // 4) get polled for DLR every 5s (up to 3 min timeout).
    //
    // Previously this endpoint only INSERT-ed into sms_logs with status='sent'
    // and never actually called the supplier — zero DLR, zero delivery.
    try {
        const authHeader = req.headers.authorization || '';
        const response = await fetch(`http://127.0.0.1:${PORT}/api/sms/send`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': authHeader,
            },
            body: JSON.stringify({
                ...req.body,
                source: 'test_sms',  // tag so sms_logs.source shows test_sms
                idempotency_key: `TEST_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`,
            }),
            signal: AbortSignal.timeout(30000),
        });
        const data = await response.json();
        res.status(response.status).json(data);
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
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
        const tps = queueManager ? queueManager.getCurrentTps() : { enqueue: 0, process: 0, deliver: 0 };
        
        // DB pool utilization
        const poolStats = {
            total: pool.totalCount,
            idle: pool.idleCount,
            waiting: pool.waitingCount,
        };
        
        res.json({ success: true, data: { 
            queue: stats, 
            rateLimiter: rlStats, 
            pipelines: pipelineStatus,
            tps,
            pool: poolStats,
            memory: {
                heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
                heapTotalMB: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
                rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
            }
        }});
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== TPS BENCHMARK ====================
// Tests how many messages per second the system can handle end-to-end.
// Fires N messages at the queue and reports actual throughput.
app.post('/api/queue/tps-benchmark', auth, async (req, res) => {
    try {
        const { duration_sec = 5, batch_size = 100, concurrent = 1 } = req.body;
        if (!queueManager) return res.status(503).json({ error: 'Queue manager not ready' });
        
        const startTime = Date.now();
        const endTime = startTime + (duration_sec * 1000);
        let enqueued = 0;
        let failed = 0;
        const results = [];
        
        const sendBatch = async () => {
            for (let i = 0; i < batch_size; i++) {
                const msgId = genNumericMsgId('9') + Date.now() + '_' + i;
                const job = {
                    message_id: msgId,
                    client_id: 1,
                    client_code: 'BENCHMARK',
                    sender_id: 'BENCHMARK',
                    destination: '1234567890',
                    message: 'benchmark test',
                    message_parts: calculateMessageParts('benchmark test'),
                    source: 'benchmark',
                };
                const r = queueManager.enqueueBuffered
                    ? queueManager.enqueueBuffered(job)
                    : await queueManager.enqueue(job);
                if (r && r.status !== 'rejected') enqueued++;
                else failed++;
            }
        };
        
        // Run benchmark
        let batches = 0;
        while (Date.now() < endTime) {
            const batchPromises = [];
            for (let c = 0; c < concurrent; c++) {
                batchPromises.push(sendBatch());
            }
            await Promise.all(batchPromises);
            batches++;
        }
        
        const elapsedMs = Date.now() - startTime;
        const elapsedSec = elapsedMs / 1000;
        const tpsAchieved = Math.round(enqueued / elapsedSec);
        
        // Clean up benchmark messages
        await pool.query(
            `DELETE FROM sms_outbox WHERE source = 'benchmark' AND queued_at > NOW() - INTERVAL '1 minute'`
        ).catch(() => {});
        
        res.json({
            success: true,
            data: {
                duration_sec: Math.round(elapsedSec * 10) / 10,
                total_enqueued: enqueued,
                total_failed: failed,
                batches: batches,
                tps_enqueue: tpsAchieved,
                concurrent_batches: concurrent,
                batch_size,
            }
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ==================== DASHBOARD PROFIT WIDGET ====================
// Returns today's revenue, cost, and profit per client for the real-time profit widget.
app.get('/api/dashboard/profit', auth, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                COALESCE(c.id, sl.client_id) as client_id,
                COALESCE(c.client_code, 'unknown') as client_code,
                COALESCE(c.company_name, 'Unknown') as company_name,
                COUNT(*) as total_sms,
                SUM(CASE WHEN sl.is_billed = true THEN 1 ELSE 0 END) as billed_sms,
                SUM(CASE WHEN sl.status = 'delivered' THEN 1 ELSE 0 END) as delivered,
                SUM(CASE WHEN sl.status = 'failed' THEN 1 ELSE 0 END) as failed,
                ROUND(SUM(CASE WHEN sl.is_billed = true THEN sl.client_rate * sl.message_parts ELSE 0 END)::numeric, 4) as revenue,
                ROUND(SUM(CASE WHEN sl.dlr_status = 'DELIVRD' THEN sl.supplier_rate * sl.message_parts ELSE 0 END)::numeric, 4) as cost,
                ROUND(SUM(CASE WHEN sl.is_billed = true THEN sl.profit ELSE 0 END)::numeric, 4) as profit
            FROM sms_logs sl
            LEFT JOIN clients c ON c.id = sl.client_id
            WHERE sl.submit_time::date = CURRENT_DATE
              AND sl.client_id IS NOT NULL
            GROUP BY COALESCE(c.id, sl.client_id), COALESCE(c.client_code, 'unknown'), COALESCE(c.company_name, 'Unknown')
            ORDER BY profit DESC
        `);

        const totals = result.rows.reduce((acc, r) => ({
            total_sms: acc.total_sms + Number(r.total_sms),
            billed_sms: acc.billed_sms + Number(r.billed_sms),
            delivered: acc.delivered + Number(r.delivered),
            failed: acc.failed + Number(r.failed),
            revenue: acc.revenue + Number(r.revenue),
            cost: acc.cost + Number(r.cost),
            profit: parseFloat((Number(acc.revenue) + Number(r.revenue) - Number(acc.cost) - Number(r.cost)).toFixed(4)),
        }), { total_sms: 0, billed_sms: 0, delivered: 0, failed: 0, revenue: 0, cost: 0, profit: 0 });

        // Tenant quota status — for dashboard alerts
        const tenantsR = await pool.query(
            `SELECT t.id, t.name, t.code, t.status, t.expiry_date,
               COALESCE(t.limits->>'max_sms_monthly','0')::int AS max_sms,
               COALESCE(SUM(COALESCE(sl.message_parts,1)) FILTER (
                 WHERE sl.created_at > date_trunc('month',NOW())), 0)::int AS used
             FROM tenants t
             LEFT JOIN clients c ON c.tenant_id = t.id AND c.status='active'
             LEFT JOIN sms_logs sl ON sl.client_id = c.id
             WHERE t.status = 'active'
             GROUP BY t.id
             HAVING COALESCE(t.limits->>'max_sms_monthly','0')::int > 0
             ORDER BY used DESC`
        ).catch(() => ({ rows: [] }));

        res.json({ success: true, data: { clients: result.rows, totals, tenants: tenantsR.rows } });
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
        let { entity_type, entity_id, period_start, period_end, notes, auto_send } = req.body || {};
        // Portal scoping: auto-resolve entity from authenticated user
        if (req.user.client_id) { entity_type = 'client'; entity_id = req.user.client_id; }
        if (req.user.supplier_id) { entity_type = 'supplier'; entity_id = req.user.supplier_id; }
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
                SUM(CASE WHEN is_billed = true THEN ${rateCol} * message_parts ELSE 0 END) as total_amount,
                SUM(CASE WHEN dlr_status = 'DELIVRD' THEN supplier_rate * message_parts ELSE 0 END) as supplier_cost,
                SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) as delivered_sms,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_sms,
                SUM(CASE WHEN is_billed = true AND billing_mode_snapshot = 'submit' THEN ${rateCol} * message_parts ELSE 0 END) as submit_charge,
                SUM(CASE WHEN is_billed = true AND (billing_mode_snapshot IS NULL OR billing_mode_snapshot = 'dlr') THEN ${rateCol} * message_parts ELSE 0 END) as dlr_charge
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
        const supplierCost = parseFloat(agg.supplier_cost) || 0;
        const deliveredSms = parseInt(agg.delivered_sms) || 0;
        const failedSms = parseInt(agg.failed_sms) || 0;
        const submitCharge = parseFloat(agg.submit_charge) || 0;
        const dlrCharge = parseFloat(agg.dlr_charge) || 0;
        // Net profit for invoice: revenue (totalAmount) minus supplier cost on DELIVRD
        const netProfit = parseFloat((totalAmount - supplierCost).toFixed(4));
        const billingSummary = `Submit-mode: €${submitCharge.toFixed(4)} | DLR-mode: €${dlrCharge.toFixed(4)} | Total billed: €${totalAmount.toFixed(4)}`;

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

        // Create invoice with real data including delivery breakdown and billing mode summary
        const invR = await pool.query(
            `INSERT INTO invoices (invoice_number, entity_type, entity_id, entity_name,
             invoice_to_name, invoice_to_email,
             invoice_by_name, invoice_by_email,
             period_start, period_end, total_sms, delivered_sms, failed_sms,
             total_amount, submit_charge, dlr_charge, tax_amount, tax_rate, grand_total,
             currency, status, due_date, notes, billing_mode_summary, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,'NET2APP Hub','billing@net2app.com',$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,NOW()) RETURNING *`,
            [invNum, entity_type, entity_id, entityName,
             entityName, entityEmail,
             period_start, period_end,
             totalSms, deliveredSms, failedSms,
             totalAmount, submitCharge, dlrCharge, taxAmount, taxRate, grandTotal,
             entity.currency || 'EUR', 'draft', dueDate, notes || 'Auto-generated from SMS logs', billingSummary]
        );

        res.json({
            success: true,
            data: invR.rows[0],
            summary: {
                total_sms: totalSms,
                delivered: deliveredSms,
                failed: failedSms,
                total_amount: totalAmount,
                supplier_cost: supplierCost,
                net_profit: netProfit,
                submit_charge: submitCharge,
                dlr_charge: dlrCharge,
                tax_amount: taxAmount,
                grand_total: grandTotal,
                billing_mode_summary: billingSummary,
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
        let q = 'SELECT * FROM invoices WHERE 1=1';
        const p = []; let i = 1;
        // Portal scoping: client sees own, supplier sees own
        if (req.user.client_id) { q += ` AND entity_type = 'client' AND entity_id = $${i++}`; p.push(req.user.client_id); }
        if (req.user.supplier_id) { q += ` AND entity_type = 'supplier' AND entity_id = $${i++}`; p.push(req.user.supplier_id); }
        if (include_deleted !== 'true') {
            q += ' AND (is_deleted IS NULL OR is_deleted = false)';
        }
        q += ' ORDER BY id DESC LIMIT 500';
        const result = await pool.query(q, p);
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

// ==================== INVOICE PDF DOWNLOAD ====================
// Generates a downloadable HTML invoice rendered as PDF-like page.
// Portal users can only download their own invoices.
app.get('/api/invoices/:id/pdf', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM invoices WHERE id = $1 AND (is_deleted IS NULL OR is_deleted = false)', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Invoice not found' });
        const inv = result.rows[0];
        // Portal scoping
        if (req.user.client_id && (inv.entity_type !== 'client' || inv.entity_id !== req.user.client_id)) {
            return res.status(403).json({ error: 'Access denied' });
        }
        if (req.user.supplier_id && (inv.entity_type !== 'supplier' || inv.entity_id !== req.user.supplier_id)) {
            return res.status(403).json({ error: 'Access denied' });
        }
        // Get destination breakdown from sms_logs
        const breakdown = await pool.query(
            `SELECT destination, COUNT(*) as sms_count,
                    AVG(${inv.entity_type === 'client' ? 'client_rate' : 'supplier_rate'}) as avg_rate,
                    SUM(${inv.entity_type === 'client' ? 'client_rate' : 'supplier_rate'} * message_parts) as total_amount
             FROM sms_logs
             WHERE ${inv.entity_type}_id = $1
               AND submit_time >= $2 AND submit_time <= ($3::date + INTERVAL '1 day')
               AND (is_deleted IS NULL OR is_deleted = false)
             GROUP BY destination ORDER BY total_amount DESC LIMIT 20`,
            [inv.entity_id, inv.period_start, inv.period_end]
        );
        const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${inv.invoice_number}</title>
<style>
  body { font-family: Arial, sans-serif; max-width: 800px; margin: 40px auto; color: #1f2937; }
  .header { display: flex; justify-content: space-between; border-bottom: 2px solid #3b82f6; padding-bottom: 20px; margin-bottom: 30px; }
  .header h1 { font-size: 32px; color: #3b82f6; margin: 0; }
  .header .inv-num { font-size: 18px; color: #6b7280; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; }
  .meta .box { background: #f9fafb; padding: 16px; border-radius: 8px; }
  .meta .box h3 { font-size: 11px; text-transform: uppercase; color: #6b7280; margin: 0 0 8px; }
  .dates { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 30px; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 30px; }
  th { background: #f3f4f6; padding: 10px 12px; text-align: left; font-size: 12px; text-transform: uppercase; color: #6b7280; }
  td { padding: 10px 12px; border-bottom: 1px solid #e5e7eb; font-size: 14px; }
  td.right { text-align: right; }
  .totals { margin-left: auto; width: 300px; }
  .totals div { display: flex; justify-content: space-between; padding: 6px 0; font-size: 14px; }
  .totals hr { border: none; border-top: 1px solid #d1d5db; margin: 8px 0; }
  .totals .grand { font-size: 20px; font-weight: bold; }
  .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af; }
  @media print { body { margin: 0; } .no-print { display: none; } }
</style></head><body>
<div class="header">
  <div><h1>📡 NET2APP Hub</h1><p style="margin:4px 0;color:#6b7280">Enterprise SMS Platform</p></div>
  <div style="text-align:right"><h1>INVOICE</h1><p class="inv-num">${inv.invoice_number}</p></div>
</div>
<div class="meta">
  <div class="box"><h3>Invoice To</h3><p style="font-weight:600;margin:0">${inv.entity_name}</p><p style="margin:4px 0;color:#6b7280">${inv.entity_type}</p></div>
  <div class="box"><h3>Invoice By</h3><p style="font-weight:600;margin:0">NET2APP Hub</p><p style="margin:4px 0;color:#6b7280">Platform Provider</p></div>
</div>
<div class="dates">
  <div><strong>Invoice Date</strong><br>${new Date(inv.created_at).toLocaleDateString()}</div>
  <div><strong>Period Start</strong><br>${new Date(inv.period_start).toLocaleDateString()}</div>
  <div><strong>Period End</strong><br>${new Date(inv.period_end).toLocaleDateString()}</div>
  <div><strong>Due Date</strong><br>${new Date(inv.due_date).toLocaleDateString()}</div>
</div>
<table>
  <thead><tr><th>Destination</th><th class="right">SMS Count</th><th class="right">Avg Rate</th><th class="right">Amount</th></tr></thead>
  <tbody>${breakdown.rows.map(r => `<tr><td>${r.destination}</td><td class="right">${parseInt(r.sms_count).toLocaleString()}</td><td class="right">€${Number(r.avg_rate).toFixed(4)}</td><td class="right">€${Number(r.total_amount).toFixed(2)}</td></tr>`).join('')}</tbody>
</table>
<div class="totals">
  <div><span>Subtotal</span><span>€${Number(inv.total_amount).toLocaleString()}</span></div>
  <div><span>Tax (${inv.tax_rate || 0}%)</span><span>€${Number(inv.tax_amount).toLocaleString()}</span></div>
  <hr><div class="grand"><span>Total</span><span>€${Number(inv.grand_total).toLocaleString()}</span></div>
</div>
${inv.notes ? `<p style="margin-top:20px;font-size:13px;color:#6b7280"><strong>Notes:</strong> ${inv.notes}</p>` : ''}
<div class="footer">NET2APP Hub • Enterprise SMS Platform • ${new Date().getFullYear()}</div>
<p class="no-print" style="text-align:center;margin-top:20px"><button onclick="window.print()" style="padding:10px 24px;background:#3b82f6;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px">🖨 Print / Save PDF</button></p>
</body></html>`;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Disposition', `inline; filename="${inv.invoice_number}.html"`);
        res.send(html);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Billing invoice list (frontend-friendly with filters)
app.post('/api/billing/invoices/list', auth, async (req, res) => {
    try {
        const f = req.body || {};
        const pageLimit = Math.min(parseInt(f.limit) || 50, 500);
        const pageOffset = parseInt(f.offset) || 0;
        let q = 'SELECT * FROM invoices WHERE 1=1';
        const p = []; let i = 1;
        // Portal scoping
        if (req.user.client_id) { q += ` AND entity_type = 'client' AND entity_id = $${i++}`; p.push(req.user.client_id); }
        if (req.user.supplier_id) { q += ` AND entity_type = 'supplier' AND entity_id = $${i++}`; p.push(req.user.supplier_id); }
        if (f.entity_type) { q += ` AND entity_type = $${i++}`; p.push(f.entity_type); }
        if (f.entity_id) { q += ` AND entity_id = $${i++}`; p.push(f.entity_id); }
        if (f.status) { q += ` AND status = $${i++}`; p.push(f.status); }
        if (f.include_deleted !== true) q += ' AND (is_deleted IS NULL OR is_deleted = false)';
        // Count
        const countQ = q.replace('SELECT *', 'SELECT COUNT(*) as total');
        const countR = await pool.query(countQ, p);
        const total = parseInt(countR.rows[0].total);
        // Paginate
        q += ` ORDER BY created_at DESC LIMIT $${i++} OFFSET $${i++}`;
        p.push(pageLimit, pageOffset);
        const result = await pool.query(q, p);
        res.json({ success: true, data: result.rows, total });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== PAYMENTS ====================
app.get('/api/payments', auth, async (req, res) => {
    try {
        const { include_deleted } = req.query;
        let q = 'SELECT * FROM payments WHERE 1=1';
        const p = []; let i = 1;
        // Portal scoping
        if (req.user.client_id) { q += ` AND entity_type = 'client' AND entity_id = $${i++}`; p.push(req.user.client_id); }
        if (req.user.supplier_id) { q += ` AND entity_type = 'supplier' AND entity_id = $${i++}`; p.push(req.user.supplier_id); }
        if (include_deleted !== 'true') {
            q += ' AND (is_deleted IS NULL OR is_deleted = false)';
        }
        q += ' ORDER BY id DESC LIMIT 500';
        const result = await pool.query(q, p);
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

// Blocking Rules: checks active blocking rules (DND, keyword, URL) against a message.
// Returns {blocked:true, reason} if message should be rejected, or null if it passes.
async function checkTranslationsBlock(clientId, supplierId, destination, message) {
    try {
        const blockR = await pool.query(
            `SELECT * FROM translations WHERE is_active = true 
             AND translation_type IN ('number_blacklist','keyword_blacklist','keyword_whitelist','url_block')
             AND (apply_to = 'both' OR (apply_to = 'client' AND apply_entity_id = $1) OR (apply_to = 'supplier' AND apply_entity_id = $2) OR apply_entity_id = 'all')
             ORDER BY priority ASC`,
            [String(clientId || ''), String(supplierId || '')]
        );
        if (!blockR.rows.length) return null;
        return checkBlocks(blockR.rows, { destination, message, sender_id: '' });
    } catch (e) {
        console.error('[Blocks] Engine error:', e.message);
        return null; // If blocking check fails, allow message through (fail-open)
    }
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
             is_otp_extract, otp_length_min, otp_length_max, otp_strict_mode,
             template_data, sid_match_type, mccmnc_list, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
                     $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,NOW()) RETURNING *`,
            [b.translation_type, b.source_pattern || '', b.target_value || '',
             b.client_id || null, b.supplier_id || null, b.route_id || null, b.mcc || null, b.mnc || null,
             b.name || '', b.description || '', b.subtype || '', b.priority || 1, b.apply_to || 'client', b.apply_entity_id || 'all', b.is_active !== false,
             b.strip_prefix_digits || 0, b.add_prefix_text || '', b.match_content || '', b.replace_content || '',
             b.is_otp_extract || false, b.otp_length_min || 4, b.otp_length_max || 8, b.otp_strict_mode !== undefined ? b.otp_strict_mode : true,
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
            'is_otp_extract','otp_length_min','otp_length_max','otp_strict_mode',
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
        number_blacklist: 'name,source_pattern,subtype,priority,is_active,apply_to,apply_entity_id\nBlock 88017*,88017,prefix,1,true,both,all\nBlock exact number,8801712345678,exact,2,true,both,all',
        keyword_blacklist: 'name,match_content,priority,is_active,apply_to,apply_entity_id\nBlock spam words,spam,scam,fraud,1,true,both,all',
        keyword_whitelist: 'name,match_content,priority,is_active,apply_to,apply_entity_id\nOnly OTP messages,code,otp,verification,1,true,both,all',
        url_block: 'name,source_pattern,priority,is_active,apply_to,apply_entity_id\nBlock all URLs,,1,true,both,all',
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
                blocked: translated.blocked || false,
                block_reason: translated.block_reason || null,
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
              greeting_text, retry_text, retry_count, play_count, is_active,
              is_dual_language, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,NOW()) RETURNING *`,
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
                b.retry_count ?? 4,
                b.play_count ?? 1,
                b.is_active !== false,
                b.is_dual_language === true,
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
            'sip_host','sip_port','sip_username','sip_password','caller_id','is_active','sip_e164','audio_codec',
            'retry_count','play_count','is_dual_language'];
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

// POST — ping a SIP server host and return latency, TTL, and packet loss
// Uses OS `ping` command: 4 packets, 2-second timeout
app.post('/api/voice-otp/sip-ping', auth, async (req, res) => {
    try {
        const { host } = req.body || {};
        if (!host) return res.status(400).json({ error: 'host is required' });

        // Sanitize host to prevent command injection
        const safeHost = host.replace(/[^a-zA-Z0-9.\-:]/g, '');
        if (!safeHost || safeHost.length > 255) {
            return res.status(400).json({ error: 'Invalid host' });
        }

        const result = await new Promise((resolve) => {
            execFile('ping', ['-c', '4', '-W', '2', safeHost], { timeout: 12000 }, (err, stdout, stderr) => {
                if (err && !stdout) {
                    // ping failed entirely (host unreachable, no route, etc.)
                    resolve({
                        host: safeHost,
                        latency_ms: null,
                        min_ms: null,
                        max_ms: null,
                        ttl: null,
                        packets_sent: 4,
                        packets_received: 0,
                        packet_loss_pct: 100,
                        alive: false,
                        error: err.message || 'Ping failed',
                    });
                    return;
                }

                const output = stdout || '';

                // Parse ping statistics
                // Linux ping output format:
                // 4 packets transmitted, 4 received, 0% packet loss, time 3003ms
                // rtt min/avg/max/mdev = 10.123/15.456/20.789/3.456 ms
                let packetsSent = 4, packetsReceived = 0, lossPct = 100;
                let minMs = null, avgMs = null, maxMs = null, ttl = null;

                const txMatch = output.match(/(\d+)\s+packets?\s+transmitted/i);
                const rxMatch = output.match(/(\d+)\s+(packets?\s+)?received/i);
                const lossMatch = output.match(/(\d+(?:\.\d+)?)%\s+packet\s+loss/i);
                const rttMatch = output.match(/rtt\s+min\/avg\/max\/mdev\s*=\s*([\d.]+)\/([\d.]+)\/([\d.]+)\/([\d.]+)\s*ms/i);
                const ttlMatch = output.match(/ttl=(\d+)/i);

                if (txMatch) packetsSent = parseInt(txMatch[1]);
                if (rxMatch) packetsReceived = parseInt(rxMatch[1]);
                if (lossMatch) lossPct = parseFloat(lossMatch[1]);
                if (rttMatch) {
                    minMs = parseFloat(rttMatch[1]);
                    avgMs = parseFloat(rttMatch[2]);
                    maxMs = parseFloat(rttMatch[3]);
                }
                if (ttlMatch) ttl = parseInt(ttlMatch[1]);

                resolve({
                    host: safeHost,
                    latency_ms: avgMs,
                    min_ms: minMs,
                    max_ms: maxMs,
                    ttl,
                    packets_sent: packetsSent,
                    packets_received: packetsReceived,
                    packet_loss_pct: lossPct,
                    alive: packetsReceived > 0,
                });
            });
        });

        res.json({ success: true, data: result });
    } catch (e) { res.status(500).json({ error: e.message }); }
});


// Send Voice OTP — initiate SIP call via Asterisk bridge
// Shared Voice OTP send logic — used by both /api/voice-otp/send and /api/voice-otp/test.
// Extracted into a named function to eliminate all forwarding/HTTP-hop issues.
async function handleVoiceOtpSend(req, res) {
    try {
        const { destination, otp_code, config_id, client_id, supplier_id } = req.body;
        if (!destination) return res.status(400).json({ error: 'destination is required' });

        // 1. Look up language config: explicit config_id > supplier's voice_otp_config_id > country prefix > first active
        let config = null;
        let supplierRow = null;
        if (supplier_id) {
            try {
                const sr = await pool.query('SELECT * FROM suppliers WHERE id = $1', [supplier_id]);
                if (sr.rows.length) supplierRow = sr.rows[0];
            } catch (e) { /* non-critical */ }
        }
        if (config_id) {
            const cr = await pool.query('SELECT * FROM voice_otp_configs WHERE id = $1', [config_id]);
            if (cr.rows.length) config = cr.rows[0];
        }
        if (!config && supplierRow && supplierRow.voice_otp_config_id) {
            const cr = await pool.query('SELECT * FROM voice_otp_configs WHERE id = $1 AND is_active = true', [supplierRow.voice_otp_config_id]);
            if (cr.rows.length) config = cr.rows[0];
        }
        if (!config) {
            // Prefix match via the SHARED engine helper (comma-aware, longest match,
            // local-first) — keeps the manual path identical to the queue path.
            // The destination's leading '+' is stripped so '+880...' matches '880'.
            try {
                const voiceEngine = require('./src/services/voiceOtpEngine.cjs');
                if (voiceEngine && typeof voiceEngine.resolveVoiceOtpConfigByPrefix === 'function') {
                    const cleanedDest = String(destination).replace(/^\+/, '');
                    config = await voiceEngine.resolveVoiceOtpConfigByPrefix(pool, cleanedDest);
                }
            } catch (e) {
                console.error('[voice-otp] resolveVoiceOtpConfigByPrefix error:', e.message);
            }
        }
        if (!config) {
            const cr = await pool.query('SELECT * FROM voice_otp_configs WHERE is_active = true ORDER BY id LIMIT 1');
            if (cr.rows.length) config = cr.rows[0];
        }
        if (!config) return res.status(400).json({ error: 'No active voice OTP config found' });

        // 1b. Apply supplier voice_otp_mode overrides (local_1x / local_2x / local_international).
        // Uses the SAME shared helper as executeVoiceOtpPipeline so manual test calls
        // behave exactly like queue-routed calls:
        //   local_1x            → greeting + digits played ONCE (local language)
        //   local_2x            → greeting + digits played TWICE (local language)
        //   local_international → local greeting+digits, then English greeting+digits
        let englishConfig = null;
        // applyVoiceOtpModeOverrides no-ops for null supplier mode + unflagged configs,
        // and resolves the English config for dual-language playback (config flag or
        // supplier local_international mode) — so picking 'Local + International' on
        // the send form plays local + English even without a supplier mode.
        if (config) {
            try {
                const voiceEngine = require('./src/services/voiceOtpEngine.cjs');
                if (voiceEngine && typeof voiceEngine.applyVoiceOtpModeOverrides === 'function') {
                    const modeResult = await voiceEngine.applyVoiceOtpModeOverrides(pool, config, supplierRow);
                    config = modeResult.config;
                    englishConfig = modeResult.englishConfig || null;
                }
            } catch (e) {
                console.error('[voice-otp] applyVoiceOtpModeOverrides error:', e.message);
            }
        }

        // 1.5 Apply translations (OTP extract, number prefix, SID alias, content replace)
        // Voice OTP calls should respect the same translation rules as SMS.
        const origMessage = req.body.message || '';
        const origSenderId = req.body.sender_id || '';
        let translationApplied = false;
        let translationResult = null;
        let translationBlockReason = null;
        try {
            const translated = await applyTranslations(
                client_id || null, supplier_id || null,
                destination, origSenderId, origMessage
            );
            // Check if any translation actually modified the message/sender/destination
            if (translated && (
                translated.message !== origMessage ||
                translated.sender_id !== origSenderId ||
                translated.destination !== destination
            )) {
                translationApplied = true;
                translationResult = translated;
            }
            // Check for OTP extract blocking (strict mode, no numeric code found)
            if (translated && translated.blocked) {
                translationBlockReason = translated.block_reason || 'No numeric OTP code found';
                return res.status(400).json({
                    error: 'OTP_EXTRACT_FAILED',
                    message: translationBlockReason,
                    translation_applied: true,
                    block_reason: translationBlockReason
                });
            }
        } catch (e) {
            console.error('[VoiceOTP] Translation error:', e.message);
        }

        // 2. Extract OTP from message or auto-generate
        // If translation already extracted OTP (message is now just digits), use it.
        let finalOtp = otp_code;
        const messageForOtp = (translationResult && translationResult.message) || origMessage;
        if (!finalOtp && messageForOtp) {
            // If translation extracted the OTP (e.g., message is now just "123456"), use directly
            if (translationApplied && /^\d{4,8}$/.test(String(messageForOtp).trim())) {
                finalOtp = String(messageForOtp).trim();
            } else {
                const m = String(messageForOtp).match(/\b\d{4,8}\b/);
                if (m) finalOtp = m[0];
            }
        }
        if (!finalOtp) {
            finalOtp = String(Math.floor(100000 + Math.random() * 900000));
        }

        // 3. Build call ID and insert log
        const callId = `VOICE_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
        const finalDest = (translationResult && translationResult.destination) || destination;
        const logResult = await pool.query(
            `INSERT INTO voice_otp_logs (call_id, destination, otp_code, extracted_otp, language, status, retry_count, max_retries, client_id, supplier_id, created_at)
             VALUES ($1,$2,$3,$4,$5,'initiated',0,$6,$7,$8,NOW()) RETURNING *`,
            [callId, finalDest, finalOtp, (translationApplied ? finalOtp : null), config.language || 'en', (req.body.max_retries || config.retry_count || 4), client_id || null, supplier_id || null]
        );

        // Also insert into sms_logs so Voice OTP calls appear in the SMS Logs page.
        // Uses the same callId as message_id so DLR updates (below) can find it.
        // Look up supplier, MCC/MNC, operator, and rates so the SMS Log shows full detail.
        let supplierInfo = null, mccInfo = null, clientCode = null, clientRate = null, supplierRate = null;
        try {
            // Look up supplier if provided
            if (supplier_id) {
                const sr = await pool.query(
                    'SELECT id, supplier_code, company_name, connection_type FROM suppliers WHERE id = $1', [supplier_id]
                );
                if (sr.rows.length) supplierInfo = sr.rows[0];
            }
            // Look up client code
            if (client_id) {
                const cc = await pool.query('SELECT client_code FROM clients WHERE id = $1', [client_id]);
                if (cc.rows.length) clientCode = cc.rows[0].client_code;
            }
            // Look up MCC/MNC/Operator/Country from destination
            const destNum = String(destination).replace(/^\+/, '');
            for (let len = 6; len >= 1; len--) {
                const prefix = destNum.substring(0, len);
                const mr = await pool.query(
                    'SELECT mcc, mnc, country, operator FROM mccmnc WHERE calling_code = $1 AND (is_deleted IS NULL OR is_deleted = false) LIMIT 1',
                    [prefix]
                );
                if (mr.rows.length) { mccInfo = mr.rows[0]; break; }
            }
            // Look up client rate for this MCC
            if (client_id && mccInfo) {
                const cr = await pool.query(
                    `SELECT rate FROM rates WHERE entity_type='client' AND entity_id=$1
                     AND (mcc=$2 OR mcc='*') AND is_active=true
                     ORDER BY CASE WHEN mnc=$3 THEN 0 WHEN mnc='*' THEN 1 ELSE 2 END, rate ASC LIMIT 1`,
                    [client_id, mccInfo.mcc, mccInfo.mnc || null]
                );
                if (cr.rows.length) clientRate = parseFloat(cr.rows[0].rate);
            }
            // Look up supplier rate for this MCC
            if (supplier_id && mccInfo) {
                const sr2 = await pool.query(
                    `SELECT rate FROM rates WHERE entity_type='supplier' AND entity_id=$1
                     AND (mcc=$2 OR mcc='*') AND is_active=true
                     ORDER BY CASE WHEN mnc=$3 THEN 0 WHEN mnc='*' THEN 1 ELSE 2 END, rate ASC LIMIT 1`,
                    [supplier_id, mccInfo.mcc, mccInfo.mnc || null]
                );
                if (sr2.rows.length) supplierRate = parseFloat(sr2.rows[0].rate);
            }
        } catch (e) { /* best-effort enrichment */ }
        const profit = (clientRate && supplierRate) ? parseFloat((clientRate - supplierRate).toFixed(6)) : null;
        // Use translated message/sender if translation was applied
        const finalMessage = (translationResult && translationResult.message) || req.body.message || finalOtp;
        const finalSenderId = (translationResult && translationResult.sender_id) || req.body.sender_id || '';
        const smsLogInsert = await pool.query(
            `INSERT INTO sms_logs (message_id, client_id, client_code, supplier_id, supplier_code,
             destination, sender_id, message, status, source, submit_time,
             mcc, mnc, operator, country, client_rate, supplier_rate, profit, currency,
             original_sender_id, original_message, original_destination)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'submitted','voice_otp',NOW(),
                     $9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
            [callId, client_id || null, clientCode,
             supplierInfo?.id || null, supplierInfo?.supplier_code || null,
             finalDest, finalSenderId, finalMessage,
             mccInfo?.mcc || null, mccInfo?.mnc || null,
             mccInfo?.operator || null, mccInfo?.country || null,
             clientRate, supplierRate, profit, 'EUR',
             origSenderId, origMessage, destination]
        ).catch(() => null); // best-effort — don't block call initiation

        // 4. Get SIP settings
        const sipServerR = await pool.query("SELECT value FROM platform_settings WHERE key = 'sip_servers'");
        let sipServers = [];
        if (sipServerR.rows.length && sipServerR.rows[0].value) {
            try { sipServers = typeof sipServerR.rows[0].value === "string" ? JSON.parse(sipServerR.rows[0].value) : sipServerR.rows[0].value; }
            catch { sipServers = []; }
        }
        if (!Array.isArray(sipServers)) sipServers = [];

        let destMcc = "";
        try {
            const destNum = String(destination).replace(/^\+/, "");
            for (let len = 6; len >= 1; len--) {
                const prefix = destNum.substring(0, len);
                const mccR = await pool.query(
                    "SELECT mcc FROM mccmnc WHERE calling_code = $1 AND (is_deleted IS NULL OR is_deleted = false) LIMIT 1",
                    [prefix]
                );
                if (mccR.rows.length) { destMcc = mccR.rows[0].mcc; break; }
            }
        } catch (e) { /* non-critical */ }

        let selectedServer = sipServers.length > 0 ? sipServers[0] : null;
        if (destMcc && sipServers.length > 1) {
            for (const srv of sipServers) {
                const allowed = (srv.mccmnc_allowed || "").split(",").map(s => s.trim()).filter(Boolean);
                if (allowed.includes(destMcc) || allowed.includes(destMcc + '*') || allowed.includes('*')) { selectedServer = srv; break; }
            }
        }

        const sipR = await pool.query(
            "SELECT key, value FROM platform_settings WHERE key IN ('sip_host','sip_port','sip_username','sip_password','sip_caller_id','sip_e164','audio_codec')"
        );
        const sip = {};
        for (const row of sipR.rows) { sip[row.key] = row.value; }

        const sipHost = (selectedServer && selectedServer.host) || sip.sip_host || "127.0.0.1";
        const sipPort = (selectedServer && selectedServer.port) || parseInt(sip.sip_port) || 5060;
        const sipUser = (selectedServer && selectedServer.username) || sip.sip_username || "";
        const sipPass = (selectedServer && selectedServer.password) || sip.sip_password || "";
        // Always random foreign-country ANI per call — carriers may rate-limit fixed caller IDs.
        // Bridge's generateRandomAni picks a different country prefix each time.
        const callerId = '';
        const destPrefix = (selectedServer && selectedServer.destination_prefix) || '';
        // Use translated destination as base, then apply SIP prefix if configured
        const sipDest = (destPrefix || '') + String(finalDest).replace(/^\+/, '');
        if (destPrefix) console.error(`[voice-otp] Prepending prefix ${destPrefix} → ${sipDest}`);

        // 5. Originate SIP call via Asterisk bridge
        // 5a. Overlap protection — never place two calls to the same destination.
        // The engine lock is held until the call completes (released in the
        // .then/.catch handlers below), matching the queue path's no-overlap rule.
        const lockDest = finalDest || destination;
        let preRegisteredCall = null;
        let voiceOtpLockModule = null;
        try {
            voiceOtpLockModule = require('./src/services/voiceOtpEngine.cjs');
            if (voiceOtpLockModule && typeof voiceOtpLockModule.tryRegisterActiveCall === 'function') {
                preRegisteredCall = voiceOtpLockModule.tryRegisterActiveCall(lockDest);
                if (!preRegisteredCall) {
                    console.error(`[voice-otp] 🚫 BLOCKED overlapping call to ${lockDest} (another Voice OTP call is active)`);
                    // Mark the just-created log rows as rejected so they don't stay 'initiated' forever
                    pool.query(`UPDATE voice_otp_logs SET status='failed',dlr_status='REJECTED',error_message='Overlapping call — another Voice OTP call is active for this destination',completed_at=NOW() WHERE call_id=$1`, [callId]).catch(()=>{});
                    pool.query(`UPDATE sms_logs SET dlr_status='REJECTED', status='failed', error='destination_busy_overlapping_call' WHERE message_id=$1`, [callId]).catch(()=>{});
                    return res.status(409).json({ error: 'destination_busy_overlapping_call', message: 'Destination already has an active Voice OTP call — retry after it finishes.' });
                }
            }
        } catch (e) { /* lock is best-effort */ }
        const releaseLock = () => {
            try {
                if (preRegisteredCall && voiceOtpLockModule && typeof voiceOtpLockModule.releaseActiveCall === 'function') {
                    voiceOtpLockModule.releaseActiveCall(lockDest);
                    preRegisteredCall = null;
                }
            } catch (e) { /* best-effort */ }
        };
        try {
            const ac = require('./asterisk-bridge.cjs');
            // Build the COMPLETE audio sequence (greeting + OTP digit clips) from the
            // config's audio_0_9_primary / audio_0_9_secondary / audio_0_9 maps.
            // The bridge needs the flat `audioFiles` array — passing only `digitAudio`
            // (legacy audio_0_9 column, empty on modern configs) made calls play just
            // the ~1s greeting, then BYE → "call drops after 1-2s".
            let audioSeq = null;
            try {
                const voiceEngine = require('./src/services/voiceOtpEngine.cjs');
                if (voiceEngine && typeof voiceEngine.buildAudioSequence === 'function') {
                    audioSeq = voiceEngine.buildAudioSequence(config, finalOtp, config.play_count || 1, false, englishConfig);
                }
            } catch (e) {
                // Do NOT silently fall back to the old greeting-only path — that would
                // reproduce the 1-second-call bug. Fail the request so it's visible.
                console.error('[voice-otp] buildAudioSequence error:', e.message);
                releaseLock();
                return res.status(500).json({ error: 'Failed to build voice OTP audio sequence: ' + e.message });
            }
            const audioFilesList = (audioSeq && Array.isArray(audioSeq.audio) && audioSeq.audio.length > 0) ? audioSeq.audio : null;
            const callOpts = { callId, destination: sipDest, sipHost, sipPort, sipUsername: sipUser, sipPassword: sipPass, callerId: callerId || '', greetingAudio: config.greeting_audio_url || null, digitAudio: config.audio_0_9 || null, audioFiles: audioFilesList || undefined, otpCode: finalOtp, playCount: (audioSeq && audioSeq.repeat) || config.play_count || 1, timeout: (req.body.timeout || 30) * 1000 };
            ac.originateCall(callOpts).then(async (callResult) => {
                releaseLock();
                const finalStatus = callResult.status || 'unknown';
                const finalDlr = callResult.dlr || 'UNKNOWN';
                const finalDuration = callResult.duration || 0;
                const isDelivered = finalDlr === 'DELIVRD';
                await pool.query(`UPDATE voice_otp_logs SET status=$1,dlr_status=$2,duration=$3,completed_at=NOW() WHERE call_id=$4`,
                    [finalStatus, finalDlr, finalDuration, callId]
                ).catch(()=>{});
                // Also update sms_logs with delivery result so it shows in SMS Logs page
                await pool.query(
                    `UPDATE sms_logs SET dlr_status=$1, status=$2, delivery_time=NOW(), dlr_timestamp=NOW()
                     WHERE message_id=$3`,
                    [finalDlr, isDelivered ? 'delivered' : 'failed', callId]
                ).catch(()=>{});

                // ── BILLING: charge client + pay supplier on DELIVRD ──
                if (isDelivered && client_id && clientRate > 0) {
                    try {
                        await applyBilling({
                            messageId: callId,
                            clientId: client_id,
                            supplierId: supplier_id || null,
                            clientCost: clientRate,
                            supplierCost: supplierRate || 0,
                            clientBillingMode: 'dlr',
                            supplierBillingMode: 'dlr',
                            isSubmit: false,
                            dlrStatus: 'DELIVRD'
                        });
                        // Update voice_otp_logs with billing info
                        await pool.query(
                            `UPDATE voice_otp_logs SET total_cost=$1, client_cost=$2, billing_status='billed'
                             WHERE call_id=$3`,
                            [supplierRate || 0, clientRate, callId]
                        ).catch(()=>{});
                        // Update sms_logs with rates if they weren't set earlier
                        await pool.query(
                            `UPDATE sms_logs SET client_rate=$1, supplier_rate=$2, profit=$3
                             WHERE message_id=$4 AND client_rate IS NULL`,
                            [clientRate, supplierRate || 0, profit || 0, callId]
                        ).catch(()=>{});
                        console.error(`[voice-otp] 💰 Billed: ${callId} client=€${clientRate} supplier=€${supplierRate||0} profit=€${profit||0}`);
                    } catch (e) {
                        console.error(`[voice-otp] ⚠ Billing failed for ${callId}: ${e.message}`);
                    }
                }

                // Push DLR to dlr_outbox so SMPP clients (e.g. TriAngle) receive delivery notification
                if (client_id) {
                    try {
                        const clientR = await pool.query('SELECT client_code, webhook_url FROM clients WHERE id=$1', [client_id]);
                        const clientCode = clientR.rows[0]?.client_code || '';
                        const webhookUrl = clientR.rows[0]?.webhook_url || '';
                        const receipt = `id:${callId} sub:001 dlvrd:${finalDlr === 'DELIVRD' ? '001' : '000'} submit date:${new Date().toISOString().slice(0,16).replace(/[-:T]/g,'')} done date:${new Date().toISOString().slice(0,16).replace(/[-:T]/g,'')} stat:${finalDlr} err:000 text:${finalDlr === 'DELIVRD' ? 'Delivery success' : 'Delivery failed'}`;
                        await pool.query(
                            `INSERT INTO dlr_outbox (message_id, entity_type, entity_id, client_id, client_code, destination, sender_id, status, dlr_receipt, submit_time, webhook_url)
                             VALUES ($1,'client',$2,$2,$3,$4,'',$5,$6,NOW(),$7)
                             ON CONFLICT (message_id) DO UPDATE SET status=EXCLUDED.status, dlr_receipt=EXCLUDED.dlr_receipt`,
                            [callId, client_id, clientCode, sipDest, finalDlr, receipt, webhookUrl]
                        );
                        console.error(`[voice-otp] 📝 DLR pushed to outbox: ${callId} → ${finalDlr} (client=${clientCode})`);
                    } catch (e) {
                        console.error(`[voice-otp] ⚠ DLR outbox push failed for ${callId}: ${e.message}`);
                    }
                }
            }).catch(async () => {
                releaseLock();
                await pool.query(`UPDATE voice_otp_logs SET status='failed',dlr_status='FAILED',completed_at=NOW() WHERE call_id=$1`, [callId]);
                // Also update sms_logs on bridge error
                await pool.query(
                    `UPDATE sms_logs SET dlr_status='FAILED', status='failed', error_code='BRIDGE_ERROR',
                     error_message='Asterisk bridge error' WHERE message_id=$1`, [callId]
                ).catch(()=>{});
                // Push FAILED DLR to outbox even on error
                if (client_id) {
                    try {
                        const clientR = await pool.query('SELECT client_code, webhook_url FROM clients WHERE id=$1', [client_id]);
                        const receipt = `id:${callId} sub:001 dlvrd:000 submit date:${new Date().toISOString().slice(0,16).replace(/[-:T]/g,'')} done date:${new Date().toISOString().slice(0,16).replace(/[-:T]/g,'')} stat:FAILED err:000 text:Bridge error`;
                        await pool.query(
                            `INSERT INTO dlr_outbox (message_id, entity_type, entity_id, client_id, client_code, destination, sender_id, status, dlr_receipt, submit_time, webhook_url)
                             VALUES ($1,'client',$2,$2,$3,$4,'','FAILED',$5,NOW(),$6)
                             ON CONFLICT (message_id) DO UPDATE SET status='FAILED', dlr_receipt=EXCLUDED.dlr_receipt`,
                            [callId, client_id, clientR.rows[0]?.client_code || '', sipDest, receipt, clientR.rows[0]?.webhook_url || '']
                        );
                    } catch (e) { /* best-effort */ }
                }
            });
        } catch (bridgeErr) {
            releaseLock();
            console.warn('[voice-otp] Asterisk bridge error:', bridgeErr.message);
            // Bridge error = call FAILED. Do NOT fake DELIVRD — that triggers false DLR billing.
            setTimeout(async () => { await pool.query(`UPDATE voice_otp_logs SET status='failed',dlr_status='FAILED',error_message=$2,completed_at=NOW() WHERE call_id=$1`, [callId, bridgeErr.message]); }, 2000);
            // Also update sms_logs on bridge load error
            pool.query(`UPDATE sms_logs SET dlr_status='FAILED', status='failed', error_code='BRIDGE_ERROR',
                        error_message=$1 WHERE message_id=$2`,
                       [bridgeErr.message, callId]).catch(()=>{});
        }

        // Add translation info and extracted OTP to log entry for frontend display
        const responseData = { ...logResult.rows[0] };
        if (translationApplied) {
            responseData.translation_applied = true;
            responseData.original_message = origMessage;
            responseData.message = finalMessage;
            responseData.extracted_otp = finalOtp;
            responseData.sender_id = finalSenderId;
        }
        res.json({
            success: true,
            data: responseData,
            message: `Voice OTP call initiated: ${callId}`,
            translation_applied: translationApplied || false,
            original_message: translationApplied ? origMessage : null,
            extracted_otp: finalOtp
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
}

app.post('/api/voice-otp/send', auth, handleVoiceOtpSend);

// Test call — thin wrapper: generates OTP then forwards body to send handler
// No internal HTTP calls, no Express router forwarding — just delegates to
// the same async function that /api/voice-otp/send uses.
// Defined AFTER /api/voice-otp/send so handleVoiceOtpSend is in scope.
app.post('/api/voice-otp/test', auth, async (req, res) => {
    req.body.otp_code = req.body.otp_code || String(Math.floor(100000 + Math.random() * 900000));
    return handleVoiceOtpSend(req, res);
});

// Call logs
app.post('/api/voice-otp/logs', auth, async (req, res) => {
    try {
        const f = req.body || {};
        let q = 'SELECT vl.*, s.supplier_code, s.company_name AS supplier_name, sms.client_rate, sms.supplier_rate, sms.profit FROM voice_otp_logs vl LEFT JOIN suppliers s ON s.id = vl.supplier_id LEFT JOIN sms_logs sms ON sms.message_id = vl.call_id WHERE 1=1';
        const p = []; let i = 1;
        if (f.status)    { q += ` AND vl.status = $${i++}`; p.push(f.status); }
        if (f.dlr_status){ q += ` AND vl.dlr_status = $${i++}`; p.push(f.dlr_status); }
        if (f.destination){ q += ` AND vl.destination ILIKE $${i++}`; p.push(`%${f.destination}%`); }
        if (f.client_id) { q += ` AND vl.client_id = $${i++}`; p.push(f.client_id); }
        if (f.start_date){ q += ` AND vl.created_at >= $${i++}`; p.push(f.start_date); }
        if (f.end_date)  { q += ` AND vl.created_at <= $${i++}`; p.push(f.end_date); }
        q += ' ORDER BY vl.created_at DESC LIMIT 500';
        const result = await pool.query(q, p);
        res.json({ success: true, data: result.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/voice-otp/logs', auth, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT vl.*, s.supplier_code, s.company_name AS supplier_name, sms.client_rate, sms.supplier_rate, sms.profit FROM voice_otp_logs vl LEFT JOIN suppliers s ON s.id = vl.supplier_id LEFT JOIN sms_logs sms ON sms.message_id = vl.call_id ORDER BY vl.created_at DESC LIMIT 500'
        );
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
        ).catch(() => {});
        // Re-send with the SAME destination/OTP from the original call log.
        // (Previously the body was forwarded empty → /send rejected with 400,
        //  so the retry button never actually retried.)
        req.body = {
            ...(req.body || {}),
            destination: req.body?.destination || log.destination,
            otp_code: req.body?.otp_code || log.otp_code || undefined,
            client_id: req.body?.client_id || log.client_id || undefined,
            supplier_id: req.body?.supplier_id || log.supplier_id || undefined,
        };
        // Forward to send logic
        try {
            const sendHandler = app._router.stack.find(l => l.route?.path === '/api/voice-otp/send' && l.route?.methods?.post)?.handle;
            if (!sendHandler) return res.status(500).json({ error: 'Send endpoint not available' });
            // If the re-send is blocked (overlapping call → 409), don't burn a retry.
            const origJson = res.json.bind(res);
            res.json = (payload) => {
                if (payload && payload.error === 'destination_busy_overlapping_call') {
                    pool.query(
                        `UPDATE voice_otp_logs SET retry_count = GREATEST(retry_count - 1, 0), status = 'failed', dlr_status = 'REJECTED',
                         error_message = 'Overlapping call — another Voice OTP call is active', completed_at = NOW() WHERE call_id = $1`,
                        [callId]
                    ).catch(() => {});
                }
                return origJson(payload);
            };
            return sendHandler(req, res);
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
        const allowed = ['device_name','device_type','phone_number','session_status','qr_code','last_active','supplier_id','proxy_config','session_data','pairing_token','proxy_node'];
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
        const allowed = ['device_name','device_type','phone_number','session_status','qr_code','last_active','supplier_id','proxy_config','session_data','pairing_token','proxy_node'];
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

// Get QR code for device pairing (REAL Baileys WhatsApp / Telegram pairing)
app.get('/api/ott/devices/:id/qr', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT * FROM ott_devices WHERE id = $1', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'OTT device not found' });
        const device = result.rows[0];

        let qrCode = device.qr_code;
        let pairingToken = device.pairing_token;

        // Try real Baileys QR generation for WhatsApp
        if (device.device_type === 'whatsapp' && (!qrCode || device.session_status === 'qr_pending')) {
            try {
                const ottMgr = await import('./src/services/ottDeviceManager.mjs');
                const result = await ottMgr.startWhatsAppPairing(
                    String(device.id),
                    device.phone_number,
                    device.proxy_node || null
                );
                if (result.qr) {
                    qrCode = result.qr;
                    pairingToken = `wa_${id}_${Date.now()}`;
                    await pool.query(
                        `UPDATE ott_devices SET qr_code=$1, pairing_token=$2, session_status='qr_pending', proxy_node=COALESCE(proxy_node,$3) WHERE id=$4`,
                        [qrCode, pairingToken, result.proxyNode || null, id]
                    );
                    console.log(`[OTT-QR] ✅ Real Baileys QR generated for device ${id}`);
                }
            } catch (baileyErr) {
                console.error(`[OTT-QR] Baileys QR failed for device ${id}: ${baileyErr.message}`);
                // Fall back to stored/mock QR
                if (!qrCode) {
                    qrCode = `PAIR:${device.device_type}:${device.id}:${Date.now()}`;
                    await pool.query('UPDATE ott_devices SET qr_code=$1 WHERE id=$2', [qrCode, id]);
                }
            }
        }

        // For Telegram, generate pairing token
        if (device.device_type === 'telegram' && (!pairingToken || device.session_status === 'qr_pending')) {
            try {
                const ottMgr = await import('./src/services/ottDeviceManager.mjs');
                const result = await ottMgr.startTelegramPairing(
                    String(device.id),
                    device.phone_number,
                    device.proxy_node || null
                );
                pairingToken = result.pairingToken;
                await pool.query(
                    `UPDATE ott_devices SET pairing_token=$1, session_status='qr_pending' WHERE id=$2`,
                    [pairingToken, id]
                );
            } catch (tgErr) {
                console.error(`[OTT-QR] Telegram pairing failed for device ${id}: ${tgErr.message}`);
                pairingToken = `tg_${id}_${Date.now()}`;
            }
        }

        if (!qrCode) {
            qrCode = `PAIR:${device.device_type}:${device.id}:${Date.now()}`;
            await pool.query('UPDATE ott_devices SET qr_code=$1 WHERE id=$2', [qrCode, id]);
        }

        res.json({
            success: true,
            data: {
                qr: qrCode,
                pairing_token: pairingToken,
                device_type: device.device_type,
                instructions: device.device_type === 'whatsapp'
                    ? 'Open WhatsApp on your phone → Settings → Linked Devices → Scan QR code'
                    : 'Use the pairing token with your Telegram client to authenticate',
            }
        });
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

// ==================== OTT PROXY MANAGEMENT ====================
// Get proxy pool status
app.get('/api/ott/proxy/status', auth, async (req, res) => {
    try {
        const ottMgr = await import('./src/services/ottDeviceManager.mjs');
        const pool = ottMgr.getProxyPool();
        res.json({ success: true, data: { pool, count: pool.length } });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Test a proxy node
app.post('/api/ott/proxy/test', auth, async (req, res) => {
    try {
        const { host, port } = req.body || {};
        if (!host) return res.status(400).json({ error: 'host is required' });
        const ottMgr = await import('./src/services/ottDeviceManager.mjs');
        const result = await ottMgr.testProxyNode(host, port || 3128);
        res.json({ success: true, data: result });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Add proxy node
app.post('/api/ott/proxy/add', auth, async (req, res) => {
    try {
        const { host, port } = req.body || {};
        if (!host) return res.status(400).json({ error: 'host is required' });
        const ottMgr = await import('./src/services/ottDeviceManager.mjs');
        const pool = ottMgr.addProxyNode(host, port || 3128);
        res.json({ success: true, data: { pool, count: pool.length } });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get device connection status (from in-memory registry)
app.get('/api/ott/devices/:id/status', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const ottMgr = await import('./src/services/ottDeviceManager.mjs');
        const status = ottMgr.getDeviceStatus(id);
        res.json({ success: true, data: status });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get all active device statuses
app.get('/api/ott/devices/status/all', auth, async (req, res) => {
    try {
        const ottMgr = await import('./src/services/ottDeviceManager.mjs');
        const statuses = ottMgr.getAllDeviceStatuses();
        res.json({ success: true, data: statuses });
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

        const messageId = genNumericMsgId('7'); // CHANNEL: pure numeric ID for WhatsApp/Telegram/RCS

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

// ==================== ASTERISK STATUS ====================
app.get('/api/bind/asterisk-status', auth, async (req, res) => {
    try {
        const status = { running: false, version: '', ami_connected: false, ami_users: 0, sip_peers: 0, sip_online: 0, sip_offline: 0, service_active: false };
        let bridge = null;
        try { bridge = require('./asterisk-bridge.cjs'); } catch (e) { /* not loaded */ }
        status.ami_connected = bridge?.isConnected ? bridge.isConnected() : false;
        // Query Asterisk via the existing AMI connection (async, non-blocking)
        if (bridge?.sendCommand) {
            try {
                const versionResult = await bridge.sendCommand('core show version');
                if (versionResult) {
                    const match = versionResult.match(/Asterisk\s+([\d.]+)/);
                    if (match) { status.version = match[0]; status.running = true; }
                }
                const sipResult = await bridge.sendCommand('sip show peers');
                if (sipResult) {
                    const peerMatch = sipResult.match(/(\d+)\s+sip peers.*?(\d+)\s+online.*?(\d+)\s+offline/i);
                    if (peerMatch) {
                        status.sip_peers = parseInt(peerMatch[1]) || 0;
                        status.sip_online = parseInt(peerMatch[2]) || 0;
                        status.sip_offline = parseInt(peerMatch[3]) || 0;
                    }
                }
            } catch (e) { /* AMI command failed, keep defaults */ }
        }
        // Fallback: CLI if AMI not available
        if (!status.running) {
            try {
                const { execSync } = require('child_process');
                const verOut = execSync('asterisk -V 2>/dev/null || echo ""', { timeout: 2000 }).toString().trim();
                if (verOut) { status.version = verOut; status.running = true; }
            } catch (e) { /* nop */ }
        }
        // Service status from systemctl
        try {
            const { execSync } = require('child_process');
            status.service_active = execSync('systemctl is-active asterisk 2>/dev/null || echo "inactive"', { timeout: 2000 }).toString().trim() === 'active';
        } catch (e) { /* nop */ }
        if (bridge) status.ami_users = status.ami_connected ? 1 : 0;
        res.json({ success: true, data: status });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== SIP PEER REGISTRATION MONITOR ====================
// Returns detailed SIP peer info from PJSIP: status, latency (RTT), and last registration time.
app.get('/api/bind/sip-peers', auth, async (req, res) => {
    try {
        const peers = [];
        const { execSync } = require('child_process');
        const asteriskCmd = 'sudo asterisk -rx';

        // 1. Get PJSIP contacts (has Status, RTT, Contact URI, Endpoint)
        let contactsRaw = '';
        try {
            contactsRaw = execSync(`${asteriskCmd} "pjsip show contacts" 2>/dev/null`, { timeout: 5000 }).toString();
        } catch (e) { /* CLI failed */ }

        // Try AMI if CLI failed
        if (!contactsRaw) {
            try {
                const bridge = require('./asterisk-bridge.cjs');
                if (bridge.isConnected?.()) {
                    contactsRaw = await bridge.sendCommand('pjsip show contacts', 3000);
                }
            } catch (e) { /* AMI failed */ }
        }

        // 2. Get PJSIP registrations (has last registration time)
        let regsRaw = '';
        try {
            regsRaw = execSync(`${asteriskCmd} "pjsip show registrations" 2>/dev/null`, { timeout: 5000 }).toString();
        } catch (e) { /* CLI failed */ }

        // Parse contacts: format like:
        //   Contact:  <Aor/ContactUri..............................> <Hash....> <Status> <RTT(ms)..>
        //   Contact:  outbound-aor/sip:198.27.80.229:5060            4d94f0b25b NonQual         nan
        const contactMap = new Map(); // aor → { contactUri, status, rtt }
        if (contactsRaw) {
            const lines = contactsRaw.split('\n');
            for (const line of lines) {
                const m = line.match(/^\s*Contact:\s+(\S+)\/(\S+)\s+(\S+)\s+(\S+)\s+(\S+)/);
                if (m && !m[1].startsWith('<')) {
                    const aor = m[1];
                    const contactUri = m[2];
                    const status = m[4];
                    const rtt = m[5] === 'nan' || m[5] === 'NaN' ? null : parseFloat(m[5]);
                    contactMap.set(aor, { contactUri, status, rtt });
                }
            }
        }

        // Parse registrations: format like:
        //   <Registration/ServerURI..............................>  <Auth..........>  <Status.......>
        if (regsRaw) {
            const lines = regsRaw.split('\n');
            for (const line of lines) {
                const regMatch = line.match(/^\s*(\S+)\s*\/\s*(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/);
                if (regMatch && regMatch[3] !== 'Auth' && !regMatch[1].startsWith('<')) {
                    const regName = regMatch[1];
                    const serverUri = regMatch[2];
                    const auth = regMatch[3];
                    const status = regMatch[4];
                    const registeredAt = regMatch[5]?.trim() || null;
                    const baseName = regName.replace(/-reg$/, '');
                    const aor = `${baseName}-aor`;
                    const contact = contactMap.get(aor) || {};

                    peers.push({
                        name: baseName,
                        endpoint: `${baseName}-ep`,
                        aor,
                        server_uri: serverUri,
                        contact_uri: contact.contactUri || `${aor}/${serverUri}`,
                        status: contact.status || status || 'Unknown',
                        rtt_ms: contact.rtt !== undefined ? contact.rtt : null,
                        registered: status === 'Registered',
                        registered_at: registeredAt,
                        auth_name: auth,
                    });
                }
            }
        }

        // If no registrations, still include contacts-only peers
        if (peers.length === 0 && contactMap.size > 0) {
            for (const [aor, info] of contactMap) {
                const baseName = aor.replace(/-aor$/, '');
                peers.push({
                    name: baseName,
                    endpoint: `${baseName}-ep`,
                    aor,
                    server_uri: '',
                    contact_uri: info.contactUri,
                    status: info.status,
                    rtt_ms: info.rtt,
                    registered: info.status === 'Avail',
                    registered_at: null,
                    auth_name: '',
                });
            }
        }

        res.json({ success: true, data: peers });
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
                    COALESCE(sess.bind_mode, client_sess.bind_mode) as bind_mode,                    CASE 
          WHEN client_sess.id IS NOT NULL AND client_sess.status = 'bound' THEN 'connected'
          WHEN sess.id IS NOT NULL AND sess.status = 'bound' THEN 'connected'
          WHEN s.bind_status = 'bound' AND s.status = 'active' THEN 'connected'
          ELSE 'disconnected' 
        END as session_state
             FROM suppliers s
             LEFT JOIN active_smpp_sessions sess ON s.id = sess.entity_id AND sess.entity_type = 'supplier'
             LEFT JOIN smpp_sessions client_sess ON client_sess.entity_type = 'client'
               AND client_sess.status = 'bound'
               AND client_sess.system_id = s.smpp_username
               AND s.is_inbound = true              WHERE s.connection_type IN ('smpp', 'http', 'voice_otp', 'ott_whatsapp', 'ott_telegram', 'rcs', 'flash_sms', 'whatsapp_business', 'telegram_business', 'ott', 'android_SMS')
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
app.get('/api/license/info', superAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM license ORDER BY id DESC LIMIT 1');
        if (result.rows.length === 0) return res.json({ success: true, data: null, message: 'No license found' });
        const lic = result.rows[0];
        // Attach real-time usage: count SMS parts (multi-part = multiple),
        // Voice OTP calls, RCS, Flash SMS, WhatsApp, Telegram this month
        const usageR = await pool.query(
            `SELECT
               COALESCE(SUM(CASE WHEN source IN ('voice_otp','rcs','whatsapp_business','telegram_business','flash_sms')
                 THEN 1 ELSE COALESCE(message_parts, 1) END) FILTER (
                 WHERE created_at > date_trunc('month', NOW())), 0)::int AS sms_this_month,
               COALESCE(COUNT(*) FILTER (
                 WHERE created_at > date_trunc('month', NOW())), 0)::int AS total_messages
             FROM sms_logs`
        );
        lic.usage = usageR.rows[0] || { sms_this_month: 0, total_messages: 0 };
        lic.usage.days_used = Math.max(1, Math.ceil((Date.now() - new Date(lic.issued_date || lic.created_at).getTime()) / 86400000));
        res.json({ success: true, data: lic });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Package definitions for license key generation & activation.
// Maps license_type → { days, features, limits }
const LICENSE_PACKAGES = {
  trial:         { days: 30,   features: { smpp:true, http:true, ott:false, rcs:false, voice_otp:false, whatsapp:false, telegram:false, flash_sms:false, email:false, voip:false }, limits: { max_clients:999999, max_suppliers:999999, max_sms_monthly:1000,      max_tps:30 } },
  volume_100k:   { days: 30,   features: { smpp:true, http:true, ott:true,  rcs:false, voice_otp:true,  whatsapp:true,  telegram:false, flash_sms:true,  email:false, voip:false }, limits: { max_clients:999999, max_suppliers:999999, max_sms_monthly:100000,    max_tps:100 } },
  volume_1m:     { days: 30,   features: { smpp:true, http:true, ott:true,  rcs:true,  voice_otp:true,  whatsapp:true,  telegram:true,  flash_sms:true,  email:true,  voip:false }, limits: { max_clients:999999, max_suppliers:999999, max_sms_monthly:1000000,   max_tps:300 } },
  volume_5m:     { days: 30,   features: { smpp:true, http:true, ott:true,  rcs:true,  voice_otp:true,  whatsapp:true,  telegram:true,  flash_sms:true,  email:true,  voip:true  }, limits: { max_clients:999999, max_suppliers:999999, max_sms_monthly:5000000,   max_tps:800 } },
  volume_10m:    { days: 30,   features: { smpp:true, http:true, ott:true,  rcs:true,  voice_otp:true,  whatsapp:true,  telegram:true,  flash_sms:true,  email:true,  voip:true  }, limits: { max_clients:999999, max_suppliers:999999, max_sms_monthly:10000000,  max_tps:1500 } },
  volume_15m:    { days: 30,   features: { smpp:true, http:true, ott:true,  rcs:true,  voice_otp:true,  whatsapp:true,  telegram:true,  flash_sms:true,  email:true,  voip:true  }, limits: { max_clients:999999, max_suppliers:999999, max_sms_monthly:15000000,  max_tps:2500 } },
  volume_30m:    { days: 30,   features: { smpp:true, http:true, ott:true,  rcs:true,  voice_otp:true,  whatsapp:true,  telegram:true,  flash_sms:true,  email:true,  voip:true  }, limits: { max_clients:999999, max_suppliers:999999, max_sms_monthly:30000000,  max_tps:4000 } },
  unlimited:     { days: 365,  features: { smpp:true, http:true, ott:true,  rcs:true,  voice_otp:true,  whatsapp:true,  telegram:true,  flash_sms:true,  email:true,  voip:true  }, limits: { max_clients:999999, max_suppliers:999999, max_sms_monthly:999999999, max_tps:10000 } },
};

// Parse license key format: N2A-{TYPE}-{TS}-{RAND}-{MAC}
function parseLicenseKey(key) {
    const parts = (key || '').split('-');
    if (parts.length < 5 || parts[0] !== 'N2A') return null;
    const type = parts[1].toLowerCase();
    if (!LICENSE_PACKAGES[type]) return null;
    return { type, ts: parts[2], rand: parts[3], mac: parts.slice(4).join('-') };
}

app.post('/api/license/activate', superAuth, async (req, res) => {
    try {
        const { key, system_ip, system_mac } = req.body;
        if (!key) return res.status(400).json({ error: 'License key is required' });
        
        // Parse key to extract type
        const parsed = parseLicenseKey(key);
        const pkg = parsed ? LICENSE_PACKAGES[parsed.type] : null;
        const licenseType = parsed ? parsed.type : 'trial';
        const days = pkg ? pkg.days : 30;
        const features = pkg ? pkg.features : LICENSE_PACKAGES.trial.features;
        const limits = pkg ? pkg.limits : LICENSE_PACKAGES.trial.limits;
        
        // Upsert: activate or re-activate an existing license key
        const result = await pool.query(
            `INSERT INTO license (license_key, license_type, status, issued_to, issued_date, expiry_date,
             system_ip, system_mac, features, limits, created_at)
             VALUES ($1, $2, 'active', $3, CURRENT_DATE, CURRENT_DATE + INTERVAL '${days} days', $4, $5, $6::jsonb, $7::jsonb, NOW())
             ON CONFLICT (license_key) DO UPDATE SET
               status = 'active',
               system_ip = COALESCE($4, license.system_ip),
               system_mac = COALESCE($5, license.system_mac),
               features = COALESCE($6::jsonb, license.features),
               limits = COALESCE($7::jsonb, license.limits),
               issued_date = CURRENT_DATE,
               expiry_date = CURRENT_DATE + INTERVAL '${days} days',
               issued_to = EXCLUDED.issued_to
             RETURNING *`,
            [key, licenseType, req.user?.username || 'unknown', system_ip || null, system_mac || null,
             JSON.stringify(features), JSON.stringify(limits)]
        );
        res.json({ success: true, data: result.rows[0], message: 'License activated' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/license/deactivate', superAuth, async (req, res) => {
    try {
        const result = await pool.query(
            `UPDATE license SET status = 'expired' WHERE status = 'active' RETURNING id, license_key, status`
        );
        if (result.rows.length === 0) return res.json({ success: true, message: 'No active license to deactivate' });
        res.json({ success: true, data: result.rows[0], message: 'License deactivated' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/license/limits', superAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM license ORDER BY id DESC LIMIT 1');
        if (result.rows.length === 0) return res.json({ success: true, data: { max_clients: 10, max_suppliers: 5, max_sms_monthly: 100000, max_tps: 100 } });
        const lic = result.rows[0];
        res.json({ success: true, data: lic.limits || { max_clients: 10, max_suppliers: 5, max_sms_monthly: 100000, max_tps: 100 } });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Auto-detect server OS, IP, MAC for license binding
const os = require('os');
app.get('/api/license/system-info', superAuth, async (req, res) => {
    try {
        const interfaces = os.networkInterfaces();
        let ip = '', mac = '';
        for (const iface of Object.values(interfaces)) {
            for (const addr of iface) {
                if (!addr.internal && addr.family === 'IPv4') {
                    ip = addr.address;
                    mac = addr.mac;
                    break;
                }
            }
            if (ip) break;
        }
        // Fallback: try hostname -I for servers behind NAT
        if (!ip) {
            try {
                const { execSync } = require('child_process');
                ip = execSync("hostname -I | awk '{print $1}'", { encoding: 'utf8' }).trim();
            } catch { ip = '127.0.0.1'; }
        }
        res.json({ success: true, data: {
            ip, mac,
            os: os.platform() + ' ' + os.release(),
            hostname: os.hostname(),
            arch: os.arch(),
            cpus: os.cpus().length,
        }});
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Validate a license key
app.post('/api/license/validate', superAuth, async (req, res) => {
    try {
        const { key } = req.body;
        if (!key) return res.status(400).json({ error: 'License key required' });
        const result = await pool.query('SELECT * FROM license WHERE license_key = $1', [key]);
        if (result.rows.length === 0) return res.json({ success: true, valid: false, message: 'Invalid key' });
        const lic = result.rows[0];
        const valid = lic.status === 'active' && new Date(lic.expiry_date) > new Date();
        res.json({ success: true, valid, data: lic });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Generate license key
app.post('/api/license/generate', superAuth, async (req, res) => {
    try {
        const { type, company_name, tenant_code, system_ip, system_mac } = req.body;
        const licenseType = (type || 'trial').toLowerCase();
        const pkg = LICENSE_PACKAGES[licenseType] || LICENSE_PACKAGES.trial;
        const ts = Date.now().toString(36).toUpperCase().slice(-6);
        const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
        const macSuffix = system_mac ? system_mac.replace(/:/g,'').slice(-8).toUpperCase() : '00000000';
        const key = `N2A-${licenseType.toUpperCase()}-${ts}-${rand}-${macSuffix}`;
        const result = await pool.query(
            `INSERT INTO license (license_key, license_type, status, issued_to, issued_date, expiry_date,
             system_ip, system_mac, features, limits, created_at)
             VALUES ($1, $2, 'active', $3, CURRENT_DATE, CURRENT_DATE + INTERVAL '${pkg.days} days',
              $4, $5, $6::jsonb, $7::jsonb, NOW()) RETURNING *`,
            [key, licenseType, company_name || 'Unknown', system_ip || null, system_mac || null,
             JSON.stringify(pkg.features), JSON.stringify(pkg.limits)]
        );
        // If generating for a tenant, also update/create the tenant record
        if (tenant_code) {
            await pool.query(
                `INSERT INTO tenants (name, code, ip, mac, status, features, limits, created_at)
                 VALUES ($1, $2, $3, $4, 'active', $5::jsonb, $6::jsonb, NOW())
                 ON CONFLICT (code) DO UPDATE SET
                   ip = COALESCE(EXCLUDED.ip, tenants.ip),
                   mac = COALESCE(EXCLUDED.mac, tenants.mac),
                   features = EXCLUDED.features,
                   limits = EXCLUDED.limits,
                   updated_at = NOW()`,
                [company_name || tenant_code, tenant_code.toUpperCase(), system_ip || null, system_mac || null,
                 JSON.stringify(pkg.features), JSON.stringify(pkg.limits)]
            ).catch(() => {});
        }
        res.json({ success: true, data: { key, license: result.rows[0] } });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ==================== TENANTS ====================
app.get('/api/license/tenants', superAuth, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM tenants ORDER BY created_at DESC');
        res.json({ success: true, data: result.rows });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/license/tenants', superAuth, async (req, res) => {
    try {
        const { name, code, ip, mac, max_sms_monthly, max_tps, features, expiry_date } = req.body;
        if (!name || !code) return res.status(400).json({ error: 'Name and code required' });
        // Default expiry: 30 days from now if not specified
        const expiry = expiry_date || new Date(Date.now() + 30 * 86400000).toISOString();
        const result = await pool.query(
            `INSERT INTO tenants (name, code, ip, mac, status,
             limits, features, expiry_date, created_at)
             VALUES ($1, $2, $3, $4, 'active',
              jsonb_build_object('max_sms_monthly', $5::int, 'max_tps', $6::int),
              $7::jsonb, $8, NOW()) RETURNING *`,
            [name, code.toUpperCase(), ip || null, mac || null, max_sms_monthly || 100, max_tps || 5,
             JSON.stringify(features || { smpp: true, http: true }), expiry]
        );
        res.json({ success: true, data: result.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/license/tenants/:id', superAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { name, code, ip, mac, max_sms_monthly, max_tps, features, expiry_date } = req.body;
        const result = await pool.query(
            `UPDATE tenants SET name = COALESCE($2, name),
             code = COALESCE($3, code),
             ip = COALESCE($4, ip),
             mac = COALESCE($5, mac),
             limits = COALESCE($6::jsonb, limits),
             features = COALESCE($7::jsonb, features),
             expiry_date = COALESCE($8::timestamp, expiry_date),
             updated_at = NOW() WHERE id = $1 RETURNING *`,
            [id, name || null, code ? code.toUpperCase() : null, ip || null, mac || null,
             (max_sms_monthly || max_tps) ? JSON.stringify({ max_sms_monthly: max_sms_monthly || 100, max_tps: max_tps || 5 }) : null,
             features ? JSON.stringify(features) : null, expiry_date || null]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Tenant not found' });
        res.json({ success: true, data: result.rows[0] });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/license/tenants/:id', superAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('DELETE FROM tenants WHERE id = $1 RETURNING id', [id]);
        if (result.rows.length === 0) return res.status(404).json({ error: 'Tenant not found' });
        res.json({ success: true, message: 'Tenant deleted' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Extend tenant licence expiry — super admin can grant extra days when tenant delays payment
app.post('/api/license/tenants/:id/extend', superAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { days } = req.body; // number of days to extend (e.g. 7, 15, 30)
        if (!days || days <= 0) return res.status(400).json({ error: 'days must be a positive number' });
        // Extend from current expiry_date, or from today if not set
        const result = await pool.query(
            `UPDATE tenants SET
               expiry_date = COALESCE(expiry_date, NOW()) + ($2::int * INTERVAL '1 day'),
               updated_at = NOW()
             WHERE id = $1 RETURNING *`,
            [id, parseInt(days)]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Tenant not found' });
        res.json({ success: true, data: result.rows[0], message: `Extended by ${days} days` });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/license/tenants/:id/usage', superAuth, async (req, res) => {
    try {
        const { id } = req.params;
        // Count SMS parts (not just rows) — multi-part messages count as multiple.
        // Includes: SMS (all sources: external_api, test_sms, campaign, smpp, etc.),
        // Voice OTP calls, RCS, Flash SMS, WhatsApp, Telegram.
        const usage = await pool.query(
            `SELECT
               COALESCE(SUM(CASE WHEN source IN ('voice_otp','rcs','whatsapp_business','telegram_business','flash_sms')
                 THEN 1 ELSE COALESCE(message_parts, 1) END) FILTER (
                 WHERE created_at > date_trunc('month', NOW())
                   AND client_id IN (SELECT id FROM clients WHERE tenant_id = $1)), 0)::int AS sms_this_month,
               COALESCE(SUM(COALESCE(message_parts, 1)) FILTER (
                 WHERE created_at > date_trunc('month', NOW())
                   AND source IN ('external_api','test_sms','campaign','smpp','smpp_client','e2e_test')
                   AND client_id IN (SELECT id FROM clients WHERE tenant_id = $1)), 0)::int AS sms_parts,
               COALESCE(COUNT(*) FILTER (
                 WHERE created_at > date_trunc('month', NOW())
                   AND source IN ('voice_otp')
                   AND client_id IN (SELECT id FROM clients WHERE tenant_id = $1)), 0)::int AS voice_otp_calls,
               COALESCE(COUNT(*) FILTER (
                 WHERE created_at > date_trunc('month', NOW())
                   AND source IN ('rcs','whatsapp_business','telegram_business','flash_sms')
                   AND client_id IN (SELECT id FROM clients WHERE tenant_id = $1)), 0)::int AS channel_msgs
             FROM sms_logs`,
            [id]
        );
        const row = usage.rows[0] || {};
        // sms_this_month = total all-message counting (parts for SMS, 1 per OTT/RCS/VoiceOTP)
        const total = (row.sms_this_month || 0);
        res.json({ success: true, data: {
            sms_this_month: total,
            sms_parts: row.sms_parts || 0,
            voice_otp_calls: row.voice_otp_calls || 0,
            channel_msgs: row.channel_msgs || 0,
        }});
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Data retention cleanup
app.post('/api/system/cleanup-retention', auth, async (req, res) => {
    try {
        const { months = 6 } = req.body;
        const preservedTables = ['sms_logs', 'invoices', 'payments'];
        const cleanableTables = [
            'dlr_outbox', 'bind_history', 'notifications',
            'sms_outbox', 'voice_otp_logs', 'voice_call_retry_queue'
        ];
        let totalCleaned = 0;
        const breakdown = {};
        for (const table of cleanableTables) {
            const r = await pool.query(
                `DELETE FROM ${table} WHERE created_at < NOW() - INTERVAL '${parseInt(months)} months'`
            ).catch(() => ({ rowCount: 0 }));
            if (r.rowCount > 0) { breakdown[table] = r.rowCount; totalCleaned += r.rowCount; }
        }
        res.json({ success: true, data: {
            cutoff_months: parseInt(months),
            total_cleaned: totalCleaned,
            breakdown,
            preserved: preservedTables.join(', '),
        }});
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve static files — SPA fallback (middleware avoids path-to-regexp wildcard issue)
app.use(express.static('dist'));

// ── APK download with proper MIME type for auto-install on Android 7+ ──
// Android browsers detect application/vnd.android.package-archive and
// automatically prompt the user to install. Content-Disposition: attachment
// ensures a download dialog rather than inline display.
app.get('/download/net2app-gateway.apk', (req, res) => {
    const apkPath = path.join(__dirname, 'public', 'net2app-gateway.apk');
    const fs = require('fs');
    if (!fs.existsSync(apkPath)) {
        return res.status(404).json({ error: 'APK not found' });
    }
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', 'attachment; filename="net2app-gateway.apk"');
    res.setHeader('Content-Length', fs.statSync(apkPath).size);
    fs.createReadStream(apkPath).pipe(res);
});

// ── One-tap install page — detects Android, auto-triggers APK download ──
app.get('/install', (req, res) => {
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>NET2APP Gateway — Install</title>
    <style>
        body { font-family: -apple-system, system-ui, sans-serif; background:#0f172a; color:#e2e8f0; display:flex; align-items:center; justify-content:center; min-height:100vh; margin:0; text-align:center; }
        .card { background:#1e293b; border-radius:16px; padding:40px; max-width:420px; width:90%; box-shadow:0 25px 50px rgba(0,0,0,.4); }
        .icon { font-size:64px; margin-bottom:16px; }
        h1 { font-size:24px; margin:0 0 8px; }
        p { color:#94a3b8; margin:0 0 24px; font-size:14px; }
        .btn { display:inline-block; background:#3b82f6; color:#fff; padding:14px 32px; border-radius:10px; text-decoration:none; font-weight:600; font-size:16px; transition:background .2s; }
        .btn:hover { background:#2563eb; }
        .note { margin-top:20px; font-size:12px; color:#64748b; }
    </style>
    <script>
        // Auto-trigger download on page load for Android devices
        const ua = navigator.userAgent.toLowerCase();
        if (ua.includes('android')) {
            window.location.href = '/download/net2app-gateway.apk';
        }
    </script>
</head>
<body>
    <div class="card">
        <div class="icon">📱</div>
        <h1>NET2APP Gateway</h1>
        <p>Turn your Android phone into an SMS supplier</p>
        <a class="btn" href="/download/net2app-gateway.apk">⬇ Download APK</a>
        <p class="note">Android 7.0+ required • Tap to install</p>
    </div>
</body>
</html>`);
});

app.use('/download', express.static('public')); // other downloads
app.use((req, res, next) => {
    if (!req.path.startsWith('/api')) {
        res.sendFile(path.join(__dirname, 'dist', 'index.html'));
    } else {
        next(); // pass /api/ requests through to route handlers + error handler
    }
});

// ==================== GLOBAL ERROR HANDLER ====================
// Catches ALL unhandled errors (malformed JSON, body-parser SyntaxError,
// uncaught async errors, etc.) and returns a proper JSON response instead
// of crashing the Node.js process. Without this, every malformed request
// body (e.g. `{invalid`) would cause body-parser to throw a SyntaxError
// that crashes the entire server (38+ PM2 restarts observed).
app.use((err, req, res, next) => {
    // Log the error for debugging
    console.error('[ERROR-HANDLER]', err.stack || err.message || err);

    // Body-parser SyntaxError from express.json() — malformed JSON in request body
    if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
        return res.status(400).json({ error: 'Malformed JSON in request body' });
    }

    // Payload too large
    if (err.type === 'entity.too.large') {
        return res.status(413).json({ error: 'Request body too large' });
    }

    // JWT errors from auth middleware
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Generic 500 for everything else
    res.status(500).json({ error: 'Internal server error' });
});

// ============================================================
// ANDROID SMS GATEWAY API ROUTES
// The Android app connects to these endpoints via HTTP REST.
// ============================================================

/**
 * POST /api/gateway/register
 * Register or update an Android SMS Gateway supplier.
 */
app.post('/api/gateway/register', async (req, res) => {
    try {
        const { username, password, device_name } = req.body;
        if (!username || !password) {
            return res.status(400).json({ success: false, error: 'username and password are required' });
        }
        const cleanName = (device_name || username).replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20) || 'gateway';
        const supplierCode = `android_${cleanName}`;
        const displayName = device_name || username;
        const existing = await pool.query(
            `SELECT id FROM suppliers
             WHERE smpp_username = $1
               AND (is_deleted IS NULL OR is_deleted = false)`,
            [username]
        );
        let supplierId;
        if (existing.rows.length > 0) {
            supplierId = existing.rows[0].id;
            await pool.query(
                `UPDATE suppliers SET connection_type = 'android_SMS', is_inbound = true,
                 company_name = COALESCE(NULLIF($2,''), company_name), smpp_password = $3,
                 status = 'active', updated_at = NOW() WHERE id = $1`,
                [supplierId, displayName, password]
            );
        } else {
            const insert = await pool.query(
                `INSERT INTO suppliers (supplier_code, company_name, connection_type,
                 smpp_username, smpp_password, smpp_host, smpp_port, is_inbound,
                 bind_status, status, balance, currency)
                 VALUES ($1,$2,'android_SMS',$3,$4,'0.0.0.0',0,true,'bound','active',0,'EUR')
                 RETURNING id`,
                [supplierCode, displayName, username, password]
            );
            supplierId = insert.rows[0].id;
        }
        res.json({ success: true, supplier_id: supplierId, supplier_code: supplierCode });
    } catch (e) {
        console.error(`[Gateway] Register failed: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * POST /api/gateway/heartbeat
 * Called every 5 seconds by the Android device. Returns pending MT messages.
 */
app.post('/api/gateway/heartbeat', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Basic ')) {
            return res.status(401).json({ success: false, error: 'Missing auth header' });
        }
        const decoded = Buffer.from(authHeader.substring(6), 'base64').toString('utf8');
        const colonIdx = decoded.indexOf(':');
        const username = decoded.substring(0, colonIdx);
        const password = decoded.substring(colonIdx + 1);

        const supplierR = await pool.query(
            `SELECT id, supplier_code FROM suppliers
             WHERE smpp_username = $1 AND smpp_password = $2
               AND connection_type = 'android_SMS' AND status = 'active'
               AND (is_deleted IS NULL OR is_deleted = false)`,
            [username, password]
        );
        if (supplierR.rows.length === 0) {
            return res.status(403).json({ success: false, error: 'Invalid credentials or not an Android gateway' });
        }
        const supplier = supplierR.rows[0];

        await pool.query(
            `UPDATE suppliers SET bind_status = 'bound', updated_at = NOW() WHERE id = $1`,
            [supplier.id]
        ).catch(() => {});

        // Pick up both 'queued' (not yet processed by worker) and 'submitted'
        // (worker marked success for android_SMS via deliverToSupplier).
        // Exclude jobs already sent to the Android device (PENDING_ANDROID)
        // or with a final DLR status — prevents double-delivery.
        const pending = await pool.query(
            `SELECT o.message_id, o.destination, o.sender_id, o.message, o.client_code, o.queued_at
             FROM sms_outbox o
             WHERE o.supplier_id = $1 AND o.status IN ('queued', 'submitted')
               AND (o.dlr_status IS NULL OR o.dlr_status NOT IN ('DELIVRD','UNDELIV','FAILED','PENDING_ANDROID'))
               AND o.attempt_count < o.max_attempts
             ORDER BY o.queued_at ASC LIMIT 20`,
            [supplier.id]
        );

        const pendingMt = pending.rows.map(r => ({
            message_id: r.message_id, destination: r.destination,
            sender_id: r.sender_id || '', message: r.message,
            client_code: r.client_code || '',
        }));

        if (pendingMt.length > 0) {
            const msgIds = pending.rows.map(r => r.message_id);
            // Mark as submitted + PENDING_ANDROID so future heartbeats skip these.
            // When the Android device later reports DLR (DELIVRD/UNDELIV),
            // the /api/gateway/mt-dlr endpoint will overwrite dlr_status.
            await pool.query(
                `UPDATE sms_outbox SET status = 'submitted', dlr_status = 'PENDING_ANDROID',
                 started_at = COALESCE(started_at, NOW()),
                 attempt_count = attempt_count + 1 WHERE message_id = ANY($1)`,
                [msgIds]
            );
        }

        console.log(`[Gateway] Heartbeat from ${supplier.supplier_code}: ${pendingMt.length} pending MT`);
        res.json({ success: true, pending_mt: pendingMt, server_time: Date.now() });
    } catch (e) {
        console.error(`[Gateway] Heartbeat failed: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * GET /api/gateway/ping — simple connectivity check.
 */
app.get('/api/gateway/ping', (req, res) => {
    res.json({ success: true, server_time: Date.now(), version: '2.0.0' });
});

/**
 * POST /api/gateway/mo-sms
 * Forward a Mobile-Originated SMS from the Android device to the server.
 */
app.post('/api/gateway/mo-sms', async (req, res) => {
    try {
        const { from, text, timestamp, device_name } = req.body;
        if (!from || !text) {
            return res.status(400).json({ success: false, error: 'from and text are required' });
        }
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Basic ')) {
            return res.status(401).json({ success: false, error: 'Missing auth header' });
        }
        const decoded = Buffer.from(authHeader.substring(6), 'base64').toString('utf8');
        const [username] = decoded.split(':');

        const supplierR = await pool.query(
            `SELECT id, supplier_code FROM suppliers
             WHERE smpp_username = $1 AND connection_type = 'android_SMS' AND status = 'active'`,
            [username]
        );
        if (supplierR.rows.length === 0) {
            return res.status(403).json({ success: false, error: 'Not authorized' });
        }
        const supplier = supplierR.rows[0];
        const msgId = `MO_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

        await pool.query(
            `INSERT INTO sms_logs (message_id, supplier_id, supplier_code, sender_id,
             destination, message, status, source, submit_time)
         VALUES ($1,$2,$3,$4,$5,$6,'pending','android_gateway_mo',$7)`,
        [msgId, supplier.id, supplier.supplier_code, from,
         device_name || 'unknown', text, new Date(timestamp || Date.now())]
        );

        // Try to forward to the last client who sent MT to this number
        try {
            const lastClient = await pool.query(
                `SELECT client_id FROM sms_logs WHERE destination = $1
                 AND client_id IS NOT NULL ORDER BY submit_time DESC LIMIT 1`,
                [from]
            );
            if (lastClient.rows.length > 0 && smppServer) {
                smppServer.sendIncomingSms(lastClient.rows[0].client_id, from, text);
            }
        } catch (e) { /* best effort */ }

        res.json({ success: true, message_id: msgId });
    } catch (e) {
        console.error(`[Gateway] MO SMS failed: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * POST /api/gateway/mt-dlr
 * Report delivery status for an MT SMS sent via the Android device.
 */
app.post('/api/gateway/mt-dlr', async (req, res) => {
    try {
        const { message_id, status, error_code } = req.body;
        if (!message_id || !status) {
            return res.status(400).json({ success: false, error: 'message_id and status are required' });
        }
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Basic ')) {
            return res.status(401).json({ success: false, error: 'Missing auth header' });
        }
        const decoded = Buffer.from(authHeader.substring(6), 'base64').toString('utf8');
        const [username] = decoded.split(':');

        const supplierR = await pool.query(
            `SELECT id FROM suppliers WHERE smpp_username = $1
             AND connection_type = 'android_SMS' AND status = 'active'`,
            [username]
        );
        if (supplierR.rows.length === 0) {
            return res.status(403).json({ success: false, error: 'Not authorized' });
        }

        const finalStatus = status === 'DELIVRD' ? 'delivered' : 'failed';
        const dlrStatus = status === 'DELIVRD' ? 'DELIVRD'
            : (status === 'UNDELIV' ? 'UNDELIV' : 'FAILED');

        await pool.query(
            `UPDATE sms_outbox SET dlr_status = $1, dlr_received_at = NOW(),
             status = $2, completed_at = NOW() WHERE message_id = $3`,
            [dlrStatus, finalStatus, message_id]
        );

        const logUpdate = await pool.query(
            `UPDATE sms_logs SET dlr_status = $1, status = $2,
             delivery_time = NOW(), dlr_timestamp = NOW(),
             error_code = CASE WHEN $4 != '' THEN $4 ELSE error_code END
             WHERE message_id = $3
             RETURNING client_id, client_code, destination, submit_time,
                       client_rate, message_parts, billing_mode_snapshot, webhook_url`,
            [dlrStatus, finalStatus, message_id, error_code || '']
        );

        if (status === 'DELIVRD' && logUpdate.rows.length > 0) {
            const log = logUpdate.rows[0];
            if (log.billing_mode_snapshot === 'dlr' && log.client_rate) {
                const clientCost = parseFloat(
                    ((log.client_rate || 0) * (log.message_parts || 1)).toFixed(6)
                );
                await pool.query(
                    'UPDATE clients SET balance = GREATEST(0, balance - $1), updated_at = NOW() WHERE id = $2',
                    [clientCost, log.client_id]
                ).catch(() => {});
                await pool.query(
                    'UPDATE sms_logs SET is_billed = true WHERE message_id = $1',
                    [message_id]
                ).catch(() => {});
            }
            if (log.webhook_url && queueManager) {
                queueManager.sendWebhook(log.webhook_url, message_id, log.destination,
                    'delivered', 'DELIVRD', log.client_code).catch(() => {});
            }
            if (smppServer) {
                smppServer.sendDlr({
                    client_id: log.client_id, message_id,
                    destination: log.destination,
                    status: 'DELIVRD', client_code: log.client_code,
                    submit_time: log.submit_time,
                });
            }
        }

        console.log(`[Gateway] DLR for ${message_id}: ${status}`);
        res.json({ success: true });
    } catch (e) {
        console.error(`[Gateway] MT DLR failed: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * GET /api/gateway/stats — get gateway device statistics.
 */
app.get('/api/gateway/stats', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Basic ')) {
            return res.status(401).json({ success: false, error: 'Missing auth header' });
        }
        const decoded = Buffer.from(authHeader.substring(6), 'base64').toString('utf8');
        const [username] = decoded.split(':');

        const supplierR = await pool.query(
            `SELECT id, balance, currency, bind_status FROM suppliers
             WHERE smpp_username = $1 AND connection_type = 'android_SMS' AND status = 'active'`,
            [username]
        );
        if (supplierR.rows.length === 0) {
            return res.status(403).json({ success: false, error: 'Not authorized' });
        }
        const supplier = supplierR.rows[0];
        const stats = await pool.query(
            `SELECT COUNT(*) FILTER (WHERE status = 'delivered') as total_delivered,
                    COUNT(*) FILTER (WHERE status = 'failed') as total_failed,
                    COUNT(*) FILTER (WHERE source = 'android_gateway_mo') as total_mo,
                    COUNT(*) as total_processed
             FROM sms_logs WHERE supplier_id = $1`,
            [supplier.id]
        );
        res.json({ success: true, data: { balance: supplier.balance,
            currency: supplier.currency, bind_status: supplier.bind_status,
            ...stats.rows[0] } });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

console.log('[Gateway] Android SMS Gateway API routes registered');

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);

    // ── STARTUP SELF-PROBE ──
    // Measures time from process start to first successful HTTP response.
    // Polls /api/gateway/ping every 100ms until it responds (max 60s).
    // Logs the elapsed time so we can track startup improvements.
    const http = require('http');
    let probeAttempts = 0;
    const MAX_PROBE_ATTEMPTS = 600; // 60s with 100ms interval
    const probeInterval = setInterval(() => {
        probeAttempts++;
        const req = http.get(`http://127.0.0.1:${PORT}/api/gateway/ping`, { timeout: 500 }, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    clearInterval(probeInterval);
                    const elapsed = process.hrtime(PROCESS_START_HR);
                    const ttfrMs = Math.round(elapsed[0] * 1000 + elapsed[1] / 1e6);
                    const ttfrHuman = ttfrMs >= 1000
                        ? `${(ttfrMs / 1000).toFixed(1)}s`
                        : `${ttfrMs}ms`;
                    _startupMetric = { ttfrMs, ttfrHuman, probeAttempts, status: 'ready' };
                    console.error(`[STARTUP] ⏱ Time to first HTTP response: ${ttfrHuman} (${probeAttempts} probes)`);
                    req.destroy();
                }
            });
        });
        req.on('error', () => { req.destroy(); /* not ready yet */ });
        req.on('timeout', () => { req.destroy(); });

        if (probeAttempts >= MAX_PROBE_ATTEMPTS) {
            clearInterval(probeInterval);
            _startupMetric.status = 'timeout';
            console.error(`[STARTUP] ⚠ Timeout after ${probeAttempts} probes (60s) — HTTP still not responding`);
        }
    }, 100);
    probeInterval.unref(); // don't keep process alive just for probing
});

// ── Startup metric endpoint ──
app.get('/api/startup-metric', (req, res) => {
    const elapsed = process.hrtime(PROCESS_START_HR);
    const uptimeMs = Math.round(elapsed[0] * 1000 + elapsed[1] / 1e6);
    res.json({
        ..._startupMetric,
        uptimeMs,
        uptimeHuman: uptimeMs >= 60000
            ? `${Math.floor(uptimeMs / 60000)}m ${Math.round((uptimeMs % 60000) / 1000)}s`
            : `${(uptimeMs / 1000).toFixed(1)}s`
    });
});

module.exports = app;
