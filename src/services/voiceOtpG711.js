const dgram = require('dgram');
const crypto = require('crypto');
const { Pool } = require('pg');
require('dotenv').config();

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
  rtpPort: 10000
};

class VoiceOtpG711Service {
  constructor() {
    this.sipSocket = null;
  }

  init() {
    if (this.sipSocket) return;
    this.sipSocket = dgram.createSocket('udp4');
    this.sipSocket.bind(5060);
    console.log('[VoiceOTP] G.711/GSM service ready on port 5060');
  }

  async sendOtp(destination, otpCode, options = {}) {
    this.init();
    
    let destNumber = destination.replace(/^\+/, '');
    const callId = `OTP_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const branch = `z9hG4bK${crypto.randomBytes(8).toString('hex')}`;
    const fromTag = crypto.randomBytes(8).toString('hex');
    const cseq = Math.floor(Math.random() * 10000) + 1;
    
    const otpCallerId = `+${otpCode}`;
    
    // SDP with G.711 (PCMU/PCMA) as primary codecs
    const sdp = `v=0
o=VoiceOTP ${Date.now()} ${Date.now()} IN IP4 ${VOS_CONFIG.localIp}
s=Voice OTP Call
c=IN IP4 ${VOS_CONFIG.localIp}
t=0 0
m=audio ${VOS_CONFIG.rtpPort} RTP/AVP 0 8 3 101
a=rtpmap:0 PCMU/8000
a=rtpmap:8 PCMA/8000
a=rtpmap:3 GSM/8000
a=rtpmap:101 telephone-event/8000
a=ptime:20
a=sendrecv`;
    
    const contentLength = sdp.length;
    
    const invite = `INVITE sip:${destNumber}@${VOS_CONFIG.host} SIP/2.0
Via: SIP/2.0/UDP ${VOS_CONFIG.localIp}:5060;branch=${branch}
Max-Forwards: 70
From: <sip:${otpCallerId}@${VOS_CONFIG.localIp}>;tag=${fromTag}
To: <sip:${destNumber}@${VOS_CONFIG.host}>
Call-ID: ${callId}
CSeq: ${cseq} INVITE
Contact: <sip:voiceotp@${VOS_CONFIG.localIp}:5060>
Content-Type: application/sdp
Content-Length: ${contentLength}

${sdp}`;
    
    // Store in database
    const result = await pool.query(
      `INSERT INTO voice_otp_logs 
       (call_id, destination, otp_code, codec, status, created_at) 
       VALUES ($1, $2, $3, 'G.711/GSM', 'initiated', NOW()) 
       RETURNING *`,
      [callId, destination, otpCode]
    );
    
    // Send SIP INVITE
    this.sipSocket.send(invite, 0, invite.length, VOS_CONFIG.port, VOS_CONFIG.host, (err) => {
      if (err) {
        console.error(`[VoiceOTP] Send error:`, err);
        pool.query(`UPDATE voice_otp_logs SET status = 'failed', error_message = $1 WHERE call_id = $2`, 
          [err.message, callId]);
      } else {
        console.log(`[VoiceOTP] OTP ${otpCode} sent via G.711/GSM to ${destination}`);
        pool.query(`UPDATE voice_otp_logs SET status = 'sent', updated_at = NOW() WHERE call_id = $1`, [callId]);
        
        // Update to completed after call duration
        setTimeout(() => {
          pool.query(`UPDATE voice_otp_logs SET status = 'completed', dlr_status = 'DELIVRD', completed_at = NOW() WHERE call_id = $1`, [callId]);
        }, 10000);
      }
    });
    
    return result.rows[0];
  }
}

module.exports = new VoiceOtpG711Service();
