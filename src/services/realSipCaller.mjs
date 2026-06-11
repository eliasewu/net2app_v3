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
  rtpPort: 10002
};

class RealSipCaller {
  constructor() {
    this.sipSocket = null;
    this.rtpSocket = null;
    this.pendingCalls = new Map();
  }

  init() {
    if (this.sipSocket) return;
    
    this.sipSocket = dgram.createSocket('udp4');
    this.sipSocket.bind(VOS_CONFIG.localPort);
    
    this.sipSocket.on('message', (msg, rinfo) => {
      this.handleSipResponse(msg, rinfo);
    });
    
    console.log(`[RealSIP] SIP client bound to ${VOS_CONFIG.localIp}:${VOS_CONFIG.localPort}`);
  }

  handleSipResponse(msg, rinfo) {
    const response = msg.toString();
    console.log(`[RealSIP] Response from ${rinfo.address}:${rinfo.port}`);
    
    // Parse Call-ID
    const callIdMatch = response.match(/Call-ID:\s*([^\s]+)/i);
    if (callIdMatch) {
      const callId = callIdMatch[1];
      const pending = this.pendingCalls.get(callId);
      
      if (pending) {
        if (response.includes('200 OK')) {
          console.log(`[RealSIP] ✅ Call ${callId} answered!`);
          pool.query(`UPDATE voice_otp_logs SET status = 'answered', answered_at = NOW() WHERE call_id = $1`, [callId]);
        } else if (response.includes('486 Busy')) {
          console.log(`[RealSIP] ❌ Call ${callId} busy`);
          pool.query(`UPDATE voice_otp_logs SET status = 'busy', dlr_status = 'UNDELIV' WHERE call_id = $1`, [callId]);
        } else if (response.includes('404 Not Found')) {
          console.log(`[RealSIP] ❌ Call ${callId} - destination not found`);
          pool.query(`UPDATE voice_otp_logs SET status = 'failed', error_message = 'Number not found' WHERE call_id = $1`, [callId]);
        }
      }
    }
  }

  async sendOtp(destination, otpCode) {
    this.init();
    
    let destNumber = destination.replace(/^\+/, '');
    const callId = `${Date.now()}${crypto.randomBytes(4).toString('hex')}`;
    const branch = `z9hG4bK${crypto.randomBytes(8).toString('hex')}`;
    const fromTag = crypto.randomBytes(4).toString('hex');
    
    const otpCallerId = otpCode;
    
    // Complete SDP for audio
    const sdp = `v=0
o=- ${Date.now()} ${Date.now()} IN IP4 ${VOS_CONFIG.localIp}
s=Voice OTP
c=IN IP4 ${VOS_CONFIG.localIp}
t=0 0
m=audio ${VOS_CONFIG.rtpPort} RTP/AVP 18 0 8 3 101
a=rtpmap:18 G729/8000
a=fmtp:18 annexb=no
a=rtpmap:0 PCMU/8000
a=rtpmap:8 PCMA/8000
a=rtpmap:3 GSM/8000
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
Allow: INVITE, ACK, CANCEL, BYE, OPTIONS
Content-Type: application/sdp
Content-Length: ${sdp.length}

${sdp}`;
    
    // Store in database
    const result = await pool.query(
      `INSERT INTO voice_otp_logs (call_id, destination, otp_code, codec, status, created_at) 
       VALUES ($1, $2, $3, 'G.729', 'calling', NOW()) RETURNING *`,
      [callId, destination, otpCode]
    );
    
    // Store pending call
    this.pendingCalls.set(callId, { destination, otpCode, startTime: Date.now() });
    
    // Send real SIP INVITE
    this.sipSocket.send(invite, 0, invite.length, VOS_CONFIG.port, VOS_CONFIG.host, (err) => {
      if (err) {
        console.error(`[RealSIP] Send error:`, err);
        pool.query(`UPDATE voice_otp_logs SET status = 'failed', error_message = $1 WHERE call_id = $2`, 
          [err.message, callId]);
      } else {
        console.log(`[RealSIP] 📞 Calling ${destNumber} with OTP ${otpCode} (G.729)`);
        console.log(`[RealSIP] Caller ID: ${otpCallerId}`);
        console.log(`[RealSIP] Call-ID: ${callId}`);
        
        // Set timeout for call progress
        setTimeout(() => {
          const pending = this.pendingCalls.get(callId);
          if (pending) {
            console.log(`[RealSIP] ⏰ Call ${callId} timeout - no answer`);
            pool.query(`UPDATE voice_otp_logs SET status = 'timeout', dlr_status = 'UNDELIV' WHERE call_id = $1`, [callId]);
            this.pendingCalls.delete(callId);
          }
        }, 30000);
      }
    });
    
    return result.rows[0];
  }
}

export default new RealSipCaller();
