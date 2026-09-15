import smpp from 'smpp';
import dotenv from 'dotenv';
dotenv.config();

// Detects Unicode (non-GSM7) characters in message, returns correct SMPP data_coding
// data_coding: 0 = GSM-7 (default), 8 = UCS-2 (Unicode)
// Human-readable names for common SMPP bind/command error codes (ESME_*).
// Used for clearer logs when a bind is rejected (e.g. status 13 = ESME_RBINDFAIL).
const ESME_ERRORS = {
  0x01: 'ESME_RINVMSGLEN', 0x02: 'ESME_RINVCMDLEN', 0x03: 'ESME_RINVCMDID',
  0x04: 'ESME_RINVBNDSTS', 0x05: 'ESME_RALYBND', 0x06: 'ESME_RINVPRTFLG',
  0x07: 'ESME_RINVREGDLVFLG', 0x08: 'ESME_RSYSERR', 0x0A: 'ESME_RINVSRCADR',
  0x0B: 'ESME_RINVDSTADR', 0x0C: 'ESME_RINVMSGID', 0x0D: 'ESME_RBINDFAIL',
  0x0E: 'ESME_RINVPASWD', 0x0F: 'ESME_RINVSYSID', 0x14: 'ESME_RMSGQFUL',
  0x15: 'ESME_RINVSERTYP', 0x53: 'ESME_RINVSYSTYP', 0x58: 'ESME_RTHROTTLED'
};
const smppErrorName = (code) => `${code || 0} (${ESME_ERRORS[code] || 'ESME_UNKNOWN'})`;

// Convert a stored SMPP version ("3.3", "3.4", "5.0", raw byte, ...) into the correct
// protocol interface_version byte sent in bind_transceiver. Default 0x34 (3.4).
// Prevents sending an invalid byte like 0x05 from parseInt("5.0") which SMSCs reject.
const resolveInterfaceVersion = (raw) => {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return 0x34;
  if (/^0x[0-9a-fA-F]{2}$/.test(s)) return parseInt(s, 16);
  const t = s.toLowerCase();
  if (t === '3.3' || t === '33') return 0x33;
  if (t === '3.4' || t === '34') return 0x34;
  if (t === '5.0' || t === '50') return 0x50;
  const n = parseInt(s, 10);
  if (!isNaN(n) && n >= 0 && n <= 255 && String(n) === s) return n; // already a raw byte
  return 0x34;
};

// DLR keyword vocabulary — these are protocol field names / status words,
// never message ids. Filtering them keeps the candidate list to real ids.
const DLR_KEYWORDS = new Set([
  'sub', 'dlvrd', 'submit', 'done', 'stat', 'err', 'text', 'id', 'msgid', 'message_id',
  'receipt_id', 'transaction_id', 'date', 'dates', 'submit_date', 'done_date',
  'delivrd', 'undeliv', 'expired', 'rejectd', 'accepted', 'unknown', 'enroute',
  'deleted', 'skipped', 'delivered', 'success', 'failed', 'failure', 'message', 'delivery',
]);

// "submit date:2609132221" style stamps: YYMMDDhhmm. Not an id.
const isDlrDateStamp = (s) => /^\d{10}$/.test(s)
  && /^(2[0-9]|3[0-9])(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])([01][0-9]|2[0-3])[0-5][0-9]$/.test(s);

/**
 * Collect every plausible message-id form from an SMPP DLR receipt.
 *
 * Suppliers are inconsistent about the `id:` field: some echo the id we sent
 * ("id:SMPP1789360442207"), others return their own SMSC id
 * ("id:c3f0e-e-a5f8-a5f804f41"), and chain-forwarding gateways rewrite it.
 * Instead of assuming one format, gather every token that could be an id and
 * let SQL test them all against the known id columns at once.
 *
 * @returns {string[]} candidate ids, most reliable first
 */
