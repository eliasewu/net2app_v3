// ============================================================
// SMS Queue Manager - PostgreSQL-based async job queue
// Uses FOR UPDATE SKIP LOCKED for concurrent worker processing
// Designed for 1000+ clients and 1000+ suppliers
// No Redis/MQ needed — relies entirely on PostgreSQL
// ============================================================

import { createRequire } from 'module';
import rateLimiter from './rateLimiter.mjs';

const require = createRequire(import.meta.url);

// Lazy-load voice OTP engine (CJS module) — only loaded when a voice_otp job is processed
let _voiceOtpEngine = null;
function getVoiceOtpEngine() {
  if (!_voiceOtpEngine) {
    try {
      _voiceOtpEngine = require('./voiceOtpEngine.cjs');
      console.log('[QueueManager] Voice OTP engine loaded');
    } catch (e) {
      console.error('[QueueManager] Failed to load voice OTP engine:', e.message);
      _voiceOtpEngine = null;
    }
  }
  return _voiceOtpEngine;
}

class SMSQueueManager {
  constructor(pool, options = {}) {
    this.pool = pool;
    this.connectionPoolMgr = options.connectionPoolMgr || null;
    this.workers = [];
    this.running = false;

    /**
     * DLR callback: invoked after a job is delivered or fails.
     * Set by server.cjs after SmppServer is initialized.
     * Signature: (job) => void, where job = { client_id, message_id, destination,
     *   sender_id, status, client_code, queued_at }
     */
    this.onDlr = null;

    this.stats = {
      processed: 0,
      delivered: 0,
      failed: 0,
      throttled: 0,
      rejected: 0,
      lastProcessed: null,
    };

    // Configurable options
    this.pollIntervalMs = options.pollIntervalMs || 200;       // How often each worker polls
    this.batchSize = options.batchSize || 50;                   // Jobs per poll
    this.workerCount = options.workerCount || 4;                // Number of concurrent workers
    this.maxRetries = options.maxRetries || 5;                  // Max delivery attempts
    this.retryBackoffBase = options.retryBackoffBase || 1000;   // Base backoff ms
    this.dlrTimeoutMs = options.dlrTimeoutMs || 300000;         // 5 min DLR timeout
    this.deadLetterAfterRetries = options.deadLetterAfterRetries || 5;
    this.maxPipelinesPerSupplier = options.maxPipelinesPerSupplier || 4;

    // Supplier connection_type cache (avoids DB query per job)
    // Each entry: { value, expiresAt } — TTL 60s to avoid stale reads
    this._supplierTypeCache = new Map();
    this._supplierTypeCacheTtlMs = 60000;
  }

  /** Initialize the outbox table (idempotent) */
  async initialize() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS sms_outbox (
        id BIGSERIAL PRIMARY KEY,
        message_id VARCHAR(100) UNIQUE NOT NULL,
        client_id INTEGER NOT NULL,
        client_code VARCHAR(50),
        supplier_id INTEGER,
        supplier_code VARCHAR(50),
        sender_id VARCHAR(100) NOT NULL,
        destination VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        message_parts INTEGER DEFAULT 1,
        client_rate DECIMAL(10,6) DEFAULT 0,
        supplier_rate DECIMAL(10,6) DEFAULT 0,
        profit DECIMAL(10,6) DEFAULT 0,
        currency VARCHAR(3) DEFAULT 'EUR',
        mcc VARCHAR(10),
        mnc VARCHAR(10),
        operator VARCHAR(100),
        country VARCHAR(100),
        route_name VARCHAR(255),
        trunk_name VARCHAR(255),
        billing_mode VARCHAR(20) DEFAULT 'dlr',
        supplier_billing_mode VARCHAR(20) DEFAULT 'dlr',
        webhook_url TEXT,
        
        -- Queue state
        status VARCHAR(20) DEFAULT 'queued' CHECK (status IN ('queued','processing','submitted','delivered','failed','dead_letter')),
        pipeline_id VARCHAR(50),
        attempt_count INTEGER DEFAULT 0,
        max_attempts INTEGER DEFAULT 5,
        next_attempt_at TIMESTAMP DEFAULT NOW(),
        last_attempt_at TIMESTAMP,
        last_error TEXT,
        dlr_status VARCHAR(20),
        dlr_received_at TIMESTAMP,
        
        -- Timing
        queued_at TIMESTAMP DEFAULT NOW(),
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        
        -- For idempotency
        idempotency_key VARCHAR(255)
      );
      
