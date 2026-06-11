const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'net2app_hub',
  user: process.env.DB_USER || 'net2app_user',
  password: process.env.DB_PASS || 'Ariya@2024Net2App',
});

class VOSSipService {
  async sendOtp(destination, otpCode, clientId, options = {}) {
    const callId = `SIP_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const maxRetries = options.maxRetries || 4;
    const retryDelay = options.retryDelay || 60;
    
    // Format destination
    let formattedDest = destination;
    if (!formattedDest.startsWith('+')) {
      formattedDest = '+' + formattedDest;
    }
    
    // Store in database
    const result = await pool.query(
      `INSERT INTO voice_otp_logs 
       (call_id, destination, otp_code, client_id, status, retry_count, max_retries, retry_delay, created_at) 
       VALUES ($1, $2, $3, $4, 'initiated', 0, $5, $6, NOW()) 
       RETURNING *`,
      [callId, formattedDest, otpCode, clientId, maxRetries, retryDelay]
    );
    
    // Execute Python script to make real SIP call
    const pythonScript = `/root/send-sip-call.py ${formattedDest} ${otpCode}`;
    
    exec(`python3 ${pythonScript}`, (error, stdout, stderr) => {
      if (error) {
        console.error(`SIP call error: ${error}`);
        this.updateCallStatus(callId, 'failed', 'UNDELIV', error.message);
      } else {
        console.log(`SIP call stdout: ${stdout}`);
        if (stdout.includes('answered successfully')) {
          this.updateCallStatus(callId, 'completed', 'DELIVRD');
        } else {
          this.updateCallStatus(callId, 'failed', 'UNDELIV');
        }
      }
    });
    
    return result.rows[0];
  }
  
  async updateCallStatus(callId, status, dlrStatus, error = null) {
    await pool.query(
      `UPDATE voice_otp_logs 
       SET status = $1, dlr_status = $2, error_message = $3, completed_at = NOW() 
       WHERE call_id = $4`,
      [status, dlrStatus, error, callId]
    );
  }
  
  async inquiryDlr(callId) {
    const result = await pool.query(
      `SELECT call_id, status, dlr_status, completed_at FROM voice_otp_logs WHERE call_id = $1`,
      [callId]
    );
    return result.rows.length > 0 ? { success: true, ...result.rows[0] } : { success: false };
  }
}

module.exports = new VOSSipService();
