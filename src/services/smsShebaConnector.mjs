import axios from 'axios';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'net2app_hub',
  user: process.env.DB_USER || 'net2app_user',
  password: process.env.DB_PASS || 'Ariya@2024Net2App',
});

// SMS Sheba API Configuration
const SMS_SHEBA_CONFIG = {
  apiKey: '17a0c9ff557a81eccafefb624443573c',
  sender: '8809606776010',
  baseUrl: 'https://api.smssheba.com/smsapiv3',
  name: 'SMS Sheba'
};

class SmsShebaConnector {
  async sendSms(destination, message, clientId, options = {}) {
    const messageId = `SMS_SHEBA_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    
    // Format destination (remove +, keep only numbers)
    let msisdn = destination.replace(/[^0-9]/g, '');
    if (msisdn.startsWith('880')) {
      msisdn = msisdn.substring(3);
    }
    
    // Get existing rate from database
    const rateResult = await pool.query(
      `SELECT rate FROM rates 
       WHERE entity_type = 'client' 
       AND entity_id = $1 
       AND mcc = '470' 
       AND is_active = true 
       LIMIT 1`,
      [clientId]
    );
    
    const rate = rateResult.rows[0]?.rate || 0.0035;
    
    // Build API request
    const apiUrl = `${SMS_SHEBA_CONFIG.baseUrl}?apikey=${SMS_SHEBA_CONFIG.apiKey}&sender=${SMS_SHEBA_CONFIG.sender}&msisdn=${msisdn}&smstext=${encodeURIComponent(message)}`;
    
    console.log(`[SMS Sheba] Sending to ${msisdn}`);
    console.log(`[SMS Sheba] Rate: $${rate}`);
    
    // Store in database
    const result = await pool.query(
      `INSERT INTO sms_logs 
       (message_id, client_id, destination, message, status, submit_time, client_rate, supplier_status)
       VALUES ($1, $2, $3, $4, 'sending', NOW(), $5, 'pending')
       RETURNING *`,
      [messageId, clientId, destination, message, rate]
    );
    
    // Send HTTP request
    try {
      const response = await axios.get(apiUrl, { timeout: 30000 });
      
      // status 0 = success (delivered)
      if (response.data.status === 0) {
        await pool.query(
          `UPDATE sms_logs 
           SET status = 'delivered', 
               dlr_status = 'DELIVRD', 
               delivery_time = NOW(),
               supplier_response = $1
           WHERE message_id = $2`,
          [JSON.stringify(response.data), messageId]
        );
        console.log(`[SMS Sheba] ✅ Delivered`);
      } else {
        await pool.query(
          `UPDATE sms_logs 
           SET status = 'failed', 
               dlr_status = 'UNDELIV',
               error_message = 'API status: ' || $1,
               supplier_response = $2
           WHERE message_id = $3`,
          [response.data.status, JSON.stringify(response.data), messageId]
        );
        console.log(`[SMS Sheba] ❌ Failed - status: ${response.data.status}`);
      }
    } catch (error) {
      await pool.query(
        `UPDATE sms_logs 
         SET status = 'failed', 
             error_message = $1
         WHERE message_id = $2`,
        [error.message, messageId]
      );
      console.error(`[SMS Sheba] Error:`, error.message);
    }
    
    return result.rows[0];
  }
  
  async getStatus(messageId) {
    const result = await pool.query(
      `SELECT message_id, status, dlr_status FROM sms_logs WHERE message_id = $1`,
      [messageId]
    );
    return result.rows[0] || null;
  }
}

export default new SmsShebaConnector();
