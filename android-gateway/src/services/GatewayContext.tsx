import React, { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react';

// ============================================================
// Types
// ============================================================
export interface GatewayConfig {
  serverUrl: string;
  username: string;
  password: string;
  connectionType: 'http_rest' | 'smpp_inbound';
  deviceName: string;
  smppHost?: string;
  smppPort?: number;
}

export interface SmsMessage {
  id: string;
  from: string;
  to: string;
  text: string;
  timestamp: number;
  direction: 'incoming' | 'outgoing';
  status: 'pending' | 'sent' | 'delivered' | 'failed';
  serverSynced: boolean;
}

export interface ConnectionStatus {
  serverConnected: boolean;
  smppConnected: boolean;
  offlineQueuePending: number;
  smsPermission: boolean;
  backgroundService: boolean;
  lastServerPing: number | null;
  pendingQueue: number;
  uptime: number;
}

export interface GatewayStats {
  totalSent: number;
  totalReceived: number;
  totalDelivered: number;
  totalFailed: number;
  uptimeSeconds: number;
  lastActivity: number | null;
}

interface GatewayContextType {
  config: GatewayConfig;
  setConfig: (c: GatewayConfig) => void;
  saveConfig: (c: GatewayConfig) => Promise<void>;
  connectionStatus: ConnectionStatus;
  stats: GatewayStats;
  messages: SmsMessage[];
  sendSms: (to: string, text: string) => Promise<{ success: boolean; id?: string; error?: string }>;
  refreshMessages: () => Promise<void>;
  clearMessages: () => void;
  requestSmsPermission: () => Promise<boolean>;
  isConfigured: boolean;
}

const GatewayContext = createContext<GatewayContextType | null>(null);

export function useGateway() {
  const ctx = useContext(GatewayContext);
  if (!ctx) throw new Error('useGateway must be used within GatewayProvider');
  return ctx;
}

const STORAGE_KEY = 'net2app_gateway_config';
const MSG_STORAGE_KEY = 'net2app_gateway_messages';

function loadConfig(): GatewayConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return {
    serverUrl: '',
    username: '',
    password: '',
    connectionType: 'http_rest',
    deviceName: 'Android-Gateway',
    smppHost: '',
    smppPort: 2775,
  };
}

