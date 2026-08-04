// ============================================================
// CALLER ID POOL — Collects real sender phone numbers from
// incoming SMS traffic and reuses them as Voice OTP caller IDs.
// Real numbers have higher carrier acceptance than random ANI.
// ============================================================

const fs = require('fs');
const path = require('path');

const POOL_FILE = path.join(__dirname, '..', '..', 'data', 'caller_id_pool.json');
const FLUSH_INTERVAL_MS = 10000; // batch writes every 10s

let pool = null;
let lastPoolMtime = 0;
let dirty = false;
let flushTimer = null;

// ── load / save (cached, batched) ──

function loadPool() {
    try {
        const stat = fs.statSync(POOL_FILE);
        if (stat.mtimeMs === lastPoolMtime && pool) return pool;
        const raw = fs.readFileSync(POOL_FILE, 'utf-8');
        pool = JSON.parse(raw);
        lastPoolMtime = stat.mtimeMs;
        return pool;
    } catch (e) {
        if (!pool) pool = {};
        return pool;
    }
}

function flushPool() {
    if (!dirty || !pool) return;
    try {
        const data = {};
        for (const key of Object.keys(pool)) {
            if (key.startsWith('_')) continue;
            if (Array.isArray(pool[key]) && pool[key].length > 0) {
                data[key] = pool[key];
            }
        }
        data._lastUpdated = new Date().toISOString();
        data._stats = data._stats || {};
        let total = 0;
        for (const [k, v] of Object.entries(data)) {
            if (k.startsWith('_')) continue;
            total += (Array.isArray(v) ? v.length : 0);
        }
        data._stats.total = total;
        fs.writeFileSync(POOL_FILE, JSON.stringify(data, null, 2), 'utf-8');
        lastPoolMtime = fs.statSync(POOL_FILE).mtimeMs;
    } catch (e) {
        console.error('[CallerID-Pool] Flush failed:', e.message);
    } finally {
        dirty = false; // always clear — prevents infinite retry loop
    }
}

function markDirty() {
    dirty = true;
    if (!flushTimer) {
        flushTimer = setInterval(() => {
            flushPool();
            if (!dirty) { clearInterval(flushTimer); flushTimer = null; }
        }, FLUSH_INTERVAL_MS);
    }
}

// ── E.164 normalization ──

// Known country codes and their local prefixes that start with 0
const COUNTRY_NORMALIZE = {
    '880': { strip: 1 },  // Bangladesh: 016... → 88016...
    '91':  { strip: 1 },  // India: 098... → 9198...
    '971': { strip: 1 },  // UAE: 050... → 97150...
    '966': { strip: 1 },  // Saudi: 05... → 9665...
    '1':   { strip: 0 },  // US/Canada: already E.164
};

function normalizeToE164(number) {
    const cleaned = String(number).replace(/[^0-9]/g, '');
    if (cleaned.length < 7 || cleaned.length > 15) return null;
    
    // Already has a known country code prefix
    for (const cc of Object.keys(COUNTRY_NORMALIZE).sort((a, b) => b.length - a.length)) {
        if (cleaned.startsWith(cc)) return cleaned; // already E.164
    }
    
    // Starts with 0 — likely local format, try to infer country
    if (cleaned.startsWith('0')) {
        // Bangladesh: 013/016/017/018/019 → 880
        if (/^01[3-9]/.test(cleaned)) return '880' + cleaned.substring(1);
        // UAE: 050/052/054/055/056/058 → 971
        if (/^05[0-8]/.test(cleaned)) return '971' + cleaned.substring(1);
        // India: 06/07/08/09 → 91
        if (/^0[6-9]/.test(cleaned)) return '91' + cleaned.substring(1);
    // Unrecognized local format — don't collect (can't determine country)
    if (cleaned.startsWith('0')) return null;
    }
    
    return cleaned;
}

// ── public API ──

/**
 * Add a sender phone number to the pool (batched write, non-blocking).
 * Normalizes to E.164, deduplicates.
 * @param {string} senderId - phone number from SMS sender_id field
 */
