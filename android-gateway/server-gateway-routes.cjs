/**
 * ============================================================
 * ANDROID SMS GATEWAY — Server-Side API Routes
 * ============================================================
 * 
 * Add these routes to server.cjs to support the Android SMS Gateway app.
 * 
 * The Android app connects to these endpoints via HTTP REST to:
 *   1. Register as a supplier (connection_type = 'android_SMS')
 *   2. Heartbeat / poll for pending MT messages
 *   3. Forward MO (incoming) SMS to the server
 *   4. Report DLR for MT messages
 * 
 * ADD THIS FILE'S CONTENT TO server.cjs before the app.listen() call.
 * Search for "// === ANDROID GATEWAY ROUTES ===" as insertion point
 * and paste everything between the markers.
 */

// ============================================================
// CONFIG: Add this near the top of server.cjs after other requires
// ============================================================
// const basicAuth = (req, res, next) => { ... }; // Use existing auth middleware

// ============================================================
// ANDROID GATEWAY ROUTES — Add these before app.listen()
// ============================================================

/**
 * POST /api/gateway/register
 * Register or update an Android SMS Gateway supplier.
 * 
 * Body: { username, password, device_name, connection_type }
 * 
 * Creates/updates a supplier entry with connection_type='android_SMS'
 * and is_inbound=true (since the Android device connects TO the server).
 */
