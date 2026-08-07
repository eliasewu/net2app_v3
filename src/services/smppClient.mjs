import smpp from 'smpp';
import dotenv from 'dotenv';
dotenv.config();

// Detects Unicode (non-GSM7) characters in message, returns correct SMPP data_coding
// data_coding: 0 = GSM-7 (default), 8 = UCS-2 (Unicode)
const getDataCoding = (message) => {
    if (!message) return 0;
    const GSM7 = new Set('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1BÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà\f^{}\\[~]|€');
    for (const ch of message) { if (!GSM7.has(ch)) return 8; }
    return 0;
};

/**
 * SMPP Client (ESME) — connects TO a remote SMSC as a supplier.
 *
 * BIND SYNC: Every bind, unbind, and disconnect is synced to
 * smpp_sessions, bind_history, and suppliers.bind_status in real time.
 *
 * connect() returns a Promise that resolves true/false only after the
 * SMPP bind completes (or times out at 10s).
 *
 * @param {object} pgPool    — Shared PostgreSQL pool (from server.cjs)
 * @param {object} supplier  — { id, supplier_code, smpp_host, smpp_port,
 *   smpp_username, smpp_password, system_type, smpp_version }
 */
class SmppClient {
  constructor(pgPool, supplier) {
    this.pool = pgPool;
    this.supplier = supplier;
    this.session = null;
    this.connected = false;
    this.bound = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;       // Reduced from 10 — faster to give up on broken connections
    this._wasEverBound = false;          // Tracks whether we've ever successfully bound
    this._connecting = false; // guard against concurrent connect calls
    this._connectResolved = false; // guard against double-resolve in connect()
    this._unboundSynced = false; // guard against double _syncBindStatus('unbound')
    /** DLR callback: (dlr) => void where dlr = { message_id, status, error_code, text } */
    this.onDlr = null;
  }

