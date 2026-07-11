// ============================================================
// SMS Queue Manager - PostgreSQL-based async job queue
// Uses FOR UPDATE SKIP LOCKED for concurrent worker processing
// Designed for 1000+ clients and 1000+ suppliers
// No Redis/MQ needed — relies entirely on PostgreSQL
// ============================================================

import rateLimiter from './rateLimiter.mjs';

class SMSQueueManager {
  constructor(pool, options = {}) {
    this.pool = pool;
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
      billing_mode, webhook_url, idempotency_key, source
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
        billing_mode, webhook_url, idempotency_key,
        source, status, attempt_count, max_attempts, next_attempt_at, queued_at
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
        $20,$21,$22,$23,'queued',0,$24,NOW(),NOW()
      ) RETURNING message_id, status`,
      [
        message_id, client_id, client_code, supplier_id, supplier_code,
        sender_id, destination, message, message_parts || 1,
        client_rate || 0, supplier_rate || 0, profit || 0, currency || 'EUR',
        mcc || '', mnc || '', operator || '', country || '', route_name || '', trunk_name || '',
        billing_mode || 'dlr', webhook_url || '', idempotency_key || null,
        source || 'smpp_client',
        this.maxRetries
      ]
    );
    
    console.log(`[QueueManager] Enqueued: ${message_id} → ${destination} (client=${client_code}, supplier=${supplier_code})`);
    return { message_id: result.rows[0].message_id, status: 'queued' };
  }

  /** Start worker processes that poll the outbox and process jobs */
  start() {
    if (this.running) return;
    this.running = true;
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
            client_rate, supplier_rate, billing_mode, webhook_url, attempt_count } = job;

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

      await this.pool.query(
        `INSERT INTO sms_logs (
          message_id, client_id, client_code, supplier_id, supplier_code,
          sender_id, destination, message, message_parts,
          client_rate, supplier_rate, profit, currency,
          mcc, mnc, operator, country, route_name, trunk_name,
          status, dlr_status, billing_mode_snapshot, source, submit_time
        ) VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
          'submitted', 'PENDING', $20, $21, NOW()
        ) ON CONFLICT (message_id) DO UPDATE SET
          status = 'submitted', dlr_status = 'PENDING', source = EXCLUDED.source`,
        [
          message_id, client_id, job.client_code, supplier_id, job.supplier_code,
          sender_id, destination, message, job.message_parts || 1,
          client_rate, supplier_rate, job.profit || 0, job.currency || 'EUR',
          job.mcc || '', job.mnc || '', job.operator || '', job.country || '', job.route_name || '', job.trunk_name || '',
          billing_mode || 'dlr', smsSource
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
          `INSERT INTO sms_logs (
            message_id, client_id, client_code, supplier_id, supplier_code,
            sender_id, destination, message, message_parts,
            client_rate, supplier_rate, profit, currency,
            mcc, mnc, operator, country, route_name, trunk_name,
            status, error_message, billing_mode_snapshot, source, submit_time
          ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,
            'failed', $20, $21, $22, NOW()
          ) ON CONFLICT (message_id) DO UPDATE SET
            status = 'failed', error_message = $20, source = EXCLUDED.source`,
          [
            job.message_id, job.client_id, job.client_code, job.supplier_id, job.supplier_code,
            job.sender_id, job.destination, job.message, job.message_parts || 1,
            job.client_rate, job.supplier_rate, job.profit || 0, job.currency || 'EUR',
            job.mcc || '', job.mnc || '', job.operator || '', job.country || '', job.route_name || '', job.trunk_name || '',
            `Dead letter after ${newAttempt} attempts: ${errorMessage}`, job.billing_mode || 'dlr', job.source || 'smpp_client'
          ]
        );
      } catch (e) { /* best effort */ }

      // DLR push: notify bound SMPP client of failure
      if (this.onDlr) {
        try {
          this.onDlr({
            client_id: job.client_id, message_id: job.message_id,
            destination: job.destination, sender_id: job.sender_id,
            status: 'UNDELIV', client_code: job.client_code, queued_at: job.queued_at
          });
        } catch (e) { /* non-critical */ }
      }
    } else {
      // Retry with exponential backoff
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

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default SMSQueueManager;
