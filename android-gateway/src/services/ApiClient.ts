// ============================================================
// HTTP REST API Client — communicates with the NET2APP server
// ============================================================

export interface ServerConfig {
  serverUrl: string;
  username: string;
  password: string;
  deviceName: string;
}

export interface MoSmsPayload {
  from: string;
  to: string;
  text: string;
  timestamp: number;
  device_name: string;
}

export interface MtSmsResponse {
  success: boolean;
  messages?: Array<{
    message_id: string;
    destination: string;
    sender_id: string;
    message: string;
  }>;
  error?: string;
}

export interface DlrPayload {
  message_id: string;
  status: 'DELIVRD' | 'UNDELIV' | 'FAILED';
  error_code?: string;
  timestamp: number;
}

export class ApiClient {
  private config: ServerConfig;
  private authHeader: string;

  constructor(config: ServerConfig) {
    this.config = config;
    this.authHeader = 'Basic ' + btoa(`${config.username}:${config.password}`);
  }

  private get baseUrl() {
    return this.config.serverUrl.replace(/\/$/, '');
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': this.authHeader,
        'X-Device-Name': this.config.deviceName,
        ...options.headers,
      },
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }

    return res.json();
  }

  /**
   * Register this Android device as a supplier on the server.
   * Called once during initial setup.
   */
  async registerDevice(): Promise<{ success: boolean; supplier_id?: number; error?: string }> {
    return this.request('/api/gateway/register', {
      method: 'POST',
      body: JSON.stringify({
        username: this.config.username,
        password: this.config.password,
        device_name: this.config.deviceName,
        connection_type: 'android_SMS',
      }),
    });
  }

  /**
   * Heartbeat — tells the server we're alive and ready.
   * Returns any pending MT messages to deliver.
   */
  async heartbeat(): Promise<{
    success: boolean;
    pending_mt?: Array<{
      message_id: string;
      destination: string;
      sender_id: string;
      message: string;
      client_code?: string;
    }>;
    error?: string;
  }> {
    return this.request('/api/gateway/heartbeat', {
      method: 'POST',
      body: JSON.stringify({
        device_name: this.config.deviceName,
        timestamp: Date.now(),
      }),
    });
  }

  /**
   * Forward a Mobile-Originated (MO) SMS from the phone to the server.
   */
  async forwardMoSms(sms: MoSmsPayload): Promise<{ success: boolean; error?: string }> {
    return this.request('/api/gateway/mo-sms', {
      method: 'POST',
      body: JSON.stringify(sms),
    });
  }

  /**
   * Acknowledge that an MT SMS has been sent (or failed).
   */
  async acknowledgeMt(dlr: DlrPayload): Promise<{ success: boolean }> {
    return this.request('/api/gateway/mt-dlr', {
      method: 'POST',
      body: JSON.stringify(dlr),
    });
  }

  /**
   * Test server connectivity.
   */
  async ping(): Promise<{ success: boolean; server_time: number }> {
    return this.request('/api/gateway/ping');
  }

  /**
   * Check if gateway endpoint exists on the server by probing it.
   */
  async probe(): Promise<{ supported: boolean; version?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/api/gateway/ping`, {
        method: 'GET',
        headers: { 'Authorization': this.authHeader },
      });
      if (res.ok) {
        const data = await res.json();
        return { supported: true, version: data.version };
      }
      if (res.status === 404) {
        return { supported: false };
      }
      // Try the legacy supplier API
      const legacyRes = await fetch(`${this.baseUrl}/api/suppliers`, {
        method: 'GET',
        headers: { 'Authorization': this.authHeader },
      });
      return { supported: legacyRes.ok };
    } catch {
      return { supported: false };
    }
  }
}