export const collectDlrIds = (rawMessage, primaryId) => {
  const raw = String(rawMessage == null ? '' : rawMessage);
  const ids = new Set();
  const add = (v) => {
    const s = String(v == null ? '' : v).trim();
    if (!s || s.length > 64) return;
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(s)) return;
    if (DLR_KEYWORDS.has(s.toLowerCase())) return;
    if (/^\d{1,3}$/.test(s)) return;          // sub:001 / dlvrd:000 / err:69 counters
    if (/^\d{12}$/.test(s) || /^\d{14}$/.test(s) || isDlrDateStamp(s)) return;
    ids.add(s);
  };
  add(primaryId);
  // Explicit key:value pairs first — id:, message_id:, transaction_id:, ...
  for (const m of raw.matchAll(/\b(?:id|msgid|message_id|receipt_id|transaction_id)\s*:\s*([^\s,;]+)/gi)) add(m[1]);
  // Then every standalone token, in case the supplier invents a new format.
  // The free-text `text:` payload is human prose and never carries an id, so
  // it is dropped before tokenising to avoid extracting words as ids.
  const body = raw.split(/\btext\s*:/i)[0];
  for (const token of body.split(/\s+/)) add(token.replace(/^[A-Za-z_]+:/, ''));
  return [...ids];
};

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
    /** Manual enquire_link heartbeat state (see _startEnquireHeartbeat) */
    this._enquireTimer = null;       // interval that fires enquire_link every 30s
    this._enquireMissed = 0;         // consecutive unanswered enquire_links
    this._enquireMaxMissed = 2;      // after 2 missed (60s), treat remote as dead → unbound + reconnect
    this._enquireInflight = false;   // guard: only one enquire_link outstanding at a time
    /** DLR callback: (dlr) => void where dlr = { message_id, status, error_code, text } */
    this.onDlr = null;
    /** Billing callback: (params) => Promise where params match applyBilling() args.
     *  Called on DELIVRD DLR instead of direct SQL billing. */
    this.onDlrBilling = null;
  }

  async connect() {
    const { supplier } = this;
    const host = supplier.smpp_host;
    const port = supplier.smpp_port || 2775;

    if (!host) {
      console.error(`[SMPP-CLIENT] ${supplier.supplier_code}: No smpp_host configured, skipping`);
      return false;
    }

    // Idempotency guard: if we already have a live, bound session, never
    // open a second socket. Multiple concurrent binds to the same system_id
    // are rejected/dropped by most SMSCs, which caused the constant
    // bound→unbound churn (duplicate sessions killing each other).
    if (this.connected && this.bound && this.session) {
      return true;
    }

    if (this._connecting) {
      console.log(`[SMPP-CLIENT] ${supplier.supplier_code}: Already connecting, waiting...`);
      // Wait a bit for existing connect to settle
      await new Promise(r => setTimeout(r, 2000));
      return this.connected && this.bound;
    }

    this._connecting = true;
    // Reset the single-attempt guard on EVERY connect attempt. It was previously
    // set to true on the first attempt and never cleared, which meant any later
    // failed connect (error event) would skip resolve() AND clear the timeout,
    // leaving the connect() promise pending forever — hanging callers like
    // healthCheck's `await p.connect()`.
    this._connectResolved = false;
    console.log(`[SMPP-CLIENT] ${supplier.supplier_code}: Connecting to ${host}:${port}`);

    return new Promise((resolve) => {
      // Manual enquire_link heartbeat (30s) — started after bind succeeds. Unlike
      // the library's auto_enquire_link_period (fire-and-forget, no response
      // tracking), ours updates smpp_sessions.last_activity on EVERY successful
      // response so the health monitor sees the link as alive, and marks the
      // session unbound + reconnects if the remote stops answering.
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
          interface_version: resolveInterfaceVersion(supplier.smpp_version),
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
            this._startEnquireHeartbeat();
            resolve(true);
          } else {
            this.connected = false;
            this.bound = false;
            this._connectResolved = true;
            console.error(`[SMPP-CLIENT] ❌ ${supplier.supplier_code}: Bind rejected (status ${smppErrorName(pdu.command_status)})`);
            // A rejected/refused bind is a connectivity/config issue, NOT a message
            // delivery failure — don't push it into consecutive_failures (auto-block).
            await this._syncBindStatus('unbound', undefined, { countFailure: false });
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
          try { await this._syncBindStatus('unbound', undefined, { countFailure: false }); } catch (e) { /* ignore */ }
        }
      });

      this.session.on('close', async () => {
        console.log(`[SMPP-CLIENT] ${supplier.supplier_code}: Connection closed`);
        this._stopEnquireHeartbeat();
        this.connected = false;
        this.bound = false;
        if (!this._unboundSynced) {
          this._unboundSynced = true;
          // Connection drops are transient — don't count them as delivery failures.
          await this._syncBindStatus('unbound', undefined, { countFailure: false });
        }
        this.reconnect();
      });

      // Handle incoming enquire_link from the SMSC. Like deliver_sm, the
      // library only emits the event — we must send enquire_link_resp back or
      // the SMSC eventually considers us dead and drops the session.
      this.session.on('enquire_link', (pdu) => {
        try {
          if (typeof pdu.response === 'function' && this.session) {
            this.session.send(pdu.response({ command_status: 0 }));
          }
        } catch (_) { /* best-effort ACK */ }
      });

      // Handle incoming deliver_sm (DLR from SMSC)
      this.session.on('deliver_sm', async (pdu) => {
        // ACK the PDU immediately.
        // IMPORTANT: in smpp 0.6.x `pdu.response()` only CREATES the
        // deliver_sm_resp PDU — it does NOT transmit it. We must call
        // `session.send(pdu.response(...))` or the supplier never receives
        // our ACK (their side reports "DLR reply failed" and may retry or
        // drop the session).
        try {
          if (typeof pdu.response === 'function' && this.session) {
            this.session.send(pdu.response({ command_status: 0 }));
          }
        } catch (_) { /* best-effort ACK */ }
        const source = pdu.source_addr ? pdu.source_addr.toString() : '';

        // Parse short_message — smpp library v0.6 returns it in various shapes:
        // - string (plain text receipt)
        // - Buffer (binary data)
        // - object { message: Buffer|string, ... } (nested)
        // - Uint8Array (not caught by Buffer.isBuffer)
        let rawMessage = '';
        const sm = pdu.short_message;
        if (sm) {
          if (Buffer.isBuffer(sm)) {
            rawMessage = sm.toString('utf8');
          } else if (sm instanceof Uint8Array) {
            rawMessage = Buffer.from(sm).toString('utf8');
          } else if (typeof sm === 'string') {
            rawMessage = sm;
          } else if (typeof sm === 'object') {
            // Could be { message: Buffer|string, ... }
            const inner = sm.message || sm.short_message || sm.text;
            if (inner) {
              if (Buffer.isBuffer(inner)) {
                rawMessage = inner.toString('utf8');
              } else if (inner instanceof Uint8Array) {
                rawMessage = Buffer.from(inner).toString('utf8');
              } else {
                rawMessage = String(inner);
              }
            } else {
              rawMessage = JSON.stringify(sm);
            }
          } else {
            rawMessage = String(sm);
          }
        }
        // Final safety: ensure rawMessage is always a string
        if (typeof rawMessage !== 'string') rawMessage = String(rawMessage);

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

        const isDelivered = ['DELIVRD', 'DELIVERED', 'SUCCESS'].includes(String(dlrStatus || '').trim().toUpperCase());
        const finalStatus = isDelivered ? 'delivered' : (dlrStatus === 'REJECTD' || dlrStatus === 'EXPIRED' ? 'failed' : 'failed');
        const finalDlr = isDelivered ? 'DELIVRD' : (dlrStatus || 'UNDELIV');

        console.log(`[SMPP-CLIENT] ${supplier.supplier_code}: DLR parsed — ${dlrMessageId} → stat=${finalDlr} err=${dlrError} delivered=${isDelivered}`);

        try {
          // Match the receipt against EVERY known id form, in one statement.
          // Suppliers quote different ids for the same message (our message_id,
          // their SMSC id, or a rewritten forwarded id), and chain-forwarded
          // gateways invent new ones — so test the whole candidate set against
          // every id column instead of assuming one field. The quoted id is also
          // merged into dlr_match_ids so later DLRs for this message hit the
          // array predicate even if the supplier switches id type mid-flight.
          const candidateIds = collectDlrIds(rawMessage, dlrMessageId);
          let outboxR = await this.pool.query(
            `UPDATE sms_outbox SET
               dlr_status = $1,
               dlr_received_at = NOW(),
               dlr_confirmed_at = NOW(),
               status = $2,
               completed_at = NOW(),
               dlr_match_ids = (SELECT array_agg(DISTINCT x)
                                  FROM unnest(COALESCE(dlr_match_ids, ARRAY[]::TEXT[]) || ARRAY[$4]::TEXT[]) AS t(x)
                                 WHERE x IS NOT NULL AND x <> '')
             WHERE id = (SELECT id FROM sms_outbox
                          WHERE message_id = ANY($3::TEXT[])
                             OR connector_transaction_id = ANY($3::TEXT[])
                             OR dlr_match_ids && $3::TEXT[]
                          ORDER BY (dlr_status IS NULL OR dlr_status IN ('PENDING', 'UNDELIV')) DESC NULLS LAST,
                                   queued_at DESC NULLS LAST
                          LIMIT 1)
             RETURNING id, message_id, connector_transaction_id, dlr_match_ids,
                       client_id, client_code, supplier_id, destination, sender_id, source, queued_at,
                       client_rate, supplier_rate, message_parts, billing_mode, supplier_billing_mode`,
            [finalDlr, finalStatus, candidateIds, dlrMessageId]
          );

          if (outboxR.rows.length > 0) {
            const r = outboxR.rows[0];
            const matchedBy = dlrMessageId === r.message_id ? 'our-in-id'
              : (dlrMessageId === r.connector_transaction_id ? 'supplier-out-id'
              : (Array.isArray(r.dlr_match_ids) && r.dlr_match_ids.includes(dlrMessageId) ? 'dlr_match_ids' : 'id-from-receipt'));
            console.log(`[SMPP-CLIENT] ${supplier.supplier_code}: ✅ DLR id matched by ${matchedBy} — quoted="${dlrMessageId}" our_id=${r.message_id} supplier_id=${r.connector_transaction_id || '-'} (${candidateIds.length} id form(s) tested) → result=${finalDlr} err=${dlrError}`);
          }

          // Fallback: chain-forwarded gateways assign NEW IDs not in dlr_match_ids.
          // Try extracting all IDs from the receipt text and match against dlr_match_ids.
          if (outboxR.rows.length === 0) {
            const allIds = [...rawMessage.matchAll(/\b([A-Za-z0-9_-]{10,40})\b/g)].map(m => m[1]);
            const uniqueIds = [...new Set(allIds)].filter(id => id !== dlrMessageId);
            if (uniqueIds.length > 0) {
              console.log(`[SMPP-CLIENT] ${supplier.supplier_code}: DLR forwarded-ID detection — found ${uniqueIds.length} extra IDs, trying ANY(dlr_match_ids)...`);
              for (const altId of uniqueIds) {
                outboxR = await this.pool.query(
                  `UPDATE sms_outbox SET
                     dlr_status = $1,
                     dlr_received_at = NOW(),
                     dlr_confirmed_at = NOW(),
                     status = $2,
                     completed_at = NOW()
                   WHERE $3 = ANY(dlr_match_ids)
                   RETURNING id, message_id, client_id, client_code, supplier_id, destination, sender_id, source, queued_at,
                             client_rate, supplier_rate, message_parts, billing_mode, supplier_billing_mode`,
                  [finalDlr, finalStatus, altId]
                );
                if (outboxR.rows.length > 0) {
                  console.log(`[SMPP-CLIENT] ${supplier.supplier_code}: ✅ DLR matched via forwarded-ID "${altId}" in dlr_match_ids`);
                  // Append the DLR's primary ID to dlr_match_ids so future DLRs match directly
                  await this.pool.query(
                    `UPDATE sms_outbox SET dlr_match_ids = array_append(dlr_match_ids, $1)
                     WHERE id = $2 AND NOT ($1 = ANY(dlr_match_ids))`,
                    [dlrMessageId, outboxR.rows[0].id]
                  ).catch(() => {});
                  break;
                }
              }
            }
            // Last resort: match by supplier + destination within 10 minute window
            if (outboxR.rows.length === 0) {
              console.log(`[SMPP-CLIENT] ${supplier.supplier_code}: DLR no ID match in dlr_match_ids — trying destination+time window for supplier #${supplier.id}...`);
              outboxR = await this.pool.query(
                `UPDATE sms_outbox SET
                   dlr_status = $1,
                   dlr_received_at = NOW(),
                   dlr_confirmed_at = NOW(),
                   status = $2,
                   completed_at = NOW()
                 WHERE supplier_id = $3
                   AND status = 'submitted'
                   AND queued_at > NOW() - INTERVAL '10 minutes'
                   AND id = (SELECT id FROM sms_outbox WHERE supplier_id = $3 AND status = 'submitted' AND queued_at > NOW() - INTERVAL '10 minutes' ORDER BY queued_at DESC LIMIT 1)
                 RETURNING id, message_id, client_id, client_code, supplier_id, destination, sender_id, source, queued_at,
                           client_rate, supplier_rate, message_parts, billing_mode, supplier_billing_mode`,
                [finalDlr, finalStatus, supplier.id]
              );
              if (outboxR.rows.length > 0) {
                console.log(`[SMPP-CLIENT] ${supplier.supplier_code}: ⚠ DLR matched via time window (no ID match) → dest=${outboxR.rows[0].destination}`);
                // Append the new DLR ID so future DLRs match directly
                await this.pool.query(
                  `UPDATE sms_outbox SET dlr_match_ids = array_append(dlr_match_ids, $1)
                   WHERE id = $2 AND NOT ($1 = ANY(dlr_match_ids))`,
                  [dlrMessageId, outboxR.rows[0].id]
                ).catch(() => {});
              }
            }
          }

          // Update sms_logs + billing + callback using the matched outbox row
          if (outboxR.rows.length > 0) {
            const matchedMsgId = outboxR.rows[0].message_id || dlrMessageId;
            await this.pool.query(
              `UPDATE sms_logs SET
                 dlr_status = $1,
                 status = $2,
                 delivery_time = NOW(),
                 dlr_timestamp = NOW(),
                 error_code = CASE WHEN $4 != '000' THEN $4 ELSE error_code END,
                 error_message = CASE WHEN $4 != '000' THEN COALESCE(NULLIF($5, ''), $4) ELSE error_message END
               WHERE message_id = $3`,
              [finalDlr, finalStatus, matchedMsgId, dlrError, dlrText || '']
            );

            // Track consecutive delivery failures for auto-block.
            // DELIVRD resets the counter; any other outcome increments it.
            // The health monitor auto-blocks once it crosses max_failures.
            if (outboxR.rows[0].supplier_id) {
              try {
                if (isDelivered) {
                  await this.pool.query(
                    `UPDATE suppliers SET consecutive_failures = 0, updated_at = NOW() WHERE id = $1`,
                    [outboxR.rows[0].supplier_id]
                  );
                } else {
                  const incR = await this.pool.query(
                    `UPDATE suppliers SET consecutive_failures = consecutive_failures + 1, updated_at = NOW()
                     WHERE id = $1 RETURNING consecutive_failures`,
                    [outboxR.rows[0].supplier_id]
                  );
                  const nf = incR.rows[0] ? incR.rows[0].consecutive_failures : '?';
                  console.log(`[SMPP-CLIENT] ${supplier.supplier_code}: DLR ${finalDlr} → consecutive_failures=${nf}`);
                }
              } catch (e) {
                console.error(`[SMPP-CLIENT] ${supplier.supplier_code}: failure counter update failed: ${e.message}`);
              }
            }

            // DLR BILLING: delegate to unified applyBilling() via callback.
            if (isDelivered) {
              const outbox = outboxR.rows[0];
              const clientCost = parseFloat(((parseFloat(outbox.client_rate || 0)) * (parseInt(outbox.message_parts || 1))).toFixed(6));
              const supplierCost = parseFloat(((parseFloat(outbox.supplier_rate || 0)) * (parseInt(outbox.message_parts || 1))).toFixed(6));
              const clientBillingMode = outbox.billing_mode || 'dlr';
              const supplierBillingMode = outbox.supplier_billing_mode || 'dlr';
              if (this.onDlrBilling) {
                try {
                  await this.onDlrBilling({
                    messageId: matchedMsgId,
                    clientId: outbox.client_id || null,
                    supplierId: outbox.supplier_id || null,
                    clientCost, supplierCost,
                    clientBillingMode, supplierBillingMode,
                    isSubmit: false,
                    dlrStatus: 'DELIVRD',
                    clientForceDlr: false,
                    supplierForceDlr: false
                  });
                } catch (e) {
                  console.error(`[SMPP-CLIENT] ${supplier.supplier_code}: DLR billing callback failed for ${dlrMessageId}: ${e.message}`);
                }
              }
            }

            // Notify DLR callback (forward to QueueManager for external client push)
            if (this.onDlr) {
              const job = outboxR.rows[0];
              try {
                this.onDlr({
                  message_id: matchedMsgId,
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
          } else {
            console.warn(`[SMPP-CLIENT] ${supplier.supplier_code}: DLR id "${dlrMessageId}" did not match any outbox id (tested every id form against message_id, connector_transaction_id and dlr_match_ids)`);
          }

          console.log(`[SMPP-CLIENT] ${supplier.supplier_code}: DLR processed ✓ — ${dlrMessageId} → sms_outbox=${finalStatus}, sms_logs=${finalDlr}`);
        } catch (e) {
          console.error(`[SMPP-CLIENT] ${supplier.supplier_code}: DLR DB update failed for ${dlrMessageId}: ${e.message}`);
        }
      });
    });
  }

  /**
   * Manual enquire_link heartbeat — interval is configurable via
   * platform_settings.smpp_enquire_interval (seconds, default 30s).
   *
   * What it does (per the bind-issue fix request):
   *  1. Sends enquire_link to the SMSC every configured interval.
   *  2. On a successful response → remote IS responding:
   *       • updates smpp_sessions.last_activity = NOW() so the health monitor
   *         (which requires last_activity < 120s) keeps the supplier 'bound'
   *       • forces suppliers.bind_status='bound' (never flapped by stale data)
   *       • resets the missed-counter
   *  3. If the remote does NOT answer within one interval, twice in a row,
   *     the link is considered dead → syncs 'unbound' + reconnects. This is
   *     the "keep bound until remote stops responding" rule.
   */
  async _startEnquireHeartbeat() {
    this._stopEnquireHeartbeat();
    this._enquireMissed = 0;
    this._enquireInflight = false;
    // Enquire-link interval (seconds) is GUI-configurable via
    // platform_settings.smpp_enquire_interval. Missing/invalid → 30s default.
    let intervalMs = 30000;
    if (this.pool) {
      try {
        const r = await this.pool.query("SELECT value FROM platform_settings WHERE key='smpp_enquire_interval' LIMIT 1");
        if (r.rows.length) {
          const secs = parseInt(r.rows[0].value);
          if (!isNaN(secs) && secs > 0) intervalMs = secs * 1000;
        }
      } catch (e) { /* keep default */ }
    }
    const respTimeoutMs = Math.max(2000, intervalMs);
    this._enquireTimer = setInterval(() => {
      if (!this.session || !this.connected || !this.bound) return;
      if (this._enquireInflight) return; // previous enquiry still pending — don't stack
      this._enquireInflight = true;
      const pending = { answered: false };
      const respTimeout = setTimeout(() => {
        if (!pending.answered) {
          // No response within 15s — count as missed
          this._enquireMissed++;
          console.error(`[SMPP-CLIENT] ${this.supplier.supplier_code}: enquire_link MISSED (${this._enquireMissed}/${this._enquireMaxMissed}) — remote not responding`);
          if (this._enquireMissed >= this._enquireMaxMissed) {
            // Remote is dead — mark unbound and force reconnect
            this.connected = false;
            this.bound = false;
            this._enquireMissed = 0;
            this._enquireInflight = false;
            this._unboundSynced = false;
            this._syncBindStatus('unbound', undefined, { countFailure: false }).catch(() => {});
            console.error(`[SMPP-CLIENT] ${this.supplier.supplier_code}: ❌ Remote not responding (${this._enquireMaxMissed} missed enquire_links) — reconnecting`);
            if (this.session) { try { this.session.close(); } catch (e) { /* ignore */ } }
          } else {
            this._enquireInflight = false; // allow next cycle to retry
          }
        }
      }, respTimeoutMs);
      try {
        this.session.enquire_link(() => {
          clearTimeout(respTimeout);
          if (pending.answered) return; // already handled
          pending.answered = true;
          this._enquireInflight = false;
          this._enquireMissed = 0;
          // Remote responded → refresh activity + keep bind_status='bound'
          if (this.pool) {
            this.pool.query(
              `UPDATE smpp_sessions SET last_activity = NOW()
               WHERE entity_type='supplier' AND entity_id=$1 AND status='bound'`,
              [this.supplier.id]
            ).catch(() => {});
            this.pool.query(
              `UPDATE suppliers SET bind_status='bound', updated_at=NOW() WHERE id=$1`,
              [this.supplier.id]
            ).catch(() => {});
          }
        });
      } catch (e) {
        clearTimeout(respTimeout);
        this._enquireInflight = false;
        console.error(`[SMPP-CLIENT] ${this.supplier.supplier_code}: enquire_link send error: ${e.message}`);
      }
    }, intervalMs);
    console.log(`[SMPP-CLIENT] ${this.supplier.supplier_code}: enquire_link heartbeat started (every ${intervalMs/1000}s)`);
  }

  _stopEnquireHeartbeat() {
    if (this._enquireTimer) {
      clearInterval(this._enquireTimer);
      this._enquireTimer = null;
    }
    this._enquireInflight = false;
    this._enquireMissed = 0;
  }

  async disconnect() {
    this.maxReconnectAttempts = 0;
    this._connecting = false;
    this._unboundSynced = true; // prevent close event from double-syncing
    this._stopEnquireHeartbeat();
    if (this.session) {
      try { this.session.close(); } catch (e) { /* ignore */ }
    }
    this.connected = false;
    this.bound = false;
    // Manual disconnect (Disconnect button / removeSupplier) is NOT a delivery
    // failure — don't bump consecutive_failures, otherwise 20 manual disconnects
    // would auto-block the supplier.
    await this._syncBindStatus('unbound', undefined, { countFailure: false });
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

    const sourceAddr = job.sender_id || this.supplier.supplier_code;
    // Source TON/NPI must match the sender type. Alphanumeric senders
    // (e.g. "MSG2U", "N2AHUB", "DLRACK") sent with TON=0x01 (International)
    // + NPI=0x01 (ISDN) look like an invalid international number to the SMSC
    // and get silently dropped/misrouted — accepted at SMPP layer, never
    // delivered downstream ("submit_expired").
    //   Numeric (E.164)      → TON=0x01 (International), NPI=0x01 (ISDN)
    //   Alphanumeric         → TON=0x05 (Alphanumeric),   NPI=0x00 (Unknown)
    const isNumericSender = /^\+?[0-9]+$/.test(String(sourceAddr || '').trim());
    const sourceTon = isNumericSender ? 0x01 : 0x05;
    const sourceNpi = isNumericSender ? 0x01 : 0x00;

    return new Promise((resolve, reject) => {
      this.session.submit_sm({
        source_addr: sourceAddr,
        source_addr_ton: sourceTon,
        source_addr_npi: sourceNpi,
        destination_addr: job.destination,
        dest_addr_ton: 0x01,
        dest_addr_npi: 0x01,
        short_message: job.message,
        registered_delivery: 1,
        data_coding: getDataCoding(job.message),
      }, (pdu) => {
        if (pdu.command_status === 0) {
          // pdu.message_id may be a Buffer — convert to string for DB storage
          const smscId = typeof pdu.message_id === 'string' ? pdu.message_id :
                         Buffer.isBuffer(pdu.message_id) ? pdu.message_id.toString('utf8').replace(/\0/g, '') :
                         String(pdu.message_id || '');
          console.log(`[SMPP-CLIENT] ${this.supplier.supplier_code}: submit_sm OK — our_id=${job.message_id || '?'} smsc_id=${smscId || '?'}`);
          resolve({ success: true, transaction_id: smscId, message_id: smscId });
        } else {
          console.error(`[SMPP-CLIENT] ${this.supplier.supplier_code}: submit_sm FAILED — our_id=${job.message_id || '?'} status=${pdu.command_status}`);
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
    // after 3 retries, the failure is likely persistent (bad credentials,
    // max sessions, carrier-side reject). Probe slowly instead of hammering.
    const isPermanentFailure = !this._wasEverBound && this.reconnectAttempts >= 3;

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      // Never permanently give up on an enabled supplier: after the fast retry
      // burst, fall back to a slow keep-alive retry loop. A supplier that is
      // temporarily down or briefly rejecting binds reconnects automatically
      // once it comes back — no manual restart needed.
      const slowDelay = Math.round(300000 * jit); // ~5 min
      console.log(`[SMPP-CLIENT] ${this.supplier.supplier_code}: ${this.maxReconnectAttempts} fast reconnects done — slow-retrying in ${Math.round(slowDelay/1000)}s`);
      setTimeout(() => {
        this.reconnectAttempts = 0; // try a fresh fast burst next success cycle
        this.connect().catch(() => {});
      }, slowDelay);
      return;
    }

    this.reconnectAttempts++;

    let delay;
    if (isPermanentFailure) {
      // Likely a config/credential/bind-reject issue — probe slowly.
      delay = Math.min(300000, 60000 * this.reconnectAttempts);
    } else {
      // Transient network issue — shorter exponential backoff.
      delay = Math.min(120000, 10000 * this.reconnectAttempts);
    }
    delay = Math.round(delay * jit);

    const tag = isPermanentFailure ? ' (perm-fail slow retry)' : '';
    console.log(`[SMPP-CLIENT] ${this.supplier.supplier_code}: Reconnecting in ${Math.round(delay/1000)}s (${this.reconnectAttempts}/${this.maxReconnectAttempts})${tag}`);
    setTimeout(() => this.connect().catch(() => {}), delay);
  }

  /**
   * Sync bind status to smpp_sessions + bind_history + suppliers.bind_status.
   * @param {string} status           'bound' | 'unbound'
   * @param {number} [negotiatedVersion]
   * @param {{ countFailure?: boolean }} [options]  when false, an 'unbound' sync does
   *   NOT bump consecutive_failures (used for manual disconnects — a user clicking
   *   Disconnect is not a delivery failure).
   */
  async _syncBindStatus(status, negotiatedVersion, options = {}) {
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
           consecutive_failures = consecutive_failures + CASE WHEN $2 THEN 1 ELSE 0 END, updated_at = NOW()
           WHERE id=$1`,
          [supplierId, options.countFailure !== false]
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
