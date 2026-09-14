import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useGateway, GatewayConfig } from '../services/GatewayContext';
import { ApiClient } from '../services/ApiClient';
import { QrPairingScanner } from '../components/QrPairingScanner';

export default function SetupPage() {
  const { config, saveConfig, requestSmsPermission, connectionStatus } = useGateway();
  const navigate = useNavigate();

  const [form, setForm] = useState<GatewayConfig>({ ...config });
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [pairBanner, setPairBanner] = useState<string | null>(null);

  const handleChange = (field: keyof GatewayConfig, value: string | number) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handlePaired = (paired: Partial<GatewayConfig>) => {
    setShowScanner(false);
    setForm(prev => ({ ...prev, ...paired }));
    setPairBanner(`✅ QR paired: ${paired.serverUrl} as ${paired.username} (${paired.connectionType === 'smpp_inbound' ? 'SMPP inbound' : 'HTTP REST'}) — review and press Save & Connect`);
  };

  const handleTestConnection = async () => {
    if (!form.serverUrl || !form.username) {
      setTestResult('❌ Server URL and Username are required');
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const client = new ApiClient({
        serverUrl: form.serverUrl,
        username: form.username,
        password: form.password,
        deviceName: form.deviceName,
      });
      const probe = await client.probe();

      if (form.connectionType === 'smpp_inbound') {
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
      {showScanner && (
        <QrPairingScanner
          onPaired={handlePaired}
          onCancel={() => setShowScanner(false)}
        />
      )}

      <div className="setup-header">
        <div className="setup-icon">📡</div>
        <h1>Net2appPro Gateway</h1>
        <p className="setup-subtitle">Turn your Android phone into an SMS supplier</p>
      </div>

      <div className="setup-card">
        <h2>Quick Pairing</h2>
        <button
          className="btn btn-qr"
          onClick={() => setShowScanner(true)}
        >
          📷 Scan Pairing QR
        </button>
        <span className="form-hint">
          Fastest way: scan the pairing QR shown in the NET2APP Hub (Suppliers → Android device → Pairing QR).
          Server, username, password and mode are filled automatically — no typing.
        </span>

        {pairBanner && <div className="test-result success">{pairBanner}</div>}

        <h2 style={{ marginTop: 20 }}>Manual Setup (optional)</h2>

        <div className="form-group">
          <label>Server URL</label>
          <input
            type="url"
            placeholder="https://your-server.com or http://1.2.3.4:3001"
            value={form.serverUrl}
            onChange={e => handleChange('serverUrl', e.target.value)}
          />
          <span className="form-hint">Your Net2appPro server address</span>
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
            HTTP REST polls heartbeat every 5s · SMPP inbound binds as ESME transceiver
          </span>
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
