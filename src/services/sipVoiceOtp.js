const { Pool } = require('pg');
const dgram = require('dgram');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'net2app_hub',
  user: process.env.DB_USER || 'net2app_user',
  password: process.env.DB_PASS || 'Ariya@2024Net2App',
});

// Your SIP Server Configuration (No Authentication)
const SIP_SERVER = {
  host: '198.27.80.229',
  port: 5060,
  protocol: 'udp'
};

class SipVoiceOtpService {
  async sendOtp(destination, otpCode, clientId, options = {}) {
    const callId = `SIP_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
    const maxRetries = options.maxRetries || 4;
    const retryDelay = options.retryDelay || 60;
    
    // Format destination to E.164
    let formattedDestination = destination;
    if (!destination.startsWith('+')) {
      formattedDestination = '+' + destination.replace(/[^0-9]/g, '');
    }
    
    // Store in database
    const result = await pool.query(
      `INSERT INTO voice_otp_logs 
       (call_id, destination, otp_code, client_id, status, retry_count, max_retries, retry_delay, created_at) 
       VALUES ($1, $2, $3, $4, 'initiated', 0, $5, $6, NOW()) 
       RETURNING *`,
      [callId, formattedDestination, otpCode, clientId, maxRetries, retryDelay]
    );
    
    const call = result.rows[0];
    
    // Initiate SIP call
    this.initiateSipCall(call);
    
    return call;
  }

  initiateSipCall(call) {
    console.log(`[SIP] Initiating call to ${call.destination} via SIP server ${SIP_SERVER.host}:${SIP_SERVER.port}`);
    console.log(`[SIP] OTP Code: ${call.otp_code}`);
    console.log(`[SIP] Call ID: ${call.call_id}`);
    
    // Create SIP message (simplified INVITE)
    const sipMessage = this.buildSipInvite(call);
    console.log(`[SIP] Sending SIP INVITE to ${SIP_SERVER.host}:${SIP_SERVER.port}`);
    
    // Send UDP packet to SIP server
    const client = dgram.createSocket('udp4');
    const messageBuffer = Buffer.from(sipMessage);
    
    client.send(messageBuffer, 0, messageBuffer.length, SIP_SERVER.port, SIP_SERVER.host, (err) => {
      if (err) {
        console.error(`[SIP] Error sending INVITE:`, err);
        this.handleCallFailed(call);
      } else {
        console.log(`[SIP] INVITE sent successfully`);
        client.close();
        
        // Simulate call progress
        this.simulateCallProgress(call);
      }
    });
  }

  buildSipInvite(call) {
    const branch = `z9hG4bK${Math.random().toString(36).substr(2, 10)}`;
    const callId = call.call_id;
    const fromTag = Math.random().toString(36).substr(2, 8);
    const cseq = Math.floor(Math.random() * 10000);
    
    return `INVITE sip:${call.destination}@${SIP_SERVER.host} SIP/2.0\r
Via: SIP/2.0/UDP ${SIP_SERVER.host}:${SIP_SERVER.port};branch=${branch}\r
Max-Forwards: 70\r
From: "Voice OTP" <sip:voiceotp@${SIP_SERVER.host}>;tag=${fromTag}\r
To: <sip:${call.destination}@${SIP_SERVER.host}>\r
Call-ID: ${callId}\r
CSeq: ${cseq} INVITE\r
Contact: <sip:voiceotp@${SIP_SERVER.host}:${SIP_SERVER.port}>\r
Content-Type: application/sdp\r
Content-Length: 0\r
\r\n`;
  }

  simulateCallProgress(call) {
    setTimeout(async () => {
      await pool.query(
        `UPDATE voice_otp_logs SET status = 'ringing', updated_at = NOW() WHERE call_id = $1`,
        [call.call_id]
      );
      console.log(`[SIP] Call ${call.call_id} is ringing...`);
      
      setTimeout(async () => {
        // Simulate answer (70% success rate for demo)
        const answered = Math.random() > 0.3;
        
        if (answered) {
          await pool.query(
            `UPDATE voice_otp_logs SET status = 'in_progress', answered_at = NOW() WHERE call_id = $1`,
            [call.call_id]
          );
          console.log(`[SIP] Call ${call.call_id} answered, playing OTP: ${call.otp_code}`);
          
          // Simulate OTP playback
          setTimeout(async () => {
            await pool.query(
              `UPDATE voice_otp_logs SET status = 'completed', dlr_status = 'DELIVRD', completed_at = NOW() WHERE call_id = $1`,
              [call.call_id]
            );
            console.log(`[SIP] Call ${call.call_id} completed - OTP delivered`);
          }, 8000);
        } else {
          await this.handleCallFailed(call);
        }
      }, 5000);
    }, 2000);
  }

  async handleCallFailed(call) {
    const newRetryCount = call.retry_count + 1;
    
    if (newRetryCount <= call.max_retries) {
      await pool.query(
        `UPDATE voice_otp_logs SET retry_count = $1, status = 'retry_scheduled', last_retry_at = NOW() WHERE call_id = $2`,
        [newRetryCount, call.call_id]
      );
      
      const retryDelay = call.retry_delay * newRetryCount;
      console.log(`[SIP] Scheduling retry ${newRetryCount}/${call.max_retries} in ${retryDelay}s`);
      
      setTimeout(() => this.initiateSipCall(call), retryDelay * 1000);
    } else {
      await pool.query(
        `UPDATE voice_otp_logs SET status = 'failed', dlr_status = 'UNDELIV', error_message = 'Max retries exceeded', completed_at = NOW() WHERE call_id = $1`,
        [call.call_id]
      );
      console.log(`[SIP] Call ${call.call_id} failed after ${newRetryCount} attempts`);
    }
  }

  async inquiryDlr(callId) {
    const result = await pool.query(
      `SELECT call_id, status, dlr_status, completed_at, error_message, retry_count, max_retries 
       FROM voice_otp_logs WHERE call_id = $1`,
      [callId]
    );
    return result.rows.length > 0 ? { success: true, ...result.rows[0] } : { success: false };
  }
}

module.exports = new SipVoiceOtpService();
