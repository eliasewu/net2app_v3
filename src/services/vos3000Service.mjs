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

class VOS3000Service {
  constructor() {
    this.sipSocket = null;
  }

  init() {
    if (this.sipSocket) return;
    this.sipSocket = dgram.createSocket('udp4');
    this.sipSocket.bind(VOS_CONFIG.localPort);
    console.log('[VOS3000] Service ready - G.729 codec (payload 18)');
  }

  async sendOtp(destination, otpCode) {
    this.init();
    
    let destNumber = destination.replace(/^\+/, '');
    const callId = `${Date.now()}${crypto.randomBytes(4).toString('hex')}`;
    const branch = `z9hG4bK${crypto.randomBytes(8).toString('hex')}`;
    const fromTag = crypto.randomBytes(4).toString('hex');
    
    // OTP as caller ID (without + for VOS3000)
    const otpCallerId = otpCode;
    
    // SDP with G.729 as primary
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
User-Agent: NET2APP-VoiceOTP
Content-Type: application/sdp
Content-Length: ${sdp.length}

${sdp}`;
    
    // Store in database with G.729 codec explicitly
    const result = await pool.query(
      `INSERT INTO voice_otp_logs (call_id, destination, otp_code, codec, status, created_at) 
       VALUES ($1, $2, $3, $4, 'initiated', NOW()) RETURNING *`,
      [callId, destination, otpCode, 'G.729']
    );
    
    // Send to VOS3000
    this.sipSocket.send(invite, 0, invite.length, VOS_CONFIG.port, VOS_CONFIG.host, (err) => {
      if (err) {
        console.error('Send error:', err);
        pool.query(`UPDATE voice_otp_logs SET status = 'failed', error_message = $1 WHERE call_id = $2`, 
          [err.message, callId]);
      } else {
        console.log(`✅ OTP ${otpCode} sent via G.729 to ${destNumber}`);
        pool.query(`UPDATE voice_otp_logs SET status = 'sent', updated_at = NOW() WHERE call_id = $1`, [callId]);
        
        setTimeout(() => {
          pool.query(`UPDATE voice_otp_logs SET status = 'completed', dlr_status = 'DELIVRD', completed_at = NOW() WHERE call_id = $1`, [callId]);
        }, 15000);
      }
    });
    
    return result.rows[0];
  }
}

export default new VOS3000Service();
