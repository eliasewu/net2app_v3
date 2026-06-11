const axios = require('axios');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'net2app_hub',
  user: process.env.DB_USER || 'net2app_user',
  password: process.env.DB_PASS || 'Ariya@2024Net2App',
});

const SMS_SHEBA_CONFIG = {
  apiKey: '17a0c9ff557a81eccafefb624443573c',
  sender: '8809606776010',
  baseUrl: 'https://api.smssheba.com/smsapiv3',
  name: 'SMS Sheba'
};

class SmsShebaConnector {
  async sendSms(destination, message, clientId, options = {}) {
    // Format destination
    let msisdn = destination.replace(/[^0-9]/g, '');
    if (msisdn.startsWith('880')) {
      msisdn = msisdn.substring(3);
    }
    
    // Get client rate
    const rateResult = await pool.query(
      `SELECT rate FROM rates 
       WHERE entity_type = 'client' 
       AND entity_id = $1 
       AND mcc = '470' 
       AND is_active = true 
       LIMIT 1`,
      [clientId]
    );
    const rate = rateResult.rows[0]?.rate || 0.05;
    
    // Generate message ID
    const messageId = `SMS_SHEBA_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    
    // Get client code
    const clientResult = await pool.query('SELECT client_code FROM clients WHERE id = $1', [clientId]);
    const clientCode = clientResult.rows[0]?.client_code || 'UNKNOWN';
    
    // Store in database as pending
    await pool.query(
      `INSERT INTO sms_logs 
       (message_id, client_id, client_code, sender_id, destination, message, status, submit_time, client_rate)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', NOW(), $7)`,
      [messageId, clientId, clientCode, SMS_SHEBA_CONFIG.sender, destination, message, rate]
    );
    
    // Build API URL
    const apiUrl = `${SMS_SHEBA_CONFIG.baseUrl}?apikey=${SMS_SHEBA_CONFIG.apiKey}&sender=${SMS_SHEBA_CONFIG.sender}&msisdn=${msisdn}&smstext=${encodeURIComponent(message)}`;
    
    console.log(`[SMS Sheba] Sending to ${msisdn}`);
    
    try {
      const response = await axios.get(apiUrl, { timeout: 30000 });
      
      // Parse response - status 0 means success
      let apiResponse;
      if (response.data.response && response.data.response[0]) {
        apiResponse = response.data.response[0];
      } else {
        apiResponse = response.data;
      }
      
      if (apiResponse.status === 0) {
        // Success - delivered
        await pool.query(
          `UPDATE sms_logs 
           SET status = 'delivered', 
               dlr_status = 'DELIVRD',
               delivery_time = NOW(),
               supplier_response = $1,
               smpp_message_id = $2
           WHERE message_id = $3`,
          [JSON.stringify(apiResponse), apiResponse.id, messageId]
        );
        console.log(`[SMS Sheba] ✅ Delivered, ID: ${apiResponse.id}`);
        return { success: true, messageId: apiResponse.id, response: apiResponse };
      } else {
        // Failed
        await pool.query(
          `UPDATE sms_logs 
           SET status = 'failed', 
               error_message = $1
           WHERE message_id = $2`,
          [`API status: ${apiResponse.status}`, messageId]
        );
        console.log(`[SMS Sheba] ❌ Failed with status: ${apiResponse.status}`);
        return { success: false, error: 'SMS failed', response: apiResponse };
      }
    } catch (error) {
      console.error(`[SMS Sheba] Error:`, error.message);
      await pool.query(
        `UPDATE sms_logs 
         SET status = 'failed', 
             error_message = $1
         WHERE message_id = $2`,
        [error.message, messageId]
      );
      return { success: false, error: error.message };
    }
  }
  
  async getStatus(messageId) {
    const result = await pool.query(
      `SELECT message_id, status, dlr_status, smpp_message_id FROM sms_logs WHERE message_id = $1`,
      [messageId]
    );
    return result.rows[0] || null;
  }
}

module.exports = new SmsShebaConnector();
