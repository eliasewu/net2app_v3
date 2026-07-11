import smpp from 'smpp';
import dotenv from 'dotenv';
import pg from 'pg';
dotenv.config();

const { Pool } = pg;

// Server-supported SMPP versions (highest to lowest)
const SUPPORTED_VERSIONS = [0x50, 0x34, 0x33]; // 5.0, 3.4, 3.3

/**
 * Negotiate SMPP interface version: pick the highest version the server
 * supports that is ≤ the client's requested version.
 */
function negotiateVersion(clientVersion) {
  const req = clientVersion || 0x34;
  for (const sv of SUPPORTED_VERSIONS) {
    if (req >= sv) return sv;
  }
  return 0x33; // fallback: lowest supported
}

/**
 * Build a DLR receipt string (SMPP short_message format).
 * Format: "id:{msgId} sub:001 dlvrd:001 submit date:{submit} done date:{done} stat:{stat} err:{err} text:{text}"
 */
function buildDlrReceipt(msgId, status, submitDate = null, errorCode = '000') {
  const now = new Date();
  const fmt = (d) => {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${y}${mo}${day}${h}${mi}`;
  };
  const subDate = submitDate ? fmt(new Date(submitDate)) : fmt(now);
  const doneDate = fmt(now);
  const stat = status === 'DELIVRD' ? 'DELIVRD' : 'UNDELIV';
  const text = status === 'DELIVRD' ? '000' : 'Delivery failed';
  return `id:${msgId} sub:001 dlvrd:001 submit date:${subDate} done date:${doneDate} stat:${stat} err:${errorCode} text:${text}`;
}

/**
 * SMPP Server — accepts ESME connections from external clients on port 2775.
 *
 * FEATURES:
 * - Auto-negotiates SMPP versions v3.3 (0x33), v3.4 (0x34), v5.0 (0x50)
 * - Accepts bind_transmitter, bind_receiver, bind_transceiver
 * - Global session registry for DLR delivery (deliver_sm back to clients)
 * - submit_sm routes through the production queue (smsQueueManager)
 * - Rate limiting via token bucket (rateLimiter)
 * - Full bind/unbind/disconnect database sync to smpp_sessions + bind_history
 *
 * NOTE: smpp 0.6.x server events receive only the PDU object (no callback).
 * pdu.response() CREATES the response PDU but does NOT send it.
 * Must call session.send(pdu.response({...})) to transmit the response.
 *
 * @param {object} pgPool     — External pg Pool
 * @param {object} queueMgr   — SMSQueueManager instance (optional, for pipeline)
 * @param {object} rateLimit  — RateLimiter instance (optional, for TPS check)
 */
export default class SmppServer {
  constructor(pgPool, queueMgr = null, rateLimit = null, resolveRouteFn = null) {
    if (pgPool) {
      this.pool = pgPool;
    } else {
      this.pool = new Pool({
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 5432,
        database: process.env.DB_NAME || 'sms_platform',
        user: process.env.DB_USER || 'sms_user',
        password: process.env.DB_PASS || 'Ariya@2024Net2App',
        max: 5,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      });
    }
    this.queueManager = queueMgr;
    this.rateLimiter = rateLimit;
    this.resolveRoute = resolveRouteFn;

    /** Global session registry: "entityType_entityId" → { session, remoteAddr, systemId, bindType } */
    this.sessions = new Map();
  }

  _sessionKey(entityType, entityId) {
    return `${entityType}_${entityId}`;
  }

  start() {
    const db = this.pool;
    const server = smpp.createServer({ port: 2775, host: '0.0.0.0', auto_enquire_link_period: 30000 });

    server.on('session', (session) => {
      const remoteAddr = session.socket.remoteAddress;
      let boundEntity = null;   // { entityType, entityId, entityCode, systemId, bindType }
      let disconnected = false;

      console.log(`[SMPP] New connection from: ${remoteAddr}`);

      // Manual enquire_link keepalive — auto_enquire_link_period on createServer
      // does NOT propagate to sessions (smpp 0.6.x only passes socket/tls/debug).
      // We start our own 15s interval to keep NAT/firewall bindings alive.
      const enquireTimer = setInterval(() => {
        try { session.enquire_link(() => {}); } catch (e) { /* ignore */ }
      }, 15000);

      // ====== BIND HANDLER (shared across bind_transceiver/transmitter/receiver) ======
      // NOTE: smpp 0.6.x passes only (pdu), responses via pdu.response()
      const handleBind = async (pdu, bindType) => {
        const systemId = pdu.system_id;
        const password = pdu.password || '';
        const negotiated = negotiateVersion(pdu.interface_version);
        console.log(`[SMPP] ${bindType} request: ${systemId} (req=v${(pdu.interface_version || 0x34).toString(16)}, neg=v${negotiated.toString(16)})`);

        // 1) Try inbound suppliers FIRST — GSM gateways without public IPs
        //    register with server IP:port and authenticate as SUPPLIERS (SMSC mode).
        //    This ensures bind_status updates correctly and the gateway appears
        //    in the SMSC section of the BindStatus page.
        const supplierR = await db.query(
          `SELECT id, supplier_code, smpp_password, status
           FROM suppliers
           WHERE smpp_username = $1 AND is_inbound = true AND status = 'active'
             AND (is_deleted IS NULL OR is_deleted = false)`,
          [systemId]
        );

        if (supplierR.rows.length && supplierR.rows[0].smpp_password === password) {
          const s = supplierR.rows[0];
          try {
            await this._markBound(db, 'supplier', s.id, systemId, remoteAddr, negotiated, bindType);
          } catch (e) {
            console.error(`[SMPP] ❌ Supplier ${systemId}: DB sync failed: ${e.message}`);
            session.send(pdu.response({ command_status: 0x0000000B })); return;
          }
          boundEntity = { entityType: 'supplier', entityId: s.id, entityCode: s.supplier_code, systemId, bindType };
          this.sessions.set(this._sessionKey('supplier', s.id), { session, remoteAddr, systemId, bindType });
          session.send(pdu.response({ command_status: 0, system_id: systemId, sc_interface_version: negotiated }));
          console.log(`[SMPP] ✅ Inbound supplier (GSM gateway) ${systemId} (${s.supplier_code}) bound [${bindType}] v${negotiated.toString(16)} from ${remoteAddr}`);
          return;
        }

        // 2) Fallback: clients table (regular ESME clients)
        const clientR = await db.query(
          `SELECT id, client_code, smpp_password, status, smpp_ip
           FROM clients
           WHERE smpp_username = $1 AND status = 'active'
             AND (is_deleted IS NULL OR is_deleted = false)`,
          [systemId]
        );

        if (clientR.rows.length && clientR.rows[0].smpp_password === password) {
          const c = clientR.rows[0];
          if (c.smpp_ip && c.smpp_ip !== '0.0.0.0' && remoteAddr !== c.smpp_ip) {
            console.log(`[SMPP] ❌ Client ${systemId}: IP mismatch (allowed ${c.smpp_ip}, got ${remoteAddr})`);
            session.send(pdu.response({ command_status: 0x0000000D })); return;
          }
          try {
            await this._markBound(db, 'client', c.id, systemId, remoteAddr, negotiated, bindType);
          } catch (e) {
            console.error(`[SMPP] ❌ Client ${systemId}: DB sync failed: ${e.message}`);
            session.send(pdu.response({ command_status: 0x0000000B })); return; // system error
          }
          boundEntity = { entityType: 'client', entityId: c.id, entityCode: c.client_code, systemId, bindType };
          this.sessions.set(this._sessionKey('client', c.id), { session, remoteAddr, systemId, bindType });
          session.send(pdu.response({ command_status: 0, system_id: systemId, sc_interface_version: negotiated }));
          console.log(`[SMPP] ✅ Client ${systemId} (${c.client_code}) bound [${bindType}] v${negotiated.toString(16)} from ${remoteAddr}`);
          return;
        }

        console.log(`[SMPP] ❌ Auth failed for ${systemId}`);
        session.send(pdu.response({ command_status: 0x0000000D }));
      };

      // Attach handler to all 3 bind types (smpp 0.6.x: only pdu, no callback)
      session.on('bind_transceiver', (pdu) => handleBind(pdu, 'trx'));
      session.on('bind_transmitter', (pdu) => handleBind(pdu, 'tx'));
      session.on('bind_receiver', (pdu) => handleBind(pdu, 'rx'));

      // ====== ENQUIRE_LINK (keepalive) ======
      session.on('enquire_link', (pdu) => {
        if (boundEntity) {
          db.query(
            `UPDATE smpp_sessions SET last_activity = NOW() WHERE entity_type=$1 AND entity_id=$2`,
            [boundEntity.entityType, boundEntity.entityId]
          ).catch(() => {});
        }
        session.send(pdu.response());
      });

      // ====== SUBMIT_SM (receive SMS from clients/suppliers) ======
      session.on('submit_sm', async (pdu) => {
        // Extract PDU fields FIRST — used by both client and supplier paths
        const sourceAddr = pdu.source_addr ? pdu.source_addr.toString() : '';
        const destAddr = pdu.destination_addr ? pdu.destination_addr.toString() : '';
        // short_message can be Buffer (normal), string, or object (TLV message_payload)
        const message = (() => {
            const sm = pdu.short_message;
            if (Buffer.isBuffer(sm)) return sm.toString('utf8');
            if (typeof sm === 'string') return sm;
            const mp = pdu.message_payload || pdu.tlv?.message_payload;
            if (Buffer.isBuffer(mp)) return mp.toString('utf8');
            if (typeof mp === 'string') return mp;
            return '';
        })();

        // bind_receiver clients cannot send SMS
        if (boundEntity && boundEntity.bindType === 'rx') {
          session.send(pdu.response({ command_status: 0x00000045 }));
          return;
        }

        // Inbound supplier (GSM gateway): detect DLR vs MO SMS
        if (boundEntity && boundEntity.entityType === 'supplier') {
          const esmClass = pdu.esm_class || 0;
          // DLR detection: esm_class bit 2 (delivery receipt), receipted_message_id field,
          // or fallback regex on message content matching standard DLR format "id:12345 sub:..."
          const isDlr = (esmClass & 0x04) ||
                        (pdu.receipted_message_id) ||
                        (message && /^id:\d+ sub:/i.test(message));

          if (isDlr) {
            // === DLR from GSM gateway ===
            let origMsgId = pdu.receipted_message_id;
            let dlrStatus = 'DELIVRD';
            if (!origMsgId && message) {
              const m = message.match(/id:([^ ]+)/i);
              if (m) origMsgId = m[1];
              const s = message.match(/stat:([^ ]+)/i);
              if (s) dlrStatus = s[1].toUpperCase() === 'DELIVRD' ? 'DELIVRD' : 'UNDELIV';
            }

            if (origMsgId) {
              try {
                const origRes = await db.query(
                  `UPDATE sms_logs SET status='delivered', dlr_status=$1, delivery_time=NOW()
                   WHERE message_id=$2 AND status IN ('submitted','queued','pending')
                   RETURNING client_id, client_code, sender_id, destination, submit_time, client_rate, message_parts, webhook_url, billing_mode`,
                  [dlrStatus, origMsgId]
                );
                if (origRes.rows.length > 0) {
                  const orig = origRes.rows[0];
                  console.log(`[SMPP-DLR] 📥 DLR from gateway ${boundEntity.entityCode}: ${origMsgId} → ${dlrStatus}`);

                  // Update outbox
                  await db.query(`UPDATE sms_outbox SET status='delivered', dlr_status=$1 WHERE message_id=$2`, [dlrStatus, origMsgId]);

                  if (dlrStatus === 'DELIVRD') {
                    // DLR billing
                    if (orig.billing_mode === 'dlr' && orig.client_rate) {
                      const cost = parseFloat(orig.client_rate || 0) * parseInt(orig.message_parts || 1);
                      await db.query('UPDATE clients SET balance = balance - $1, updated_at = NOW() WHERE id = $2', [cost, orig.client_id]);
                    }
                    // Webhook
                    if (orig.webhook_url && this.queueManager) {
                      this.queueManager.sendWebhook(orig.webhook_url, origMsgId, orig.destination, 'delivered', 'DELIVRD', orig.client_code).catch(() => {});
                    }
                  }

                  // Push DLR to the originating bound client
                  this.sendDlr({
                    client_id: orig.client_id,
                    message_id: origMsgId,
                    destination: orig.destination,
                    sender_id: orig.sender_id,
                    status: dlrStatus,
                    client_code: orig.client_code,
                    submit_time: orig.submit_time
                  });
                }
              } catch (e) {
                console.error(`[SMPP-DLR] ❌ DLR update failed: ${e.message}`);
              }
              session.send(pdu.response({ command_status: 0, message_id: origMsgId }));
            } else {
              session.send(pdu.response({ command_status: 0 }));
            }
            return;
          }

          // === MO SMS from GSM gateway (real incoming mobile message) ===
          const msgId = `MO${Date.now()}${Math.random().toString(36).substr(2, 6)}`;
          try {
            await db.query(
              `INSERT INTO sms_logs (message_id, supplier_id, supplier_code, sender_id, destination, message, status, source, submit_time, created_at)
               VALUES ($1,$2,$3,$4,$5,$6,'received','smpp_mo',NOW(),NOW())`,
              [msgId, boundEntity.entityId, boundEntity.entityCode, sourceAddr, destAddr, message]
            );
            session.send(pdu.response({ command_status: 0, message_id: msgId }));
            console.log(`[SMPP] 📥 MO SMS from gateway ${boundEntity.entityCode}: ${sourceAddr} → ${destAddr}`);

            // Forward MO to the client who last sent MT to this number
            try {
              const lastClient = await db.query(
                `SELECT client_id FROM sms_logs WHERE destination=$1 AND client_id IS NOT NULL ORDER BY submit_time DESC LIMIT 1`,
                [sourceAddr]
              );
              if (lastClient.rows.length > 0) {
                this.sendIncomingSms(lastClient.rows[0].client_id, sourceAddr, message);
              }
            } catch (err) { /* best effort */ }
          } catch (e) {
            console.error(`[SMPP] ❌ MO SMS insert failed: ${e.message}`);
            session.send(pdu.response({ command_status: 0x0000000B }));
          }
          return;
        }

        // Client submit_sm path below — rate limit + queue manager

        // Rate limit check
        if (this.rateLimiter && boundEntity) {
          const check = this.rateLimiter.checkClient(boundEntity.entityId);
          if (!check.allowed) {
            console.log(`[SMPP] ⏱ Rate limited client ${boundEntity.entityCode} (wait ${check.waitMs}ms)`);
            session.send(pdu.response({ command_status: 0x00000058 })); // throttling error
            return;
          }
        }

        // Use the production queue if available; otherwise fallback to direct INSERT
        if (this.queueManager && boundEntity) {
          try {
            const msgId = `SMPP${Date.now()}${Math.random().toString(36).substr(2, 6)}`;

            // Resolve route data: MCC/MNC, operator, supplier, rates, country
            let routeData = { supplier_id: null, supplier_code: null, supplier_rate: 0,
              client_rate: 0, mcc: '', mnc: '', operator: '', country: '',
              route_name: 'SMPP', trunk_name: 'SMPP', billing_mode: 'dlr' };

            if (this.resolveRoute) {
              try {
                const clientLookup = await db.query(
                  'SELECT * FROM clients WHERE id = $1', [boundEntity.entityId]
                );
                if (clientLookup.rows.length) {
                  const resolved = await this.resolveRoute(clientLookup.rows[0], destAddr);
                  // resolved now returns snake_case keys with operator + country included
                  Object.assign(routeData, resolved);
                }
              } catch (e) {
                console.error(`[SMPP] Route resolution failed for ${boundEntity.entityCode}: ${e.message}`);
              }
            }

            await this.queueManager.enqueue({
              message_id: msgId,
              client_id: boundEntity.entityId,
              client_code: boundEntity.entityCode,
              supplier_id: routeData.supplier_id,
              supplier_code: routeData.supplier_code,
              sender_id: sourceAddr,
              destination: destAddr,
              message,
              message_parts: Math.max(1, Math.ceil((message || '').length / 160)),
              client_rate: routeData.client_rate || 0,
              supplier_rate: routeData.supplier_rate || 0,
              profit: parseFloat((parseFloat(routeData.client_rate || 0) - parseFloat(routeData.supplier_rate || 0)).toFixed(6)),
              currency: 'EUR',
              mcc: routeData.mcc || '',
              mnc: routeData.mnc || '',
              operator: routeData.operator || '',
              country: routeData.country || '',
              route_name: routeData.route_name || 'SMPP',
              trunk_name: routeData.trunk_name || 'SMPP',
              billing_mode: routeData.billing_mode || 'dlr',
              webhook_url: '',
              source: 'smpp_client',
            });
            session.send(pdu.response({ command_status: 0, message_id: msgId }));
            console.log(`[SMPP] ✅ SMS enqueued via pipeline: ${msgId} (client=${boundEntity.entityCode}, dest=${destAddr})`);
            return;
          } catch (e) {
            console.error(`[SMPP] Queue enqueue failed: ${e.message}`);
            session.send(pdu.response({ command_status: 0x0000000B })); // system error
            return;
          }
        }

        // --- Fallback: direct db insert (no queue manager available) ---
        const msgId = `SMPP${Date.now()}${Math.random().toString(36).substr(2, 4)}`;
        await db.query(
          `INSERT INTO sms_logs (message_id, client_id, client_code, sender_id, destination, message, status, submit_time)
           VALUES ($1,$2,$3,$4,$5,$6,'submitted',NOW())`,
          [msgId, boundEntity?.entityId || null, boundEntity?.entityCode || null, sourceAddr, destAddr, message]
        );
        session.send(pdu.response({ command_status: 0, message_id: msgId }));
        console.log(`[SMPP] ✅ SMS queued (fallback): ${msgId}`);
      });

      // ====== UNBIND PDU ======
      session.on('unbind', (pdu) => {
        console.log(`[SMPP] Unbind PDU received — closing session`);
        session.send(pdu.response());
        session.close();
      });

      // ====== DISCONNECT (close / error) — sync DB ======
      const handleDisconnect = async () => {
        clearInterval(enquireTimer);
        if (disconnected || !boundEntity) return;
        disconnected = true;

        const { entityType, entityId, systemId } = boundEntity;
        console.log(`[SMPP] 🔌 ${entityType} ${systemId} (ID ${entityId}) disconnected`);

        // Remove from global registry
        this.sessions.delete(this._sessionKey(entityType, entityId));

        // Mark session as unbound in DB
        try {
          await db.query(
            `UPDATE smpp_sessions SET status = 'unbound', disconnected_at = NOW()
             WHERE entity_type = $1 AND entity_id = $2 AND status = 'bound'`,
            [entityType, entityId]
          );
        } catch (e) { console.error(`[SMPP] smpp_sessions update failed: ${e.message}`); }

        // Unbind audit trail
        try {
          await db.query(
            `INSERT INTO bind_history (entity_type, entity_id, system_id, ip_address, port, bind_mode, status, created_at)
             VALUES ($1,$2,$3,$4,2775,'BIND_TRX','unbound',NOW())`,
            [entityType, entityId, systemId, remoteAddr]
          );
        } catch (e) { console.error(`[SMPP] bind_history insert failed: ${e.message}`); }

        // Note: suppliers.bind_status is NOT set to 'unbound' on disconnect.
        // Valid SMSC/ESME connections stay 'bound' — only a credential mismatch
        // (bind failure) or manual unbind via API should change bind_status.
        // Real-time connection state is tracked in smpp_sessions.session_state.

        boundEntity = null;
      };

      session.on('close', () => {
        clearInterval(enquireTimer);
        handleDisconnect();
      });
      session.on('error', (err) => {
        console.error(`[SMPP] Session error (${boundEntity?.systemId || remoteAddr}): ${err.message}`);
        clearInterval(enquireTimer);
        handleDisconnect();
      });
    });

    // smpp.createServer() returns a Server instance but does NOT auto-listen.
    // We must call server.listen() explicitly.
    // The deploy script cleans up port 2775 before restart to prevent EADDRINUSE.
    server.listen(2775, '0.0.0.0', () => {
      console.log(`[SMPP] ✅ Server listening on 0.0.0.0:2775 (ESME binds — v3.3/v3.4/v5.0)`);
    });

    server.on('error', (err) => {
      console.error(`[SMPP] ❌ Server error: ${err.message}`);
    });
  }

  /**
   * Send deliver_sm (MT SMS) to a bound INBOUND supplier for delivery.
   * Used by the queue manager to deliver SMS to GSM gateways and other
   * inbound suppliers that connected TO this server.
   *
   * @param {number} supplierId
   * @param {object} job — { message_id, sender_id, destination, message }
   * @returns {boolean} true if the supplier was connected and the PDU was sent
   */
  deliverToSupplier(supplierId, job) {
    const key = this._sessionKey('supplier', supplierId);
    const entry = this.sessions.get(key);
    if (!entry) {
      console.log(`[SMPP] ⚠ Cannot deliver to supplier #${supplierId}: not connected`);
      return false;
    }

    const { session } = entry;
    try {
      session.deliver_sm({
        source_addr: job.sender_id || '',
        destination_addr: job.destination || '',
        short_message: job.message || '',
        esm_class: 0x00,       // Default SMSC Mode
        registered_delivery: 1, // Request DLR
        data_coding: 0,
      }, (respPdu) => {
        if (respPdu && respPdu.command_status !== 0) {
          console.error(`[SMPP] ❌ deliver_sm (MT) to supplier #${supplierId} failed: status=${respPdu.command_status}`);
        }
      });
      console.log(`[SMPP] 📤 MT SMS to supplier #${supplierId}: ${job.message_id} → ${job.destination}`);
      return true;
    } catch (e) {
      console.error(`[SMPP] ❌ deliver_sm (MT) error for supplier #${supplierId}: ${e.message}`);
      return false;
    }
  }

  /**
   * DLR Delivery: send a deliver_sm (delivery receipt) back to the
   * bound SMPP client that originated the SMS.
   *
   * Called by the queue manager after a job is delivered or fails.
   *
   * @param {object} job — { client_id, message_id, destination, sender_id,
   *   status ('DELIVRD'|'UNDELIV'), client_code, submit_time }
   */
  sendDlr(job) {
    const key = this._sessionKey('client', job.client_id);
    const entry = this.sessions.get(key);
    if (!entry) {
      console.log(`[SMPP-DLR] ⚠ Client ${job.client_code || job.client_id} not connected — DLR not pushed`);
      return false;
    }

    const { session } = entry;
    const receipt = buildDlrReceipt(job.message_id, job.status, job.submit_time);

    try {
      session.deliver_sm({
        source_addr: job.destination || '',
        destination_addr: job.sender_id || '',
        short_message: receipt,
        esm_class: 0x04,                // SMSC Delivery Receipt
        registered_delivery: 0,
        receipted_message_id: job.message_id,
        message_state: job.status === 'DELIVRD' ? 2 : 5, // 2=DELIVERED, 5=UNDELIVERABLE
      }, (respPdu) => {
        // node-smpp callback receives the response PDU (not err, result pair)
        // PDU is always an object — check command_status to detect actual failures
        if (respPdu && respPdu.command_status !== 0) {
          console.error(`[SMPP-DLR] ❌ deliver_sm failed for ${job.message_id}: status=${respPdu.command_status}`);
        } else {
          console.log(`[SMPP-DLR] ✅ DLR pushed to client ${job.client_code}: ${job.message_id} → ${job.status}`);
        }
      });
      return true;
    } catch (e) {
      console.error(`[SMPP-DLR] ❌ deliver_sm error for ${job.message_id}: ${e.message}`);
      return false;
    }
  }

  /**
   * Send deliver_sm (incoming MO SMS) to a bound client session.
   * Used for receiving SMS from suppliers and forwarding to the client.
   */
  sendIncomingSms(clientId, fromNumber, message) {
    const key = this._sessionKey('client', clientId);
    const entry = this.sessions.get(key);
    if (!entry) return false;

    const { session } = entry;
    try {
      session.deliver_sm({
        source_addr: fromNumber,
        destination_addr: entry.systemId,
        short_message: message,
        esm_class: 0x00,
        registered_delivery: 0,
        data_coding: 0,
      }, (respPdu) => {
        if (respPdu && respPdu.command_status !== 0) {
          console.error(`[SMPP] deliver_sm (MO) failed: status=${respPdu.command_status}`);
        }
      });
      return true;
    } catch (e) {
      console.error(`[SMPP] deliver_sm (MO) error: ${e.message}`);
      return false;
    }
  }

  /**
   * Upserts smpp_sessions (bound) + inserts bind_history audit trail.
   * For suppliers, also updates suppliers.bind_status.
   * THROWS on any DB failure so handleBind can reject the bind with an error.
   */
  async _markBound(db, entityType, entityId, systemId, ipAddr, version, bindType) {
    const ver = version.toString(16);
    const bindMode = bindType === 'tx' ? 'BIND_TX' : (bindType === 'rx' ? 'BIND_RX' : 'BIND_TRX');

    await db.query(
      `INSERT INTO smpp_sessions (entity_type, entity_id, system_id, ip_address, remote_ip, port, bind_mode, status,
        negotiated_version, connected_at, last_activity, bound_count)
       VALUES ($1,$2,$3,$4,$5,2775,$6,'bound',$7,NOW(),NOW(),1)
       ON CONFLICT (entity_type, entity_id)
       DO UPDATE SET system_id=$3, ip_address=$4, remote_ip=$5, bind_mode=$6,
                     status='bound', negotiated_version=$7, connected_at=NOW(),
                     last_activity=NOW(), bound_count=smpp_sessions.bound_count+1,
                     last_error=NULL, last_error_at=NULL, disconnected_at=NULL`,
      [entityType, entityId, systemId, ipAddr, ipAddr, bindMode, ver]
    );

    await db.query(
      `INSERT INTO bind_history (entity_type, entity_id, system_id, ip_address, port, bind_mode, status, negotiated_version, created_at)
       VALUES ($1,$2,$3,$4,2775,$5,'bound',$6,NOW())`,
      [entityType, entityId, systemId, ipAddr, bindMode, ver]
    );

    if (entityType === 'supplier') {
      await db.query(
        `UPDATE suppliers SET bind_status='bound', consecutive_failures=0, updated_at=NOW() WHERE id=$1`,
        [entityId]
      );
    }
  }
}
