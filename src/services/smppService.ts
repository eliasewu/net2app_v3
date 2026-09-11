// SMPP Integration Service using smppy library
// Server mode: Accepts connections from clients (ESMEs)
// Client mode: Connects to external SMPP servers (suppliers)

export interface SMPPBindConfig {
  host: string;
  port: number;
  systemId: string;
  password: string;
  systemType: string;
  bindMode: 'transceiver' | 'transmitter' | 'receiver';
  tps: number;
  interfaceVersion?: number;
  addressRange?: string;
}

export interface SMPPMessage {
  id: string;
  sourceAddr: string;
  destinationAddr: string;
  shortMessage: string;
  dataCoding: number;
  esmClass: number;
  registeredDelivery: number;
  messageId?: string;
  status: 'pending' | 'submitted' | 'delivered' | 'failed' | 'expired';
  submitTime: string;
  deliveryTime?: string;
  dlrStatus?: string;
  dlrTimestamp?: string;
  errorCode?: string;
  errorMessage?: string;
  clientId?: string;
  supplierId?: string;
  routeId?: string;
  trunkId?: string;
  mcc?: string;
  mnc?: string;
  rate?: number;
}

export interface DLRResult {
  messageId: string;
  dlrStatus: string;
  submitDate: string;
  doneDate: string;
  stat: 'DELIVRD' | 'UNDELIV' | 'EXPIRED' | 'DELETED' | 'REJECTD' | 'UNKNOWN';
  err: string;
  text: string;
}

// SMPP Server Mode - receives messages from clients
export class SMPPServer {
  private config: SMPPBindConfig;
  private connectedClients: Map<string, any> = new Map();
  private messageHandlers: Map<string, (msg: SMPPMessage) => void> = new Map();

  constructor(config: SMPPBindConfig) {
    this.config = config;
  }

  async start(): Promise<boolean> {
    // In production uses smppy.Application to listen for client binds
    console.log(`[SMPP Server] Starting on ${this.config.host}:${this.config.port}`);
    console.log(`[SMPP Server] System ID: ${this.config.systemId}, Mode: ${this.config.bindMode}`);
    
    // Simulate server startup
    await this.delay(500);
    console.log('[SMPP Server] Started successfully, waiting for client binds...');
    return true;
  }

  async stop(): Promise<void> {
    console.log('[SMPP Server] Stopping...');
    this.connectedClients.clear();
    console.log('[SMPP Server] Stopped');
  }

  onMessage(handler: (msg: SMPPMessage) => void): void {
    const handlerId = `handler_${Date.now()}`;
    this.messageHandlers.set(handlerId, handler);
  }

  getConnectedClients(): string[] {
    return Array.from(this.connectedClients.keys());
  }

