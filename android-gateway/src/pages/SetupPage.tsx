import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGateway, GatewayConfig } from '../services/GatewayContext';
import { ApiClient } from '../services/ApiClient';

export default function SetupPage() {
  const { config, saveConfig, requestSmsPermission, connectionStatus } = useGateway();
  const navigate = useNavigate();

  const [form, setForm] = useState<GatewayConfig>({ ...config });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleChange = (field: keyof GatewayConfig, value: string | number) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleTestConnection = async () => {
    if (!form.serverUrl || !form.username) {
      setTestResult('❌ Server URL and Username are required');
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      // HTTP test
      const client = new ApiClient({
        serverUrl: form.serverUrl,
        username: form.username,
        password: form.password,
        deviceName: form.deviceName,
      });
      const probe = await client.probe();

      if (form.connectionType === 'smpp_inbound') {
        // Also test SMPP port reachability hint
        const smppHost = form.smppHost || extractHost(form.serverUrl);
        if (probe.supported) {
          setTestResult(`✅ Server reachable via HTTP. SMPP will connect to ${smppHost}:${form.smppPort || 2775} — ensure port ${form.smppPort || 2775} is open on your firewall.`);
        } else {
          setTestResult('⚠ Server reachable but gateway API not detected. SMPP mode still works independently on port 2775.');
        }
      } else {
        if (probe.supported) {
          setTestResult(`✅ Server reachable${probe.version ? ` (v${probe.version})` : ''}`);
        } else {
          setTestResult('⚠ Server reachable but gateway API not detected. Make sure the server has /api/gateway endpoints.');
        }
      }
    } catch (e: any) {
      setTestResult(`❌ Connection failed: ${e.message}`);
    } finally {
      setTesting(false);
    }
  };

  const extractHost = (url: string): string => {
    try {
      return url.replace(/^https?:\/\//, '').replace(/[:/].*$/, '');
    } catch { return url; }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await requestSmsPermission();
      await saveConfig(form);

      if (form.serverUrl) {
        try {
          const client = new ApiClient({
            serverUrl: form.serverUrl,
            username: form.username,
            password: form.password,
            deviceName: form.deviceName,
          });
          await client.registerDevice();
        } catch {}
      }

      navigate('/dashboard');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="setup-page">
      <div className="setup-header">
        <div className="setup-icon">📱</div>
        <h1>NET2APP Gateway</h1>
        <p className="setup-subtitle">Turn your Android phone into an SMS supplier</p>
      </div>

      <div className="setup-card">
        <h2>Connection Setup</h2>

        <div className="form-group">
          <label>Server URL</label>
          <input
            type="url"
            placeholder="https://your-server.com or http://1.2.3.4:3001"
            value={form.serverUrl}
            onChange={e => handleChange('serverUrl', e.target.value)}
          />
          <span className="form-hint">Your NET2APP Hub server address</span>
        </div>

        <div className="form-group">
          <label>Username (SMPP System ID)</label>
          <input
            type="text"
            placeholder="Enter supplier username"
            value={form.username}
            onChange={e => handleChange('username', e.target.value)}
          />
          <span className="form-hint">Must match a supplier's smpp_username on the server</span>
        </div>

        <div className="form-group">
          <label>Password</label>
          <input
            type="password"
            placeholder="Enter supplier password"
            value={form.password}
            onChange={e => handleChange('password', e.target.value)}
          />
        </div>

        <div className="form-group">
          <label>Connection Type</label>
          <select
            value={form.connectionType}
            onChange={e => handleChange('connectionType', e.target.value)}
          >
            <option value="http_rest">HTTP REST API (recommended)</option>
            <option value="smpp_inbound">SMPP — Port 2775 (advanced)</option>
          </select>
          <span className="form-hint">
            {form.connectionType === 'http_rest'
              ? 'Reliable over mobile networks. Uses HTTPS polling every 5 seconds.'
              : `Direct SMPP client connection as a transceiver. The app binds to your server's SMPP port, receives MT via deliver_sm, and forwards MO via submit_sm.`}
          </span>
        </div>

        {/* SMPP-specific fields — shown only when SMPP mode is selected */}
        {form.connectionType === 'smpp_inbound' && (
          <>
            <div className="form-group">
              <label>SMPP Host</label>
              <input
                type="text"
                placeholder="Auto-detected from server URL"
                value={form.smppHost || ''}
                onChange={e => handleChange('smppHost', e.target.value)}
              />
              <span className="form-hint">
                SMPP server hostname/IP. Leave blank to auto-detect from Server URL.
                Usually the same host as the HTTP server.
              </span>
            </div>

            <div className="form-group">
              <label>SMPP Port</label>
              <input
                type="number"
                placeholder="2775"
                value={form.smppPort || 2775}
                onChange={e => handleChange('smppPort', parseInt(e.target.value) || 2775)}
              />
              <span className="form-hint">Default SMPP port is 2775. Must be open on your server firewall.</span>
            </div>

            <div className="smpp-info-box">
              <h4>⚡ SMPP Mode Details</h4>
              <ul>
                <li>Binds as <strong>transceiver</strong> (TRX) — can send and receive</li>
                <li>MT SMS arrive via <code>deliver_sm</code> → phone sends via SIM</li>
                <li>MO SMS forwarded via <code>submit_sm</code> → server receives</li>
                <li>SMPP v3.4 protocol with auto-reconnect (exponential backoff)</li>
                <li>Enquire_link keepalive every 15 seconds</li>
                <li>DLR forwarding also via HTTP for billing consistency</li>
              </ul>
            </div>
          </>
        )}

        <div className="form-group">
          <label>Device Name</label>
          <input
            type="text"
            placeholder="My Android Phone"
            value={form.deviceName}
            onChange={e => handleChange('deviceName', e.target.value)}
          />
          <span className="form-hint">Identifier for this device on the server</span>
        </div>

        <div className="permission-status">
          <div className="perm-row">
            <span>SMS Permission</span>
            <span className={`perm-badge ${connectionStatus.smsPermission ? 'granted' : ''}`}>
              {connectionStatus.smsPermission ? '✅ Granted' : '⏳ Required'}
            </span>
          </div>
        </div>

        {testResult && (
          <div className={`test-result ${testResult.startsWith('✅') ? 'success' : testResult.startsWith('⚠') ? 'warning' : 'error'}`}>
            {testResult}
          </div>
        )}

        <div className="setup-actions">
          <button
            className="btn btn-secondary"
            onClick={handleTestConnection}
            disabled={testing}
          >
            {testing ? '⏳ Testing...' : '🔍 Test Connection'}
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving || !form.serverUrl || !form.username}
          >
            {saving ? '⏳ Saving...' : '💾 Save & Connect'}
          </button>
        </div>
      </div>
    </div>
  );
}
