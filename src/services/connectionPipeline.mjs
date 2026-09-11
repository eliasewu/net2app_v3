// ============================================================
// Connection Pipeline Manager
// Manages multiple parallel connection pipelines per supplier
// Each pipeline is an independent SMPP/HTTP connection
// Configurable max_pipelines per supplier for 1000+ scale
// ============================================================

import rateLimiter from './rateLimiter.mjs';
import SmppClient from './smppClient.mjs';

class ConnectionPipeline {
  constructor(supplierId, supplierCode, config, pipelineId, pgPool) {
    this.supplierId = supplierId;
    this.supplierCode = supplierCode;
    this.config = config; // { connection_type, smpp_host, smpp_port, smpp_username, smpp_password, api_url, api_key, ... }
    this.pipelineId = pipelineId;
    this.pool = pgPool;
    this.isConnected = false;
    this.consecutiveFailures = 0;
    this.maxFailures = 10;
    this.messagesProcessed = 0;
    this.lastActivity = null;
    this.busy = false;
    this.smppClient = null; // Real SMPP client instance (for smpp type)
    this._terminated = false; // guard against redundant DB writes after max failures
    /** DLR callback set by ConnectionPoolManager — forwarded from SmppClient */
    this._onDlrCallback = null;
    /** Billing callback set by ConnectionPoolManager — forwarded from SmppClient.onDlrBilling */
    this._billingCallback = null;
  }

  async connect() {
    try {
      const { connection_type } = this.config;
      
      if (connection_type === 'smpp') {
        if (!this.smppClient) {
          this.smppClient = new SmppClient(this.pool, {
            id: this.supplierId,
            supplier_code: this.supplierCode,
            smpp_host: this.config.smpp_host,
            smpp_port: this.config.smpp_port,
            smpp_username: this.config.smpp_username,
            smpp_password: this.config.smpp_password,
            system_type: 'SMPP',
            smpp_version: 0x34,
          });
          // Wire DLR callback — forward to ConnectionPoolManager's global DLR handler
          this.smppClient.onDlr = (dlr) => {
            if (this._onDlrCallback) {
              this._onDlrCallback(dlr);
            }
          };
          // Wire billing callback to unified applyBilling() in server.cjs
          this.smppClient.onDlrBilling = async (billingParams) => {
            if (this._billingCallback) {
              return await this._billingCallback(billingParams);
            }
          };
        }
        // connect() now returns a Promise that resolves after bind completes
        this.isConnected = await this.smppClient.connect();
        if (this.isConnected) {
          this.consecutiveFailures = 0;
        }
      } else if (connection_type === 'http') {
        console.log(`[Pipeline ${this.pipelineId}] HTTP validating ${this.config.api_url}`);
        this.isConnected = true;
        this.consecutiveFailures = 0;
        await this._syncSupplierBindStatus('bound');
      } else {
        this.isConnected = true;
        await this._syncSupplierBindStatus('bound');
      }
      
      if (this.isConnected) {
        this._terminated = false; // reset on successful reconnect
        console.log(`[Pipeline ${this.pipelineId}] Connected ✓ (supplier=${this.supplierCode})`);
      }
      return this.isConnected;
    } catch (error) {
      this.consecutiveFailures++;
      this.isConnected = false;
      console.error(`[Pipeline ${this.pipelineId}] Connect failed: ${error.message}`);
      return false;
    }
  }

  async disconnect() {
    if (this.smppClient) {
      await this.smppClient.disconnect();
      // smppClient.disconnect() already syncs bind_status to 'unbound'
    } else {
      await this._syncSupplierBindStatus('unbound');
    }
    this.isConnected = false;
    console.log(`[Pipeline ${this.pipelineId}] Disconnected (supplier=${this.supplierCode})`);
  }

  /** Sync suppliers.bind_status — lightweight update for non-SMPP types */
  async _syncSupplierBindStatus(status) {
    if (!this.pool) return;
    try {
      await this.pool.query(
        `UPDATE suppliers SET bind_status=$1, updated_at=NOW() WHERE id=$2`,
        [status, this.supplierId]
      );
    } catch (e) { /* non-critical */ }
  }

