import smpp from 'smpp';
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

// SMSC Configuration
const SMSC_CONFIG = {
  host: '5.78.72.23',
  port: 2775,
  system_id: 'newbind',
  password: 'newbind',
  system_type: 'SMPP',
  // TON/NPI settings for national numbers
  source_ton: 0x01,  // National (TON=1)
  source_npi: 0x01,  // ISDN/E.164 (NPI=1)
  dest_ton: 0x01,    // National (TON=1)
  dest_npi: 0x01     // ISDN/E.164 (NPI=1)
};

class SmppClient {
  constructor() {
    this.session = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
  }

  async connect() {
    console.log(`[SMSC] Connecting to ${SMSC_CONFIG.host}:${SMSC_CONFIG.port} with TON/NPI: National/E.164`);
    
    this.session = smpp.connect({ 
      host: SMSC_CONFIG.host, 
      port: SMSC_CONFIG.port,
      debug: true
    });
    
    this.session.on('connect', () => {
      console.log('[SMSC] TCP connection established, binding as transceiver...');
      
      this.session.bind_transceiver({
        system_id: SMSC_CONFIG.system_id,
        password: SMSC_CONFIG.password,
        system_type: SMSC_CONFIG.system_type,
        interface_version: 0x34,
        addr_ton: SMSC_CONFIG.source_ton,
        addr_npi: SMSC_CONFIG.source_npi
      }, (pdu) => {
        if (pdu.command_status === 0) {
          this.connected = true;
          this.reconnectAttempts = 0;
          console.log('[SMSC] ✅ BOUND SUCCESSFULLY with National TON/NPI');
          this.updateBindStatus('bound');
        } else {
          console.log('[SMSC] ❌ Bind failed. Status:', pdu.command_status);
          this.updateBindStatus('unbound');
          this.reconnect();
        }
      });
    });
    
    this.session.on('error', (err) => {
      console.error('[SMSC] Connection error:', err);
      this.connected = false;
      this.updateBindStatus('unbound');
      this.reconnect();
    });
    
    this.session.on('close', () => {
      console.log('[SMSC] Connection closed');
      this.connected = false;
      this.updateBindStatus('unbound');
      this.reconnect();
    });
    
    // Handle incoming SMS (MO)
    this.session.on('deliver_sm', (pdu, callback) => {
      console.log('[SMSC] Received MO SMS from:', pdu.source_addr.toString());
      console.log('[SMSC] Message:', pdu.short_message);
      this.storeIncomingSms(pdu);
      callback(null);
    });
  }

  async updateBindStatus(status) {
    await pool.query(
      `UPDATE suppliers SET bind_status = $1, updated_at = NOW() WHERE supplier_code = 'SUP_SMS_GATEWAY'`,
      [status]
    );
    console.log(`[SMSC] Bind status updated to: ${status}`);
  }

  async storeIncomingSms(pdu) {
    try {
      await pool.query(
        `INSERT INTO sms_inbox (from_number, to_number, message, received_at, status)
         VALUES ($1, $2, $3, NOW(), 'received')`,
        [pdu.source_addr.toString(), pdu.destination_addr.toString(), pdu.short_message.toString()]
      );
      console.log('[SMSC] MO SMS stored in inbox');
    } catch (err) {
      console.error('[SMSC] Failed to store MO SMS:', err);
    }
  }

  sendSms(destination, message, sourceAddr = 'NET2APP') {
    if (!this.connected) {
      console.log('[SMSC] Not connected, cannot send SMS');
      return false;
    }
    
    // Format destination number for national format
    let destNumber = destination;
    // Remove + if present for national format
    if (destNumber.startsWith('+')) {
      destNumber = destNumber.substring(1);
    }
    // Remove 880 prefix for national format if needed
    if (destNumber.startsWith('880')) {
      destNumber = destNumber.substring(3);
    }
    
    console.log(`[SMSC] Sending SMS with TON/NPI: National/E.164`);
    console.log(`[SMSC] Source: ${sourceAddr}, Dest: ${destNumber}`);
    
    this.session.submit_sm({
      source_addr: sourceAddr,
      source_addr_ton: SMSC_CONFIG.source_ton,  // National (1)
      source_addr_npi: SMSC_CONFIG.source_npi,  // E.164 (1)
      destination_addr: destNumber,
      dest_addr_ton: SMSC_CONFIG.dest_ton,      // National (1)
      dest_addr_npi: SMSC_CONFIG.dest_npi,      // E.164 (1)
      short_message: message,
      registered_delivery: 1,
      data_coding: 0
    }, (pdu) => {
      if (pdu.command_status === 0) {
        console.log('[SMSC] SMS sent, message_id:', pdu.message_id);
      } else {
        console.log('[SMSC] SMS send failed:', pdu.command_status);
      }
    });
    return true;
  }

  reconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = Math.min(30000, 5000 * this.reconnectAttempts);
      console.log(`[SMSC] Reconnecting in ${delay/1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
      setTimeout(() => this.connect(), delay);
    } else {
      console.log('[SMSC] Max reconnection attempts reached.');
    }
  }
}

const smppClient = new SmppClient();
smppClient.connect();

export default smppClient;