  async connect() {
    const { supplier } = this;
    const host = supplier.smpp_host;
    const port = supplier.smpp_port || 2775;

    if (!host) {
      console.error(`[SMPP-CLIENT] ${supplier.supplier_code}: No smpp_host configured, skipping`);
      return false;
    }

    if (this._connecting) {
      console.log(`[SMPP-CLIENT] ${supplier.supplier_code}: Already connecting, waiting...`);
      // Wait a bit for existing connect to settle
      await new Promise(r => setTimeout(r, 2000));
      return this.connected && this.bound;
    }

    this._connecting = true;
    console.log(`[SMPP-CLIENT] ${supplier.supplier_code}: Connecting to ${host}:${port}`);

    return new Promise((resolve) => {
      this.session = smpp.connect({ host, port });

      const timeout = setTimeout(() => {
        console.error(`[SMPP-CLIENT] ${supplier.supplier_code}: Connect timeout (10s)`);
        this.connected = false;
        this.bound = false;
        this._connecting = false;
        resolve(false);
      }, 10000);

      this.session.on('connect', () => {
        console.log(`[SMPP-CLIENT] ${supplier.supplier_code}: TCP connected, binding...`);

        this.session.bind_transceiver({
          system_id: supplier.smpp_username || supplier.supplier_code,
          password: supplier.smpp_password || '',
          system_type: supplier.system_type || 'SMPP',
          interface_version: supplier.smpp_version ? parseInt(supplier.smpp_version) || 0x34 : 0x34,
        }, async (pdu) => {
          clearTimeout(timeout);
          this._connecting = false;
          if (pdu.command_status === 0) {
            this.connected = true;
            this.bound = true;
            this.reconnectAttempts = 0;
            this._wasEverBound = true;
            this._connectResolved = true;
            this._unboundSynced = false;
            const negotiatedVer = pdu.sc_interface_version || pdu.interface_version;
            console.log(`[SMPP-CLIENT] ✅ ${supplier.supplier_code}: BOUND (v${negotiatedVer?.toString(16) || '34'})`);
            await this._syncBindStatus('bound', negotiatedVer);
            resolve(true);
          } else {
            this.connected = false;
            this.bound = false;
            this._connectResolved = true;
            console.log(`[SMPP-CLIENT] ❌ ${supplier.supplier_code}: Bind failed (status ${pdu.command_status})`);
            await this._syncBindStatus('unbound');
            resolve(false);
          }
        });
      });

      this.session.on('error', async (err) => {
        clearTimeout(timeout);
        console.error(`[SMPP-CLIENT] ${supplier.supplier_code}: Error — ${err.message}`);
        // Only resolve the connect promise if it hasn't been settled yet
        if (!this._connectResolved) {
          this._connectResolved = true;
          resolve(false);
        }
        // Always clean up state (pool might be undefined if constructor failed)
        this.connected = false;
        this.bound = false;
        this._connecting = false;
        if (this.pool && !this._unboundSynced) {
          this._unboundSynced = true;
          try { await this._syncBindStatus('unbound'); } catch (e) { /* ignore */ }
        }
      });

      this.session.on('close', async () => {
        console.log(`[SMPP-CLIENT] ${supplier.supplier_code}: Connection closed`);
        this.connected = false;
        this.bound = false;
        if (!this._unboundSynced) {
          this._unboundSynced = true;
          await this._syncBindStatus('unbound');
        }
        this.reconnect();
      });

      // Handle incoming deliver_sm (DLR from SMSC)
      this.session.on('deliver_sm', async (pdu, pduCallback) => {
        pduCallback(); // ACK the PDU immediately
        const source = pdu.source_addr ? pdu.source_addr.toString() : '';

        // Parse short_message — can be Buffer, string, or object (depending on smpp library version)
        let rawMessage = '';
        if (pdu.short_message) {
          if (Buffer.isBuffer(pdu.short_message)) {
            rawMessage = pdu.short_message.toString('utf8');
          } else if (typeof pdu.short_message === 'object') {
            rawMessage = pdu.short_message.message || pdu.short_message.short_message || JSON.stringify(pdu.short_message);
          } else {
            rawMessage = String(pdu.short_message);
          }
        }

        console.log(`[SMPP-CLIENT] ${supplier.supplier_code}: DLR from ${source}: ${rawMessage.substring(0, 200)}`);

        // Parse SMPP DLR receipt format:
        // "id:ABC123 sub:001 dlvrd:001 submit date:... done date:... stat:DELIVRD err:000 text:..."
        const idMatch = rawMessage.match(/\bid:(\S+)/i);
        const statMatch = rawMessage.match(/\bstat:(\S+)/i);
        const errMatch = rawMessage.match(/\berr:(\S+)/i);
        const textMatch = rawMessage.match(/\btext:(.+)$/im);

        const dlrMessageId = idMatch ? idMatch[1] : '';
        const dlrStatus = statMatch ? statMatch[1] : '';
        const dlrError = errMatch ? errMatch[1] : '000';
        const dlrText = textMatch ? textMatch[1].trim() : (dlrStatus || '');

        if (!dlrMessageId) {
          console.warn(`[SMPP-CLIENT] ${supplier.supplier_code}: DLR missing message_id in: "${rawMessage.substring(0, 100)}"`);
          return;
        }

        const isDelivered = dlrStatus === 'DELIVRD';
        const finalStatus = isDelivered ? 'delivered' : (dlrStatus === 'REJECTD' || dlrStatus === 'EXPIRED' ? 'failed' : 'failed');
        const finalDlr = dlrStatus || 'UNDELIV';

        console.log(`[SMPP-CLIENT] ${supplier.supplier_code}: DLR parsed — ${dlrMessageId} → stat=${finalDlr} err=${dlrError} delivered=${isDelivered}`);

        try {
          // Update sms_outbox
          const outboxR = await this.pool.query(
            `UPDATE sms_outbox SET
               dlr_status = $1,
               dlr_received_at = NOW(),
               dlr_confirmed_at = NOW(),
               status = $2,
               completed_at = NOW()
             WHERE message_id = $3
             RETURNING id, client_id, client_code, supplier_id, destination, sender_id, source, queued_at,
                       client_rate, supplier_rate, message_parts, billing_mode, supplier_billing_mode`,
            [finalDlr, finalStatus, dlrMessageId]
          );

          // Update sms_logs
          await this.pool.query(
            `UPDATE sms_logs SET
               dlr_status = $1,
               status = $2,
               delivery_time = NOW(),
               dlr_timestamp = NOW(),
               error_code = CASE WHEN $4 != '000' THEN $4 ELSE error_code END
             WHERE message_id = $3`,
            [finalDlr, finalStatus, dlrMessageId, dlrError]
          );

          // DLR BILLING: charge remaining parties whose billing_mode='dlr' on DELIVRD
          if (isDelivered && outboxR.rows.length > 0) {
            const outbox = outboxR.rows[0];
            const clientCost = parseFloat(((parseFloat(outbox.client_rate || 0)) * (parseInt(outbox.message_parts || 1))).toFixed(6));
            const supplierCost = parseFloat(((parseFloat(outbox.supplier_rate || 0)) * (parseInt(outbox.message_parts || 1))).toFixed(6));
            const clientBillingMode = outbox.billing_mode || 'dlr';
            const supplierBillingMode = outbox.supplier_billing_mode || 'dlr';
            
            try {
              // Check billing flags — only charge parties that haven't been billed yet
              const flagsR = await this.pool.query(
                'SELECT is_client_billed, is_supplier_billed FROM sms_logs WHERE message_id = $1',
                [dlrMessageId]
              );
              const isClientBilled = flagsR.rows[0]?.is_client_billed || false;
              const isSupplierBilled = flagsR.rows[0]?.is_supplier_billed || false;
              
              let clientBilledNow = false, supplierBilledNow = false;
              
              // Client billing: only if dlr-mode and not yet billed
              if (!isClientBilled && clientBillingMode === 'dlr' && clientCost > 0 && outbox.client_id) {
                await this.pool.query(
                  'UPDATE clients SET balance = GREATEST(0, balance - $1), updated_at = NOW() WHERE id = $2',
                  [clientCost, outbox.client_id]
                ).catch(() => {});
                await this.pool.query(
                  'UPDATE sms_logs SET is_client_billed = true WHERE message_id = $1 AND is_client_billed = false',
                  [dlrMessageId]
                ).catch(() => {});
                clientBilledNow = true;
                console.log(`[SMPP-CLIENT] 💰 ${supplier.supplier_code}: Client #${outbox.client_id} billed €${clientCost} on DLR (${dlrMessageId})`);
              }
              
              // Supplier billing: only if dlr-mode and not yet billed
              if (!isSupplierBilled && supplierBillingMode === 'dlr' && supplierCost > 0 && outbox.supplier_id) {
                await this.pool.query(
                  'UPDATE suppliers SET balance = GREATEST(0, balance - $1), updated_at = NOW() WHERE id = $2',
                  [supplierCost, outbox.supplier_id]
                ).catch(() => {});
                await this.pool.query(
                  'UPDATE sms_logs SET is_supplier_billed = true WHERE message_id = $1 AND is_supplier_billed = false',
                  [dlrMessageId]
                ).catch(() => {});
                supplierBilledNow = true;
                console.log(`[SMPP-CLIENT] 💰 ${supplier.supplier_code}: Supplier #${outbox.supplier_id} billed €${supplierCost} on DLR (${dlrMessageId})`);
              }
              
              // Update composite is_billed flag
              if ((isClientBilled || clientBilledNow) && (isSupplierBilled || supplierBilledNow || !outbox.supplier_id)) {
                await this.pool.query(
                  'UPDATE sms_logs SET is_billed = true WHERE message_id = $1 AND is_billed = false',
                  [dlrMessageId]
                ).catch(() => {});
              }
            } catch (e) {
              console.error(`[SMPP-CLIENT] ${supplier.supplier_code}: DLR billing failed for ${dlrMessageId}: ${e.message}`);
            }
          }

          // Notify DLR callback (forward to QueueManager for external client push)
          if (this.onDlr && outboxR.rows.length > 0) {
            const job = outboxR.rows[0];
            try {
              this.onDlr({
                message_id: dlrMessageId,
                client_id: job.client_id,
                client_code: job.client_code,
                destination: job.destination,
                sender_id: job.sender_id,
                status: finalDlr,
                source: job.source || 'smpp',
                queued_at: job.queued_at,
              });
            } catch (e) { /* non-critical */ }
          }

          console.log(`[SMPP-CLIENT] ${supplier.supplier_code}: DLR processed ✓ — ${dlrMessageId} → sms_outbox=${finalStatus}, sms_logs=${finalDlr}`);
        } catch (e) {
          console.error(`[SMPP-CLIENT] ${supplier.supplier_code}: DLR DB update failed for ${dlrMessageId}: ${e.message}`);
        }
      });
    });
  }