function loadMessages(): SmsMessage[] {
  try {
    const raw = localStorage.getItem(MSG_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
}

function persistMessages(msgs: SmsMessage[]) {
  try {
    // Keep only last 500 messages
    const trimmed = msgs.slice(-500);
    localStorage.setItem(MSG_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {}
}

// ============================================================
// Native SMS Plugin bridge — communicates with Android layer
// ============================================================
function getPlugin(): any {
  // Capacitor 4+ pattern: plugins are on Capacitor.Plugins
  if ((window as any).Capacitor?.Plugins?.SmsGateway) {
    return (window as any).Capacitor.Plugins.SmsGateway;
  }
  // Fallback: direct window reference (dev mode)
  return (window as any).SmsGatewayPlugin;
}

async function callPlugin(method: string, args?: any): Promise<any> {
  const plugin = getPlugin();
  if (!plugin) return null;
  try {
    // Capacitor uses { value: result } wrapper
    const raw = await plugin[method](args || {});
    return raw?.value !== undefined ? raw.value : raw;
  } catch (e) {
    console.error(`Plugin call ${method} failed:`, e);
    return null;
  }
}

// ============================================================
// Provider
// ============================================================
export function GatewayProvider({ children }: { children: ReactNode }) {
  const [config, setConfigState] = useState<GatewayConfig>(loadConfig);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>({
    serverConnected: false,
    smppConnected: false,
    offlineQueuePending: 0,
    smsPermission: false,
    backgroundService: false,
    lastServerPing: null,
    pendingQueue: 0,
    uptime: 0,
  });
  const [stats, setStats] = useState<GatewayStats>({
    totalSent: 0,
    totalReceived: 0,
    totalDelivered: 0,
    totalFailed: 0,
    uptimeSeconds: 0,
    lastActivity: null,
  });
  const [messages, setMessages] = useState<SmsMessage[]>(loadMessages);
  const messagesRef = useRef<SmsMessage[]>(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  const [startTime] = useState(Date.now);

  const isConfigured = !!config.serverUrl && !!config.username;

  // Persist config — configure native plugin
  const saveConfig = useCallback(async (c: GatewayConfig) => {
    setConfigState(c);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
    try {
      await callPlugin('configure', {
        serverUrl: c.serverUrl,
        username: c.username,
        password: c.password,
        smppEnabled: c.connectionType === 'smpp_inbound',
      });
      if (c.connectionType === 'smpp_inbound') {
        await callPlugin('connectSmpp', {
          host: c.smppHost || '',
          port: c.smppPort || 2775,
          systemId: c.username,
          password: c.password,
        });
      }
      setConnectionStatus(prev => ({ ...prev, serverConnected: true }));
    } catch (e) {
      console.error('Failed to configure gateway:', e);
    }
  }, []);

  const setConfig = useCallback((c: GatewayConfig) => {
    setConfigState(c);
  }, []);

  // Send SMS via native Android SmsManager
  const sendSms = useCallback(async (to: string, text: string) => {
    const msgId = `out_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
    const newMsg: SmsMessage = {
      id: msgId,
      from: config.username,
      to,
      text,
      timestamp: Date.now(),
      direction: 'outgoing',
      status: 'pending',
      serverSynced: false,
    };

    setMessages(prev => {
      const updated = [...prev, newMsg];
      persistMessages(updated);
      return updated;
    });

    const result = await callPlugin('sendSms', { phoneNumber: to, message: text });
    if (result?.success) {
      setMessages(prev => {
        const updated = prev.map(m =>
          m.id === msgId ? { ...m, status: 'sent' as const } : m
        );
        persistMessages(updated);
        return updated;
      });
      setStats(s => ({ ...s, totalSent: s.totalSent + 1, lastActivity: Date.now() }));
      return { success: true, id: msgId };
    }
    setMessages(prev => {
      const updated = prev.map(m =>
        m.id === msgId ? { ...m, status: 'failed' as const } : m
      );
      persistMessages(updated);
      return updated;
    });
    setStats(s => ({ ...s, totalFailed: s.totalFailed + 1 }));
    return { success: false, error: 'SMS send failed' };
  }, [config.username]);

  // Refresh messages (polled by background service)
  const refreshMessages = useCallback(async () => {
    // In production, this reads from the native SMS inbox via plugin
    if ((window as any).SmsGatewayPlugin) {
      try {
        const result = await (window as any).SmsGatewayPlugin.ping();
        if (result.success) {
          setConnectionStatus(prev => ({
            ...prev,
            serverConnected: true,
            lastServerPing: Date.now(),
          }));
        }
      } catch {}
    }

    // Update stats from message array (use ref for latest value, no stale closure)
    const current = messagesRef.current;
    setStats(prev => {
      const sent = current.filter(m => m.direction === 'outgoing' && m.status === 'sent').length;
      const delivered = current.filter(m => m.status === 'delivered').length;
      const failed = current.filter(m => m.status === 'failed').length;
      const received = current.filter(m => m.direction === 'incoming').length;
      return { ...prev, totalSent: sent, totalReceived: received, totalDelivered: delivered, totalFailed: failed };
    });
  }, []); // no dependency on messages — use ref instead

  const clearMessages = useCallback(() => {
    setMessages([]);
    localStorage.removeItem(MSG_STORAGE_KEY);
  }, []);

  const requestSmsPermission = useCallback(async () => {
    const result = await callPlugin('requestPermissions');
    if (result?.granted) {
      setConnectionStatus(prev => ({ ...prev, smsPermission: true }));
      return true;
    }
    setConnectionStatus(prev => ({ ...prev, smsPermission: false }));
    return false;
  }, []);

  // Periodically refresh connection status and message stats
  useEffect(() => {
    const interval = setInterval(async () => {
      setConnectionStatus(prev => ({
        ...prev,
        uptime: Math.floor((Date.now() - startTime) / 1000),
      }));
      try {
        const status = await callPlugin('getStatus');
        if (status) {
          setConnectionStatus(prev => ({
            ...prev,
            serverConnected: status.isRegistered,
            smppConnected: status.smppConnected,
            offlineQueuePending: status.offlineQueuePending,
            backgroundService: status.smsReceiverActive,
          }));
        }
      } catch {}
      // Refresh stats using latest messages
      refreshMessages();
    }, 5000);
    return () => clearInterval(interval);
  }, [startTime, refreshMessages]);

  // On mount, load saved config and check plugin status
  useEffect(() => {
    callPlugin('loadSavedConfig').then(saved => {
      if (saved?.serverUrl) {
        setConfigState(prev => ({ ...prev, serverUrl: saved.serverUrl, username: saved.username, password: saved.password }));
      }
    });
    callPlugin('getStatus').then(status => {
      if (status) {
        setConnectionStatus(prev => ({
          ...prev,
          serverConnected: status.isRegistered,
          smsPermission: status.smsReceiverActive,
          offlineQueuePending: status.offlineQueuePending,
        }));
      }
    });
  }, []);

  const value: GatewayContextType = {
    config,
    setConfig,
    saveConfig,
    connectionStatus,
    stats,
    messages,
    sendSms,
    refreshMessages,
    clearMessages,
    requestSmsPermission,
    isConfigured,
  };

  return (
    <GatewayContext.Provider value={value}>
      {children}
    </GatewayContext.Provider>
  );
}