function collectSenderId(senderId) {
    if (!senderId) return;
    const normalized = normalizeToE164(senderId);
    if (!normalized) return;
    
    loadPool();
    
    // Determine country prefix (longest match first)
    let prefix = '';
    const sortedKeys = Object.keys(COUNTRY_NORMALIZE).sort((a, b) => b.length - a.length);
    for (const p of sortedKeys) {
        if (normalized.startsWith(p)) { prefix = p; break; }
    }
    if (!prefix) prefix = normalized.substring(0, Math.min(3, normalized.length));
    
    // Ensure prefix exists in pool
    if (!pool[prefix]) pool[prefix] = [];
    if (!pool[prefix].includes(normalized)) {
        pool[prefix].push(normalized);
        markDirty();
    }
}

/**
 * Pick a caller ID from the pool matching the destination's country.
 * Falls back to any foreign number if no match for the destination country.
 * @param {string} destination - E.164 destination number
 * @returns {string|null} caller ID in E.164 format (+prefixnumber), or null
 */
function pickCallerId(destination) {
    const cleaned = String(destination || '').replace(/[^0-9]/g, '');
    if (!cleaned) return null;
    
    loadPool();
    
    // Find the destination's country prefix
    let destPrefix = '';
    const sortedKeys = Object.keys(COUNTRY_NORMALIZE).sort((a, b) => b.length - a.length);
    for (const p of sortedKeys) {
        if (cleaned.startsWith(p)) { destPrefix = p; break; }
    }
    if (!destPrefix) destPrefix = cleaned.substring(0, Math.min(3, cleaned.length));
    
    // Try same-country numbers first
    if (pool[destPrefix] && Array.isArray(pool[destPrefix]) && pool[destPrefix].length > 0) {
        const pick = pool[destPrefix][Math.floor(Math.random() * pool[destPrefix].length)];
        return '+' + pick;
    }
    
    // No numbers from this country — pick any from a DIFFERENT country (foreign ANI)
    const allForeign = [];
    for (const [p, nums] of Object.entries(pool)) {
        if (p.startsWith('_')) continue;
        if (p !== destPrefix && Array.isArray(nums)) allForeign.push(...nums);
    }
    if (allForeign.length > 0) {
        const pick = allForeign[Math.floor(Math.random() * allForeign.length)];
        return '+' + pick;
    }
    
    return null;
}

/**
 * Seed the pool from existing SMS logs on startup.
 * @param {object} dbPool - PostgreSQL pool
 */
async function collectFromRecentLogs(dbPool) {
    try {
        const r = await dbPool.query(
            "SELECT DISTINCT COALESCE(original_sender_id, sender_id) as real_sender FROM sms_logs WHERE COALESCE(original_sender_id, sender_id) ~ '^[0-9]{7,15}$' AND COALESCE(original_sender_id, sender_id) NOT LIKE '%.%' ORDER BY real_sender DESC LIMIT 200"
        );
        const before = countPool();
        for (const row of r.rows) {
            if (row.real_sender) collectSenderId(row.real_sender);
        }
        const after = countPool();
        flushPool(); // force immediate flush after seeding
        console.log('[CallerID-Pool] Seeded from SMS logs:', (after - before), 'new numbers, pool total:', after);
    } catch (e) {
        console.error('[CallerID-Pool] Failed to seed from logs:', e.message);
    }
}

function countPool() {
    if (!pool) loadPool();
    let total = 0;
    for (const [k, v] of Object.entries(pool)) {
        if (k.startsWith('_')) continue;
        if (Array.isArray(v)) total += v.length;
    }
    return total;
}

function getPoolStats() {
    if (!pool) loadPool();
    const stats = {};
    for (const [k, v] of Object.entries(pool)) {
        if (k.startsWith('_')) continue;
        if (Array.isArray(v)) stats[k] = v.length;
    }
    return { total: countPool(), countries: stats };
}

// Flush on process exit
process.on('exit', () => flushPool());
process.on('SIGINT', () => { flushPool(); process.exit(); });
process.on('SIGTERM', () => { flushPool(); process.exit(); });

module.exports = { collectSenderId, pickCallerId, collectFromRecentLogs, getPoolStats, countPool };
