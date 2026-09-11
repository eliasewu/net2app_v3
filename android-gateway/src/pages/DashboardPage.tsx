import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGateway } from '../services/GatewayContext';
import { ApiClient } from '../services/ApiClient';

export default function DashboardPage() {
  const { config, connectionStatus, stats, sendSms, refreshMessages } = useGateway();
  const navigate = useNavigate();

  const [quickSms, setQuickSms] = useState({ to: '', text: '' });
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [testingConn, setTestingConn] = useState(false);

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