app.post('/api/gateway/register', async (req, res) => {
    try {
        const { username, password, device_name } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({ success: false, error: 'username and password are required' });
        }

        const supplierCode = `android_${(device_name || username).replace(/[^a-zA-Z0-9]/g, '_').substring(0, 20)}`;
        const displayName = device_name || username;

        // Check if supplier already exists (by smpp_username)
        const existing = await pool.query(
            'SELECT id FROM suppliers WHERE smpp_username = $1',
            [username]
        );

        let supplierId;

        if (existing.rows.length > 0) {
            // Update existing
            supplierId = existing.rows[0].id;
            await pool.query(
                `UPDATE suppliers SET
                    connection_type = 'android_SMS',
                    is_inbound = true,
                    company_name = COALESCE(NULLIF($2,''), company_name),
                    smpp_password = $3,
                    status = 'active',
                    updated_at = NOW()
                 WHERE id = $1`,
                [supplierId, displayName, password]
            );
            console.log(`[Gateway] Updated supplier #${supplierId} (${username}) for Android device "${displayName}"`);
        } else {
            // Create new
            const insert = await pool.query(
                `INSERT INTO suppliers (
                    supplier_code, company_name, connection_type,
                    smpp_username, smpp_password, smpp_host, smpp_port,
                    is_inbound, bind_status, status, balance, currency
                 ) VALUES ($1,$2,'android_SMS',$3,$4,'0.0.0.0',0,true,'bound','active',0,'EUR')
                 RETURNING id`,
                [supplierCode, displayName, username, password]
            );
            supplierId = insert.rows[0].id;
            console.log(`[Gateway] Created new Android supplier #${supplierId}: ${supplierCode} (${displayName})`);
        }

        res.json({ success: true, supplier_id: supplierId, supplier_code: supplierCode });
    } catch (e) {
        console.error(`[Gateway] Register failed: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * POST /api/gateway/heartbeat
 * Called every 5 seconds by the Android device.
 * 
 * Returns pending MT messages to deliver.
 * Also updates the device's last_seen timestamp.
 * 
 * Body: { device_name, timestamp }
 * Authenticated via Basic auth (username = smpp_username, password = smpp_password)
 */
app.post('/api/gateway/heartbeat', async (req, res) => {
    try {
        const { device_name } = req.body;

        // Authenticate via Basic auth header
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Basic ')) {
            return res.status(401).json({ success: false, error: 'Missing auth header' });
        }

        const decoded = Buffer.from(authHeader.substring(6), 'base64').toString('utf8');
        const [username, password] = decoded.split(':');

        // Find the supplier
        const supplierR = await pool.query(
            `SELECT id, supplier_code, connection_type, is_inbound, status
             FROM suppliers
             WHERE smpp_username = $1 AND smpp_password = $2
               AND connection_type = 'android_SMS'
               AND status = 'active'
               AND (is_deleted IS NULL OR is_deleted = false)`,
            [username, password]
        );

        if (supplierR.rows.length === 0) {
            return res.status(403).json({ success: false, error: 'Invalid credentials or not an Android gateway' });
        }

        const supplier = supplierR.rows[0];

        // Update last heartbeat timestamp
        await pool.query(
            `UPDATE suppliers SET bind_status = 'bound', updated_at = NOW()
             WHERE id = $1`,
            [supplier.id]
        ).catch(() => {});

        // Fetch pending MT messages from sms_outbox for this supplier
        const pending = await pool.query(
            `SELECT o.message_id, o.destination, o.sender_id, o.message,
                    o.client_code, o.queued_at
             FROM sms_outbox o
             WHERE o.supplier_id = $1
               AND o.status = 'pending'
               AND o.attempt_count < o.max_attempts
             ORDER BY o.queued_at ASC
             LIMIT 20`,
            [supplier.id]
        );

        const pendingMt = pending.rows.map(r => ({
            message_id: r.message_id,
            destination: r.destination,
            sender_id: r.sender_id || '',
            message: r.message,
            client_code: r.client_code || '',
        }));

        // Mark these as dispatched
        if (pendingMt.length > 0) {
            const msgIds = pending.rows.map(r => r.message_id);
            await pool.query(
                `UPDATE sms_outbox SET status = 'sent', sent_at = NOW(), attempt_count = attempt_count + 1
                 WHERE message_id = ANY($1)`,
                [msgIds]
            );
        }

        console.log(`[Gateway] Heartbeat from ${supplier.supplier_code}: ${pendingMt.length} pending MT`);

        res.json({
            success: true,
            pending_mt: pendingMt,
            server_time: Date.now(),
        });
    } catch (e) {
        console.error(`[Gateway] Heartbeat failed: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * GET /api/gateway/ping
 * Simple connectivity check. Returns server time.
 */
app.get('/api/gateway/ping', (req, res) => {
    res.json({ success: true, server_time: Date.now(), version: '2.0.0' });
});

/**
 * POST /api/gateway/mo-sms
 * Forward a Mobile-Originated (incoming) SMS from the Android device to the server.
 * 
 * Body: { from, to, text, timestamp, device_name }
 * 
 * The server stores this in sms_logs and can optionally forward it
 * to the client who last sent an MT to this number.
 */
app.post('/api/gateway/mo-sms', async (req, res) => {
    try {
        const { from, text, timestamp, device_name } = req.body;

        if (!from || !text) {
            return res.status(400).json({ success: false, error: 'from and text are required' });
        }

        // Authenticate via Basic auth
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Basic ')) {
            return res.status(401).json({ success: false, error: 'Missing auth header' });
        }

        const decoded = Buffer.from(authHeader.substring(6), 'base64').toString('utf8');
        const [username] = decoded.split(':');

        // Find supplier
        const supplierR = await pool.query(
            `SELECT id, supplier_code FROM suppliers
             WHERE smpp_username = $1 AND connection_type = 'android_SMS' AND status = 'active'`,
            [username]
        );

        if (supplierR.rows.length === 0) {
            return res.status(403).json({ success: false, error: 'Not authorized' });
        }

        const supplier = supplierR.rows[0];
        const msgId = `MO_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

        // Store in sms_logs
        await pool.query(
            `INSERT INTO sms_logs (message_id, supplier_id, supplier_code, sender_id, destination, message, status, source, submit_time)
             VALUES ($1,$2,$3,$4,$5,$6,'received','android_gateway_mo',$7)`,
            [msgId, supplier.id, supplier.supplier_code, from, device_name || 'unknown', text, new Date(timestamp || Date.now())]
        );

        // Try to forward to the last client who sent MT to this number
        try {
            const lastClient = await pool.query(
                `SELECT client_id, client_code FROM sms_logs
                 WHERE destination = $1 AND client_id IS NOT NULL
                 ORDER BY submit_time DESC LIMIT 1`,
                [from]
            );
            if (lastClient.rows.length > 0 && smppServer) {
                smppServer.sendIncomingSms(lastClient.rows[0].client_id, from, text);
                console.log(`[Gateway] MO forwarded to client #${lastClient.rows[0].client_id}: ${from}`);
            }
        } catch (e) {
            // Best effort — don't fail the whole request
            console.error(`[Gateway] MO forward to client failed: ${e.message}`);
        }

        console.log(`[Gateway] MO SMS from ${supplier.supplier_code}: ${from} → "${text.substring(0, 30)}"`);

        res.json({ success: true, message_id: msgId });
    } catch (e) {
        console.error(`[Gateway] MO SMS failed: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * POST /api/gateway/mt-dlr
 * Report delivery status for an MT SMS sent via the Android device.
 * 
 * Body: { message_id, status ('DELIVRD'|'UNDELIV'|'FAILED'), error_code, timestamp }
 */
app.post('/api/gateway/mt-dlr', async (req, res) => {
    try {
        const { message_id, status, error_code } = req.body;

        if (!message_id || !status) {
            return res.status(400).json({ success: false, error: 'message_id and status are required' });
        }

        // Authenticate
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Basic ')) {
            return res.status(401).json({ success: false, error: 'Missing auth header' });
        }

        const decoded = Buffer.from(authHeader.substring(6), 'base64').toString('utf8');
        const [username] = decoded.split(':');

        const supplierR = await pool.query(
            `SELECT id FROM suppliers
             WHERE smpp_username = $1 AND connection_type = 'android_SMS' AND status = 'active'`,
            [username]
        );

        if (supplierR.rows.length === 0) {
            return res.status(403).json({ success: false, error: 'Not authorized' });
        }

        const finalStatus = status === 'DELIVRD' ? 'delivered' : 'failed';
        const dlrStatus = status === 'DELIVRD' ? 'DELIVRD' : (status === 'UNDELIV' ? 'UNDELIV' : 'FAILED');

        // Update sms_outbox
        await pool.query(
            `UPDATE sms_outbox SET
                dlr_status = $1,
                dlr_received_at = NOW(),
                status = $2,
                completed_at = NOW()
             WHERE message_id = $3`,
            [dlrStatus, finalStatus, message_id]
        );

        // Update sms_logs
        const logUpdate = await pool.query(
            `UPDATE sms_logs SET
                dlr_status = $1,
                status = $2,
                delivery_time = NOW(),
                dlr_timestamp = NOW(),
                error_code = CASE WHEN $4 != '' THEN $4 ELSE error_code END
             WHERE message_id = $3
             RETURNING client_id, client_code, destination, submit_time, client_rate, message_parts, billing_mode_snapshot, webhook_url`,
            [dlrStatus, finalStatus, message_id, error_code || '']
        );

        // DLR billing for DELIVRD
        if (status === 'DELIVRD' && logUpdate.rows.length > 0) {
            const log = logUpdate.rows[0];
            if (log.billing_mode_snapshot === 'dlr' && log.client_rate) {
                const clientCost = parseFloat(((log.client_rate || 0) * (log.message_parts || 1)).toFixed(6));
                await pool.query(
                    'UPDATE clients SET balance = GREATEST(0, balance - $1), updated_at = NOW() WHERE id = $2',
                    [clientCost, log.client_id]
                ).catch(() => {});
                await pool.query(
                    'UPDATE sms_logs SET is_billed = true WHERE message_id = $1',
                    [message_id]
                ).catch(() => {});
                console.log(`[Gateway] 💰 DLR billing: ${message_id} → €${clientCost} (client #${log.client_id})`);
            }
            // Webhook
            if (log.webhook_url && queueManager) {
                queueManager.sendWebhook(log.webhook_url, message_id, log.destination, 'delivered', 'DELIVRD', log.client_code).catch(() => {});
            }
            // Push DLR to bound client
            if (smppServer) {
                smppServer.sendDlr({
                    client_id: log.client_id,
                    message_id,
                    destination: log.destination,
                    status: 'DELIVRD',
                    client_code: log.client_code,
                    submit_time: log.submit_time,
                });
            }
        }

        console.log(`[Gateway] DLR for ${message_id}: ${status}`);

        res.json({ success: true });
    } catch (e) {
        console.error(`[Gateway] MT DLR failed: ${e.message}`);
        res.status(500).json({ success: false, error: e.message });
    }
});