  async disconnect() {
    this.maxReconnectAttempts = 0;
    this._connecting = false;
    this._unboundSynced = true; // prevent close event from double-syncing
    if (this.session) {
      try { this.session.close(); } catch (e) { /* ignore */ }
    }
    this.connected = false;
    this.bound = false;
    await this._syncBindStatus('unbound');
    console.log(`[SMPP-CLIENT] ${this.supplier.supplier_code}: Disconnected`);
  }

  /**
   * Send SMS via SMPP submit_sm.
   * Returns { success, message_id? } or throws on failure.
   */
  async submitSm(job) {
    if (!this.connected || !this.bound) {
      throw new Error(`[SMPP-CLIENT] ${this.supplier.supplier_code}: Not connected`);
    }

    return new Promise((resolve, reject) => {
      this.session.submit_sm({
        source_addr: job.sender_id || this.supplier.supplier_code,
        source_addr_ton: 0x01,
        source_addr_npi: 0x01,
        destination_addr: job.destination,
        dest_addr_ton: 0x01,
        dest_addr_npi: 0x01,
        short_message: job.message,
        registered_delivery: 1,
        data_coding: getDataCoding(job.message),
      }, (pdu) => {
        if (pdu.command_status === 0) {
          resolve({ success: true, message_id: pdu.message_id });
        } else {
          reject(new Error(`submit_sm failed (status ${pdu.command_status})`));
        }
      });
    });
  }

