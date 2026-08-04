/**
 * END-TO-END TEST: SMS → Voice OTP Full Pipeline
 *
 * Flow:
 *   1. POST /api/auth/login (admin) → JWT
 *   2. POST /api/sms/send  → resolveRoute → queueManager.enqueue
 *   3. Queue worker picks up job → detects voice_otp → fires engine
 *   4. Voice OTP Engine: extract OTP → resolve bn-BD → build audio → originate call via SIP
 *   5. Monitor sms_logs + voice_otp_logs for final DLR status
 *
 * Usage: node test-e2e-sms-to-voice.cjs
 */

const { Pool } = require('pg');
const http = require('http');

// ====== Config ======
const API_BASE = 'http://localhost:3001';
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'admin123';
const CLIENT_ID = 4;
const DESTINATION = '+8801615069178';
const SENDER_ID = 'TEST';
const MESSAGE = '252525';

const pool = new Pool({
  host: 'localhost', port: 5432,
  database: 'sms_platform', user: 'sms_user',
  password: 'Ariya@2024Net2App',
});

// ====== HTTP helpers ======
function httpPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: urlObj.hostname, port: urlObj.port,
      path: urlObj.pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), ...headers },
      timeout: 30000,
    }, (res) => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ====== Main ======
async function main() {
  const startTime = Date.now();
  console.log('══════════════════════════════════════════════════');
  console.log('  E2E TEST: SMS → Voice OTP Pipeline');
  console.log('══════════════════════════════════════════════════');
  console.log(`  Client ID:    ${CLIENT_ID}`);
  console.log(`  Destination:  ${DESTINATION}`);
  console.log(`  Message:      "${MESSAGE}"`);
  console.log('  Chain:  Client 4 → Plan 4 → Route 23 → Trunk 44 → Supplier 63 → Config 85 (bn-BD)');
  console.log('══════════════════════════════════════════════════\n');

  // === STEP 1: Login ===
  console.log('[1/5] Authenticating as admin...');
  let token;
  try {
    const login = await httpPost(`${API_BASE}/api/auth/login`, {
      username: ADMIN_USER, password: ADMIN_PASS,
    });
    if (login.status !== 200 || !login.body.token) {
      console.error(`  ❌ Login failed: ${login.status} — ${JSON.stringify(login.body)}`);
      process.exit(1);
    }
    token = login.body.token;
    console.log('  ✅ Logged in as admin\n');
  } catch (e) {
    console.error(`  ❌ Cannot reach server: ${e.message}`);
    process.exit(1);
  }

  // === STEP 2: Send SMS ===
  console.log('[2/5] Sending SMS via /api/sms/send...');
  let msgId;
  try {
    const send = await httpPost(`${API_BASE}/api/sms/send`, {
      client_id: CLIENT_ID,
      destination: DESTINATION,
      sender_id: SENDER_ID,
      message: MESSAGE,
      source: 'e2e_test',
    }, { 'Authorization': `Bearer ${token}` });

    console.log(`  HTTP Status: ${send.status}`);
    console.log(`  Response:    ${JSON.stringify(send.body)}`);

    if (!send.body.success || !send.body.data?.message_id) {
      console.error(`  ❌ SMS send failed: ${JSON.stringify(send.body)}`);
      process.exit(1);
    }
    msgId = send.body.data.message_id;
    console.log(`  ✅ SMS accepted — message_id: ${msgId}\n`);
  } catch (e) {
    console.error(`  ❌ SMS send error: ${e.message}`);
    process.exit(1);
  }

  // === STEP 3: Check immediate routing ===
  console.log('[3/5] Checking routing info in sms_logs...');
  await sleep(2000); // Give queue a moment
  let smsLog = null;
  try {
    const res = await pool.query(
      'SELECT * FROM sms_logs WHERE message_id = $1 LIMIT 1', [msgId]
    );
    smsLog = res.rows[0];
    if (smsLog) {
      console.log(`  Status:       ${smsLog.status}`);
      console.log(`  DLR:          ${smsLog.dlr_status || '(none)'}`);
      console.log(`  Channel:      ${smsLog.channel || '(not set)'}`);
      console.log(`  Supplier:     ${smsLog.supplier_code || '(none)'} (id=${smsLog.supplier_id})`);
      console.log(`  Route:        ${smsLog.route_name || '(none)'}`);
      console.log(`  Trunk:        ${smsLog.trunk_name || '(none)'}`);
      console.log(`  Client Rate:  ${smsLog.client_rate}`);
      console.log(`  Supplier Rate:${smsLog.supplier_rate}`);
    } else {
      console.log('  ⚠ Not in sms_logs yet — may still be queued');
    }
  } catch (e) {
    console.log(`  ⚠ DB query error: ${e.message}`);
  }
  console.log('');

  // === STEP 4: Poll for voice_otp_logs ===
  console.log('[4/5] Polling voice_otp_logs for call result...');
  let callResult = null;
  for (let i = 0; i < 30; i++) {
    await sleep(3000); // 3s intervals
    try {
      const res = await pool.query(
        "SELECT * FROM voice_otp_logs WHERE destination = $1 ORDER BY created_at DESC LIMIT 1",
        [DESTINATION.replace('+', '')]
      );
      if (res.rows.length > 0) {
        const log = res.rows[0];
        console.log(`  [${i + 1}] status=${log.status} dlr=${log.dlr_status} duration=${log.duration}ms language=${log.language || '?'} attempts=${log.retry_count}/${log.max_retries}`);
        if (['completed', 'delivered', 'failed'].includes(log.status) || log.dlr_status === 'DELIVRD') {
          callResult = log;
          break;
        }
      } else {
        console.log(`  [${i + 1}] waiting... (no voice_otp_log entry yet)`);
      }
    } catch (e) {
      console.log(`  [${i + 1}] DB error: ${e.message}`);
    }
  }
  console.log('');

  // === STEP 5: Final verification ===
  console.log('══════════════════════════════════════════════════');
  console.log('  FINAL RESULTS');
  console.log('══════════════════════════════════════════════════');

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  try {
    const finalSms = await pool.query(
      'SELECT * FROM sms_logs WHERE message_id = $1 LIMIT 1', [msgId]
    );
    const sms = finalSms.rows[0];
    console.log(`  sms_logs:   status=${sms?.status || '?'}  dlr=${sms?.dlr_status || '?'}  channel=${sms?.channel || '?'}`);
  } catch {}

  if (callResult) {
    console.log(`  voice_otp:  status=${callResult.status}  dlr=${callResult.dlr_status}  duration=${callResult.duration}ms`);
    console.log(`  language:   ${callResult.language || 'unknown'}`);

    if (callResult.dlr_status === 'DELIVRD' || callResult.status === 'completed') {
      console.log(`\n  ✅ E2E TEST PASSED — Voice OTP call delivered!`);
      console.log(`  Time:        ${elapsed}s`);
      console.log('══════════════════════════════════════════════════');
      await pool.end();
      process.exit(0);
    } else if (callResult.status === 'failed') {
      console.log(`\n  ❌ Call FAILED — ${callResult.error_message || 'no error detail'}`);
    }
  } else {
    console.log(`  ⚠ No voice_otp_log entry found after ${elapsed}s polling`);
    console.log(`  This could mean: queue not running, supplier not voice_otp, or rate check failed`);
  }

  // Check if THIS message was rejected
  try {
    const rej = await pool.query(
      "SELECT * FROM sms_logs WHERE message_id = $1 AND status = 'failed'",
      [msgId]
    );
    if (rej.rows.length > 0) {
      console.log(`\n  ❌ THIS SMS was REJECTED: code=${rej.rows[0].error_code} msg=${rej.rows[0].error_message}`);
    }
  } catch {}

  console.log('══════════════════════════════════════════════════');
  await pool.end();
  process.exit(1);
}

main().catch(err => {
  console.error('FATAL:', err);
  pool.end().catch(() => {});
  process.exit(2);
});
