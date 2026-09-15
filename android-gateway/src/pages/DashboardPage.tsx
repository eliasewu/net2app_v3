import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGateway } from '../services/GatewayContext';
import { ApiClient } from '../services/ApiClient';
import { QrPairingScanner } from '../components/QrPairingScanner';

export default function DashboardPage() {
  const { config, connectionStatus, stats, sendSms, refreshMessages, checkSmsPermissions, openPermissionSettings, deviceInfo, nodeStatuses, addNodeFromPairing, removeNode } = useGateway();
  const navigate = useNavigate();

  const [quickSms, setQuickSms] = useState({ to: '', text: '' });
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [testingConn, setTestingConn] = useState(false);
  const [showNodeScanner, setShowNodeScanner] = useState(false);
  const [nodeMsg, setNodeMsg] = useState<string | null>(null);

  useEffect(() => {
    const interval = setInterval(refreshMessages, 10000);
    return () => clearInterval(interval);
  }, [refreshMessages]);

  const handleQuickSend = async () => {
    if (!quickSms.to || !quickSms.text) return;
    setSending(true);
    setSendResult(null);
    try {
      const result = await sendSms(quickSms.to, quickSms.text);
      setSendResult({
        ok: result.success,
        msg: result.success ? `Sent! ID: ${result.id}` : `Failed: ${result.error}`,
      });
      if (result.success) {
        setQuickSms({ to: '', text: '' });
      }
    } finally {
      setSending(false);
    }
  };

  const handleTestServer = async () => {
    setTestingConn(true);
    try {
      const client = new ApiClient({
        serverUrl: config.serverUrl,
        username: config.username,
        password: config.password,
        deviceName: config.deviceName,
      });
      await client.ping();
    } catch {}
    setTestingConn(false);
  };

  const uptimeMins = Math.floor(connectionStatus.uptime / 60);
  const uptimeHours = Math.floor(uptimeMins / 60);

  return (
    <div className="dashboard-page">
      {/* Header */}
      <div className="dash-header">
        <div className="dash-title">
          <h1>📱 {config.deviceName}</h1>
          <p>{config.serverUrl}</p>
        </div>
        <div className={`connection-dot ${connectionStatus.serverConnected ? 'online' : 'offline'}`}>
          {connectionStatus.serverConnected ? '🟢 Online' : '🔴 Offline'}
        </div>
      </div>
      {nodeStatuses.length > 1 && (
        <p style={{ margin: '4px 0 0', fontSize: 12, opacity: 0.75 }}>
          🖧 {nodeStatuses.filter(n => n.connected).length}/{nodeStatuses.length} hub nodes connected
        </p>
      )}

      {/* Status Cards */}
      <div className="status-cards">
        <div className="stat-card">
          <div className="stat-icon">📤</div>
          <div className="stat-value">{stats.totalSent}</div>
          <div className="stat-label">Sent (MT)</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">📥</div>
          <div className="stat-value">{stats.totalReceived}</div>
          <div className="stat-label">Received (MO)</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">✅</div>
          <div className="stat-value">{stats.totalDelivered}</div>
          <div className="stat-label">Delivered</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">📦</div>
          <div className="stat-value">{connectionStatus.offlineQueuePending}</div>
          <div className="stat-label">Queue Pending</div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">⏱</div>
          <div className="stat-value">
            {uptimeHours > 0 ? `${uptimeHours}h` : `${uptimeMins}m`}
          </div>
          <div className="stat-label">Uptime</div>
        </div>
      </div>

      {/* Quick Send */}
      <div className="quick-send-card">
        <h3>⚡ Quick Send SMS (Test)</h3>
        <div className="quick-send-form">
          <input
            type="tel"
            placeholder="Phone number (e.g. +1234567890)"
            value={quickSms.to}
            onChange={e => setQuickSms(prev => ({ ...prev, to: e.target.value }))}
          />
          <textarea
            placeholder="Message text..."
            value={quickSms.text}
            onChange={e => setQuickSms(prev => ({ ...prev, text: e.target.value }))}
            rows={2}
          />
          <button
            className="btn btn-primary"
            onClick={handleQuickSend}
            disabled={sending || !quickSms.to || !quickSms.text}
          >
            {sending ? '⏳ Sending...' : '📤 Send SMS'}
          </button>
        </div>
        {sendResult && (
          <div className={`send-result ${sendResult.ok ? 'success' : 'error'}`}>
            {sendResult.msg}
          </div>
        )}
      </div>

      {/* Service Status */}
      <div className="status-details-card">
        <h3>🔧 Service Status</h3>
        <div className="status-rows">
          <div className="status-row">
            <span>Server Connection</span>
            <span className={connectionStatus.serverConnected ? 'ok' : 'error'}>
              {connectionStatus.serverConnected ? '✅ Connected' : '❌ Disconnected'}
            </span>
          </div>
          {config.connectionType === 'smpp_inbound' && (
            <div className="status-row">
              <span>SMPP Session</span>
              <span className={connectionStatus.smppConnected ? 'ok' : 'warn'}>
                {connectionStatus.smppConnected ? '✅ Bound (TRX)' : '⚠ Not Bound'}
              </span>
            </div>
          )}
          <div className="status-row">
            <span>SMS Permission</span>
            <span className={connectionStatus.smsPermission ? 'ok' : 'error'}>
              {connectionStatus.smsPermission ? '✅ Granted' : '❌ Denied'}
            </span>
            {!connectionStatus.smsPermission && (
              <button
                className="btn btn-secondary"
                style={{ marginLeft: 'auto', padding: '4px 10px', fontSize: 12 }}
                onClick={async () => {
                  // Re-check first — if still denied, jump to system settings
                  // (the dialog is suppressed once "Don't ask again" was chosen)
                  const ok = await checkSmsPermissions();
                  if (!ok) await openPermissionSettings();
                }}
              >
                Fix Permissions
              </button>
            )}
          </div>
          <div className="status-row">
            <span>Background Service</span>
            <span className={connectionStatus.backgroundService ? 'ok' : 'warn'}>
              {connectionStatus.backgroundService ? '✅ Running' : '⚠ Not Running'}
            </span>
          </div>
          <div className="status-row">
            <span>Connection Type</span>
            <span className="info">{config.connectionType === 'http_rest' ? 'HTTP REST' : `SMPP (${config.smppHost || 'auto'}:${config.smppPort || 2775})`}</span>
          </div>
          <div className="status-row">
            <span>Offline Queue</span>
            <span className={connectionStatus.offlineQueuePending > 0 ? 'warn' : 'ok'}>
              {connectionStatus.offlineQueuePending > 0
                ? `⚠ ${connectionStatus.offlineQueuePending} pending`
                : '✅ Empty'}
            </span>
          </div>
          <div className="status-row">
            <span>Last Ping</span>
            <span className="info">
              {connectionStatus.lastServerPing
                ? new Date(connectionStatus.lastServerPing).toLocaleTimeString()
                : 'Never'}
            </span>
          </div>
        </div>
        <div className="status-actions">
          <button className="btn btn-sm btn-outline" onClick={handleTestServer} disabled={testingConn}>
            {testingConn ? '⏳' : '🔍'} Test Server
          </button>
          <button className="btn btn-sm btn-outline" onClick={() => navigate('/setup')}>
            ⚙ Settings
          </button>
        </div>
      </div>

      {/* Connected Nodes (MULTI-NODE) */}
      <div className="status-details-card">
        <h3>🖧 Connected Nodes</h3>
        <div className="status-rows">
          {nodeStatuses.length === 0 && (
            <div className="status-row"><span>No nodes</span><span className="warn">⚠</span></div>
          )}
          {nodeStatuses.map(n => (
            <div className="status-row" key={n.url}>
              <span style={{ maxWidth: '55%', wordBreak: 'break-all' }}>{n.url}</span>
              <span className={n.connected ? 'ok' : 'error'} style={{ marginLeft: 'auto' }}>
                {n.connected ? '✅ Connected' : '❌ Offline'}
              </span>
              <button
                className="btn btn-secondary"
                style={{ marginLeft: 8, padding: '2px 8px', fontSize: 11 }}
                onClick={async () => {
                  if (await removeNode(n.url)) setNodeMsg(`🗑 Node removed: ${n.url}`);
                }}
              >✖</button>
            </div>
          ))}
          {nodeMsg && <div className="status-row"><span className="info" style={{ fontSize: 12 }}>{nodeMsg}</span></div>}
        </div>
        <div className="status-actions">
          <button className="btn btn-sm btn-outline" onClick={() => { setNodeMsg(null); setShowNodeScanner(true); }}>
            ➕ Add Server (Scan QR)
          </button>
        </div>
      </div>
      {showNodeScanner && (
        <QrPairingScanner
          onPaired={async (paired: any) => {
            setShowNodeScanner(false);
            setNodeMsg('⏳ Connecting to new node…');
            const res = await addNodeFromPairing(paired as any);
            setNodeMsg(res.message);
          }}
          onCancel={() => setShowNodeScanner(false)}
        />
      )}

      {/* Device & SIM */}
      <div className="status-details-card">
        <h3>📱 Device & SIM</h3>
        <div className="status-rows">
          <div className="status-row">
            <span>Device</span>
            <span className="info">
              {deviceInfo ? `${deviceInfo.manufacturer} ${deviceInfo.model}`.trim() : '—'}
            </span>
          </div>
          <div className="status-row">
            <span>Android Version</span>
            <span className="info">
              {deviceInfo ? `${deviceInfo.androidVersion} (API ${deviceInfo.sdkInt})` : '—'}
            </span>
          </div>
          <div className="status-row">
            <span>SIM Status</span>
            <span className={deviceInfo?.simReady ? 'ok' : 'error'}>
              {deviceInfo
                ? deviceInfo.simReady
                  ? '✅ Ready'
                  : '❌ No SIM detected'
                : '—'}
            </span>
          </div>
          <div className="status-row">
            <span>Carrier</span>
            <span className="info">{deviceInfo?.simCarrier || '—'}</span>
          </div>
          <div className="status-row">
            <span>SIM Number</span>
            <span className="info">
              {deviceInfo?.simNumber || '—'}
              {deviceInfo && deviceInfo.simReady && !deviceInfo.simNumber && (
                <em style={{ fontSize: 11, marginLeft: 6 }}>(grant Phone permission to show)</em>
              )}
            </span>
          </div>
          {!!deviceInfo?.simCount && deviceInfo.simCount > 1 && (
            <div className="status-row">
              <span>Active SIMs</span>
              <span className="info">{deviceInfo.simCount}</span>
            </div>
          )}
          <div className="status-row">
            <span>App Version</span>
            <span className="info">
              {deviceInfo?.appVersion
                ? `${deviceInfo.appVersion}${deviceInfo.appVersionCode ? ` (#${deviceInfo.appVersionCode})` : ''}`
                : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <div className="nav-bar">
        <button className="nav-btn active" onClick={() => navigate('/dashboard')}>
          <span>📊</span> Dashboard
        </button>
        <button className="nav-btn" onClick={() => navigate('/inbox')}>
          <span>📥</span> Inbox
        </button>
        <button className="nav-btn" onClick={() => navigate('/outbox')}>
          <span>📤</span> Outbox
        </button>
      </div>
    </div>
  );
}
