import React, { createContext, useContext, useEffect, useState, useCallback, useRef, ReactNode } from 'react';

// ============================================================
// Types
// ============================================================
export interface GatewayConfig {
  serverUrl: string;
  username: string;
  password: string;
  /** Gateway API key (x-api-key) — alternative to username/password */
  apiKey?: string;
  connectionType: 'http_rest' | 'smpp_inbound';
  deviceName: string;
  smppHost?: string;
  smppPort?: number;
  /** MULTI-NODE: all hub nodes this phone connects to (serverUrl above = primary). */
  nodes?: NodeCreds[];
}

/** Credentials for one hub node (persisted natively in nodes_json). */
export interface NodeCreds {
  url: string;
  username: string;
  password: string;
  apiKey?: string;
}

/** Live per-node status reported by the native plugin. */
export interface NodeStatus {
  url: string;
  username: string;
  connected: boolean;
  lastOkAt: number;
}

/** Pairing QR payload (server: GET /api/suppliers/:id/pairing-qr). */
export interface PairingPayload {
  v: number;
  app: string;
  server_url: string;
  username: string;
  password: string;
  api_key?: string;
  mode: 'http_rest' | 'smpp_inbound';
  smpp_host?: string;
  smpp_port?: number;
  device_name?: string;
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

export interface DeviceInfo {
  model: string;
  manufacturer: string;
  androidVersion: string;
  sdkInt: number;
  simReady: boolean;
  simCarrier: string;
  simNumber: string;
  appVersion: string;
  appVersionCode?: number;
  simCount?: number;
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
  checkSmsPermissions: () => Promise<boolean>;
  openPermissionSettings: () => Promise<void>;
  deviceInfo: DeviceInfo | null;
  isConfigured: boolean;
  /** MULTI-NODE */
  nodeStatuses: NodeStatus[];
  addNodeFromPairing: (p: PairingPayload) => Promise<{ ok: boolean; message: string }>;
  removeNode: (url: string) => Promise<boolean>;
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

/**
 * Plain WebView native bridge (window.Net2appNative) — registered by
 * MainActivity. PRIMARY path for config persistence: bypasses the Capacitor
 * plugin layer entirely, so the native multi-node engine always gets the
 * config even if the plugin bridge is broken.
 */
function nativeBridge(): any {
  return (window as any).Net2appNative || null;
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
  const [deviceInfo, setDeviceInfo] = useState<DeviceInfo | null>(null);
  const messagesRef = useRef<SmsMessage[]>(messages);
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  const [startTime] = useState(Date.now);

  const isConfigured = !!config.serverUrl && !!config.username;
  const [nodeStatuses, setNodeStatuses] = useState<NodeStatus[]>([]);

  // Persist config — configure native plugin (MULTI-NODE aware)
  const saveConfig = useCallback(async (c: GatewayConfig) => {
    setConfigState(c);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
    // Build the full node list: explicit c.nodes, or derive the single node
    const nodeList: NodeCreds[] = (c.nodes && c.nodes.length > 0)
      ? c.nodes
      : [{ url: c.serverUrl, username: c.username, password: c.password, apiKey: c.apiKey || '' }];
    try {
      await callPlugin('configure', {
        // Full multi-node list
        nodes: nodeList.map(n => ({ url: n.url, username: n.username, password: n.password, apiKey: n.apiKey || '' })),
        // Legacy single-server fields (primary node) for old builds
        serverUrl: c.serverUrl,
        username: c.username,
        password: c.password,
        apiKey: c.apiKey || '',
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
    try {
      const ns = await callPlugin('getNodes');
      if (ns?.nodes) setNodeStatuses(ns.nodes);
    } catch {}
    // PRIMARY: persist natively via the plain WebView bridge and start the
    // multi-node engine. Works regardless of Capacitor plugin health.
    const nb = nativeBridge();
    if (nb && typeof nb.saveConfig === 'function') {
      try {
        const res = nb.saveConfig(JSON.stringify({
          serverUrl: c.serverUrl,
          username: c.username,
          password: c.password,
          apiKey: c.apiKey || '',
          nodes: nodeList.map(n => ({ url: n.url, username: n.username, password: n.password, apiKey: n.apiKey || '' })),
        }));
        console.log('[Net2app] native saveConfig:', res);
        const st = JSON.parse(nb.status());
        if (Array.isArray(st.nodes)) setNodeStatuses(st.nodes);
        setConnectionStatus(prev => ({ ...prev, serverConnected: st.registeredCount > 0 || prev.serverConnected }));
      } catch (e) {
        console.error('[Net2app] native bridge saveConfig failed:', e);
      }
    }
  } catch (e) {
    console.error('Failed to configure gateway:', e);
  }
}, []);

  // MULTI-NODE: add a hub node from a scanned pairing QR without touching
  // the existing nodes — the phone then connects to BOTH hubs.
  const addNodeFromPairing = useCallback(async (p: PairingPayload) => {
    const url = (p.server_url || '').replace(/\/$/, '');
    if (!url || !p.username) return { ok: false, message: '❌ Invalid pairing QR (missing server_url/username)' };
    // PRIMARY: plain native bridge
    const nb = nativeBridge();
    if (nb && typeof nb.addNode === 'function') {
      try {
        const res = nb.addNode(JSON.stringify({
          url,
          username: p.username,
          password: p.password || '',
          apiKey: p.api_key || '',
        }));
        const st = JSON.parse(nb.status());
        if (Array.isArray(st.nodes)) setNodeStatuses(st.nodes);
        const ok = typeof res === 'string' && res.startsWith('ok');
        const total = st.totalCount ?? '?';
        const reg = st.registeredCount ?? '?';
        return {
          ok,
          message: ok
            ? `✅ Node added: ${url} as ${p.username} — connected nodes: ${reg}/${total}`
            : `⚠ Node saved (${total} total) but registration failed — heartbeat keeps retrying.`,
        };
      } catch (e) {
        console.error('[Net2app] native addNode failed:', e);
      }
    }
    const result = await callPlugin('addNode', {
      url,
      username: p.username,
      password: p.password || '',
      apiKey: p.api_key || '',
    });
    if (result && result.nodes) setNodeStatuses(result.nodes);
    const ok = !!(result && result.success);
    const total = result?.totalCount ?? '?';
    const reg = result?.registeredCount ?? '?';
    return {
      ok,
      message: ok
        ? `✅ Node added: ${url} as ${p.username} — connected nodes: ${reg}/${total}`
        : `⚠ Node saved (${total} total) but registration failed — check the server URL is reachable from this phone. Heartbeat keeps retrying.`,
    };
  }, []);

  const removeNodeByUrl = useCallback(async (url: string) => {
    const nb = nativeBridge();
    if (nb && typeof nb.removeNode === 'function') {
      try {
        const res = nb.removeNode(url);
        const st = JSON.parse(nb.status());
        if (Array.isArray(st.nodes)) setNodeStatuses(st.nodes);
        return typeof res === 'string' && res.startsWith('ok');
      } catch {}
    }
    const result = await callPlugin('removeNode', { url });
    if (result && result.nodes) setNodeStatuses(result.nodes);
    return !!(result && result.success);
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
            // Native truth: real runtime permission state (falls back to
            // receiver-active on older builds that don't report it).
            smsPermission: typeof status.smsPermissionGranted === 'boolean'
              ? status.smsPermissionGranted
              : status.smsReceiverActive,
            smppConnected: status.smppConnected,
            offlineQueuePending: status.offlineQueuePending,
            // Background = foreground service alive (or at minimum the SMS
            // receiver is registered on builds predating the service).
            backgroundService: status.foregroundServiceRunning === true || status.smsReceiverActive || status.isRegistered,
            // MULTI-NODE: online when at least one hub node answers
            lastServerPing: Array.isArray(status.nodes) && status.nodes.some((n: any) => n.lastOkAt > 0)
              ? Math.max(...status.nodes.filter((n: any) => n.lastOkAt > 0).map((n: any) => n.lastOkAt))
              : prev.lastServerPing,
          }));
          if (Array.isArray(status.nodes)) setNodeStatuses(status.nodes);
        }
      } catch {}
      // PRIMARY multi-node truth from the plain native bridge
      try {
        const nb = nativeBridge();
        if (nb && typeof nb.status === 'function') {
          const st = JSON.parse(nb.status());
          if (Array.isArray(st.nodes)) {
            setNodeStatuses(st.nodes);
            const anyUp = (st.registeredCount || 0) > 0;
            setConnectionStatus(prev => ({
              ...prev,
              serverConnected: anyUp,
              backgroundService: st.engineStarted === true || prev.backgroundService,
              smsPermission: typeof st.smsPermissionGranted === 'boolean' ? st.smsPermissionGranted : prev.smsPermission,
              lastServerPing: anyUp && st.nodes.some((n: any) => n.lastOkAt > 0)
                ? Math.max(...st.nodes.filter((n: any) => n.lastOkAt > 0).map((n: any) => n.lastOkAt))
                : prev.lastServerPing,
            }));
          }
        }
      } catch {}
      // Refresh device/SIM snapshot (cheap local call — reflects permission
      // grants the moment the user returns from Settings).
      try {
        const di = await callPlugin('getDeviceInfo');
        if (di) {
          const next: DeviceInfo = {
            model: di.model || '',
            manufacturer: di.manufacturer || '',
            androidVersion: di.androidVersion || '',
            sdkInt: di.sdkInt || 0,
            simReady: !!di.simReady,
            simCarrier: di.simCarrier || '',
            simNumber: di.simNumber || '',
            appVersion: di.appVersion || '',
            appVersionCode: di.appVersionCode,
            simCount: di.simCount,
          };
          setDeviceInfo(prev => {
            if (prev && JSON.stringify(prev) === JSON.stringify(next)) return prev;
            return next;
          });
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
        setConfigState(prev => ({
          ...prev,
          serverUrl: saved.serverUrl,
          username: saved.username,
          password: saved.password,
          apiKey: saved.apiKey || '',
          nodes: Array.isArray(saved.nodes) && saved.nodes.length > 0 ? saved.nodes : prev.nodes,
        }));
      }
    });
    // Multi-node status from the plain native bridge (survives plugin issues)
    try {
      const nb = nativeBridge();
      if (nb && typeof nb.status === 'function') {
        const st = JSON.parse(nb.status());
        if (Array.isArray(st.nodes) && st.nodes.length > 0) setNodeStatuses(st.nodes);
      }
    } catch {}
    callPlugin('getStatus').then(status => {
      if (status) {
        setConnectionStatus(prev => ({
          ...prev,
          serverConnected: status.isRegistered,
          smsPermission: typeof status.smsPermissionGranted === 'boolean'
            ? status.smsPermissionGranted
            : status.smsReceiverActive,
          backgroundService: status.foregroundServiceRunning === true || status.smsReceiverActive || status.isRegistered,
          offlineQueuePending: status.offlineQueuePending,
        }));
      }
    });
  }, []);

  // Real permission check — accurate even when the dialog was permanently denied
  const checkSmsPermissions = useCallback(async (): Promise<boolean> => {
    try {
      const result = await callPlugin('checkPermissions');
      const granted = !!result?.granted;
      setConnectionStatus(prev => ({ ...prev, smsPermission: granted }));
      return granted;
    } catch {
      return false;
    }
  }, []);

  // Deep-link to the system App Settings page (needed after "Don't ask again")
  const openPermissionSettings = useCallback(async (): Promise<void> => {
    await callPlugin('openPermissionSettings');
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
    checkSmsPermissions,
    openPermissionSettings,
    deviceInfo,
    isConfigured,
    nodeStatuses,
    addNodeFromPairing,
    removeNode: removeNodeByUrl,
  };

  return (
    <GatewayContext.Provider value={value}>
      {children}
    </GatewayContext.Provider>
  );
}
