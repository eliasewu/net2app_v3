import smpp from 'smpp';
import dotenv from 'dotenv';
dotenv.config();

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
    this.maxReconnectAttempts = 10;
    this._connecting = false; // guard against concurrent connect calls
    this._connectResolved = false; // guard against double-resolve in connect()
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
            this._connectResolved = true;
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
        if (this.pool) {
          try { await this._syncBindStatus('unbound'); } catch (e) { /* ignore */ }
        }
      });

      this.session.on('close', async () => {
        console.log(`[SMPP-CLIENT] ${supplier.supplier_code}: Connection closed`);
        this.connected = false;
        this.bound = false;
        await this._syncBindStatus('unbound');
        this.reconnect();
      });

      // Handle incoming deliver_sm (DLR from SMSC)
      this.session.on('deliver_sm', (pdu, callback) => {
        const source = pdu.source_addr ? pdu.source_addr.toString() : '';
        const message = pdu.short_message ? pdu.short_message.toString() : '';
        console.log(`[SMPP-CLIENT] ${supplier.supplier_code}: DLR from ${source}: ${message}`);
        callback();
      });
    });
  }

  async disconnect() {
    this.maxReconnectAttempts = 0;
    this._connecting = false;
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
        data_coding: 0,
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
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.log(`[SMPP-CLIENT] ${this.supplier.supplier_code}: Max reconnects reached`);
      return;
    }
    this.reconnectAttempts++;
    const delay = Math.min(30000, 5000 * this.reconnectAttempts);
    console.log(`[SMPP-CLIENT] ${this.supplier.supplier_code}: Reconnecting in ${delay/1000}s (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    setTimeout(() => this.connect().catch(() => {}), delay);
  }

  /** Sync bind status to smpp_sessions + bind_history + suppliers.bind_status */
  async _syncBindStatus(status, negotiatedVersion) {
    const { id: supplierId, supplier_code: supplierCode, smpp_username: systemId, smpp_host: host, smpp_port: port } = this.supplier;
    const db = this.pool;

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
          `INSERT INTO bind_history (entity_type, entity_id, system_id, ip_address, port, bind_mode, status, created_at)
           VALUES ('supplier',$1,$2,$3,$4,'BIND_TRX','unbound',NOW())`,
          [supplierId, systemId, host, port]
        );
      } catch (e) { console.error(`[SMPP-CLIENT] bind_history insert failed: ${e.message}`); }

      // Note: suppliers.bind_status is NOT set to 'unbound' on disconnect.
      // Valid SMSC connections stay 'bound' across disconnects — only a
      // credential mismatch or manual unbind should change bind_status.
    }
  }
}

export default SmppClient;
