#!/bin/bash

cd /home/ubuntu/net2app-hub

# Create a patch to fix the status values
cat > server-patch.cjs << 'ENDPATCH'
// ===================== FIXED SMS SHEBA DIRECT WITH DLR =====================
app.post('/api/sms-sheba/send', auth, async (req, res) => {
  try {
    const { client_id, destination, message, sender_id = '8809606776010' } = req.body;
    
    let msisdn = destination.replace(/[^0-9]/g, '');
    if (msisdn.startsWith('880')) {
      msisdn = msisdn.substring(3);
    }
    
    // Get rates
    const clientRateResult = await pool.query(
      "SELECT rate FROM rates WHERE entity_type = 'client' AND entity_id = $1 AND mcc = '470' AND is_active = true",
      [client_id]
    );
    const supplierRateResult = await pool.query(
      "SELECT rate FROM rates WHERE entity_type = 'supplier' AND entity_id = $1 AND mcc = '470' AND is_active = true",
      [7]
    );
    
    const clientRate = clientRateResult.rows[0]?.rate || 0.05;
    const supplierRate = supplierRateResult.rows[0]?.rate || 0.0035;
    const profit = parseFloat(clientRate) - parseFloat(supplierRate);
    
    const clientResult = await pool.query('SELECT client_code FROM clients WHERE id = $1', [client_id]);
    const clientCode = clientResult.rows[0]?.client_code || 'UNKNOWN';
    
    const tempMessageId = `TEMP_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    // Use valid status 'pending' instead of 'sending'
    await pool.query(
      `INSERT INTO sms_logs (message_id, client_id, client_code, sender_id, destination, message, client_rate, supplier_rate, profit, status, submit_time, force_dlr)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', NOW(), true)`,
      [tempMessageId, client_id, clientCode, sender_id, destination, message, clientRate, supplierRate, profit]
    );
    
    const apiUrl = `https://api.smssheba.com/smsapiv3?apikey=17a0c9ff557a81eccafefb624443573c&sender=${sender_id}&msisdn=${msisdn}&smstext=${encodeURIComponent(message)}`;
    
    const response = await axios.get(apiUrl, { timeout: 30000 });
    const apiResponse = response.data;
    
    if (apiResponse.status === 0) {
      const apiMessageId = apiResponse.id;
      
      await pool.query(
        `UPDATE sms_logs 
         SET message_id = $1, 
             smpp_message_id = $2, 
             supplier_response = $3, 
             status = 'sent'
         WHERE message_id = $4`,
        [apiMessageId, apiMessageId, JSON.stringify(apiResponse), tempMessageId]
      );
      
      const dlrDelay = Math.floor(Math.random() * 3000) + 1000;
      
      setTimeout(async () => {
        await pool.query(
          `UPDATE sms_logs 
           SET status = 'delivered', 
               dlr_status = 'DELIVRD',
               delivery_time = NOW()
           WHERE message_id = $1`,
          [apiMessageId]
        );
        console.log(`[DLR] Message ${apiMessageId} delivered after ${dlrDelay}ms`);
      }, dlrDelay);
      
      res.json({ 
        success: true, 
        message: 'SMS sent, DLR pending',
        message_id: apiMessageId,
        status: apiResponse.status,
        dlr_delay_ms: dlrDelay
      });
    } else {
      await pool.query(
        `UPDATE sms_logs 
         SET status = 'failed', 
             error_message = $1
         WHERE message_id = $2`,
        [`API status: ${apiResponse.status}`, tempMessageId]
      );
      res.json({ success: false, error: 'SMS failed', status: apiResponse.status });
    }
  } catch (e) {
    console.error('[SMS Sheba] Error:', e);
    res.status(500).json({ error: e.message });
  }
});
ENDPATCH

# Remove the old SMS Sheba endpoint and add the new one
sed -i '/\/\/ ===================== SMS SHEBA DIRECT WITH DLR =====================/,/\/\/ Catch-all/d' server.cjs
sed -i '/\/\/ Catch-all/i \
// ===================== SMS SHEBA DIRECT WITH DLR =====================\
app.post("/api/sms-sheba/send", auth, async (req, res) => {\
  try {\
    const { client_id, destination, message, sender_id = "8809606776010" } = req.body;\
    let msisdn = destination.replace(/[^0-9]/g, "");\
    if (msisdn.startsWith("880")) { msisdn = msisdn.substring(3); }\
    const clientRateResult = await pool.query("SELECT rate FROM rates WHERE entity_type = "client" AND entity_id = $1 AND mcc = "470" AND is_active = true", [client_id]);\
    const supplierRateResult = await pool.query("SELECT rate FROM rates WHERE entity_type = "supplier" AND entity_id = $1 AND mcc = "470" AND is_active = true", [7]);\
    const clientRate = clientRateResult.rows[0]?.rate || 0.05;\
    const supplierRate = supplierRateResult.rows[0]?.rate || 0.0035;\
    const profit = parseFloat(clientRate) - parseFloat(supplierRate);\
    const clientResult = await pool.query("SELECT client_code FROM clients WHERE id = $1", [client_id]);\
    const clientCode = clientResult.rows[0]?.client_code || "UNKNOWN";\
    const tempMessageId = `TEMP_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;\
    await pool.query(`INSERT INTO sms_logs (message_id, client_id, client_code, sender_id, destination, message, client_rate, supplier_rate, profit, status, submit_time, force_dlr) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, "pending", NOW(), true)`, [tempMessageId, client_id, clientCode, sender_id, destination, message, clientRate, supplierRate, profit]);\
    const apiUrl = `https://api.smssheba.com/smsapiv3?apikey=17a0c9ff557a81eccafefb624443573c&sender=${sender_id}&msisdn=${msisdn}&smstext=${encodeURIComponent(message)}`;\
    const response = await axios.get(apiUrl, { timeout: 30000 });\
    const apiResponse = response.data;\
    if (apiResponse.status === 0) {\
      const apiMessageId = apiResponse.id;\
      await pool.query(`UPDATE sms_logs SET message_id = $1, smpp_message_id = $2, supplier_response = $3, status = "sent" WHERE message_id = $4`, [apiMessageId, apiMessageId, JSON.stringify(apiResponse), tempMessageId]);\
      const dlrDelay = Math.floor(Math.random() * 3000) + 1000;\
      setTimeout(async () => {\
        await pool.query(`UPDATE sms_logs SET status = "delivered", dlr_status = "DELIVRD", delivery_time = NOW() WHERE message_id = $1`, [apiMessageId]);\
      }, dlrDelay);\
      res.json({ success: true, message: "SMS sent, DLR pending", message_id: apiMessageId, status: apiResponse.status, dlr_delay_ms: dlrDelay });\
    } else {\
      await pool.query(`UPDATE sms_logs SET status = "failed", error_message = $1 WHERE message_id = $2`, [`API status: ${apiResponse.status}`, tempMessageId]);\
      res.json({ success: false, error: "SMS failed", status: apiResponse.status });\
    }\
  } catch (e) {\
    res.status(500).json({ error: e.message });\
  }\
});\
' server.cjs

# Restart server
pm2 restart net2app-hub
sleep 3
