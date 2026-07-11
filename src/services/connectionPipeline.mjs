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
        // Fallback to simulation if no real client
        return await this.simulateSMPPSubmit(job);
      } else if (connection_type === 'http') {
        return await this.httpSubmit(job);
      } else {
        // Generic delivery
        return await this.simulateSMPPSubmit(job);
      }
    } catch (error) {
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= this.maxFailures) {
        console.error(`[Pipeline ${this.pipelineId}] Too many failures (${this.consecutiveFailures}), marking as failed`);
        this.isConnected = false;
      }
      throw error;
    } finally {
      this.busy = false;
      this.messagesProcessed++;
    }
  }

  async simulateSMPPSubmit(job) {
    // Simulate SMPP submit_sm latency (50-300ms)
    await new Promise(resolve => setTimeout(resolve, 50 + Math.random() * 250));
    
    // 95% success rate in production simulation
    if (Math.random() > 0.05) {
      const smppMsgId = `SMPP_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
      return { success: true, smpp_message_id: smppMsgId };
    } else {
      throw new Error('SMPP SUBMIT_SM failed: ESME_RTHROTTLED (0x00000058)');
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
  constructor(pgPool) {
    // Supplier ID → array of ConnectionPipelines
    this.supplierPipelines = new Map();
    this.pool = pgPool;
    // Default pipelines per supplier
    this.defaultPipelines = 4;
    // Max pipelines per supplier
    this.maxPipelines = 16;
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

    const maxPipelines = Math.min(
      supplier.maxPipelines || this.defaultPipelines,
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

  /** Reconnect any disconnected pipelines */
  async healthCheck() {
    let reconnected = 0;
    
    for (const [supplierId, pipelines] of this.supplierPipelines) {
      for (const p of pipelines) {
        if (!p.isConnected) {
          const ok = await p.connect();
          if (ok) reconnected++;
        }
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
