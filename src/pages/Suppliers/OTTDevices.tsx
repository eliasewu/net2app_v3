import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { Plus, Search, Smartphone, Trash2, RefreshCw, QrCode, Power, Shield, Globe, Server, CheckCircle, XCircle, Activity, Zap, Download, Key, Save, AlertTriangle } from 'lucide-react';
import { useData } from '../../store/DataContext';
import { Card } from '../../components/UI/Card';
import { Button } from '../../components/UI/Button';
import { Badge } from '../../components/UI/Badge';
import { Modal } from '../../components/UI/Modal';
import { Input, Select } from '../../components/UI/Input';
import { api } from '../../services/api';
import { OTTDevice } from '../../types';

const QRCodeDisplay: React.FC<{ qrData: string }> = ({ qrData }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvasRef.current && qrData) {
      QRCode.toCanvas(canvasRef.current, qrData, { width: 200, margin: 1 });
    }
  }, [qrData]);
  return <canvas ref={canvasRef} className="w-48 h-48" />;
};

export const OTTDevices: React.FC = () => {
  const { ottDevices, suppliers, addOTTDevice, updateOTTDevice, deleteOTTDevice } = useData();
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [deleteModal, setDeleteModal] = useState<OTTDevice | null>(null);
  const [qrModal, setQrModal] = useState<any>(null);
  const [qrLoading, setQrLoading] = useState(false);

  // Proxy management state
  const [proxyPool, setProxyPool] = useState<string[]>([]);
  const [proxyTestResults, setProxyTestResults] = useState<Record<string, { testing: boolean; online?: boolean; exitIp?: string; error?: string }>>({});
  const [newProxyHost, setNewProxyHost] = useState('');
  const [newProxyPort, setNewProxyPort] = useState('3128');
  const [proxyAddLoading, setProxyAddLoading] = useState(false);
  const [showProxyPanel, setShowProxyPanel] = useState(false);
  const [showTelegramCreds, setShowTelegramCreds] = useState(false);

  // Telegram API credentials
  const [tgApiId, setTgApiId] = useState('');
  const [tgApiHash, setTgApiHash] = useState('');
  const [tgCredsSaving, setTgCredsSaving] = useState(false);
  const [tgCredsLoaded, setTgCredsLoaded] = useState(false);

  const [formData, setFormData] = useState({
    device_name: '',
    device_type: 'whatsapp' as 'whatsapp' | 'telegram',
    phone_number: '',
    supplier_id: '',
    proxy_node: '',
    api_id: '',
    api_hash: '',
  });

  const filteredDevices = ottDevices.filter(device =>
    device.device_name.toLowerCase().includes(search.toLowerCase()) ||
    device.phone_number.includes(search)
  );

  const ottSuppliers = suppliers.filter(s => 
    ['ott_whatsapp', 'ott_telegram'].includes(s.connection_type)
  );

  // Fetch proxy pool on mount
  useEffect(() => {
    fetchProxyPool();
    fetchTelegramCreds();
  }, []);

  const fetchProxyPool = async () => {
    try {
      const res = await api.get<any>('/ott/proxy/status');
      setProxyPool((res as any).data?.data?.pool || []);
    } catch {}
  };

  const handleTestProxy = async (host: string) => {
    const nodeKey = host.split(':')[0];
    setProxyTestResults(prev => ({ ...prev, [nodeKey]: { testing: true } }));
    try {
      const port = host.includes(':') ? parseInt(host.split(':')[1]) : 3128;
      const res = await api.post<any>('/ott/proxy/test', { host: nodeKey, port });
      const data = (res as any).data?.data;
      setProxyTestResults(prev => ({
        ...prev,
        [nodeKey]: { testing: false, online: data?.success || false, exitIp: data?.exitIp, error: data?.error }
      }));
    } catch {
      setProxyTestResults(prev => ({ ...prev, [nodeKey]: { testing: false, online: false, error: 'Test failed' } }));
    }
  };

  const handleAddProxy = async () => {
    if (!newProxyHost.trim()) return;
    setProxyAddLoading(true);
    try {
      const res = await api.post<any>('/ott/proxy/add', { host: newProxyHost.trim(), port: parseInt(newProxyPort) || 3128 });
      setProxyPool((res as any).data?.data?.pool || []);
      setNewProxyHost('');
      // Auto-test after adding
      handleTestProxy(newProxyHost.trim());
    } catch {}
    setProxyAddLoading(false);
  };

  const handleRemoveProxy = async (host: string) => {
    const nodeKey = host.split(':')[0];
    try {
      const res = await api.delete<any>('/ott/proxy/remove', { host: nodeKey });
      setProxyPool((res as any).data?.data?.pool || []);
      setProxyTestResults(prev => { const n = { ...prev }; delete n[nodeKey]; return n; });
    } catch {}
  };

  // Telegram API credentials
  const fetchTelegramCreds = async () => {
    try {
      const res = await api.get<any>('/platform-settings');
      const settings = (res as any).data?.data || {};
      if (settings.telegram_api_id) setTgApiId(settings.telegram_api_id);
      if (settings.telegram_api_hash) setTgApiHash(settings.telegram_api_hash);
      setTgCredsLoaded(true);
    } catch {}
  };

  const saveTelegramCreds = async () => {
    if (!tgApiId.trim() || !tgApiHash.trim()) return;
    setTgCredsSaving(true);
    try {
      await api.put('/platform-settings', {
        telegram_api_id: tgApiId.trim(),
        telegram_api_hash: tgApiHash.trim(),
      });
      alert('✅ Telegram API credentials saved! Restart the server or pair a new device for changes to take effect.');
    } catch (e: any) {
      alert('❌ Failed: ' + (e.message || 'Unknown error'));
    }
    setTgCredsSaving(false);
  };

  const handleCreate = () => {
    addOTTDevice({
      ...formData,
      api_id: formData.api_id ? parseInt(formData.api_id) : null,
      session_status: 'disconnected',
      qr_code: null,
      last_active: null,
    });
    setShowModal(false);
    setFormData({ device_name: '', device_type: 'whatsapp', phone_number: '', supplier_id: '', proxy_node: '', api_id: '', api_hash: '' });
  };

  const handleDelete = () => {
    if (deleteModal) {
      deleteOTTDevice(deleteModal.id);
      setDeleteModal(null);
    }
  };

  const handleDisconnect = async (device: OTTDevice) => {
    try {
      await api.post(`/ott/devices/${device.id}/disconnect`);
      updateOTTDevice(device.id, { session_status: 'disconnected', qr_code: null, pairing_token: null });
    } catch (e: any) {
      console.error('Disconnect failed:', e);
    }
  };

  const handleGenerateQR = async (device: OTTDevice) => {
    setQrLoading(true);
    try {
      const res = await api.get<any>(`/ott/devices/${device.id}/qr`);
      const data = (res as any).data?.data || (res as any).data;
      setQrModal({
        ...device,
        qr_code: data?.qr || device.qr_code,
        qr_image: data?.qr_image || null,
        pairing_token: data?.pairing_token,
        instructions: data?.instructions,
        device_type: data?.device_type || device.device_type,
        proxy_node: data?.proxy_node || device.proxy_node,
      });
    } catch (e: any) {
      setQrModal(device);
    }
    setQrLoading(false);
  };

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { variant: 'success' | 'warning' | 'danger' | 'default'; label: string }> = {
      connected: { variant: 'success', label: 'Connected' },
      disconnected: { variant: 'default', label: 'Disconnected' },
      qr_pending: { variant: 'warning', label: 'QR Pending' },
      error: { variant: 'danger', label: 'Error' },
      logged_out: { variant: 'danger', label: 'Logged Out' },
    };
    const config = statusMap[status] || { variant: 'default' as const, label: status };
    return <Badge variant={config.variant} dot>{config.label}</Badge>;
  };

  const proxyOnlineCount = Object.values(proxyTestResults).filter(r => r.online).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">OTT Device Pairing</h1>
          <p className="text-gray-500 mt-1">Manage WhatsApp and Telegram device connections</p>
        </div>
        <Button icon={<Plus size={18} />} onClick={() => setShowModal(true)}>
          Add Device
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-sm text-gray-500">Total Devices</p>
          <p className="text-2xl font-bold text-gray-800 mt-1">{ottDevices.length}</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-sm text-gray-500">Connected</p>
          <p className="text-2xl font-bold text-green-600 mt-1">
            {ottDevices.filter(d => d.session_status === 'connected').length}
          </p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-sm text-gray-500">WhatsApp</p>
          <p className="text-2xl font-bold text-green-600 mt-1">
            {ottDevices.filter(d => d.device_type === 'whatsapp').length}
          </p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-sm text-gray-500">Telegram</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">
            {ottDevices.filter(d => d.device_type === 'telegram').length}
          </p>
        </div>
      </div>

      {/* Proxy Pool Panel */}
      <Card>
        <div
          className="flex items-center justify-between cursor-pointer select-none"
          onClick={() => setShowProxyPanel(!showProxyPanel)}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-100">
              <Server size={20} className="text-indigo-600" />
            </div>
            <div>
              <p className="font-semibold text-gray-800">Tailscale + 3proxy Residential Proxy</p>
              <p className="text-sm text-gray-500">
                {proxyPool.length === 0
                  ? 'No proxy nodes configured'
                  : `${proxyPool.length} node${proxyPool.length > 1 ? 's' : ''} · ${proxyOnlineCount} online`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {proxyPool.length > 0 && proxyOnlineCount > 0 && (
              <Badge variant="success" dot>Active</Badge>
            )}
            {proxyPool.length > 0 && proxyOnlineCount === 0 && (
              <Badge variant="warning" dot>Offline</Badge>
            )}
            <span className="text-xs text-gray-400">{showProxyPanel ? '▲' : '▼'}</span>
          </div>
        </div>

        {showProxyPanel && (
          <div className="mt-4 space-y-4 border-t border-gray-100 pt-4">
            {/* Add new proxy */}
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  placeholder="Tailscale IP (100.x.x.x)"
                  value={newProxyHost}
                  onChange={(e) => setNewProxyHost(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddProxy()}
                />
              </div>
              <div className="w-24">
                <Input
                  placeholder="3128"
                  value={newProxyPort}
                  onChange={(e) => setNewProxyPort(e.target.value)}
                />
              </div>
              <Button
                variant="primary"
                icon={<Plus size={16} />}
                onClick={handleAddProxy}
                loading={proxyAddLoading}
              >
                Add
              </Button>
            </div>

            {/* Proxy node list */}
            {proxyPool.map(node => {
              const hostKey = node.split(':')[0];
              const testResult = proxyTestResults[hostKey];
              return (
                <div
                  key={node}
                  className="flex items-center justify-between p-3 bg-gray-50 rounded-lg border border-gray-200 hover:border-indigo-200 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${
                      testResult?.testing ? 'bg-yellow-400 animate-pulse' :
                      testResult?.online ? 'bg-green-500' :
                      testResult?.online === false ? 'bg-red-500' : 'bg-gray-300'
                    }`} />
                    <div>
                      <p className="font-mono text-sm font-medium text-gray-800">{node}</p>
                      {testResult?.online && testResult.exitIp && (
                        <p className="text-xs text-green-600 flex items-center gap-1">
                          <CheckCircle size={10} /> Exit IP: {testResult.exitIp}
                        </p>
                      )}
                      {testResult?.online === false && testResult.error && (
                        <p className="text-xs text-red-500 flex items-center gap-1">
                          <XCircle size={10} /> {testResult.error}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Activity size={14} />}
                      onClick={() => handleTestProxy(node)}
                      loading={testResult?.testing}
                    >
                      Test
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Trash2 size={14} />}
                      onClick={() => handleRemoveProxy(node)}
                      className="text-red-500 hover:text-red-700"
                    />
                  </div>
                </div>
              );
            })}

            {proxyPool.length === 0 && (
              <p className="text-sm text-gray-400 text-center py-4">
                No proxy nodes configured. Add a Tailscale IP to route OTT traffic through residential proxies with 3proxy.
              </p>
            )}

            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-400 flex items-center gap-1">
                <Zap size={10} />
                Devices with no proxy assigned will auto-distribute across available nodes
              </p>
              <a
                href="/api/ott/proxy/setup-script"
                download="setup-tailscale-3proxy.sh"
                className="inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-800 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-lg transition-colors"
              >
                <Download size={12} />
                Download Setup Script
              </a>
            </div>
          </div>
        )}
      </Card>

      {/* Telegram API Credentials */}
      <Card>
        <div
          className="flex items-center justify-between cursor-pointer select-none"
          onClick={() => setShowTelegramCreds(!showTelegramCreds)}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-100">
              <Key size={20} className="text-blue-600" />
            </div>
            <div>
              <p className="font-semibold text-gray-800">Telegram API Credentials</p>
              <p className="text-sm text-gray-500">
                {tgApiId && tgApiHash
                  ? `Configured (api_id: ${tgApiId.substring(0, 6)}...)`
                  : 'Not configured — QR codes will NOT scan!'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {tgApiId && tgApiHash ? (
              <Badge variant="success" dot>Set</Badge>
            ) : (
              <Badge variant="danger" dot>Missing</Badge>
            )}
            <span className="text-xs text-gray-400">{showTelegramCreds ? '▲' : '▼'}</span>
          </div>
        </div>

        {showTelegramCreds && (
          <div className="mt-4 space-y-4 border-t border-gray-100 pt-4">
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 flex items-start gap-2">
              <AlertTriangle size={16} className="text-yellow-600 mt-0.5 shrink-0" />
              <p className="text-sm text-yellow-800">
                Get your real credentials at <a href="https://my.telegram.org/apps" target="_blank" className="underline font-medium">my.telegram.org/apps</a>.
                Without real credentials, QR codes will be rejected by the Telegram app.
              </p>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">API ID</label>
                <input
                  type="text"
                  value={tgApiId}
                  onChange={(e) => setTgApiId(e.target.value)}
                  placeholder="e.g. 12345678"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">API Hash</label>
                <input
                  type="text"
                  value={tgApiHash}
                  onChange={(e) => setTgApiHash(e.target.value)}
                  placeholder="e.g. a1b2c3d4e5f6..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
                />
              </div>
            </div>

            <div className="flex justify-between items-center">
              <p className="text-xs text-gray-400">
                Credentials are stored in platform settings and loaded on server restart
              </p>
              <Button
                icon={<Save size={16} />}
                onClick={saveTelegramCreds}
                loading={tgCredsSaving}
                disabled={!tgApiId.trim() || !tgApiHash.trim()}
              >
                Save Credentials
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Search */}
      <Card>
        <div className="relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search devices..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </Card>

      {/* Devices Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredDevices.map(device => {
          const proxyOnline = device.proxy_node
            ? proxyTestResults[device.proxy_node.split(':')[0]]?.online
            : undefined;

          return (
            <Card key={device.id} className="hover:shadow-md transition-shadow">
              <div className="space-y-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`p-3 rounded-xl ${device.device_type === 'whatsapp' ? 'bg-green-100' : 'bg-blue-100'}`}>
                      <Smartphone size={24} className={device.device_type === 'whatsapp' ? 'text-green-600' : 'text-blue-600'} />
                    </div>
                    <div>
                      <p className="font-semibold text-gray-800">{device.device_name}</p>
                      <p className="text-sm text-gray-500">{device.phone_number}</p>
                    </div>
                  </div>
                  {getStatusBadge(device.session_status)}
                </div>

                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500">Type:</span>
                    <span className="font-medium text-gray-700 capitalize">{device.device_type}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Proxy:</span>
                    <span className="font-medium text-gray-700 flex items-center gap-1.5">
                      {device.proxy_node ? (
                        <>
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            proxyOnline === true ? 'bg-green-500' :
                            proxyOnline === false ? 'bg-red-500' : 'bg-gray-300'
                          }`} />
                          {device.proxy_node}
                        </>
                      ) : (
                        <span className="text-gray-400">Auto (pool)</span>
                      )}
                    </span>
                  </div>
                  {/* Rate limit usage */}
                  {(device as any).monthly_limit > 0 && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Monthly:</span>
                      <span className={`font-medium font-mono text-xs ${
                        ((device as any).monthly_sent || 0) >= (device as any).monthly_limit ? 'text-red-600' :
                        ((device as any).monthly_sent || 0) > (device as any).monthly_limit * 0.8 ? 'text-yellow-600' :
                        'text-gray-700'
                      }`}>
                        {(device as any).monthly_sent || 0}/{(device as any).monthly_limit}
                        {((device as any).monthly_sent || 0) >= (device as any).monthly_limit && ' ⚠️'}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-gray-500">Last Active:</span>
                    <span className="font-medium text-gray-700">
                      {device.last_active ? new Date(device.last_active).toLocaleString() : 'Never'}
                    </span>
                  </div>
                </div>

                <div className="flex gap-2">
                  {device.session_status === 'qr_pending' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<QrCode size={16} />}
                      className="flex-1"
                      onClick={() => handleGenerateQR(device)}
                      loading={qrLoading}
                    >
                      Show QR
                    </Button>
                  )}
                  {device.session_status === 'connected' ? (
                    <Button
                      size="sm"
                      variant="danger"
                      icon={<Power size={16} />}
                      className="flex-1"
                      onClick={() => handleDisconnect(device)}
                    >
                      Disconnect
                    </Button>
                  ) : device.session_status !== 'qr_pending' && (
                    <Button
                      size="sm"
                      variant="success"
                      icon={<RefreshCw size={16} />}
                      className="flex-1"
                      onClick={() => handleGenerateQR(device)}
                    >
                      Pair
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    icon={<Trash2 size={16} />}
                    onClick={() => setDeleteModal(device)}
                  />
                </div>
              </div>
            </Card>
          );
        })}

        {filteredDevices.length === 0 && (
          <div className="col-span-full text-center py-12 bg-white rounded-xl border border-gray-200">
            <Smartphone size={48} className="mx-auto text-gray-300 mb-4" />
            <p className="text-gray-600">No devices found</p>
            <p className="text-sm text-gray-400 mt-1">Add a new device to get started</p>
          </div>
        )}
      </div>

      {/* Add Device Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title="Add OTT Device"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={handleCreate}>Add Device</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input
            label="Device Name"
            value={formData.device_name}
            onChange={(e) => setFormData(prev => ({ ...prev, device_name: e.target.value }))}
            placeholder="WhatsApp Device 1"
            required
          />
          <Select
            label="Device Type"
            value={formData.device_type}
            onChange={(e) => setFormData(prev => ({ ...prev, device_type: e.target.value as 'whatsapp' | 'telegram' }))}
            options={[
              { value: 'whatsapp', label: 'WhatsApp' },
              { value: 'telegram', label: 'Telegram' },
            ]}
          />
          <Input
            label="Phone Number"
            value={formData.phone_number}
            onChange={(e) => setFormData(prev => ({ ...prev, phone_number: e.target.value }))}
            placeholder="+1234567890"
            required
          />
          <Select
            label="Proxy Node"
            value={formData.proxy_node}
            onChange={(e) => setFormData(prev => ({ ...prev, proxy_node: e.target.value }))}
            options={[
              { value: '', label: 'Auto-assign (from pool)' },
              ...proxyPool.map(p => ({ value: p.split(':')[0], label: p })),
            ]}
            hint="Residential proxy via Tailscale + 3proxy. SOCKS5 on port 3128."
          />
          {formData.device_type === 'telegram' && (
            <>
              <Input
                label="Telegram API ID (per-device)"
                value={formData.api_id}
                onChange={(e) => setFormData(prev => ({ ...prev, api_id: e.target.value }))}
                placeholder="From my.telegram.org/apps"
                type="number"
                hint="Leave blank to use global default"
              />
              <Input
                label="Telegram API Hash (per-device)"
                value={formData.api_hash}
                onChange={(e) => setFormData(prev => ({ ...prev, api_hash: e.target.value }))}
                placeholder="From my.telegram.org/apps"
                hint="Leave blank to use global default"
              />
            </>
          )}
          <Select
            label="Supplier"
            value={formData.supplier_id}
            onChange={(e) => setFormData(prev => ({ ...prev, supplier_id: e.target.value }))}
            options={[
              { value: '', label: 'Select Supplier' },
              ...ottSuppliers.map(s => ({ value: s.id, label: `${s.supplier_code} - ${s.company_name}` }))
            ]}
            required
          />
        </div>
      </Modal>

      {/* QR Code Modal */}
      <Modal
        isOpen={!!qrModal}
        onClose={() => setQrModal(null)}
        title={`Pair ${qrModal?.device_type === 'whatsapp' ? 'WhatsApp' : 'Telegram'} Device`}
        size="md"
      >
        {qrModal && (
          <div className="text-center space-y-4">
            {qrModal.device_type === 'whatsapp' && (
              <div className="bg-white p-6 rounded-xl border-2 border-dashed border-green-300 inline-block">
                {qrModal.qr_code ? (
                  <QRCodeDisplay qrData={qrModal.qr_code} />
                ) : (
                  <div className="w-56 h-56 bg-gray-100 rounded-lg flex items-center justify-center">
                    <RefreshCw size={40} className="animate-spin text-green-500" />
                  </div>
                )}
              </div>
            )}
            {qrModal.device_type === 'telegram' && (
              <div className="space-y-4">
                <div className="bg-white p-6 rounded-xl border-2 border-dashed border-blue-300 inline-block">
                  {qrModal.qr_image ? (
                    <img
                      src={qrModal.qr_image}
                      alt="Telegram QR"
                      className="w-56 h-56 object-contain"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : qrModal.qr_code && qrModal.qr_code.startsWith('tg://') ? (
                    <QRCodeDisplay qrData={qrModal.qr_code} />
                  ) : (
                    <div className="w-56 h-56 bg-gray-100 rounded-lg flex items-center justify-center">
                      <RefreshCw size={40} className="animate-spin text-blue-500" />
                    </div>
                  )}
                </div>
                {qrModal.pairing_token && (
                  <div className="bg-blue-50 p-4 rounded-xl border border-blue-200">
                    <div className="flex items-center justify-center gap-2 mb-2">
                      <Shield size={18} className="text-blue-500" />
                      <p className="text-sm font-medium text-blue-800">Or use pairing token</p>
                    </div>
                    <code className="block p-3 bg-white rounded-lg text-xs text-blue-700 break-all font-mono text-center">
                      {qrModal.pairing_token}
                    </code>
                  </div>
                )}
              </div>
            )}
            <p className="text-sm text-gray-600">
              {qrModal.instructions || `Open ${qrModal.device_type === 'whatsapp' ? 'WhatsApp' : 'Telegram'} and follow the pairing instructions.`}
            </p>

            {/* Proxy info in QR modal */}
            <div className="bg-gray-50 rounded-xl p-4 border border-gray-200 text-left">
              <p className="text-xs font-semibold text-gray-500 uppercase mb-2 flex items-center gap-1.5">
                <Globe size={12} /> Proxy Configuration
              </p>
              {qrModal.proxy_node ? (
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-700 font-mono">{qrModal.proxy_node}</span>
                  {proxyTestResults[qrModal.proxy_node.split(':')[0]]?.online ? (
                    <Badge variant="success" dot>Online</Badge>
                  ) : (
                    <Badge variant="warning" dot>Unknown</Badge>
                  )}
                </div>
              ) : (
                <p className="text-sm text-gray-500">
                  {proxyPool.length > 0
                    ? `Auto-assigned from pool (${proxyPool.length} node${proxyPool.length > 1 ? 's' : ''})`
                    : 'No proxy configured — traffic goes direct'}
                </p>
              )}
            </div>

            <div className="flex gap-3 justify-center">
              <Button variant="secondary" onClick={() => setQrModal(null)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete Modal */}
      <Modal
        isOpen={!!deleteModal}
        onClose={() => setDeleteModal(null)}
        title="Delete Device"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setDeleteModal(null)}>Cancel</Button>
            <Button variant="danger" onClick={handleDelete}>Delete Device</Button>
          </div>
        }
      >
        <p className="text-gray-600">
          Are you sure you want to delete <strong>{deleteModal?.device_name}</strong>?
          This will disconnect the device and remove all associated data.
        </p>
      </Modal>
    </div>
  );
};