      -- Migrate existing tables that may lack operator/country columns
      ALTER TABLE sms_outbox ADD COLUMN IF NOT EXISTS operator VARCHAR(100);
      ALTER TABLE sms_outbox ADD COLUMN IF NOT EXISTS country VARCHAR(100);
      ALTER TABLE sms_outbox ADD COLUMN IF NOT EXISTS connector_transaction_id VARCHAR(100);
      ALTER TABLE sms_outbox ADD COLUMN IF NOT EXISTS dlr_confirmed_at TIMESTAMP;
      ALTER TABLE sms_outbox ADD COLUMN IF NOT EXISTS source VARCHAR(30);
      ALTER TABLE sms_outbox ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 0;
      ALTER TABLE sms_outbox ADD COLUMN IF NOT EXISTS voice_otp_config_id INTEGER;
      
      -- Indexes for queue polling performance
      CREATE INDEX IF NOT EXISTS idx_sms_outbox_poll 
        ON sms_outbox(status, next_attempt_at) 
        WHERE status IN ('queued', 'dead_letter');
      
      CREATE INDEX IF NOT EXISTS idx_sms_outbox_client 
        ON sms_outbox(client_id, queued_at);
      
      CREATE INDEX IF NOT EXISTS idx_sms_outbox_supplier 
        ON sms_outbox(supplier_id, status);
      
      CREATE INDEX IF NOT EXISTS idx_sms_outbox_message_id 
        ON sms_outbox(message_id);
      
      CREATE INDEX IF NOT EXISTS idx_sms_outbox_idempotency 
        ON sms_outbox(idempotency_key) 
        WHERE idempotency_key IS NOT NULL;
    `);
    console.log('[QueueManager] sms_outbox table ready');
  }

  /** Enqueue an SMS for async processing. Returns immediately with message_id. */
  async enqueue(job) {
    const {
      message_id, client_id, client_code, supplier_id, supplier_code,
      sender_id, destination, message, message_parts,
      client_rate, supplier_rate, profit, currency,
      mcc, mnc, operator, country, route_name, trunk_name,
      billing_mode, supplier_billing_mode, webhook_url, idempotency_key, source,
      voice_otp_config_id
    } = job;

    // Idempotency check
    if (idempotency_key) {
      const existing = await this.pool.query(
        'SELECT message_id, status FROM sms_outbox WHERE idempotency_key = $1 LIMIT 1',
        [idempotency_key]
      );
      if (existing.rows.length > 0) {
        return { 
          duplicate: true, 
          message_id: existing.rows[0].message_id,
          status: existing.rows[0].status 
        };
      }
    }

    const result = await this.pool.query(
      `INSERT INTO sms_outbox (
        message_id, client_id, client_code, supplier_id, supplier_code,
        sender_id, destination, message, message_parts,
        client_rate, supplier_rate, profit, currency,
        mcc, mnc, operator, country, route_name, trunk_name,
        billing_mode, supplier_billing_mode, webhook_url, idempotency_key, voice_otp_config_id,
        source, status, attempt_count, max_attempts, next_attempt_at, queued_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
        $20,$21,$22,$23,$24,$25,'queued',0,$26,NOW(),NOW()
      ) RETURNING message_id, status`,
      [
        message_id, client_id, client_code, supplier_id, supplier_code,
        sender_id, destination, message, message_parts || 1,
        client_rate || 0, supplier_rate || 0, profit || 0, currency || 'EUR',
        mcc || '', mnc || '', operator || '', country || '', route_name || '', trunk_name || '',
        billing_mode || 'dlr', supplier_billing_mode || 'dlr', webhook_url || '', idempotency_key || null,
        voice_otp_config_id || null,
        source || 'smpp_client',
        this.maxRetries
      ]
    );
    
    console.log(`[QueueManager] Enqueued: ${message_id} → ${destination} (client=${client_code}, supplier=${supplier_code})`);
    return { message_id: result.rows[0].message_id, status: 'queued' };
  }

  /** Start worker processes that poll the outbox and process jobs */
  async start() {
    if (this.running) return;
    this.running = true;
    // ── Startup: recover orphaned jobs ──
    // Workers mark jobs as 'submitted' before dispatching to engines.
    // If a worker crashes or is restarted, these jobs become orphaned.
    // Reset them back to 'queued' so they get re-processed.
    try {
      const orphanResult = await this.pool.query(
        `UPDATE sms_outbox SET status = 'queued', next_attempt_at = NOW()
         WHERE status IN ('submitted', 'processing')
           AND next_attempt_at < NOW() - INTERVAL '5 seconds'
         RETURNING message_id`
      );
      if (orphanResult.rows.length > 0) {
        console.log(`[QueueManager] Recovered ${orphanResult.rows.length} orphaned job(s) — reset to queued`);
      }
    } catch (e) {
      console.warn('[QueueManager] Failed to recover orphaned jobs:', e.message);
    }
    
    console.log(`[QueueManager] Starting ${this.workerCount} workers (batch=${this.batchSize}, poll=${this.pollIntervalMs}ms)`);
    
    for (let i = 0; i < this.workerCount; i++) {
      this.startWorker(i);
    }
  }

  /** Stop all workers gracefully */
  stop() {
    this.running = false;
    console.log('[QueueManager] Stopping workers...');
  }

  /** Single worker loop */
  async startWorker(workerId) {
    console.log(`[QueueManager] Worker #${workerId} started`);
    
