const smpp = require('smpp');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'net2app_hub',
  user: process.env.DB_USER || 'net2app_user',
  password: process.env.DB_PASS || 'Ariya@2024Net2App',
});

class SmppServer {
  constructor() {
    this.sessions = new Map();
  }

  start() {
    const server = smpp.createServer({ port: 2775, host: '0.0.0.0' });
    
    server.on('session', (session) => {
      const remoteAddr = session.socket.remoteAddress;
      console.log(`[SMPP] New connection from: ${remoteAddr}`);
      
      session.on('bind_transceiver', async (pdu, callback) => {
        console.log(`[SMPP] Bind request from: ${pdu.system_id}`);
        
        const result = await pool.query(
          `SELECT id, client_code, smpp_password, status 
           FROM clients 
           WHERE smpp_username = $1 AND status = 'active'`,
          [pdu.system_id]
        );
        
        if (result.rows.length > 0 && result.rows[0].smpp_password === pdu.password) {
          this.sessions.set(pdu.system_id, { session, clientId: result.rows[0].id });
          callback(null, { command_status: 0, system_id: pdu.system_id });
          console.log(`[SMPP] ✅ ${pdu.system_id} bound successfully (BOUND_TRX)`);
        } else {
          console.log(`[SMPP] ❌ Authentication failed for ${pdu.system_id}`);
          callback({ command_status: 0x0000000D });
        }
      });
      
      session.on('submit_sm', async (pdu, callback) => {
        const sourceAddr = pdu.source_addr.toString();
        const destAddr = pdu.destination_addr.toString();
        const message = pdu.short_message.toString();
        
        console.log(`[SMPP] SMS from ${sourceAddr} to ${destAddr}`);
        
        let clientId = null;
        for (const [username, data] of this.sessions) {
          if (data.session === session) clientId = data.clientId;
        }
        
        const msgId = `SMPP${Date.now()}${Math.random().toString(36).substr(2, 4)}`;
        
        await pool.query(
          `INSERT INTO sms_logs (message_id, client_id, sender_id, destination, message, status, submit_time) 
           VALUES ($1, $2, $3, $4, $5, 'submitted', NOW())`,
          [msgId, clientId, sourceAddr, destAddr, message]
        );
        
        callback(null, { command_status: 0, message_id: msgId });
        console.log(`[SMPP] ✅ SMS queued: ${msgId}`);
      });
      
      session.on('unbind', () => {
        console.log(`[SMPP] Session unbound`);
        session.close();
      });
    });
    
    server.listen(2775, '0.0.0.0', () => {
      console.log(`[SMPP] ✅ Server listening on port 2775`);
      console.log(`[SMPP] Accepting ESME connections from external clients`);
    });
    
    server.on('error', (err) => {
      console.error(`[SMPP] ❌ Server error:`, err.message);
    });
  }
}

module.exports = SmppServer;
