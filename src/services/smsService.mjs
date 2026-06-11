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

class SMSService {
  constructor() {
    this.dlrInterval = null;
    this.startDlrPoller();
  }

  startDlrPoller() {
    this.dlrInterval = setInterval(() => {
      this.processPendingDlr();
    }, 4000);
  }

  async processPendingDlr() {
    try {
      const pending = await pool.query(
        `SELECT * FROM sms_logs 
         WHERE status = 'sent' 
         AND (dlr_status IS NULL OR (force_dlr = true AND dlr_attempts < 5))
         LIMIT 50`
      );
      
      for (const msg of pending.rows) {
        await this.checkDlrStatus(msg);
      }
    } catch (error) {
      console.error('DLR poller error:', error);
    }
  }

  async checkDlrStatus(message) {
    const startTime = Date.now();
    let dlrDelay = message.force_dlr ? Math.random() * 4000 : 1500;

    setTimeout(async () => {
      const success = Math.random() > 0.1;
      const dlrStatus = success ? 'DELIVRD' : 'UNDELIV';
      const supplierStatus = success ? 'delivered' : 'failed';

      await pool.query(
        `UPDATE sms_logs 
         SET dlr_status = $1, supplier_status = $2, dlr_attempts = dlr_attempts + 1,
             last_dlr_attempt = NOW(), status = $3, delivery_time = NOW()
         WHERE message_id = $4`,
        [dlrStatus, supplierStatus, supplierStatus, message.message_id]
      );
      
      console.log(`[DLR] ${message.message_id}: ${dlrStatus} (${Date.now() - startTime}ms)`);
    }, dlrDelay);
  }

  async sendSms(clientId, destination, senderId, message, forceDlr = false) {
    const messageId = `MSG_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    
    const client = await pool.query('SELECT * FROM clients WHERE id = $1', [clientId]);
    const clientCode = client.rows[0]?.client_code || 'UNKNOWN';
    
    const result = await pool.query(
      `INSERT INTO sms_logs 
       (message_id, client_id, client_code, sender_id, destination, message, status, submit_time, force_dlr, max_retries, retry_count)
       VALUES ($1, $2, $3, $4, $5, $6, 'sent', NOW(), $7, 3, 0)
       RETURNING *`,
      [messageId, clientId, clientCode, senderId, destination, message, forceDlr]
    );
    
    // Simulate supplier response
    setTimeout(async () => {
      const success = Math.random() > 0.05;
      if (success) {
        await pool.query(
          `UPDATE sms_logs SET status = 'sent', supplier_status = 'accepted' WHERE message_id = $1`,
          [messageId]
        );
        console.log(`[SMS] ${messageId} accepted`);
      } else {
        await pool.query(
          `UPDATE sms_logs SET status = 'failed', supplier_status = 'rejected', supplier_response = 'Supplier error' WHERE message_id = $1`,
          [messageId]
        );
        console.log(`[SMS] ${messageId} rejected`);
      }
    }, 1000 + Math.random() * 2000);
    
    return result.rows[0];
  }

  async getSmsLogs(clientId = null, status = null, limit = 100, offset = 0) {
    let query = 'SELECT * FROM sms_logs WHERE 1=1';
    const params = [];
    let idx = 1;
    
    if (clientId) {
      query += ` AND client_id = $${idx++}`;
      params.push(clientId);
    }
    if (status) {
      query += ` AND status = $${idx++}`;
      params.push(status);
    }
    
    query += ` ORDER BY submit_time DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(limit, offset);
    
    const result = await pool.query(query, params);
    return result.rows;
  }
}

export default new SMSService();