    while (this.running) {
      try {
        const processed = await this.processBatch(workerId);
        if (processed === 0) {
          // No jobs available, sleep before next poll
          await this.sleep(this.pollIntervalMs);
        }
        // If we processed jobs, immediately poll again for more
      } catch (error) {
        console.error(`[QueueManager] Worker #${workerId} error:`, error.message);
        await this.sleep(1000);
      }
    }
    
    console.log(`[QueueManager] Worker #${workerId} stopped`);
  }

  /** Fetch and process a batch of queued jobs */
  async processBatch(workerId) {
    const client = await this.pool.connect();
    let jobs = [];
    try {
      await client.query('BEGIN');
      
      // FOR UPDATE SKIP LOCKED: claim jobs without blocking other workers
      const result = await client.query(
        `SELECT * FROM sms_outbox
         WHERE status = 'queued' 
           AND next_attempt_at <= NOW()
         ORDER BY priority DESC, queued_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        [this.batchSize]
      );

      if (result.rows.length === 0) {
        await client.query('COMMIT');
        return 0;
      }

      jobs = result.rows;

      // Mark as processing
      const ids = jobs.map(j => j.id);
      await client.query(
        `UPDATE sms_outbox SET status = 'processing', started_at = NOW(), pipeline_id = $1 WHERE id = ANY($2::bigint[])`,
        [`worker-${workerId}`, ids]
      );
      
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release(); // Release connection immediately after claiming
    }

    // Process each job with individual connections (not holding one for the entire batch)
    let processed = 0;
    for (const job of jobs) {
      try {
        await this.processJob(job, workerId);
        processed++;
      } catch (error) {
        console.error(`[QueueManager] Job ${job.message_id} failed:`, error.message);
        await this.handleJobFailure(job, error.message);
        processed++;
      }
    }

    return processed;
  }

  /** Process a single SMS job */
  async processJob(job, workerId) {
    const { id, message_id, client_id, supplier_id, destination, message, sender_id,
            client_rate, supplier_rate, billing_mode, supplier_billing_mode, webhook_url, attempt_count,
            voice_otp_config_id } = job;

    // --- Rate Limiting ---
    // Check client TPS
    const clientCheck = rateLimiter.checkClient(client_id);
    if (!clientCheck.allowed) {
      // Re-queue with delay
      // Note: we increment attempt_count so it doesn't count as a failure
      await this.pool.query(
        `UPDATE sms_outbox SET status = 'queued', next_attempt_at = NOW() + INTERVAL '${Math.ceil(clientCheck.waitMs / 1000)} seconds', attempt_count = $1 WHERE id = $2`,
        [attempt_count, id]  // don't increment attempt for rate limiting
      );
      this.stats.throttled++;
      console.log(`[QueueManager] Throttled client ${client_id} for SMS ${message_id} (wait ${clientCheck.waitMs}ms)`);
      return;
    }

    // Check supplier TPS
    if (supplier_id) {
      const supplierCheck = rateLimiter.checkSupplier(supplier_id);
      if (!supplierCheck.allowed) {
        await this.pool.query(
          `UPDATE sms_outbox SET status = 'queued', next_attempt_at = NOW() + INTERVAL '${Math.ceil(supplierCheck.waitMs / 1000)} seconds', attempt_count = $1 WHERE id = $2`,
          [attempt_count, id]
        );
        this.stats.throttled++;
        console.log(`[QueueManager] Throttled supplier ${supplier_id} for SMS ${message_id} (wait ${supplierCheck.waitMs}ms)`);
        return;
      }
    }

    // --- Submit to Supplier ---
    // Before normal delivery, check if this is a voice_otp supplier
    if (supplier_id) {
      const connType = await this._getSupplierConnectionType(supplier_id);
      if (connType === 'voice_otp') {
        // Voice OTP path — fire engine asynchronously, mark submitted immediately
        await this._handleVoiceOtpJob(job, id, message_id, client_id, supplier_id,
          destination, message, sender_id, client_rate, supplier_rate,
          billing_mode, webhook_url, voice_otp_config_id);
        return;
      }
      // If cache returned null (DB error / supplier deleted), fail safely
      // rather than falling through to SMS delivery for a possibly-voice_otp supplier
      if (connType === null) {
        console.warn(`[QueueManager] Unknown supplier type for #${supplier_id}, skipping delivery`);
        await this.handleJobFailure(job, 'Supplier connection type unknown (DB error or deleted)');
        return;
      }
    }

    // Normal SMS delivery (SMPP/HTTP/etc)
    const result = await this.deliverToSupplier(job);

    if (result && result.success) {
      // Save connector transaction_id for DLR polling (Voice OTP / HTTP connectors)
      if (result.transaction_id) {
        await this.pool.query(
          'UPDATE sms_outbox SET connector_transaction_id = $1 WHERE id = $2',
          [result.transaction_id, id]
        );
      }
      // Mark as submitted (not delivered — wait for real DLR)
      await this.pool.query(
        `UPDATE sms_outbox SET 
           status = 'submitted', 
           dlr_status = 'PENDING',
           completed_at = NOW()
         WHERE id = $1`,
        [id]
      );

      // Also update the main sms_logs table — submitted, not delivered
      // Determine source label for UI display
      const smsSource = job.source || 'smpp_client';

      // is_client_billed / is_supplier_billed: set to true if submit-mode billing
      // already deducted that party's balance. DLR-mode parties stay false.
      const isClientBilled = (billing_mode || 'dlr') === 'submit';
      const isSupplierBilled = (job.supplier_billing_mode || 'dlr') === 'submit';
      const isBilled = isClientBilled && (isSupplierBilled || !supplier_id);
      await this.pool.query(
        `INSERT INTO sms_logs (
          message_id, client_id, client_code, supplier_id, supplier_code,
          sender_id, destination, message, message_parts,
          client_rate, supplier_rate, profit, currency,
          mcc, mnc, operator, country, route_name, trunk_name,
          status, dlr_status, billing_mode_snapshot, supplier_billing_mode_snapshot,
          is_client_billed, is_supplier_billed, is_billed, source, submit_time
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
          'submitted', 'PENDING', $20, $21, $22, $23, $24, $25, NOW()
        ) ON CONFLICT (message_id) DO UPDATE SET
          status = 'submitted', dlr_status = 'PENDING',
          is_client_billed = COALESCE(sms_logs.is_client_billed, EXCLUDED.is_client_billed),
          is_supplier_billed = COALESCE(sms_logs.is_supplier_billed, EXCLUDED.is_supplier_billed),
          is_billed = COALESCE(sms_logs.is_billed, EXCLUDED.is_billed),
          source = EXCLUDED.source`,
        [
          message_id, client_id, job.client_code, supplier_id, job.supplier_code,
          sender_id, destination, message, job.message_parts || 1,
          client_rate, supplier_rate, job.profit || 0, job.currency || 'EUR',
          job.mcc || '', job.mnc || '', job.operator || '', job.country || '', job.route_name || '', job.trunk_name || '',
          billing_mode || 'dlr', supplier_billing_mode || 'dlr',
          isClientBilled, isSupplierBilled, isBilled, smsSource
        ]
      );

      // DLR billing, webhook, and DLR push are deferred to real DLR confirmation
      // (HTTP DLR poll in server.cjs or SMPP DLR handler in smppServer.mjs)

      this.stats.processed++;
      console.log(`[QueueManager] ✓ Submitted: ${message_id} → ${destination} (waiting for DLR)`);
    } else {
      // Will be handled by handleJobFailure → retry or dead letter
      throw new Error('Supplier rejected or timed out');
    }
  }

  /** Deliver SMS to supplier — inbound (deliver_sm via SMPP server) or outbound (submit_sm via pipeline) */
  async deliverToSupplier(job) {
    // 1) Try inbound delivery via SMPP server session first
    if (this.onDeliverToInboundSupplier && job.supplier_id) {
      try {
        const delivered = await this.onDeliverToInboundSupplier(job.supplier_id, job);
        if (delivered) {
          console.log(`[QueueManager] ✓ Delivered to inbound supplier #${job.supplier_id}: ${job.message_id}`);
          return { success: true };
        }
        // Inbound supplier not connected — fall through to try outbound path
        console.log(`[QueueManager] ⚠ Inbound supplier #${job.supplier_id} not connected, trying outbound...`);
      } catch (e) {
        console.error(`[QueueManager] ✗ Inbound delivery failed: ${e.message}`);
        // Fall through to try outbound path
      }
    }

    // 2) Try outbound pipeline (connectionPoolMgr) for actual SMPP/HTTP outbound delivery
    if (this.connectionPoolMgr && job.supplier_id) {
      const pipeline = this.connectionPoolMgr.getPipeline(job.supplier_id);
      if (pipeline) {
        try {
          const result = await pipeline.sendMessage(job);
          console.log(`[QueueManager] ✓ Delivered via outbound pipeline to supplier #${job.supplier_id}: ${job.message_id}`);
          return { success: true, transaction_id: result?.transaction_id || null };
        } catch (e) {
          console.error(`[QueueManager] ✗ Outbound pipeline delivery failed for supplier #${job.supplier_id}: ${e.message}`);
          return { success: false };
        }
      }
    }

    // 3) Fallback: no delivery mechanism available
    console.log(`[QueueManager] ✗ No delivery path for supplier #${job.supplier_id}: ${job.message_id}`);
    return { success: false };
  }

  /** Handle a failed job: retry with backoff or move to dead letter */
  async handleJobFailure(job, errorMessage) {
    const newAttempt = (job.attempt_count || 0) + 1;
    
    if (newAttempt >= job.max_attempts) {
      // Dead letter queue
      await this.pool.query(
        `UPDATE sms_outbox SET 
           status = 'dead_letter', 
           attempt_count = $1,
           last_attempt_at = NOW(),
           last_error = $2,
           completed_at = NOW()
         WHERE id = $3`,
        [newAttempt, errorMessage, job.id]
      );
      this.stats.rejected++;
      console.log(`[QueueManager] ☠ Dead letter: ${job.message_id} after ${newAttempt} attempts`);
      
      // Also log to sms_logs as failed
      try {
        await this.pool.query(
          // Dead letters are never billed — always set billing flags false
          `INSERT INTO sms_logs (
            message_id, client_id, client_code, supplier_id, supplier_code,
            sender_id, destination, message, message_parts,
            client_rate, supplier_rate, profit, currency,
            mcc, mnc, operator, country, route_name, trunk_name,
            status, error_code, error_message, billing_mode_snapshot, supplier_billing_mode_snapshot,
            is_client_billed, is_supplier_billed, is_billed, source, submit_time
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
            'failed', 'DEAD_LETTER', $20, $21, $22, false, false, false, $23, NOW()
          ) ON CONFLICT (message_id) DO UPDATE SET
            status = 'failed', error_code = 'DEAD_LETTER', error_message = $20, source = EXCLUDED.source`,
          [
            job.message_id, job.client_id, job.client_code, job.supplier_id, job.supplier_code,
            job.sender_id, job.destination, job.message, job.message_parts || 1,
            job.client_rate, job.supplier_rate, job.profit || 0, job.currency || 'EUR',
            job.mcc || '', job.mnc || '', job.operator || '', job.country || '', job.route_name || '', job.trunk_name || '',
            `Dead letter after ${newAttempt} attempts: ${errorMessage}`, job.billing_mode || 'dlr', job.supplier_billing_mode || 'dlr', job.source || 'smpp_client'
          ]
        );
      } catch (e) { /* best effort */ }

      // DLR push: notify bound SMPP client of failure
      if (this.onDlr) {
        try {
          this.onDlr({
            client_id: job.client_id, message_id: job.message_id,
            destination: job.destination, sender_id: job.sender_id,
            status: 'UNDELIV', client_code: job.client_code, queued_at: job.queued_at,
            source: job.source || ''
          });
        } catch (e) { /* non-critical */ }
      }
    } else {
      // Retry with jittered exponential backoff (prevents thundering herd)
      const baseBackoff = Math.min(this.retryBackoffBase * Math.pow(2, newAttempt - 1), 60000);
      const jitter = Math.random() * baseBackoff * 0.3; // ±30% random jitter
      const backoffMs = Math.ceil(baseBackoff + jitter);
      await this.pool.query(
        `UPDATE sms_outbox SET 
           status = 'queued',
           attempt_count = $1,
           next_attempt_at = NOW() + INTERVAL '${Math.ceil(backoffMs / 1000)} seconds',
           last_attempt_at = NOW(),
           last_error = $2
         WHERE id = $3`,
        [newAttempt, errorMessage, job.id]
      );
      this.stats.failed++;
      console.log(`[QueueManager] ↻ Retry #${newAttempt}: ${job.message_id} in ${backoffMs}ms`);

      // DLR push on first failure only — subsequent retries don't re-notify
      if (newAttempt === 1 && this.onDlr) {
        try {
          this.onDlr({
            client_id: job.client_id, message_id: job.message_id,
            destination: job.destination, sender_id: job.sender_id,
            status: 'UNDELIV', client_code: job.client_code, queued_at: job.queued_at,
            source: job.source || ''
          });
        } catch (e) { /* non-critical */ }
      }
    }
  }

  /** Send webhook notification */
  async sendWebhook(url, messageId, destination, status, dlrStatus, clientCode) {
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message_id: messageId,
          destination,
          status,
          dlr_status: dlrStatus,
          client_code: clientCode,
          timestamp: new Date().toISOString()
        }),
        signal: AbortSignal.timeout(5000)
      });
    } catch (e) {
      console.error(`[QueueManager] Webhook failed for ${messageId}:`, e.message);
    }
  }

  /** Get queue statistics for dashboard */
  async getQueueStats() {
    const [counts, deadLetters, processing] = await Promise.all([
      this.pool.query(`
        SELECT 
          status, COUNT(*) as count
        FROM sms_outbox 
        GROUP BY status
      `),
      this.pool.query(`
        SELECT COUNT(*) as dead_letters 
        FROM sms_outbox 
        WHERE status = 'dead_letter' AND completed_at > NOW() - INTERVAL '24 hours'
      `),
      this.pool.query(`
        SELECT COUNT(*) as in_flight 
        FROM sms_outbox 
        WHERE status = 'processing'
      `)
    ]);

    const stats = {
      queue_depth: 0,
      processing: parseInt(processing.rows[0]?.in_flight || 0),
      dead_letters_24h: parseInt(deadLetters.rows[0]?.dead_letters || 0),
      workerStats: this.stats,
    };

    for (const row of counts.rows) {
      if (row.status === 'queued') stats.queue_depth = parseInt(row.count);
    }

    return stats;
  }

  /** Reprocess dead letter queue items */
  async reprocessDeadLetters(limit = 100) {
    const result = await this.pool.query(
      `UPDATE sms_outbox SET 
         status = 'queued', 
         attempt_count = 0, 
         next_attempt_at = NOW(),
         last_error = 'Manually reprocessed'
       WHERE status = 'dead_letter'
       LIMIT $1
       RETURNING message_id`,
      [limit]
    );
    console.log(`[QueueManager] Reprocessed ${result.rows.length} dead letters`);
    return result.rows.length;
  }

  /**
   * Get supplier connection_type (cached).
   * Queries the DB on first miss, caches for subsequent calls.
   */
  /**
   * Get the effective delivery method for a supplier.
   * Auto-detects voice_otp when a SIP address (dst_sip_address) is configured,
   * regardless of the declared connection_type. This ensures ANY route plan
   * selected from the GUI works without code changes — the delivery method
   * is determined by the supplier's actual infrastructure, not a label.
   */
  async _getSupplierConnectionType(supplierId) {
    const key = String(supplierId);
    const cached = this._supplierTypeCache.get(key);
    if (cached && Date.now() < cached.expiresAt) {
      return cached.value;
    }
    // Remove expired entry
    if (cached) this._supplierTypeCache.delete(key);

    try {
      const res = await this.pool.query(
        'SELECT connection_type, dst_sip_address FROM suppliers WHERE id = $1 LIMIT 1',
        [supplierId]
      );

      if (res.rows.length === 0) return null;

      let connType = res.rows[0].connection_type;
      const sipAddr = (res.rows[0].dst_sip_address || '').trim();

      // Auto-detect voice OTP: any supplier with a SIP address routes through
      // the voice OTP engine, regardless of declared connection_type.
      // This handles cases like BORNO_OTP (connection_type='http' but uses SIP).
      if (sipAddr !== '') {
        if (connType !== 'voice_otp') {
          console.log(`[QueueManager] Supplier #${supplierId}: auto-detected voice_otp via dst_sip_address (declared type was '${connType}')`);
        }
        connType = 'voice_otp';
      }

      this._supplierTypeCache.set(key, {
        value: connType,
        expiresAt: Date.now() + this._supplierTypeCacheTtlMs,
      });
      return connType;
    } catch (e) {
      console.error(`[QueueManager] Failed to get supplier type for #${supplierId}:`, e.message);
      return null;
    }
  }

  /**
   * Handle a voice_otp job — fires the Voice OTP engine asynchronously.
   * Marks the outbox as 'submitted' immediately; the engine handles
   * all DLR updates, retries, call logging, and billing internally.
   */
  async _handleVoiceOtpJob(job, outboxId, message_id, client_id, supplier_id,
                            destination, message, sender_id, client_rate, supplier_rate,
                            billing_mode, webhook_url, voiceOtpConfigId) {
    // 0. Prevent overlapping calls: register destination BEFORE any async work.
    // This is synchronous and atomic — no other worker can slip in between.
    const engine = getVoiceOtpEngine();
    if (engine && engine.tryRegisterActiveCall) {
      const preRegisteredCallId = engine.tryRegisterActiveCall(destination);
      if (!preRegisteredCallId) {
        // Destination is busy — another call is already active
        console.log(`[QueueManager] 🚫 BLOCKED overlapping call to ${destination} (another voice OTP call is active)`);
        await this.pool.query(
          `UPDATE sms_outbox SET status = 'failed', dlr_status = 'REJECTED',
           last_error = 'destination_busy_overlapping_call', completed_at = NOW()
           WHERE id = $1`,
          [outboxId]
        ).catch(() => {});
        // Also update sms_logs if already inserted
        await this.pool.query(
          `UPDATE sms_logs SET status = 'failed', dlr_status = 'REJECTED',
           delivery_time = NOW(), error = 'destination_busy_overlapping_call'
           WHERE message_id = $1`,
          [message_id]
        ).catch(() => {});
        if (this.onDlr) {
          try {
            this.onDlr({
              client_id, message_id, destination, sender_id,
              status: 'UNDELIV', client_code: job.client_code,
              queued_at: job.queued_at, source: job.source || ''
            });
          } catch (e) { /* non-critical */ }
        }
        this.stats.rejected++;
        return;
      }
      // Store the pre-registered callId so the engine skips its own overlap check
      job._preRegisteredCallId = preRegisteredCallId;
    }

    // Wrap steps 1-5 in try/finally: if we exit early (before firing engine),
    // release the destination lock so future calls aren't permanently blocked.
    try {

    // 1. Fetch client and supplier rows needed by the voice OTP engine
    let clientRow = null;
    let supplierRow = null;
    try {
      const [clientRes, supplierRes] = await Promise.all([
        this.pool.query('SELECT * FROM clients WHERE id = $1 LIMIT 1', [client_id]),
        this.pool.query('SELECT * FROM suppliers WHERE id = $1 LIMIT 1', [supplier_id]),
      ]);
      clientRow = clientRes.rows[0] || null;
      supplierRow = supplierRes.rows[0] || null;
    } catch (e) {
      console.error(`[QueueManager] Voice OTP DB lookup failed for ${message_id}:`, e.message);
      await this.handleJobFailure(job, `Voice OTP DB lookup: ${e.message}`);
      return;
    }

    if (!clientRow || !supplierRow) {
      await this.handleJobFailure(job, 'Voice OTP: client or supplier not found');
      return;
    }

    // 2a. For API-based voice OTP suppliers (have api_connector_id + api_url),
    // the HTTP connector IS the delivery mechanism. Submit via pipeline and
    // use the provider's real transaction_id (e.g. 'OTP_2507...') for DLR polling.
    // Skip the voice OTP engine — no double-submission.
    let httpSubmitted = false;
    if (supplierRow.api_connector_id && supplierRow.api_url && this.connectionPoolMgr) {
      const pipeline = this.connectionPoolMgr.getPipeline(supplier_id);
      if (pipeline) {
        try {
          const httpResult = await pipeline.sendMessage(job);
          if (httpResult?.success && httpResult?.transaction_id) {
            await this.pool.query(
              'UPDATE sms_outbox SET connector_transaction_id = $1 WHERE id = $2',
              [httpResult.transaction_id, outboxId]
            );
            httpSubmitted = true;
            console.log(`[QueueManager] 🔗 Borno/API voice OTP submitted: tx_id=${httpResult.transaction_id}`);
          }
        } catch (e) {
          console.error(`[QueueManager] ⚠ HTTP connector submit failed for ${message_id}: ${e.message} — will try voice OTP engine`);
        }
      }
    }

    // 2b. Mark outbox as submitted
    const initialTxId = httpSubmitted ? null : `voice_otp:${message_id}`;
    if (initialTxId) {
      await this.pool.query(
        `UPDATE sms_outbox SET status = 'submitted', dlr_status = 'PENDING',
         connector_transaction_id = $1, completed_at = NOW() WHERE id = $2`,
        [initialTxId, outboxId]
      );
    } else {
      // HTTP submit already succeeded — mark as submitted without overriding tx_id
      await this.pool.query(
        `UPDATE sms_outbox SET status = 'submitted', dlr_status = 'PENDING',
         completed_at = NOW() WHERE id = $1`,
        [outboxId]
      );
    }

    // 3. Insert/update sms_logs as submitted (DLR poll or engine will update final status)
    const smsSource = job.source || 'smpp_client';
    const channel = httpSubmitted ? 'http_voice_otp' : 'voice_otp';
    try {
      // is_billed: true if submit-mode billing already deducted balance.
      const isClientBilled2 = (billing_mode || 'dlr') === 'submit';
      const isSupplierBilled2 = (job.supplier_billing_mode || 'dlr') === 'submit';
      const isBilled = (billing_mode || 'dlr') !== 'dlr';
      await this.pool.query(
        `INSERT INTO sms_logs (
          message_id, client_id, client_code, supplier_id, supplier_code,
          sender_id, destination, message, message_parts,
          client_rate, supplier_rate, profit, currency,
          mcc, mnc, operator, country, route_name, trunk_name,
          status, dlr_status, channel, billing_mode_snapshot, supplier_billing_mode_snapshot,
          is_client_billed, is_supplier_billed, is_billed, source, submit_time
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
          'submitted', 'PENDING', $20, $21, $22, $23, $24, $25, $26, NOW()
        ) ON CONFLICT (message_id) DO UPDATE SET
          status = 'submitted', dlr_status = 'PENDING', channel = $20,
          is_client_billed = COALESCE(sms_logs.is_client_billed, EXCLUDED.is_client_billed),
          is_supplier_billed = COALESCE(sms_logs.is_supplier_billed, EXCLUDED.is_supplier_billed),
          is_billed = COALESCE(sms_logs.is_billed, EXCLUDED.is_billed), source = EXCLUDED.source`,
        [
          message_id, client_id, job.client_code, supplier_id, job.supplier_code,
          sender_id, destination, message, job.message_parts || 1,
          client_rate || 0, supplier_rate || 0, job.profit || 0, job.currency || 'EUR',
          job.mcc || '', job.mnc || '', job.operator || '', job.country || '',
          job.route_name || '', job.trunk_name || '',
          channel,            billing_mode || 'dlr', job.supplier_billing_mode || 'dlr', isClientBilled2, isSupplierBilled2, isBilled, smsSource
        ]
      );
    } catch (e) {
      console.error(`[QueueManager] sms_logs insert failed for voice_otp ${message_id}:`, e.message);
    }

    // 4. If HTTP connector already submitted successfully, we're done.
    // DLR polling in server.cjs will pick up the real transaction_id.
    // Otherwise, fire the voice OTP engine for direct-SIP providers.
    if (httpSubmitted) {
      this.stats.processed++;
      console.log(`[QueueManager] ✓ API voice OTP submitted: ${message_id} → ${destination} (awaiting DLR via connector tx_id)`);
      return;
    }

    // 5. Fire-and-forget the voice OTP engine for direct-SIP suppliers
    const engine2 = getVoiceOtpEngine();
    if (!engine2 || !engine2.executeVoiceOtpPipeline) {
      console.error(`[QueueManager] Voice OTP engine not available for ${message_id}`);
      await this.handleJobFailure(job, 'Voice OTP engine not loaded (module missing or corrupt)');
      return;
    }

    // Config priority: route/trunk level > supplier level > null (auto-resolve)
    const effectiveConfigId = voiceOtpConfigId || (supplierRow ? supplierRow.voice_otp_config_id : null) || null;

    console.log(`[QueueManager] 🎙 Voice OTP: firing engine for ${message_id} → ${destination}`);

    // Fire async — don't block the worker.
    // Clear _preRegisteredCallId — the engine's finally block now owns cleanup.
    const preRegId = job._preRegisteredCallId;
    job._preRegisteredCallId = null;
    
    engine2.executeVoiceOtpPipeline(this.pool, {
      client: clientRow,
      supplier: supplierRow,
      destination,
      message,
      messageId: message_id,
      configId: effectiveConfigId,
      preRegisteredCallId: preRegId || null,
    }).then((result) => {
      console.log(`[QueueManager] 🎙 Voice OTP completed: ${message_id} — DLR=${result?.dlr || 'unknown'}, duration=${result?.duration || 0}ms`);

      const finalStatus = (result?.dlr === 'DELIVRD') ? 'delivered' : 'failed';
      this.pool.query(
        `UPDATE sms_outbox SET status = $1, dlr_status = $2,
         dlr_confirmed_at = NOW() WHERE message_id = $3`,
        [finalStatus, result?.dlr || 'FAILED', message_id]
      ).catch(() => {});

      if (this.onDlr) {
        try {
          this.onDlr({
            client_id: job.client_id, message_id,
            destination: job.destination, sender_id: job.sender_id,
            status: result?.dlr === 'DELIVRD' ? 'DELIVRD' : 'UNDELIV',
            client_code: job.client_code, queued_at: job.queued_at,
            source: job.source || ''
          });
        } catch (e) { /* non-critical */ }
      }
    }).catch((err) => {
      console.error(`[QueueManager] 🎙 Voice OTP failed for ${message_id}:`, err.message);
      this.pool.query(
        `UPDATE sms_outbox SET status = 'failed', dlr_status = 'FAILED',
         last_error = $1, completed_at = NOW() WHERE message_id = $2`,
        [err.message, message_id]
      ).catch(() => {});

      if (this.onDlr) {
        try {
          this.onDlr({
            client_id: job.client_id, message_id,
            destination: job.destination, sender_id: job.sender_id,
            status: 'UNDELIV', client_code: job.client_code, queued_at: job.queued_at,
            source: job.source || ''
          });
        } catch (e) { /* non-critical */ }
      }
    });

    this.stats.processed++;
    console.log(`[QueueManager] ✓ Voice OTP submitted: ${message_id} → ${destination} (engine dispatched)`);

    } finally {
      // If we exited before firing the engine, release the pre-registered destination lock.
      // (When the engine fires, _preRegisteredCallId is cleared so this won't double-clean.)
      if (job._preRegisteredCallId) {
        const engineCleanup = getVoiceOtpEngine();
        if (engineCleanup && engineCleanup.releaseActiveCall) {
          engineCleanup.releaseActiveCall(destination);
        }
      }
    }
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default SMSQueueManager;