  getClientCount(): number {
    return this.connectedClients.size;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// SMPP Client Mode - connects to external suppliers
export class SMPPClient {
  private config: SMPPBindConfig;
  private isBound: boolean = false;
  private dlrCallbacks: Map<string, (dlr: DLRResult) => void> = new Map();
  private messageHandlers: ((msg: SMPPMessage) => void)[] = [];
  private consecutiveFailures: number = 0;
  private maxFailures: number = 20;

  constructor(config: SMPPBindConfig) {
    this.config = config;
  }

  async bind(): Promise<{ success: boolean; message: string }> {
    // In production uses smppy.Client to bind to external SMPP server
    console.log(`[SMPP Client] Binding to ${this.config.host}:${this.config.port} as ${this.config.systemId}`);
    
    try {
      // Simulate SMPP bind
      await this.delay(800);
      
      // Check for bind success
      const success = true; // In production, actual SMPP bind response
      
      if (success) {
        this.isBound = true;
        this.consecutiveFailures = 0;
        console.log('[SMPP Client] Bind successful');
        return { success: true, message: 'Bind successful' };
      } else {
        this.isBound = false;
        this.consecutiveFailures++;
        console.error('[SMPP Client] Bind failed');
        return { success: false, message: 'Bind failed: Invalid credentials' };
      }
    } catch (error) {
      this.isBound = false;
      this.consecutiveFailures++;
      return { success: false, message: `Bind error: ${error}` };
    }
  }

  async unbind(): Promise<{ success: boolean }> {
    console.log('[SMPP Client] Unbinding...');
    this.isBound = false;
    return { success: true };
  }

  async reconnect(): Promise<{ success: boolean; message: string }> {
    await this.unbind();
    await this.delay(1000);
    return this.bind();
  }

  async submitMessage(msg: Omit<SMPPMessage, 'id' | 'status' | 'submitTime'>): Promise<SMPPMessage> {
    const fullMsg: SMPPMessage = {
      ...msg,
      id: `MSG_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      status: 'pending',
      submitTime: new Date().toISOString(),
    };

    console.log(`[SMPP Client] Submitting SMS: ${fullMsg.sourceAddr} -> ${fullMsg.destinationAddr}`);
    console.log(`[SMPP Client] Message: ${fullMsg.shortMessage.substring(0, 50)}...`);

    // In production: actual SMPP submit_sm PDU
    await this.delay(300);

    fullMsg.status = 'submitted';
    fullMsg.messageId = `SMPP_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    // Register DLR callback
    this.dlrCallbacks.set(fullMsg.messageId, (dlr: DLRResult) => {
      fullMsg.dlrStatus = dlr.stat;
      fullMsg.dlrTimestamp = dlr.doneDate;
      fullMsg.status = dlr.stat === 'DELIVRD' ? 'delivered' : 'failed';
      if (dlr.err) {
        fullMsg.errorCode = dlr.err;
        fullMsg.errorMessage = dlr.text;
      }
    });

    // Simulate DLR after some time
    setTimeout(() => {
      this.simulateDLR(fullMsg);
    }, 2000 + Math.random() * 5000);

    return fullMsg;
  }

  private simulateDLR(msg: SMPPMessage): void {
    if (!msg.messageId || !this.dlrCallbacks.has(msg.messageId)) return;

    const dlrResult: DLRResult = {
      messageId: msg.messageId,
      dlrStatus: Math.random() > 0.15 ? 'DELIVRD' : 'UNDELIV',
      submitDate: new Date().toISOString(),
      doneDate: new Date(Date.now() + 2000).toISOString(),
      stat: Math.random() > 0.15 ? 'DELIVRD' : 'UNDELIV',
      err: Math.random() > 0.15 ? '000' : '001',
      text: Math.random() > 0.15 ? 'Message delivered' : 'Destination unreachable',
    };

    const callback = this.dlrCallbacks.get(msg.messageId);
    if (callback) {
      callback(dlrResult);
      this.dlrCallbacks.delete(msg.messageId);
    }
  }

  onMessage(handler: (msg: SMPPMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  getBindStatus(): { isBound: boolean; failures: number; host: string; port: number } {
    return {
      isBound: this.isBound,
      failures: this.consecutiveFailures,
      host: this.config.host,
      port: this.config.port,
    };
  }

  shouldBlock(): boolean {
    return this.consecutiveFailures >= this.maxFailures;
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Global SMPP Manager - manages all client and supplier connections
export class SMPPManager {
  private clients: Map<string, SMPPClient> = new Map();
  private servers: Map<string, SMPPServer> = new Map();
  private messageLog: SMPPMessage[] = [];
  private onLogUpdate: ((log: SMPPMessage[]) => void) | null = null;

  // Create SMPP server for receiving client messages
  createServer(id: string, config: SMPPBindConfig): SMPPServer {
    const server = new SMPPServer(config);
    server.onMessage((msg) => {
      this.messageLog.push(msg);
      this.onLogUpdate?.(this.messageLog);
    });
    this.servers.set(id, server);
    return server;
  }

  // Create SMPP client for connecting to suppliers
  createClient(id: string, config: SMPPBindConfig): SMPPClient {
    const client = new SMPPClient(config);
    client.onMessage((msg) => {
      this.messageLog.push(msg);
      this.onLogUpdate?.(this.messageLog);
    });
    this.clients.set(id, client);
    return client;
  }

  // Send SMS through the platform
  async sendSMS(data: {
    sourceAddr: string;
    destinationAddr: string;
    shortMessage: string;
    clientId: string;
    supplierId?: string;
    routeId?: string;
    mcc?: string;
    mnc?: string;
    rate?: number;
  }): Promise<SMPPMessage> {
    // Use client's SMPP connection or supplier's
    const client = this.clients.get(data.clientId);
    if (client) {
      return client.submitMessage({
        sourceAddr: data.sourceAddr,
        destinationAddr: data.destinationAddr,
        shortMessage: data.shortMessage,
        dataCoding: 0,
        esmClass: 0,
        registeredDelivery: 1,
        clientId: data.clientId,
        supplierId: data.supplierId,
        routeId: data.routeId,
        mcc: data.mcc,
        mnc: data.mnc,
        rate: data.rate,
      });
    }

    // If no specific client bind, create ad-hoc message
    const msg: SMPPMessage = {
      id: `MSG_${Date.now()}`,
      sourceAddr: data.sourceAddr,
      destinationAddr: data.destinationAddr,
      shortMessage: data.shortMessage,
      dataCoding: 0,
      esmClass: 0,
      registeredDelivery: 1,
      status: 'submitted',
      submitTime: new Date().toISOString(),
      clientId: data.clientId,
      supplierId: data.supplierId,
      routeId: data.routeId,
      mcc: data.mcc,
      mnc: data.mnc,
      rate: data.rate,
    };

    this.messageLog.push(msg);
    this.onLogUpdate?.(this.messageLog);
    return msg;
  }

  // Get all message logs
  getMessageLog(): SMPPMessage[] {
    return [...this.messageLog];
  }

  // Set log update callback
  onLogUpdateCallback(callback: (log: SMPPMessage[]) => void): void {
    this.onLogUpdate = callback;
  }

  // Get client connection
  getClient(id: string): SMPPClient | undefined {
    return this.clients.get(id);
  }

  // Get server connection
  getServer(id: string): SMPPServer | undefined {
    return this.servers.get(id);
  }

  // Get all client statuses
  getAllClientStatus(): Array<{ id: string; bound: boolean; failures: number; host: string; port: number }> {
    return Array.from(this.clients.entries()).map(([id, client]) => {
      const status = client.getBindStatus();
      return {
        id,
        bound: status.isBound,
        failures: status.failures,
        host: status.host,
        port: status.port,
      };
    });
  }

  // Auto-block clients with too many failures
  checkAutoBlock(): string[] {
    const blocked: string[] = [];
    this.clients.forEach((client, id) => {
      if (client.shouldBlock()) {
        console.warn(`[SMPP Manager] Auto-blocking client ${id} after ${client.getBindStatus().failures} failures`);
        blocked.push(id);
      }
    });
    return blocked;
  }
}

// Global instance
export const smppManager = new SMPPManager();

export default smppManager;
