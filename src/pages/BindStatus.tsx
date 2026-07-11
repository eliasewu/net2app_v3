import React, { useState, useEffect, useCallback } from 'react';
import { Wifi, WifiOff, RefreshCw, AlertTriangle, Clock } from 'lucide-react';
import { bindApi } from '../services/api';
import { Card } from '../components/UI/Card';
import { Button } from '../components/UI/Button';
import { Badge } from '../components/UI/Badge';

interface ClientBindInfo {
  id: string;
  client_code: string;
  company_name: string;
  smpp_username: string;
  smpp_ip: string;
  smpp_port: number;
  system_type: string;
  max_tps: number;
  routing_plan_id: string | null;
  client_status: string;
  session_system_id: string | null;
  connected_at: string | null;
  session_ip: string | null;
  remote_ip: string | null;
  bind_mode: string | null;
  session_status: string | null;
  negotiated_version: string | null;
  last_activity: string | null;
  smpp_session_id: string | null;
  bound_count: number;
  last_error: string | null;
  last_error_at: string | null;
  bind_status: 'bound' | 'unbound' | 'connecting';
}

interface SupplierBindInfo {
  id: string;
  supplier_code: string;
  company_name: string;
  bind_status: string;
  consecutive_failures: number;
  smpp_host: string;
  smpp_port: number;
  smpp_username: string;
  connection_type: string;
  supplier_status: string;
  session_system_id: string | null;
  connected_at: string | null;
  ip_address: string | null;
  session_status: string | null;
  bind_mode: string | null;
  session_state: 'connected' | 'disconnected';
}

interface BindHistoryEntry {
  id: number;
  entity_type: string;
  entity_id: number;
  entity_code: string | null;
  entity_name: string | null;
  system_id: string;
  ip_address: string | null;
  port: number;
  bind_mode: string;
  status: string;
  negotiated_version: string | null;
  smpp_session_id: string | null;
  created_at: string;
}

