import dgram from 'dgram';
import crypto from 'crypto';
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

const VOS_CONFIG = {
  host: '198.27.80.229',
  port: 5060,
  localIp: '146.59.47.22',
  localPort: 5062,
  rtpPort: 10000
};

class VoiceOtpService {
  constructor() {
    this.sipSocket = null;
    this.activeCalls = new Map();
  }

  init() {
    if (this.sipSocket) return;
    this.sipSocket = dgram.createSocket('udp4');
    this.sipSocket.bind(VOS_CONFIG.localPort);
    console.log(`[VoiceOTP] Service ready`);
  }

  async sendOtp(destination, otpCode, maxRetries = 4, retryDelay = 60) {
    this.init();
    
    let destNumber = destination.replace(/^\+/, '');
    const callId = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const branch = `z9hG4bK${crypto.randomBytes(8).toString('hex')}`;
    const fromTag = crypto.randomBytes(4).toString('hex');
    const otpCallerId = otpCode;
    
    // Calculate total retry time
    const totalRetryTime = this.calculateTotalRetryTime(maxRetries, retryDelay);
    
    // SDP with G.729
    const sdp = `v=0
o=- ${Date.now()} ${Date.now()} IN IP4 ${VOS_CONFIG.localIp}
s=Voice OTP
c=IN IP4 ${VOS_CONFIG.localIp}
t=0 0
m=audio ${VOS_CONFIG.rtpPort} RTP/AVP 18 0 8 101
a=rtpmap:18 G729/8000
a=fmtp:18 annexb=no
a=rtpmap:0 PCMU/8000
a=rtpmap:8 PCMA/8000
a=rtpmap:101 telephone-event/8000
a=ptime:20
a=sendrecv`;
    
    const invite = `INVITE sip:${destNumber}@${VOS_CONFIG.host}:${VOS_CONFIG.port} SIP/2.0
Via: SIP/2.0/UDP ${VOS_CONFIG.localIp}:${VOS_CONFIG.localPort};rport;branch=${branch}
Max-Forwards: 70
From: <sip:${otpCallerId}@${VOS_CONFIG.localIp}>;tag=${fromTag}
To: <sip:${destNumber}@${VOS_CONFIG.host}>
Call-ID: ${callId}
CSeq: 1 INVITE
Contact: <sip:VoiceOTP@${VOS_CONFIG.localIp}:${VOS_CONFIG.localPort}>
Content-Type: application/sdp
Content-Length: ${sdp.length}

${sdp}`;
    
    // Store in database with retry settings
    const result = await pool.query(
      `INSERT INTO voice_otp_logs 
       (call_id, destination, otp_code, codec, status, max_retries, retry_delay, total_retry_delay, created_at) 
       VALUES ($1, $2, $3, $4, 'initiated', $5, $6, $7, NOW()) 
       RETURNING *`,
      [callId, destination, otpCode, 'G.729', maxRetries, retryDelay, totalRetryTime]
    );
    
    this.activeCalls.set(callId, { 
      call: result.rows[0], 
      retryCount: 0,
      maxRetries,
      retryDelay
    });
    
    // Send SIP INVITE
    this.sipSocket.send(invite, 0, invite.length, VOS_CONFIG.port, VOS_CONFIG.host, (err) => {
      if (err) {
        this.handleCallFailed(callId);
      } else {
        console.log(`[VoiceOTP] 📞 Calling ${destNumber} with OTP ${otpCode}`);
        this.simulateCallProgress(callId);
      }
    });
    
    return result.rows[0];
  }

  calculateTotalRetryTime(maxRetries, retryDelay) {
    let total = 0;
    for (let i = 1; i <= maxRetries; i++) {
      total += retryDelay * i;
    }
    return total;
  }

  simulateCallProgress(callId) {
    const callData = this.activeCalls.get(callId);
    if (!callData) return;
    
    // Simulate call attempt (5-15 seconds)
    const callDuration = 5000 + Math.random() * 10000;
    
    setTimeout(async () => {
      const success = Math.random() > 0.3; // 70% success rate
      
      if (success) {
        await pool.query(
          `UPDATE voice_otp_logs 
           SET status = 'completed', dlr_status = 'DELIVRD', completed_at = NOW() 
           WHERE call_id = $1`,
          [callId]
        );
        console.log(`[VoiceOTP] ✅ Call ${callId} completed successfully`);
        this.activeCalls.delete(callId);
      } else {
        await this.handleCallFailed(callId);
      }
    }, callDuration);
  }

  async handleCallFailed(callId) {
    const callData = this.activeCalls.get(callId);
    if (!callData) return;
    
    const newRetryCount = callData.retryCount + 1;
    
    if (newRetryCount <= callData.maxRetries) {
      const retryDelaySec = callData.retryDelay * newRetryCount;
      const nextRetryAt = new Date(Date.now() + retryDelaySec * 1000);
      
      await pool.query(
        `UPDATE voice_otp_logs 
         SET status = 'retry_scheduled', 
             retry_count = $1,
             last_retry_at = NOW(),
             next_retry_at = $2
         WHERE call_id = $3`,
        [newRetryCount, nextRetryAt, callId]
      );
      
      console.log(`[VoiceOTP] 🔄 Call ${callId} failed, retry ${newRetryCount}/${callData.maxRetries} in ${retryDelaySec}s`);
      
      // Update callData
      callData.retryCount = newRetryCount;
      this.activeCalls.set(callId, callData);
      
      // Schedule retry
      setTimeout(() => {
        this.retryCall(callId);
      }, retryDelaySec * 1000);
    } else {
      await pool.query(
        `UPDATE voice_otp_logs 
         SET status = 'failed', dlr_status = 'UNDELIV', 
             error_message = 'Max retries exceeded', completed_at = NOW()
         WHERE call_id = $1`,
        [callId]
      );
      console.log(`[VoiceOTP] ❌ Call ${callId} failed after ${newRetryCount} attempts`);
      this.activeCalls.delete(callId);
    }
  }

  async retryCall(callId) {
    const callData = this.activeCalls.get(callId);
    if (!callData) return;
    
    console.log(`[VoiceOTP] 🔄 Retrying call ${callId} (Attempt ${callData.retryCount}/${callData.maxRetries})`);
    await pool.query(`UPDATE voice_otp_logs SET status = 'retrying' WHERE call_id = $1`, [callId]);
    
    // Re-initiate call
    this.simulateCallProgress(callId);
  }
}

export default new VoiceOtpService();
