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

class SipVoiceOtpService {
  constructor() {
    this.sipSocket = null;
  }

  init() {
    if (this.sipSocket) return;
    this.sipSocket = dgram.createSocket('udp4');
    this.sipSocket.bind(VOS_CONFIG.localPort);
    console.log(`[VoiceOTP] SIP client bound to port ${VOS_CONFIG.localPort}`);
  }

  async sendOtp(destination, otpCode, options = {}) {
    try {
      this.init();
      
      let destNumber = destination.replace(/^\+/, '');
      const callId = `OTP_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const branch = `z9hG4bK${crypto.randomBytes(8).toString('hex')}`;
      const fromTag = crypto.randomBytes(8).toString('hex');
      const cseq = Math.floor(Math.random() * 10000) + 1;
      
      const otpCallerId = `+${otpCode}`;
      
      // Complete SDP with G.729 as primary codec (payload 18)
      const sdp = `v=0
o=VoiceOTP ${Date.now()} ${Date.now()} IN IP4 ${VOS_CONFIG.localIp}
s=Voice OTP Call
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
      
      const contentLength = sdp.length;
      
      // Build complete SIP INVITE with SDP body
      const invite = `INVITE sip:${destNumber}@${VOS_CONFIG.host} SIP/2.0\r
Via: SIP/2.0/UDP ${VOS_CONFIG.localIp}:${VOS_CONFIG.localPort};branch=${branch}\r
Max-Forwards: 70\r
From: <sip:${otpCallerId}@${VOS_CONFIG.localIp}>;tag=${fromTag}\r
To: <sip:${destNumber}@${VOS_CONFIG.host}>\r
Call-ID: ${callId}\r
CSeq: ${cseq} INVITE\r
Contact: <sip:voiceotp@${VOS_CONFIG.localIp}:${VOS_CONFIG.localPort}>\r
Content-Type: application/sdp\r
Content-Length: ${contentLength}\r
\r
${sdp}`;
      
      console.log(`[VoiceOTP] Sending INVITE to ${destNumber}@${VOS_CONFIG.host}`);
      console.log(`[VoiceOTP] Codec: G.729 (payload 18) priority`);
      console.log(`[VoiceOTP] SDP Length: ${contentLength}`);
      
      // Store in database
      const result = await pool.query(
        `INSERT INTO voice_otp_logs 
         (call_id, destination, otp_code, codec, status, created_at) 
         VALUES ($1, $2, $3, 'G.729', 'initiated', NOW()) 
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
          console.log(`[VoiceOTP] ✅ INVITE sent - G.729 codec negotiated`);
          pool.query(`UPDATE voice_otp_logs SET status = 'sent', updated_at = NOW() WHERE call_id = $1`, [callId]);
        }
      });
      
      return result.rows[0];
    } catch (error) {
      console.error('[VoiceOTP] Error:', error);
      throw error;
    }
  }
}

export default new SipVoiceOtpService();
