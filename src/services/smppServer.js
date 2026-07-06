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
        
        // First try clients table
        const clientResult = await pool.query(
          `SELECT id, client_code, smpp_password, status 
           FROM clients 
           WHERE smpp_username = $1 AND status = 'active'`,
          [pdu.system_id]
        );
        
        if (clientResult.rows.length > 0 && clientResult.rows[0].smpp_password === pdu.password) {
          const c = clientResult.rows[0];
          this.sessions.set(pdu.system_id, { session, entityType: 'client', entityId: c.id, entityCode: c.client_code });
          callback(null, { command_status: 0, system_id: pdu.system_id });
          console.log(`[SMPP] ✅ Client ${pdu.system_id} bound successfully (BOUND_TRX)`);
          return;
        }
        
        // Fallback: try inbound suppliers
        const supplierResult = await pool.query(
          `SELECT id, supplier_code, smpp_password, status 
           FROM suppliers 
           WHERE smpp_username = $1 AND is_inbound = true AND status = 'active'`,
          [pdu.system_id]
        );
        
        if (supplierResult.rows.length > 0 && supplierResult.rows[0].smpp_password === pdu.password) {
          const s = supplierResult.rows[0];
          this.sessions.set(pdu.system_id, { session, entityType: 'supplier', entityId: s.id, entityCode: s.supplier_code });
          callback(null, { command_status: 0, system_id: pdu.system_id });
          console.log(`[SMPP] ✅ Inbound supplier ${pdu.system_id} bound successfully (BOUND_TRX)`);
          return;
        }
        
        console.log(`[SMPP] ❌ Authentication failed for ${pdu.system_id}`);
        callback({ command_status: 0x0000000D });
      });
      
      session.on('submit_sm', async (pdu, callback) => {
        const sourceAddr = pdu.source_addr.toString();
        const destAddr = pdu.destination_addr.toString();
        const message = pdu.short_message.toString();
        
        console.log(`[SMPP] SMS from ${sourceAddr} to ${destAddr}`);
        
        // Find session data
        let sessionData = null;
        for (const [username, data] of this.sessions) {
          if (data.session === session) { sessionData = data; break; }
        }
        
        // Inbound suppliers cannot submit (they RECEIVE SMS from us in deliver_sm)
        if (sessionData && sessionData.entityType === 'supplier') {
          console.log(`[SMPP] ❌ Supplier ${sessionData.entityCode} cannot submit_sm`);
          callback({ command_status: 0x00000045 }); // Submit Failed
          return;
        }
        
        const clientId = sessionData?.entityId || null;
        const clientCode = sessionData?.entityCode || null;
        
        const msgId = `SMPP${Date.now()}${Math.random().toString(36).substr(2, 4)}`;
        
        await pool.query(
          `INSERT INTO sms_logs (message_id, client_id, client_code, sender_id, destination, message, status, submit_time) 
           VALUES ($1, $2, $3, $4, $5, $6, 'submitted', NOW())`,
          [msgId, clientId, clientCode, sourceAddr, destAddr, message]
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
