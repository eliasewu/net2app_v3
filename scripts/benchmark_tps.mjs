#!/usr/bin/env node
// ============================================================
// NET2APP SMS PLATFORM — TPS BENCHMARKING TOOL
// ============================================================
// Measures actual server throughput capacity by:
//   1. Enqueue throughput: How fast can the server accept SMS into the queue?
//   2. Process throughput: How fast can workers process queued messages?
//   3. DB connection pool utilization under load
//
// Usage:
//   node scripts/benchmark_tps.mjs [--enqueue-only] [--process-only] [--duration 10] [--tps 200]
//
// Options:
//   --enqueue-only    Only test enqueue speed (not processing)
//   --process-only    Only test worker processing speed (requires existing queued messages)
//   --duration N      Test duration in seconds (default: 10)
//   --tps N           Target enqueue TPS to simulate (default: 200)
//   --db-host HOST    DB host (default: localhost)
//   --db-name NAME    DB name (default: sms_platform)
// ============================================================

import pg from 'pg';
import { parseArgs } from 'node:util';

// ── Parse CLI args ──
const args = process.argv.slice(2);
let mode = 'full';   // 'full' | 'enqueue' | 'process'
let duration = 10;
let targetTps = 200;

let autoCleanup = false; // auto-cleanup without prompting
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--enqueue-only') mode = 'enqueue';
  else if (args[i] === '--process-only') mode = 'process';
  else if (args[i] === '--duration' && args[i + 1]) { duration = parseInt(args[++i]); }
  else if (args[i] === '--tps' && args[i + 1]) { targetTps = parseInt(args[++i]); }
  else if (args[i] === '--cleanup') autoCleanup = true;
}

const DB_HOST = process.env.DB_HOST || 'localhost';
const DB_PORT = process.env.DB_PORT || 5432;
const DB_NAME = process.env.DB_NAME || 'sms_platform';
const DB_USER = process.env.DB_USER || 'sms_user';
const DB_PASS = process.env.DB_PASS || 'Ariya@2024Net2App';

const PREFIX = '99'; // Benchmark message prefix to distinguish from real traffic

console.log(`
╔══════════════════════════════════════════════════════════╗
║         NET2APP SMS PLATFORM — TPS BENCHMARK             ║
╠══════════════════════════════════════════════════════════╣
║  Mode:     ${mode.padEnd(46)}║
║  Duration: ${String(duration).padEnd(46)}║
║  Target:   ${String(targetTps + ' TPS').padEnd(46)}║
║  DB:       ${(DB_HOST + ':' + DB_PORT + '/' + DB_NAME).padEnd(46)}║
╚══════════════════════════════════════════════════════════╝
`);

const pool = new pg.Pool({
  host: DB_HOST, port: DB_PORT, database: DB_NAME,
  user: DB_USER, password: DB_PASS,
  max: 50, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000,
});

// ── Generate unique message IDs ──
function genMsgId(i) {
  return `${PREFIX}${Date.now()}${String(i).padStart(6, '0')}`;
}