export const BindStatus: React.FC = () => {
  const [clients, setClients] = useState<ClientBindInfo[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierBindInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [bindingId, setBindingId] = useState<string | null>(null);
  const [history, setHistory] = useState<BindHistoryEntry[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(0);
  const [historyFilter, setHistoryFilter] = useState<{ entity_type?: string; status?: string; include_deleted?: boolean }>({});
  const [showDeletedSuppliers, setShowDeletedSuppliers] = useState(false);
  const PAGE_SIZE = 20;

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const [clientRes, supplierRes] = await Promise.all([
        bindApi.getClientStatus(),
        bindApi.getStatus(showDeletedSuppliers),
      ]);
      if (clientRes.success && (clientRes.data as any)?.data) {
        setClients((clientRes.data as any).data);
      }
      if (supplierRes.success && (supplierRes.data as any)?.data) {
        setSuppliers((supplierRes.data as any).data);
      }
      setLastRefresh(new Date());
    } catch (e: any) {
      setError(e?.message || 'Failed to fetch bind status');
    } finally {
      setLoading(false);
    }
  }, [showDeletedSuppliers]);

  const fetchHistory = useCallback(async (page: number, filters: typeof historyFilter) => {
    try {
      const res = await bindApi.getHistory({
        ...filters,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      });
      if (res.success && (res.data as any)?.data) {
        setHistory((res.data as any).data);
        setHistoryTotal((res.data as any).total || 0);
      }
    } catch (e) {
      console.error('Failed to fetch history:', e);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    fetchHistory(historyPage, historyFilter);
  }, [historyPage, historyFilter, fetchHistory]);

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(fetchData, 30000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchData]);

  const handleBind = async (type: 'client' | 'supplier', entityId: string) => {
    setBindingId(`${type}-${entityId}`);
    try {
      if (type === 'client') await bindApi.bindClient(entityId);
      else await bindApi.bindSupplier(entityId);
      await fetchData();
    } catch (e: any) {
      console.error('Bind failed:', e);
    } finally {
      setBindingId(null);
    }
  };

  const handleUnbind = async (type: 'client' | 'supplier', entityId: string) => {
    setBindingId(`${type}-${entityId}`);
    try {
      if (type === 'client') await bindApi.unbindClient(entityId);
      else await bindApi.unbindSupplier(entityId);
      await fetchData();
    } catch (e: any) {
      console.error('Unbind failed:', e);
    } finally {
      setBindingId(null);
    }
  };

  // Stats
  const clientStats = {
    total: clients.length,
    bound: clients.filter(c => c.bind_status === 'bound').length,
    unbound: clients.filter(c => c.bind_status === 'unbound').length,
    connecting: clients.filter(c => c.bind_status === 'connecting').length,
    active: clients.filter(c => c.client_status === 'active').length,
  };

  const supplierStats = {
    total: suppliers.length,
    bound: suppliers.filter(s => s.session_state === 'connected').length,
    unbound: suppliers.filter(s => s.session_state !== 'connected').length,
    error: suppliers.filter(s => s.bind_status === 'error').length,
    blocked: suppliers.filter(s => s.consecutive_failures >= 20).length,
  };

  const smppSuppliers = suppliers.filter(s => ['smpp', 'http'].includes(s.connection_type));
  const ottSuppliers = suppliers.filter(s => ['ott_whatsapp', 'ott_telegram'].includes(s.connection_type));

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'bound': return <Wifi size={18} className="text-green-500" />;
      case 'connected': return <Wifi size={18} className="text-green-500" />;
      case 'unbound': return <WifiOff size={18} className="text-red-400" />;
      case 'disconnected': return <WifiOff size={18} className="text-red-400" />;
      case 'connecting': return <Clock size={18} className="text-yellow-500 animate-pulse" />;
      case 'error': return <AlertTriangle size={18} className="text-red-500" />;
      default: return <WifiOff size={18} className="text-red-400" />;
    }
  };

  const getStatusBadge = (status: string, failures?: number) => {
    if (failures !== undefined && failures >= 20) {
      return <Badge variant="danger" dot>BLOCKED</Badge>;
    }
    const variants: Record<string, 'success' | 'warning' | 'danger' | 'default'> = {
      bound: 'success', unbound: 'danger', connecting: 'warning', error: 'danger',
      connected: 'success', disconnected: 'danger',
    };
    return <Badge variant={variants[status] || 'danger'} dot size="sm">{status.toUpperCase()}</Badge>;
  };

  const formatTime = (ts: string | null) => {
    if (!ts) return '—';
    return new Date(ts).toLocaleString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <RefreshCw size={24} className="animate-spin text-gray-400" />
        <span className="ml-3 text-gray-500">Loading bind status...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Bind Status</h1>
          <p className="text-gray-500 mt-1">Real-time Client (ESME) and Supplier (SMSC) SMPP connection status</p>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-blue-600" />
            <span className="text-sm text-gray-600">Auto-refresh</span>
          </label>
          <span className="text-sm text-gray-500">Updated: {lastRefresh.toLocaleTimeString()}</span>
          <Button variant="secondary" icon={<RefreshCw size={16} />} onClick={fetchData}>Refresh</Button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
          {error}. <button onClick={fetchData} className="underline">Try again</button>
        </div>
      )}

      {/* Combined Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <div className="bg-white rounded-xl p-3 border text-center">
          <p className="text-xs text-gray-500">Total Clients</p>
          <p className="text-xl font-bold text-gray-800">{clientStats.total}</p>
          <p className="text-[10px] text-gray-400">{clientStats.active} active</p>
        </div>
        <div className="bg-white rounded-xl p-3 border text-center">
          <p className="text-xs text-gray-500">ESME Bound</p>
          <p className="text-xl font-bold text-green-600">{clientStats.bound}</p>
          <p className="text-[10px] text-gray-400">{clientStats.unbound} unbound</p>
        </div>
        <div className="bg-white rounded-xl p-3 border text-center">
          <p className="text-xs text-gray-500">Total Suppliers</p>
          <p className="text-xl font-bold text-gray-800">{supplierStats.total}</p>
        </div>
        <div className="bg-white rounded-xl p-3 border text-center">
          <p className="text-xs text-gray-500">SMSC Bound</p>
          <p className="text-xl font-bold text-green-600">{supplierStats.bound}</p>
          <p className="text-[10px] text-gray-400">{supplierStats.unbound} unbound</p>
        </div>
        <div className="bg-white rounded-xl p-3 border text-center">
          <p className="text-xs text-gray-500">Errors</p>
          <p className="text-xl font-bold text-red-600">{supplierStats.error}</p>
        </div>
        <div className="bg-white rounded-xl p-3 border text-center">
          <p className="text-xs text-gray-500">Blocked</p>
          <p className="text-xl font-bold text-orange-600">{supplierStats.blocked}</p>
        </div>
        <div className="bg-white rounded-xl p-3 border text-center">
          <p className="text-xs text-gray-500">SMPP</p>
          <p className="text-xl font-bold text-blue-600">{smppSuppliers.length}</p>
        </div>
        <div className="bg-white rounded-xl p-3 border text-center">
          <p className="text-xs text-gray-500">OTT</p>
          <p className="text-xl font-bold text-purple-600">{ottSuppliers.length}</p>
        </div>
      </div>

      {/* ESME: Client Bind Status */}
      <Card title={`ESME — Client SMPP Connections (${clients.length})`} subtitle="Real session data from smpp_sessions table. Green = bound, Red = no active session">
        {clients.length === 0 ? (
          <p className="text-gray-500 text-sm py-4">No clients with SMPP credentials configured.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {clients.map(client => (
              <div key={client.id}
                className={`p-4 rounded-xl border-2 transition-all ${
                  client.bind_status === 'bound' ? 'border-green-200 bg-green-50' :
                  client.bind_status === 'connecting' ? 'border-yellow-200 bg-yellow-50' :
                  'border-red-200 bg-red-50'
                }`}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm ${client.client_status === 'active' ? 'bg-gradient-to-br from-blue-500 to-indigo-600' : 'bg-gray-400'}`}>
                      {client.company_name.charAt(0)}
                    </div>
                    <div>
                      <p className="font-semibold text-gray-800 text-sm">{client.client_code}</p>
                      <p className="text-xs text-gray-600">{client.company_name}</p>
                    </div>
                  </div>
                  {getStatusBadge(client.bind_status)}
                </div>
                <div className="mt-3 space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-500">SMPP Username:</span>
                    <span className="font-mono text-gray-700">{client.smpp_username || 'N/A'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">IP Allowed:</span>
                    <span className="font-mono text-gray-700">{client.smpp_ip || 'Any'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Session System ID:</span>
                    <span className="font-mono text-gray-700">{client.session_system_id || '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Session IP:</span>
                    <span className="font-mono text-gray-700">{client.remote_ip || client.session_ip || '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Bind Mode:</span>
                    <span className="font-mono text-gray-700">{client.bind_mode || '—'}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Connected At:</span>
                    <span className="text-gray-700">{formatTime(client.connected_at)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Last Activity:</span>
                    <span className="text-gray-700">{formatTime(client.last_activity)}</span>
                  </div>
                  {client.last_error && (
                    <div className="flex justify-between">
                      <span className="text-gray-500">Last Error:</span>
                      <span className="text-red-600 truncate max-w-[150px]" title={client.last_error}>{client.last_error}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-gray-500">Max TPS:</span>
                    <span className="font-medium text-gray-700">{client.max_tps}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Route Plan:</span>
                    <span className={`font-medium ${client.routing_plan_id ? 'text-green-600' : 'text-red-600'}`}>
                      {client.routing_plan_id ? 'Assigned' : 'None'}
                    </span>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  {client.bind_status === 'bound' ? (
                    <Button size="sm" variant="danger" className="flex-1" onClick={() => handleUnbind('client', client.id)} disabled={bindingId === `client-${client.id}`}>
                      {bindingId === `client-${client.id}` ? '...' : 'Disconnect'}
                    </Button>
                  ) : (
                    <Button size="sm" variant="success" className="flex-1" onClick={() => handleBind('client', client.id)} disabled={bindingId === `client-${client.id}` || !client.smpp_username}>
                      {bindingId === `client-${client.id}` ? '...' : 'Connect'}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* SMSC: Supplier SMPP Bind Status */}
      <Card title={`SMSC — Supplier SMPP / HTTP Connections (${smppSuppliers.length})`} subtitle="Real session data with supplier bind status">
        <div className="flex items-center justify-between mb-4">
          <label className="flex items-center gap-2 px-3 py-1.5 border border-gray-300 rounded-lg text-sm cursor-pointer hover:bg-gray-50">
            <input
              type="checkbox"
              checked={showDeletedSuppliers}
              onChange={e => setShowDeletedSuppliers(e.target.checked)}
              className="rounded"
            />
            <span className={showDeletedSuppliers ? 'text-red-600 font-medium' : 'text-gray-600'}>Show Deleted</span>
          </label>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {smppSuppliers.map(supplier => {
            const isConnected = supplier.session_state === 'connected';
            const isBlocked = supplier.consecutive_failures >= 20;
            return (
              <div key={supplier.id}
                className={`p-4 rounded-xl border-2 transition-all ${
                  isConnected ? 'border-green-200 bg-green-50' :
                  isBlocked ? 'border-orange-200 bg-orange-50' :
                  supplier.bind_status === 'error' ? 'border-red-200 bg-red-50' :
                  'border-red-200 bg-red-50'
                }`}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    {getStatusIcon(isConnected ? 'connected' : 'disconnected')}
                    <div>
                      <p className="font-semibold text-gray-800 text-sm">{supplier.supplier_code}</p>
                      <p className="text-xs text-gray-600">{supplier.company_name}</p>
                    </div>
                  </div>
                  {getStatusBadge(isBlocked ? 'error' : isConnected ? 'connected' : 'disconnected', supplier.consecutive_failures)}
                </div>
                <div className="mt-3 space-y-1.5 text-xs">
                  <div className="flex justify-between"><span className="text-gray-500">Type:</span><span className="font-medium text-gray-700">{supplier.connection_type.toUpperCase()}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Host:</span><span className="font-mono text-gray-700">{supplier.smpp_host || 'N/A'}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Port:</span><span className="font-mono text-gray-700">{supplier.smpp_port || 'N/A'}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">System ID:</span><span className="font-mono text-gray-700">{supplier.session_system_id || '—'}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Session IP:</span><span className="font-mono text-gray-700">{supplier.ip_address || '—'}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Bind Mode:</span><span className="font-mono text-gray-700">{supplier.bind_mode || '—'}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Connected At:</span><span className="text-gray-700">{formatTime(supplier.connected_at)}</span></div>
                  <div className="flex justify-between"><span className="text-gray-500">Failures:</span>
                    <span className={`font-medium ${supplier.consecutive_failures > 10 ? 'text-red-600' : supplier.consecutive_failures > 0 ? 'text-yellow-600' : 'text-green-600'}`}>{supplier.consecutive_failures}</span>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  {isConnected ? (
                    <Button size="sm" variant="danger" className="flex-1" onClick={() => handleUnbind('supplier', supplier.id)} disabled={bindingId === `supplier-${supplier.id}`}>
                      {bindingId === `supplier-${supplier.id}` ? '...' : 'Disconnect'}
                    </Button>
                  ) : (
                    <Button size="sm" variant="success" className="flex-1" onClick={() => handleBind('supplier', supplier.id)} disabled={bindingId === `supplier-${supplier.id}`}>
                      {bindingId === `supplier-${supplier.id}` ? '...' : 'Reconnect'}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* OTT Connections */}
      <Card title={`Supplier — OTT Connections (WhatsApp / Telegram) — ${ottSuppliers.length}`}>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {ottSuppliers.map(supplier => (
            <div key={supplier.id}
              className={`p-4 rounded-xl border-2 transition-all ${
                supplier.bind_status === 'bound' ? 'border-green-200 bg-green-50' :
                supplier.bind_status === 'error' ? 'border-red-200 bg-red-50' :
                'border-red-200 bg-red-50'
              }`}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${supplier.connection_type === 'ott_whatsapp' ? 'bg-green-500' : 'bg-blue-500'}`}>
                    <span className="text-white text-lg">{supplier.connection_type === 'ott_whatsapp' ? '📱' : '✈️'}</span>
                  </div>
                  <div>
                    <p className="font-semibold text-gray-800 text-sm">{supplier.supplier_code}</p>
                    <p className="text-xs text-gray-600">{supplier.company_name}</p>
                  </div>
                </div>
                {getStatusBadge(supplier.bind_status, supplier.consecutive_failures)}
              </div>
              <div className="mt-3 space-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-gray-500">Platform:</span><span className="font-medium text-gray-700">{supplier.connection_type === 'ott_whatsapp' ? 'WhatsApp' : 'Telegram'}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Status:</span><span className={`font-medium ${supplier.bind_status === 'bound' ? 'text-green-600' : 'text-red-600'}`}>{supplier.bind_status === 'bound' ? 'Connected' : 'Disconnected'}</span></div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Bind History Audit Trail */}
      <Card title={`Bind History — Audit Trail (${historyTotal} events)`} subtitle="Complete bind/unbind history for both clients (ESME) and suppliers (SMSC)">
        <div className="flex gap-3 mb-4">
          <select
            className="px-3 py-1.5 border rounded-lg text-sm"
            value={historyFilter.entity_type || ''}
            onChange={e => { setHistoryFilter(f => ({ ...f, entity_type: e.target.value || undefined })); setHistoryPage(0); }}
          >
            <option value="">All Types</option>
            <option value="client">Clients (ESME)</option>
            <option value="supplier">Suppliers (SMSC)</option>
          </select>
          <select
            className="px-3 py-1.5 border rounded-lg text-sm"
            value={historyFilter.status || ''}
            onChange={e => { setHistoryFilter(f => ({ ...f, status: e.target.value || undefined })); setHistoryPage(0); }}
          >
            <option value="">All Statuses</option>
            <option value="bound">Bound</option>
            <option value="unbound">Unbound</option>
            <option value="error">Error</option>
          </select>
          <label className="flex items-center gap-2 px-3 py-1.5 border border-gray-300 rounded-lg text-sm cursor-pointer hover:bg-gray-50">
            <input
              type="checkbox"
              checked={!!historyFilter.include_deleted}
              onChange={e => { setHistoryFilter(f => ({ ...f, include_deleted: e.target.checked })); setHistoryPage(0); }}
              className="rounded"
            />
            <span className={historyFilter.include_deleted ? 'text-red-600 font-medium' : 'text-gray-600'}>Show Deleted</span>
          </label>
        </div>
        {history.length === 0 ? (
          <p className="text-gray-500 text-sm py-4">No history records found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b">
                  <th className="pb-2 pr-3">Time</th>
                  <th className="pb-2 pr-3">Type</th>
                  <th className="pb-2 pr-3">Entity</th>
                  <th className="pb-2 pr-3">System ID</th>
                  <th className="pb-2 pr-3">IP</th>
                  <th className="pb-2 pr-3">Port</th>
                  <th className="pb-2 pr-3">Mode</th>
                  <th className="pb-2 pr-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {history.map(entry => (
                  <tr key={entry.id} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                    <td className="py-2 pr-3 text-gray-600 whitespace-nowrap font-mono text-xs">{formatTime(entry.created_at)}</td>
                    <td className="py-2 pr-3">
                      <Badge variant={entry.entity_type === 'client' ? 'default' : 'warning'} size="sm">{entry.entity_type.toUpperCase()}</Badge>
                    </td>
                    <td className="py-2 pr-3 font-medium text-gray-800">{entry.entity_code || `#${entry.entity_id}`}</td>
                    <td className="py-2 pr-3 font-mono text-xs text-gray-700">{entry.system_id}</td>
                    <td className="py-2 pr-3 font-mono text-xs text-gray-600">{entry.ip_address || '—'}</td>
                    <td className="py-2 pr-3 text-gray-600">{entry.port}</td>
                    <td className="py-2 pr-3 font-mono text-xs text-gray-600">{entry.bind_mode}</td>
                    <td className="py-2 pr-3">
                      {entry.status === 'bound' ? <Badge variant="success" size="sm" dot>BOUND</Badge> :
                       entry.status === 'unbound' ? <Badge variant="danger" size="sm">UNBOUND</Badge> :
                       entry.status === 'error' ? <Badge variant="danger" size="sm">ERROR</Badge> :
                       <span className="text-gray-600">{entry.status}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Pagination */}
            {historyTotal > PAGE_SIZE && (
              <div className="flex items-center justify-between mt-4">
                <span className="text-xs text-gray-500">Showing {historyPage * PAGE_SIZE + 1}–{Math.min((historyPage + 1) * PAGE_SIZE, historyTotal)} of {historyTotal}</span>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" disabled={historyPage === 0} onClick={() => setHistoryPage(p => p - 1)}>Previous</Button>
                  <Button size="sm" variant="secondary" disabled={(historyPage + 1) * PAGE_SIZE >= historyTotal} onClick={() => setHistoryPage(p => p + 1)}>Next</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Routing Flow Diagram */}
      <Card title="SMS Routing Flow">
        <div className="bg-gray-50 rounded-xl p-6">
          <div className="flex flex-wrap items-center justify-center gap-3 text-center">
            {[
              { emoji:'📱', label:'Client\nSMPP Bind', desc:'username/password\nIP whitelist' },
              { emoji:'✅', label:'Validation', desc:'Rate + Balance\n+ Credit Check' },
              { emoji:'🗺️', label:'Route Map', desc:'MCCMNC Pattern\nMatch' },
              { emoji:'🔀', label:'Route\nSelection', desc:'Priority / LCR\n/ Percentage' },
              { emoji:'🔗', label:'Trunk\nSelection', desc:'Supplier Bind\nStatus Check' },
              { emoji:'🏢', label:'Supplier\nGateway', desc:'SMPP/HTTP\n/OTT' },
              { emoji:'📩', label:'DLR\nCallback', desc:'Delivery\nReceipt' },
            ].map((step, i) => (
              <div key={i} className="flex flex-col items-center">
                <div className="bg-white p-3 rounded-lg shadow-sm border border-gray-200 min-w-[100px]">
                  <div className="text-xl mb-1">{step.emoji}</div>
                  <p className="text-xs font-medium text-gray-800 whitespace-pre-line">{step.label}</p>
                  <p className="text-[10px] text-gray-500 whitespace-pre-line">{step.desc}</p>
                </div>
                {i < 6 && <div className="text-lg text-gray-400 mt-1">↓</div>}
              </div>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
};