  async sendMessage(job) {
    if (!this.isConnected) {
      await this.connect();
      if (!this.isConnected) {
        throw new Error(`Pipeline ${this.pipelineId} not connected`);
      }
    }

    this.busy = true;
    this.lastActivity = Date.now();
    
    try {
      // Rate limit check
      const check = rateLimiter.checkSupplier(this.supplierId);
      if (!check.allowed) {
        throw new Error(`Supplier ${this.supplierCode} rate limited (wait ${check.waitMs}ms)`);
      }

      const { connection_type } = this.config;
      
      if (connection_type === 'smpp') {
        if (this.smppClient && this.smppClient.bound) {
          return await this.smppClient.submitSm(job);
        }
        // SMPP client not bound — fail with a clear error instead of
        // silently returning fake success from simulateSMPPSubmit().
        throw new Error(`SMPP client not bound for supplier ${this.supplierCode} — cannot deliver ${job.message_id}`);
      } else if (connection_type === 'http') {
        return await this.httpSubmit(job);
      } else if (connection_type === 'voice_otp') {
        // Voice OTP handled by QueueManager's _handleVoiceOtpJob path,
        // but if we reach here, fail loudly rather than simulate.
        throw new Error(`Voice OTP supplier ${this.supplierCode} reached pipeline sendMessage — should have been handled by QueueManager`);
      } else if (connection_type === 'android_SMS') {
        // Android SMS is handled by heartbeat polling — should never reach here.
        throw new Error(`Android SMS supplier ${this.supplierCode} reached pipeline sendMessage — should have been skipped by QueueManager`);
      } else {
        // Unknown connection_type — fail with a clear error.
        // Previously this silently returned fake 95% success from
        // simulateSMPPSubmit(), which could mask misconfigured suppliers.
        throw new Error(`Unknown connection_type '${connection_type || 'undefined'}' for supplier ${this.supplierCode} — cannot deliver ${job.message_id}. Please configure a valid connection type (smpp/http/voice_otp/android_SMS).`);
      }
    } catch (error) {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= this.maxFailures && !this._terminated) {
        this._terminated = true;
        console.error(`[Pipeline ${this.pipelineId}] Too many failures (${this.consecutiveFailures}), marking supplier unbound`);
        this.isConnected = false;
        // Sync unbound status + increment failures atomically in DB (once only)
        await this._syncSupplierBindStatus('unbound');
        if (this.pool) {
          try {
            await this.pool.query(
              `UPDATE suppliers SET consecutive_failures = consecutive_failures + 1, updated_at = NOW() WHERE id = $1`,
              [this.supplierId]
            );
          } catch (e) { /* non-critical */ }
        }
      }
      throw error;
    } finally {
      this.busy = false;
      this.messagesProcessed++;
    }
  }

  async httpSubmit(job) {
    // HTTP API submission
    const { api_url, api_key, api_method, api_connector_id } = this.config;
    if (!api_url) throw new Error('No API URL configured for HTTP supplier');

    // Voice OTP connectors use GET with query params (apiKey, msisdn, code)
    // Number translation: 880 prefix → 0 prefix (Bangladesh local format)
    // e.g. 8801615069178 → 01615069178
    if (api_connector_id && (api_method || '').toUpperCase() === 'GET') {
      let msisdn = String(job.destination || '').replace(/^\+/, '');
      if (msisdn.startsWith('880') && msisdn.length >= 13) {
        msisdn = '0' + msisdn.substring(3); // 880 → 0
      }
      
      // OTP code extraction: strip all non-digit characters from the message.
      // Handles Unicode/Bengali SMS bodies like "আপনার কোড 212121" → "212121".
      // If message is already a pure numeric code, passes through unchanged.
      let code = (job.message || '').toString();
      const digitsOnly = code.replace(/\D/g, '');
      if (digitsOnly && digitsOnly !== code) {
        console.log(`[Pipeline ${this.pipelineId}] OTP extracted: "${code.substring(0, 30)}..." → "${digitsOnly}"`);
        code = digitsOnly;
      }
      
      const url = new URL(api_url);
      url.searchParams.set('apiKey', api_key || '');
      url.searchParams.set('msisdn', msisdn);
      url.searchParams.set('code', code);
      
      try {
        const response = await fetch(url.toString(), {
          method: 'GET',
          signal: AbortSignal.timeout(30000)
        });
        const body = await response.text();
        let parsed = null;
        try { parsed = JSON.parse(body); } catch { /* not JSON */ }
        
        if (response.ok && parsed?.status === 'success') {
          return { success: true, http_status: response.status, transaction_id: parsed.transaction_id };
        }
        const errMsg = parsed?.message || `HTTP ${response.status}`;
        throw new Error(errMsg);
      } catch (error) {
        throw new Error(`Voice OTP submit failed: ${error.message}`);
      }
    }
    
    // Default: generic JSON POST
    try {
      const response = await fetch(api_url, {
        method: api_method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${api_key || ''}`
        },
        body: JSON.stringify({
          to: job.destination,
          from: job.sender_id,
          text: job.message
        }),
        signal: AbortSignal.timeout(10000)
      });
      
      if (response.ok) {
        return { success: true, http_status: response.status };
      } else {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } catch (error) {
      throw new Error(`HTTP submit failed: ${error.message}`);
    }
  }

  getStatus() {
    return {
      pipelineId: this.pipelineId,
      supplierCode: this.supplierCode,
      connected: this.isConnected,
      busy: this.busy,
      failures: this.consecutiveFailures,
      processed: this.messagesProcessed,
      lastActivity: this.lastActivity
    };
  }
}

class ConnectionPoolManager {
  constructor() {
    // Supplier ID → array of ConnectionPipelines
    this.supplierPipelines = new Map();
    this.pool = null;
    // SMPP suppliers MUST use ONE pipeline — SMSCs only allow one session per
    // system_id and kick duplicate binds, which caused connection flapping
    // (3-4 parallel sockets fighting over the same account, endless reconnects).
    this.defaultPipelines = 1;
    // HTTP/API connectors benefit from parallel pipelines for throughput.
    this.httpPipelines = 4;
    // Max pipelines per supplier
    this.maxPipelines = 16;
    /** Global DLR callback — set by server.cjs, forwarded to all SMPP pipelines */
    this._globalDlrCallback = null;
    /** Supplier IDs currently being configured (prevents duplicate concurrent setup) */
    this._configuringSuppliers = new Set();
  }

  /** Set global DLR callback — all new SMPP pipelines will forward DLRs here */
  setDlrCallback(cb) {
    this._globalDlrCallback = cb;
    // Also set on existing pipelines
    for (const [, pipelines] of this.supplierPipelines) {
      for (const p of pipelines) {
        p._onDlrCallback = cb;
      }
    }
  }

  /** Set billing callback (for unified applyBilling) — propagated to all pipelines */
  setBillingCallback(cb) {
    this._globalBillingCallback = cb;
    for (const [, pipelines] of this.supplierPipelines) {
      for (const p of pipelines) {
        p._billingCallback = cb;
      }
    }
  }

  /** Set the shared pool after import (called by server.cjs) */
  init(pgPool) {
    this.pool = pgPool;
  }

  /** 
   * Configure pipelines for a supplier.
   * Each supplier gets `maxPipelines` parallel SMPP/HTTP connections.
   */
  async configureSupplier(supplier) {
    // Skip inbound suppliers — they connect TO us on port 2775 (SMPP server),
    // not the other way around. Only outbound suppliers need pipelines.
    if (supplier.is_inbound) {
      console.log(`[PoolManager] Supplier ${supplier.supplier_code}: inbound — skipping pipeline (connects to us)`);
      return;
    }

    // Guard against duplicate concurrent configuration (e.g. overlapping health checks)
    if (this._configuringSuppliers.has(supplier.id)) {
      console.log(`[PoolManager] Supplier ${supplier.supplier_code}: already being configured — skipping`);
      return;
    }
    this._configuringSuppliers.add(supplier.id);
    try {
      await this._configureSupplierInner(supplier);
    } finally {
      this._configuringSuppliers.delete(supplier.id);
    }
  }

  /** Actual pipeline setup — wrapped by configureSupplier() with a concurrency guard */
  async _configureSupplierInner(supplier) {
    // Skip inbound suppliers — they connect TO us on port 2775 (SMPP server),
    // not the other way around. Only outbound suppliers need pipelines.
    if (supplier.is_inbound) {
      console.log(`[PoolManager] Supplier ${supplier.supplier_code}: inbound — skipping pipeline (connects to us)`);
      return;
    }

    const existing = this.supplierPipelines.get(supplier.id);
    if (existing && existing.length === supplier.maxPipelines) {
      return; // Already configured
    }

    // Disconnect existing pipelines if count changed
    if (existing) {
      for (const p of existing) {
        await p.disconnect();
      }
    }

    // Only HTTP/API connectors get parallel pipelines; SMPP keeps a single
    // session per system_id (SMSCs reject duplicate binds from the same account).
    const isHttp = ['http', 'api', 'api_connector'].includes(String(supplier.connection_type || '').toLowerCase());
    const defaultCount = isHttp ? this.httpPipelines : this.defaultPipelines;
    const maxPipelines = Math.min(
      supplier.maxPipelines || defaultCount,
      this.maxPipelines
    );

    const pipelines = [];
    for (let i = 0; i < maxPipelines; i++) {
      const pipeline = new ConnectionPipeline(
        supplier.id,
        supplier.supplier_code,
        {
          connection_type: supplier.connection_type,
          smpp_host: supplier.smpp_host,
          smpp_port: supplier.smpp_port,
          smpp_username: supplier.smpp_username,
          smpp_password: supplier.smpp_password,
          api_url: supplier.api_url,
          api_key: supplier.api_key,
          api_method: supplier.api_method,
          api_connector_id: supplier.api_connector_id
        },
        `${supplier.supplier_code}-p${i}`,
        this.pool
      );
      
      // Wire DLR callback if set
      if (this._globalDlrCallback) {
        pipeline._onDlrCallback = this._globalDlrCallback;
        pipeline._billingCallback = this._globalBillingCallback;
      }
      await pipeline.connect();
      pipelines.push(pipeline);
    }

    this.supplierPipelines.set(supplier.id, pipelines);
    console.log(`[PoolManager] Supplier ${supplier.supplier_code}: ${pipelines.length} pipelines configured`);
  }

  /** Remove all pipelines for a supplier */
  async removeSupplier(supplierId) {
    const pipelines = this.supplierPipelines.get(supplierId);
    if (pipelines) {
      for (const p of pipelines) {
        await p.disconnect();
      }
      this.supplierPipelines.delete(supplierId);
      console.log(`[PoolManager] Supplier ${supplierId}: pipelines removed`);
    }
  }

  /** Get the least-busy pipeline for a supplier (round-robin) */
  getPipeline(supplierId) {
    const pipelines = this.supplierPipelines.get(supplierId);
    if (!pipelines || pipelines.length === 0) return null;

    // Find the least-busy connected pipeline
    let best = null;
    let bestScore = Infinity;
    
    for (const p of pipelines) {
      if (!p.isConnected) continue;
      const score = p.busy ? 1000 : p.messagesProcessed;
      if (score < bestScore) {
        bestScore = score;
        best = p;
      }
    }
    
    return best;
  }

  /**
   * Reconnect any disconnected pipelines AND auto-configure suppliers that were
   * added to the DB while the server was running (no restart needed).
   * Also removes pipelines for suppliers that were deleted or deactivated.
   */
  async healthCheck() {
    let reconnected = 0;
    
    // 1) Reconnect any disconnected pipelines for known suppliers.
    //    Each connect is raced against a 12s timeout so a single hung pipeline
    //    (e.g. unresponsive SMSC, or a client bug) can never stall the whole
    //    health check — step 2 reconciliation must always run.
    //    Manually disconnected suppliers (manual_disconnect=true) are skipped
    //    so the Disconnect button actually sticks until a manual Connect.
    let manualDisconnectedIds = new Set();
    if (this.pool) {
      try {
        const md = await this.pool.query(
          `SELECT id FROM suppliers WHERE manual_disconnect = true`
        );
        manualDisconnectedIds = new Set(md.rows.map(r => r.id));
      } catch (e) { /* keep empty set */ }
    }
    for (const [supplierId, pipelines] of this.supplierPipelines) {
      if (manualDisconnectedIds.has(supplierId)) continue;
      for (const p of pipelines) {
        if (!p.isConnected) {
          const ok = await Promise.race([
            p.connect(),
            new Promise(r => setTimeout(() => { r(false); }, 12000))
          ]);
          if (ok) reconnected++;
        }
      }
    }

    // 2) Reconcile with DB: pick up newly-created suppliers (outbound only —
    //    inbound suppliers connect TO us and are handled by the SMPP server),
    //    and drop pipelines for suppliers that were deleted/deactivated.
    if (this.pool) {
      try {
        const active = await this.pool.query(
          `SELECT id, supplier_code, company_name, connection_type, is_inbound, status,
                  smpp_host, smpp_port, smpp_username, smpp_password,
                  api_url, api_key, api_method, api_connector_id,
                  capacity, is_deleted, manual_disconnect
           FROM suppliers
           WHERE status = 'active' AND (is_deleted IS NULL OR is_deleted = false)`
        );

        const activeIds = new Set();
        for (const s of active.rows) {
          activeIds.add(s.id);
          // Manually disconnected suppliers must stay disconnected — never auto-reconnect.
          // The user explicitly clicked Disconnect; only a manual Connect restores it.
          if (s.manual_disconnect) continue;
          if (s.is_inbound) continue; // inbound suppliers connect to us — no outbound pipeline
          if (!this.supplierPipelines.has(s.id)) {
            console.log(`[PoolManager] Health check: new supplier ${s.supplier_code} (#${s.id}) — configuring pipelines`);
            // Fire-and-forget: don't let one slow supplier block the rest of the health check
            this.configureSupplier(s).catch(e =>
              console.error(`[PoolManager] Health check: failed to configure new supplier ${s.supplier_code}: ${e.message}`)
            );
          }
        }

        // Remove pipelines for suppliers that are no longer active in the DB
        for (const [supplierId] of this.supplierPipelines) {
          if (!activeIds.has(supplierId)) {
            console.log(`[PoolManager] Health check: removing pipelines for inactive/deleted supplier #${supplierId}`);
            await this.removeSupplier(supplierId);
          }
        }
      } catch (e) {
        console.error(`[PoolManager] Health check: supplier reconciliation failed: ${e.message}`);
      }
    }
    
    if (reconnected > 0) {
      console.log(`[PoolManager] Health check: reconnected ${reconnected} pipelines`);
    }
    return reconnected;
  }

  /** Get comprehensive status of all pipelines */
  getStatus() {
    const status = {
      totalSuppliers: this.supplierPipelines.size,
      totalPipelines: 0,
      connectedPipelines: 0,
      busyPipelines: 0,
      pipelineDetails: []
    };

    for (const [supplierId, pipelines] of this.supplierPipelines) {
      status.totalPipelines += pipelines.length;
      for (const p of pipelines) {
        if (p.isConnected) status.connectedPipelines++;
        if (p.busy) status.busyPipelines++;
        status.pipelineDetails.push(p.getStatus());
      }
    }

    return status;
  }

  /** Shutdown all pipelines gracefully */
  async shutdown() {
    console.log('[PoolManager] Shutting down all pipelines...');
    for (const [supplierId, pipelines] of this.supplierPipelines) {
      for (const p of pipelines) {
        await p.disconnect();
      }
    }
    this.supplierPipelines.clear();
    console.log('[PoolManager] All pipelines shut down');
  }
}

// Global singleton
const connectionPoolManager = new ConnectionPoolManager();
export default connectionPoolManager;