  getStatus() {
    return {
      supplierCode: this.supplier.supplier_code,
      connected: this.connected,
      bound: this.bound,
      host: this.supplier.smpp_host,
      port: this.supplier.smpp_port,
    };
  }

  reconnect() {
    // ── Anti-thundering-herd: add random jitter (±30%) so multiple
    // pipelines from the same supplier don't reconnect simultaneously.
    // Without jitter, 4 pipelines fire their reconnect timers at the
    // same cadence and create 4× the event-loop pressure.
    const jit = 1 + (Math.random() - 0.5) * 0.6; // 0.7x to 1.3x multiplier

    // ── Bind-failure cool-down: if we've NEVER successfully bound
    // after 3 retries, the failure is likely permanent (wrong credentials,
    // max sessions reached, etc.). Use 60-120s delays instead of normal backoff.
    // Kicks in on the 4th reconnect() call (after attempts 1-3 all failed).
    const isPermanentFailure = !this._wasEverBound && this.reconnectAttempts >= 3;

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log(`[SMPP-CLIENT] ${this.supplier.supplier_code}: Max reconnects reached (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
      return;
    }

    this.reconnectAttempts++;

    // Base delay: 10s per attempt (was 5s). Cap at 60s (was 30s).
    // Permanent bind failures: use 60s minimum after 3 failed binds.
    let delay;
    if (isPermanentFailure) {
      delay = Math.min(120000, 60000 * (this.reconnectAttempts - 2));
    } else {
      delay = Math.min(60000, 10000 * this.reconnectAttempts);
    }
    delay = Math.round(delay * jit);

    const tag = isPermanentFailure ? ' (perm-fail cool-down)' : '';
    console.log(`[SMPP-CLIENT] ${this.supplier.supplier_code}: Reconnecting in ${Math.round(delay/1000)}s (${this.reconnectAttempts}/${this.maxReconnectAttempts})${tag}`);
    setTimeout(() => this.connect().catch(() => {}), delay);
  }

  /** Sync bind status to smpp_sessions + bind_history + suppliers.bind_status */
  async _syncBindStatus(status, negotiatedVersion) {
    const { id: supplierId, supplier_code: supplierCode, smpp_username: systemId, smpp_host: host, smpp_port: port } = this.supplier;
    const db = this.pool;
    if (!db) return; // pool not yet initialized

    if (status === 'bound') {
      const ver = negotiatedVersion ? negotiatedVersion.toString(16) : '34';
      try {
        await db.query(
          `INSERT INTO smpp_sessions (entity_type, entity_id, system_id, ip_address, remote_ip, port, bind_mode, status,
            negotiated_version, connected_at, last_activity, bound_count)
           VALUES ('supplier',$1,$2,$3,$3,$4,'BIND_TRX','bound',$5,NOW(),NOW(),1)
           ON CONFLICT (entity_type, entity_id)
           DO UPDATE SET system_id=$2, ip_address=$3, remote_ip=$3, port=$4,
                         bind_mode='BIND_TRX', status='bound', negotiated_version=$5,
                         connected_at=NOW(), last_activity=NOW(),
                         bound_count=smpp_sessions.bound_count+1,
                         last_error=NULL, last_error_at=NULL, disconnected_at=NULL`,
          [supplierId, systemId, host, port, ver]
        );
      } catch (e) { console.error(`[SMPP-CLIENT] smpp_sessions upsert failed: ${e.message}`); }

      try {
        await db.query(
          `INSERT INTO bind_history (entity_type, entity_id, system_id, ip_address, port, bind_mode, status, negotiated_version, created_at)
           VALUES ('supplier',$1,$2,$3,$4,'BIND_TRX','bound',$5,NOW())`,
          [supplierId, systemId, host, port, ver]
        );
      } catch (e) { console.error(`[SMPP-CLIENT] bind_history insert failed: ${e.message}`); }

      try {
        await db.query(
          `UPDATE suppliers SET bind_status='bound', consecutive_failures=0, updated_at=NOW() WHERE id=$1`,
          [supplierId]
        );
      } catch (e) { console.error(`[SMPP-CLIENT] supplier update failed: ${e.message}`); }

    } else {
      try {
        await db.query(
          `UPDATE smpp_sessions SET status='unbound', disconnected_at=NOW()
           WHERE entity_type='supplier' AND entity_id=$1 AND status='bound'`,
          [supplierId]
        );
      } catch (e) { console.error(`[SMPP-CLIENT] smpp_sessions update failed: ${e.message}`); }

      try {
        await db.query(
          `UPDATE suppliers SET bind_status='unbound',
           consecutive_failures = consecutive_failures + 1, updated_at = NOW()
           WHERE id=$1`,
          [supplierId]
        );
      } catch (e) { console.error(`[SMPP-CLIENT] supplier unbind update failed: ${e.message}`); }

      try {
        await db.query(
          `INSERT INTO bind_history (entity_type, entity_id, system_id, ip_address, port, bind_mode, status, created_at)
           VALUES ('supplier',$1,$2,$3,$4,'BIND_TRX','unbound',NOW())`,
          [supplierId, systemId, host, port]
        );
      } catch (e) { console.error(`[SMPP-CLIENT] bind_history insert failed: ${e.message}`); }

      // suppliers.bind_status set to 'unbound' on disconnect so routing
      // and health checks see real-time state. consecutive_failures
      // increments atomically — auto-blocked at 20 by health monitor.
    }
  }
}

export default SmppClient;
