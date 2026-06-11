const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'net2app_hub',
  user: process.env.DB_USER || 'net2app_user',
  password: process.env.DB_PASS || 'Ariya@2024Net2App',
});

class VoiceOtpService {
  constructor() {
    this.activeCalls = new Map();
    this.dlrQueue = [];
    this.isProcessingDlr = false;
  }

  // Send Voice OTP
  async sendOtp(destination, otpCode, clientId, options = {}) {
    const callId = `VOICE_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    const maxRetries = options.maxRetries || 4;
    const retryDelay = options.retryDelay || 60; // seconds
    const dlrTimeout = options.dlrTimeout || 150; // seconds
    
    // Store call in database
    const result = await pool.query(
      `INSERT INTO voice_otp_logs 
       (call_id, destination, otp_code, client_id, status, retry_count, max_retries, retry_delay, dlr_timeout, created_at) 
       VALUES ($1, $2, $3, $4, 'initiated', 0, $5, $6, $7, NOW()) 
       RETURNING *`,
      [callId, destination, otpCode, clientId, maxRetries, retryDelay, dlrTimeout]
    );
    
    const call = result.rows[0];
    
    // Initiate the call (simulate or real SIP)
    this.initiateCall(call);
    
    return call;
  }

  // Initiate call (simulated for now, replace with real SIP)
  async initiateCall(call) {
    console.log(`[Voice OTP] Initiating call to ${call.destination} with OTP: ${call.otp_code}`);
    
    // Update status to ringing
    await pool.query(
      `UPDATE voice_otp_logs SET status = 'ringing', updated_at = NOW() WHERE call_id = $1`,
      [call.call_id]
    );
    
    // Simulate call connection (replace with actual SIP call)
    const callSuccess = Math.random() > 0.2; // 80% success rate for demo
    
    setTimeout(async () => {
      if (callSuccess) {
        // Call answered
        await this.handleCallAnswered(call);
      } else {
        // Call failed - will retry
        await this.handleCallFailed(call);
      }
    }, 3000);
  }

  // Handle answered call
  async handleCallAnswered(call) {
    console.log(`[Voice OTP] Call ${call.call_id} answered, playing OTP`);
    
    await pool.query(
      `UPDATE voice_otp_logs 
       SET status = 'in_progress', 
           answered_at = NOW(),
           updated_at = NOW() 
       WHERE call_id = $1`,
      [call.call_id]
    );
    
    // Simulate playing OTP (5-10 seconds)
    setTimeout(async () => {
      await this.handleCallCompleted(call, 'delivered');
    }, 7000);
  }

  // Handle call completion
  async handleCallCompleted(call, status) {
    console.log(`[Voice OTP] Call ${call.call_id} completed with status: ${status}`);
    
    await pool.query(
      `UPDATE voice_otp_logs 
       SET status = $1, 
           dlr_status = 'DELIVRD',
           completed_at = NOW(),
           updated_at = NOW() 
       WHERE call_id = $2`,
      [status === 'delivered' ? 'completed' : 'failed', call.call_id]
    );
    
    // Queue DLR for external system
    this.queueDlr(call.call_id, 'DELIVRD', 'Call completed successfully');
  }

  // Handle call failure with retry logic
  async handleCallFailed(call) {
    const newRetryCount = call.retry_count + 1;
    
    console.log(`[Voice OTP] Call ${call.call_id} failed. Retry ${newRetryCount}/${call.max_retries}`);
    
    if (newRetryCount <= call.max_retries) {
      // Update retry count and schedule retry
      await pool.query(
        `UPDATE voice_otp_logs 
         SET retry_count = $1, 
             status = 'retry_scheduled',
             last_retry_at = NOW(),
             updated_at = NOW() 
         WHERE call_id = $2`,
        [newRetryCount, call.call_id]
      );
      
      // Schedule retry with exponential backoff
      const retryDelay = call.retry_delay * newRetryCount;
      console.log(`[Voice OTP] Scheduling retry ${newRetryCount} in ${retryDelay}s`);
      
      setTimeout(async () => {
        await this.retryCall(call.call_id);
      }, retryDelay * 1000);
    } else {
      // Max retries exceeded
      await pool.query(
        `UPDATE voice_otp_logs 
         SET status = 'failed', 
             dlr_status = 'UNDELIV',
             error_message = 'Max retries exceeded',
             completed_at = NOW(),
             updated_at = NOW() 
         WHERE call_id = $1`,
        [call.call_id]
      );
      
      this.queueDlr(call.call_id, 'UNDELIV', 'Max retries exceeded');
    }
  }

  // Retry a failed call
  async retryCall(callId) {
    const result = await pool.query(
      `SELECT * FROM voice_otp_logs WHERE call_id = $1`,
      [callId]
    );
    
    if (result.rows.length > 0) {
      const call = result.rows[0];
      console.log(`[Voice OTP] Retrying call ${callId} (Attempt ${call.retry_count}/${call.max_retries})`);
      
      await pool.query(
        `UPDATE voice_otp_logs SET status = 'retrying', updated_at = NOW() WHERE call_id = $1`,
        [callId]
      );
      
      // Re-initiate call
      this.initiateCall(call);
    }
  }

  // Queue DLR for external inquiry
  queueDlr(callId, status, message) {
    this.dlrQueue.push({
      call_id: callId,
      status: status,
      message: message,
      timestamp: new Date(),
      retry_count: 0
    });
    
    // Start processing DLR queue if not already
    if (!this.isProcessingDlr) {
      this.processDlrQueue();
    }
  }

  // Process DLR queue every 3-5 seconds
  async processDlrQueue() {
    this.isProcessingDlr = true;
    
    while (this.dlrQueue.length > 0) {
      const dlr = this.dlrQueue.shift();
      
      // Simulate sending DLR to external system
      console.log(`[DLR] Sending DLR for call ${dlr.call_id}: ${dlr.status} - ${dlr.message}`);
      
      // Update DLR sent status
      await pool.query(
        `UPDATE voice_otp_logs 
         SET dlr_sent = true, 
             dlr_sent_at = NOW(),
             dlr_status = $1
         WHERE call_id = $2`,
        [dlr.status, dlr.call_id]
      );
      
      // Random delay between 3-5 seconds for next DLR
      const delay = 3000 + Math.random() * 2000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    this.isProcessingDlr = false;
  }

  // Inquiry DLR status (for external polling)
  async inquiryDlr(callId) {
    const result = await pool.query(
      `SELECT call_id, status, dlr_status, completed_at, error_message 
       FROM voice_otp_logs 
       WHERE call_id = $1`,
      [callId]
    );
    
    if (result.rows.length === 0) {
      return { success: false, error: 'Call not found' };
    }
    
    const call = result.rows[0];
    return {
      success: true,
      call_id: call.call_id,
      status: call.status,
      dlr_status: call.dlr_status,
      completed_at: call.completed_at,
      error: call.error_message
    };
  }
}

module.exports = new VoiceOtpService();