// ── ENQUEUE BENCHMARK ──
async function benchmarkEnqueue() {
  console.log('[BENCH] Starting ENQUEUE benchmark...\n');

  const startTime = Date.now();
  const endTime = startTime + duration * 1000;
  let enqueued = 0;
  let failed = 0;
  let batchCount = 0;
  let maxLatencyMs = 0;
  let totalLatencyMs = 0;

  // Calculate batch size to hit target TPS with 10 batches/second
  const batchSize = Math.max(1, Math.ceil(targetTps / 10));
  const intervalMs = 100; // 10 batches per second

  while (Date.now() < endTime) {
    const batchStart = Date.now();
    const values = [];
    const placeholders = [];
    let paramIdx = 0;

    for (let i = 0; i < batchSize; i++) {
      const msgId = genMsgId(enqueued + i);

      // Each row has 26 columns
      const cols = 26;
      const rowPh = [];
      for (let j = 0; j < cols; j++) rowPh.push(`$${++paramIdx}`);
      placeholders.push(`(${rowPh.join(',')})`);

      values.push(
        msgId,                        // message_id
        1,                            // client_id
        'BENCHMARK',                  // client_code
        null,                         // supplier_id
        null,                         // supplier_code
        'BENCHMARK',                  // sender_id
        '1234567890',                 // destination
        'benchmark test message',     // message
        1,                            // message_parts
        0.001, 0.0005, 0.0005, 'EUR', // rates
        '', '', '', '', '', '',       // mcc, mnc, operator, country, route, trunk
        'dlr', 'dlr', '', null, null, // billing
        'benchmark',                  // source
        'queued', 0, 5,               // status, attempt, max_attempts
        new Date().toISOString(),     // next_attempt_at
        new Date().toISOString()      // queued_at
      );
    }

    const allCols = [
      'message_id', 'client_id', 'client_code', 'supplier_id', 'supplier_code',
      'sender_id', 'destination', 'message', 'message_parts',
      'client_rate', 'supplier_rate', 'profit', 'currency',
      'mcc', 'mnc', 'operator', 'country', 'route_name', 'trunk_name',
      'billing_mode', 'supplier_billing_mode', 'webhook_url', 'idempotency_key', 'voice_otp_config_id',
      'source', 'status', 'attempt_count', 'max_attempts', 'next_attempt_at', 'queued_at'
    ];

    try {
      await pool.query(
        `INSERT INTO sms_outbox (${allCols.join(', ')})
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (message_id) DO NOTHING`,
        values
      );
      enqueued += batchSize;
      batchCount++;

      const batchLatencyMs = Date.now() - batchStart;
      totalLatencyMs += batchLatencyMs;
      if (batchLatencyMs > maxLatencyMs) maxLatencyMs = batchLatencyMs;
    } catch (e) {
      failed += batchSize;
      console.error(`[BENCH] Batch insert failed: ${e.message}`);
    }

    // Sleep to maintain target TPS
    const elapsed = Date.now() - batchStart;
    const sleepMs = Math.max(0, intervalMs - elapsed);
    if (sleepMs > 0) await new Promise(r => setTimeout(r, sleepMs));
  }

  const elapsedSec = (Date.now() - startTime) / 1000;

  console.log(`
┌──────────────────────────────────────────────────────────┐
│  ENQUEUE BENCHMARK RESULTS                               │
├──────────────────────────────────────────────────────────┤
│  Duration:            ${String(Math.round(elapsedSec * 10) / 10 + 's').padEnd(41)}│
│  Total enqueued:      ${String(enqueued.toLocaleString()).padEnd(41)}│
│  Total failed:        ${String(failed.toLocaleString()).padEnd(41)}│
│  Batches:             ${String(batchCount.toLocaleString()).padEnd(41)}│
│  Batch size:          ${String(batchSize).padEnd(41)}│
│  Avg batch latency:   ${String(Math.round(totalLatencyMs / Math.max(1, batchCount)) + 'ms').padEnd(41)}│
│  Max batch latency:   ${String(maxLatencyMs + 'ms').padEnd(41)}│
│  ─────────────────────────────────────────────────────── │
│  EFFECTIVE TPS:       ${String(Math.round(enqueued / elapsedSec) + ' msg/s').padEnd(41)}│
│  DB ops/sec:          ${String(Math.round(batchCount / elapsedSec) + ' batches/s').padEnd(41)}│
└──────────────────────────────────────────────────────────┘
`);

  return { enqueued, failed, elapsedSec, tps: Math.round(enqueued / elapsedSec) };
}