/**
 * GET /api/gateway/stats
 * Get gateway device statistics.
 */
app.get('/api/gateway/stats', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Basic ')) {
            return res.status(401).json({ success: false, error: 'Missing auth header' });
        }

        const decoded = Buffer.from(authHeader.substring(6), 'base64').toString('utf8');
        const [username] = decoded.split(':');

        const supplierR = await pool.query(
            `SELECT id, balance, currency, bind_status FROM suppliers
             WHERE smpp_username = $1 AND connection_type = 'android_SMS' AND status = 'active'`,
            [username]
        );

        if (supplierR.rows.length === 0) {
            return res.status(403).json({ success: false, error: 'Not authorized' });
        }

        const supplier = supplierR.rows[0];

        const stats = await pool.query(
            `SELECT
                COUNT(*) FILTER (WHERE status = 'delivered') as total_delivered,
                COUNT(*) FILTER (WHERE status = 'failed') as total_failed,
                COUNT(*) FILTER (WHERE source = 'android_gateway_mo') as total_mo,
                COUNT(*) as total_processed
             FROM sms_logs
             WHERE supplier_id = $1`,
            [supplier.id]
        );

        res.json({
            success: true,
            data: {
                balance: supplier.balance,
                currency: supplier.currency,
                bind_status: supplier.bind_status,
                ...stats.rows[0],
            }
        });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

console.log('[Gateway] ✅ Android SMS Gateway API routes registered');