// ── PROCESS BENCHMARK ──
async function benchmarkProcess() {
  console.log('[BENCH] Starting PROCESS benchmark...\n');

  // Check initial queue depth
  const initial = await pool.query(
    `SELECT COUNT(*) as count FROM sms_outbox WHERE status = 'queued' AND source = 'benchmark'`
  );
  const initialCount = parseInt(initial.rows[0].count);

  if (initialCount === 0) {
    console.log('[BENCH] No benchmark messages queued. Run enqueue benchmark first or use --enqueue-only.\n');
    return { processed: 0, elapsedSec: 0, tps: 0 };
  }

  console.log(`[BENCH] Initial queue depth: ${initialCount} benchmark messages`);
  console.log(`[BENCH] Waiting for workers to process... (duration: ${duration}s)\n`);

  const startTime = Date.now();
  const endTime = startTime + duration * 1000;

  // Poll queue depth
  const snapshots = [];
  while (Date.now() < endTime) {
    const r = await pool.query(
      `SELECT COUNT(*) as count FROM sms_outbox WHERE source = 'benchmark' AND status IN ('queued','processing')`
    );
    snapshots.push({
      time: Date.now(),
      remaining: parseInt(r.rows[0].count),
    });
    await new Promise(r => setTimeout(r, 1000));
  }

  const final = await pool.query(
    `SELECT COUNT(*) as count FROM sms_outbox WHERE source = 'benchmark' AND status NOT IN ('queued','processing')`
  );
  const processed = parseInt(final.rows[0].count);
  const elapsedSec = Math.max(1, (Date.now() - startTime) / 1000);

  console.log(`
┌──────────────────────────────────────────────────────────┐
│  PROCESS BENCHMARK RESULTS                               │
├──────────────────────────────────────────────────────────┤
│  Duration:            ${String(Math.round(elapsedSec) + 's').padEnd(41)}│
│  Initial queue:       ${String(initialCount.toLocaleString()).padEnd(41)}│
│  Processed:           ${String(processed.toLocaleString()).padEnd(41)}│
│  Remaining:           ${String((initialCount - processed).toLocaleString()).padEnd(41)}│
│  ─────────────────────────────────────────────────────── │
│  PROCESS TPS:         ${String(Math.round(processed / elapsedSec) + ' msg/s').padEnd(41)}│
└──────────────────────────────────────────────────────────┘
`);

  return { processed, initialCount, elapsedSec, tps: Math.round(processed / elapsedSec) };
}

// ── Cleanup ──
async function cleanup() {
  const r = await pool.query(
    `DELETE FROM sms_outbox WHERE source = 'benchmark'`
  );
  console.log(`[BENCH] Cleaned up ${r.rowCount} benchmark messages`);
}

// ── Main ──
async function main() {
  try {
    if (mode === 'enqueue' || mode === 'full') {
      await benchmarkEnqueue();
    }

    if (mode === 'process' || mode === 'full') {
      await benchmarkProcess();
    }

    // Summary
    console.log(`
╔══════════════════════════════════════════════════════════╗
║  BENCHMARK COMPLETE                                      ║
╠══════════════════════════════════════════════════════════╣
║  To test API endpoint:                                   ║
║    curl -X POST http://localhost:3001/api/queue/tps-benchmark \\
║         -H "Authorization: Bearer TOKEN"                 ║
║         -H "Content-Type: application/json"              ║
║         -d '{"duration_sec":5, "batch_size":100}'        ║
║                                                          ║
║  To view queue stats:                                    ║
║    curl http://localhost:3001/api/queue/stats             ║
║         -H "Authorization: Bearer TOKEN"                 ║
╚══════════════════════════════════════════════════════════╝
`);

    // Cleanup: auto if --cleanup flag passed, otherwise prompt
    if (autoCleanup) {
      await cleanup();
      await pool.end();
      process.exit(0);
    } else {
      const readline = (await import('readline')).default;
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question('[BENCH] Clean up benchmark messages? (y/n) ', async (answer) => {
        if (answer.toLowerCase() === 'y') await cleanup();
        rl.close();
        await pool.end();
        process.exit(0);
      });
    }
  } catch (e) {
    console.error('[BENCH] Fatal error:', e.message);
    await pool.end();
    process.exit(1);
  }
}

main();
