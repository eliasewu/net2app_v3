import React, { useState, useEffect, useCallback } from 'react';
import { Wifi, WifiOff, RefreshCw, AlertTriangle, Clock, Search, LayoutGrid, LayoutList, Phone, PhoneOff, Radio } from 'lucide-react';
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
  is_inbound: boolean;
  smpp_mode: 'smsc_server' | 'esme_client';
  smpp_bind_type: string | null;
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
  const [asteriskStatus, setAsteriskStatus] = useState<{running:boolean;version:string;ami_connected:boolean;ami_users:number;sip_peers:number;sip_online:number;sip_offline:number;service_active:boolean}|null>(null);
  const [sipPeers, setSipPeers] = useState<{name:string;endpoint:string;aor:string;server_uri:string;contact_uri:string;status:string;rtt_ms:number|null;registered:boolean;registered_at:string|null;auth_name:string}[]>([]);
  const [sipLoading, setSipLoading] = useState(false);
  const [bindingId, setBindingId] = useState<string | null>(null);
  const [history, setHistory] = useState<BindHistoryEntry[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyPage, setHistoryPage] = useState(0);
  const [historyFilter, setHistoryFilter] = useState<{ entity_type?: string; status?: string; include_deleted?: boolean }>({});
  const [showDeletedSuppliers, setShowDeletedSuppliers] = useState(false);
  const [viewMode, setViewMode] = useState<'card' | 'table'>('card');
  const [searchQuery, setSearchQuery] = useState('');
  const PAGE_SIZE = 20;

  const fetchAsteriskStatus = async () => {
    try {
      const res = await bindApi.getAsteriskStatus();
      // res.data is the server payload { success, data: {...} } — unwrap to get the status object
      if (res.success && (res.data as any)?.data) setAsteriskStatus((res.data as any).data);
    } catch (e) { /* ignore */ }
  };

  const fetchSipPeers = async () => {
    setSipLoading(true);
    try {
      const res = await bindApi.getSipPeers();
      // res.data is the server payload { success, data: [...] } — unwrap to get the array
      const arr = (res.data as any)?.data;
      if (res.success && Array.isArray(arr)) setSipPeers(arr);
    } catch (e) { /* ignore */ }
    setSipLoading(false);
  };

  const fetchData = useCallback(async () => {
    try {
      setError(null);
      const [clientRes, supplierRes] = await Promise.all([
        bindApi.getClientStatus(),
        bindApi.getStatus(showDeletedSuppliers),
      ]);
      const clientArr = (clientRes.data as any)?.data;
      if (clientRes.success && Array.isArray(clientArr)) {
        setClients(clientArr);
      }
      const supplierArr = (supplierRes.data as any)?.data;
      if (supplierRes.success && Array.isArray(supplierArr)) {
        setSuppliers(supplierArr);
      }
      setLastRefresh(new Date());
      fetchAsteriskStatus();
      fetchSipPeers();
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
        const arr = (res.data as any).data;
        setHistory(Array.isArray(arr) ? arr : []);
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
    inbound: suppliers.filter(s => s.is_inbound).length,
    error: suppliers.filter(s => s.consecutive_failures >= 5).length,
    blocked: suppliers.filter(s => s.consecutive_failures >= 20).length,
  };

  // Search filtering
  const filterBySearch = <T extends { supplier_code?: string; company_name?: string; smpp_username?: string; session_system_id?: string | null; client_code?: string }>(items: T[]) => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(item => {
      const fields = [
        (item as any).supplier_code || (item as any).client_code || '',
        (item as any).company_name || '',
        (item as any).smpp_username || '',
        (item as any).session_system_id || '',
      ];
      return fields.some(f => f.toLowerCase().includes(q));
    });
  };

  // Unfiltered counts for stats (always show full picture)
  const allSmppSuppliers = suppliers.filter(s => ['smpp', 'http'].includes(s.connection_type));
  const allOttSuppliers = suppliers.filter(s => ['ott_whatsapp', 'ott_telegram'].includes(s.connection_type));
  const allSmscServer = allSmppSuppliers.filter(s => s.smpp_mode === 'smsc_server');
  const allEsmeClient = allSmppSuppliers.filter(s => s.smpp_mode === 'esme_client');

  // Filtered for display (search applies)
  const smppSuppliers = filterBySearch(allSmppSuppliers);
  const ottSuppliers = filterBySearch(allOttSuppliers);
  const filteredClients = filterBySearch(clients);

  const smscServerSuppliers = smppSuppliers.filter(s => s.smpp_mode === 'smsc_server');
  const esmeClientSuppliers = smppSuppliers.filter(s => s.smpp_mode === 'esme_client');
  const smscServerBound = allSmscServer.filter(s => s.session_state === 'connected').length;
  const esmeClientBound = allEsmeClient.filter(s => s.session_state === 'connected').length;

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

  // Supplier card renderer shared between server and client mode
  const renderSupplierCard = (supplier: SupplierBindInfo) => {
    const isConnected = supplier.session_state === 'connected';
    const isBlocked = supplier.consecutive_failures >= 20;
    const isServerMode = supplier.smpp_mode === 'smsc_server';
    return (
      <div key={supplier.id}
        className={`p-4 rounded-xl border-2 transition-all ${
          isServerMode ? 'border-yellow-200 bg-yellow-50' :
          isConnected ? 'border-green-200 bg-green-50' :
          isBlocked ? 'border-orange-200 bg-orange-50' :
          'border-red-200 bg-red-50'
        }`}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            {getStatusIcon(isConnected ? 'connected' : 'disconnected')}
            <div>
              <div className="flex items-center gap-2">
                <p className="font-semibold text-gray-800 text-sm">{supplier.supplier_code}</p>
                <Badge variant={isServerMode ? 'warning' : 'default'} size="sm">{isServerMode ? 'SMSC' : 'ESME'}</Badge>
              </div>
              <p className="text-xs text-gray-600">{supplier.company_name}</p>
            </div>
          </div>
          {getStatusBadge(isBlocked ? 'error' : isConnected ? 'connected' : 'disconnected', supplier.consecutive_failures)}
        </div>
        <div className="mt-3 space-y-1.5 text-xs">
          <div className="flex justify-between"><span className="text-gray-500">Type:</span><span className="font-medium text-gray-700">{supplier.connection_type.toUpperCase()}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Host:</span><span className="font-mono text-gray-700">{supplier.smpp_host || (isServerMode ? 'Inbound (they connect to us)' : 'N/A')}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Port:</span><span className="font-mono text-gray-700">{supplier.smpp_port || 'N/A'}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Bind Type:</span><Badge variant="info" size="sm">{supplier.smpp_bind_type?.toUpperCase() || '—'}</Badge></div>
          <div className="flex justify-between"><span className="text-gray-500">System ID:</span><span className="font-mono text-gray-700">{supplier.session_system_id || '—'}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Session IP:</span><span className="font-mono text-gray-700">{supplier.ip_address || '—'}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Connected At:</span><span className="text-gray-700">{formatTime(supplier.connected_at)}</span></div>
          <div className="flex justify-between"><span className="text-gray-500">Failures:</span>
            <span className={`font-medium ${supplier.consecutive_failures > 10 ? 'text-red-600' : supplier.consecutive_failures > 0 ? 'text-yellow-600' : 'text-green-600'}`}>{supplier.consecutive_failures}</span>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          {isConnected ? (
            <>
              {isServerMode && (
                <span className="text-[10px] text-yellow-600 bg-yellow-50 px-2 py-1 rounded">Inbound</span>
              )}
              <Button size="sm" variant="danger" className="flex-1" onClick={() => handleUnbind('supplier', supplier.id)} disabled={bindingId === `supplier-${supplier.id}`}>
                {bindingId === `supplier-${supplier.id}` ? '...' : 'Disconnect'}
              </Button>
            </>
          ) : (
            <Button size="sm" variant="success" className="flex-1" onClick={() => handleBind('supplier', supplier.id)} disabled={bindingId === `supplier-${supplier.id}`}>
              {bindingId === `supplier-${supplier.id}` ? '...' : (isServerMode ? 'Connect' : 'Reconnect')}
            </Button>
          )}
        </div>
      </div>
    );
  };

  // ========== TABLE RENDERERS ==========

  const renderSupplierTable = (suppliersList: SupplierBindInfo[], showActions = true) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 border-b bg-gray-50">
            <th className="pb-2.5 pt-2 px-3 font-medium">Status</th>
            <th className="pb-2.5 pt-2 px-3 font-medium">Code</th>
            <th className="pb-2.5 pt-2 px-3 font-medium">Name</th>
            <th className="pb-2.5 pt-2 px-3 font-medium">Mode</th>
            <th className="pb-2.5 pt-2 px-3 font-medium">Type</th>
            <th className="pb-2.5 pt-2 px-3 font-medium">System ID</th>
            <th className="pb-2.5 pt-2 px-3 font-medium">Host / IP</th>
            <th className="pb-2.5 pt-2 px-3 font-medium">Port</th>
            <th className="pb-2.5 pt-2 px-3 font-medium">Bind Type</th>
            <th className="pb-2.5 pt-2 px-3 font-medium">Connected</th>
            <th className="pb-2.5 pt-2 px-3 font-medium">Failures</th>
            {showActions && <th className="pb-2.5 pt-2 px-3 font-medium">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {suppliersList.length === 0 ? (
            <tr><td colSpan={showActions ? 12 : 11} className="py-8 text-center text-gray-400">No gateways found</td></tr>
          ) : suppliersList.map(supplier => {
            const isConnected = supplier.session_state === 'connected';
            const isServerMode = supplier.smpp_mode === 'smsc_server';
            const isBlocked = supplier.consecutive_failures >= 20;
            return (
              <tr key={supplier.id} className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${isBlocked ? 'bg-orange-50' : isConnected ? 'bg-green-50/30' : ''}`}>
                <td className="py-2.5 px-3">
                  <div className="flex items-center gap-1.5">
                    {getStatusIcon(isConnected ? 'connected' : 'disconnected')}
                    {getStatusBadge(isBlocked ? 'error' : isConnected ? 'connected' : 'disconnected', supplier.consecutive_failures)}
                  </div>
                </td>
                <td className="py-2.5 px-3 font-medium text-gray-800">{supplier.supplier_code}</td>
                <td className="py-2.5 px-3 text-gray-600 text-xs">{supplier.company_name}</td>
                <td className="py-2.5 px-3">
                  <Badge variant={isServerMode ? 'warning' : 'default'} size="sm">{isServerMode ? 'SMSC' : 'ESME'}</Badge>
                </td>
                <td className="py-2.5 px-3 text-xs text-gray-600">{supplier.connection_type.toUpperCase()}</td>
                <td className="py-2.5 px-3 font-mono text-xs text-gray-700">{supplier.session_system_id || '—'}</td>
                <td className="py-2.5 px-3 font-mono text-xs text-gray-600">
                  {supplier.ip_address || supplier.smpp_host || (isServerMode ? 'Inbound' : '—')}
                </td>
                <td className="py-2.5 px-3 text-xs text-gray-600">{supplier.smpp_port || '—'}</td>
                <td className="py-2.5 px-3"><Badge variant="info" size="sm">{supplier.smpp_bind_type?.toUpperCase() || '—'}</Badge></td>
                <td className="py-2.5 px-3 text-xs text-gray-600 whitespace-nowrap">{formatTime(supplier.connected_at)}</td>
                <td className="py-2.5 px-3">
                  <span className={`font-medium text-xs ${supplier.consecutive_failures > 10 ? 'text-red-600' : supplier.consecutive_failures > 0 ? 'text-yellow-600' : 'text-green-600'}`}>
                    {supplier.consecutive_failures}
                    {isServerMode && <span className="text-[10px] text-yellow-600 ml-1">Inbound</span>}
                  </span>
                </td>
                {showActions && (
                  <td className="py-2.5 px-3">
                    {isConnected ? (
                      <Button size="sm" variant="danger" className="text-xs px-2 py-1" onClick={() => handleUnbind('supplier', supplier.id)} disabled={bindingId === `supplier-${supplier.id}`}>
                        {bindingId === `supplier-${supplier.id}` ? '...' : 'Disconnect'}
                      </Button>
                    ) : (
                      <Button size="sm" variant="success" className="text-xs px-2 py-1" onClick={() => handleBind('supplier', supplier.id)} disabled={bindingId === `supplier-${supplier.id}`}>
                        {bindingId === `supplier-${supplier.id}` ? '...' : (isServerMode ? 'Connect' : 'Reconnect')}
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const renderClientTable = (clientsList: ClientBindInfo[]) => (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 border-b bg-gray-50">
            <th className="pb-2.5 pt-2 px-3 font-medium">Status</th>
            <th className="pb-2.5 pt-2 px-3 font-medium">Code</th>
            <th className="pb-2.5 pt-2 px-3 font-medium">Name</th>
            <th className="pb-2.5 pt-2 px-3 font-medium">Username</th>
            <th className="pb-2.5 pt-2 px-3 font-medium">IP Allowed</th>
            <th className="pb-2.5 pt-2 px-3 font-medium">Session IP</th>
            <th className="pb-2.5 pt-2 px-3 font-medium">Bind Mode</th>
            <th className="pb-2.5 pt-2 px-3 font-medium">Connected</th>
            <th className="pb-2.5 pt-2 px-3 font-medium">Last Activity</th>
            <th className="pb-2.5 pt-2 px-3 font-medium">Max TPS</th>
            <th className="pb-2.5 pt-2 px-3 font-medium">Route Plan</th>
            <th className="pb-2.5 pt-2 px-3 font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {clientsList.length === 0 ? (
            <tr><td colSpan={12} className="py-8 text-center text-gray-400">No clients found</td></tr>
          ) : clientsList.map(client => (
            <tr key={client.id} className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${client.bind_status === 'bound' ? 'bg-green-50/30' : client.bind_status === 'connecting' ? 'bg-yellow-50/30' : ''}`}>
              <td className="py-2.5 px-3">
                <div className="flex items-center gap-1.5">
                  {getStatusIcon(client.bind_status)}
                  {getStatusBadge(client.bind_status)}
                </div>
              </td>
              <td className="py-2.5 px-3 font-medium text-gray-800">{client.client_code}</td>
              <td className="py-2.5 px-3 text-gray-600 text-xs">{client.company_name}</td>
              <td className="py-2.5 px-3 font-mono text-xs text-gray-700">{client.smpp_username || 'N/A'}</td>
              <td className="py-2.5 px-3 font-mono text-xs text-gray-600">{client.smpp_ip || 'Any'}</td>
              <td className="py-2.5 px-3 font-mono text-xs text-gray-600">{client.remote_ip || client.session_ip || '—'}</td>
              <td className="py-2.5 px-3 font-mono text-xs text-gray-600">{client.bind_mode || '—'}</td>
              <td className="py-2.5 px-3 text-xs text-gray-600 whitespace-nowrap">{formatTime(client.connected_at)}</td>
              <td className="py-2.5 px-3 text-xs text-gray-600 whitespace-nowrap">{formatTime(client.last_activity)}</td>
              <td className="py-2.5 px-3 text-xs text-gray-600">{client.max_tps}</td>
              <td className="py-2.5 px-3">
                <span className={`font-medium text-xs ${client.routing_plan_id ? 'text-green-600' : 'text-red-600'}`}>
                  {client.routing_plan_id ? 'Assigned' : 'None'}
                </span>
              </td>
              <td className="py-2.5 px-3">
                {client.bind_status === 'bound' ? (
                  <Button size="sm" variant="danger" className="text-xs px-2 py-1" onClick={() => handleUnbind('client', client.id)} disabled={bindingId === `client-${client.id}`}>
                    {bindingId === `client-${client.id}` ? '...' : 'Disconnect'}
                  </Button>
                ) : (
                  <Button size="sm" variant="success" className="text-xs px-2 py-1" onClick={() => handleBind('client', client.id)} disabled={bindingId === `client-${client.id}` || !client.smpp_username}>
                    {bindingId === `client-${client.id}` ? '...' : 'Connect'}
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

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
          <div className="relative">
            <Search size={16} className="absolute left-3 top-2.5 text-gray-400" />
            <input
              type="text"
              placeholder="Search gateways..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-9 pr-3 py-2 border border-gray-300 rounded-lg text-sm w-56 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery('')} className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600">✕</button>
            )}
          </div>
          <div className="flex items-center border border-gray-300 rounded-lg overflow-hidden">
            <button
              onClick={() => setViewMode('card')}
              className={`px-3 py-2 text-sm flex items-center gap-1.5 transition-colors ${viewMode === 'card' ? 'bg-blue-50 text-blue-600 font-medium' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              <LayoutGrid size={15} /> Cards
            </button>
            <button
              onClick={() => setViewMode('table')}
              className={`px-3 py-2 text-sm flex items-center gap-1.5 transition-colors ${viewMode === 'table' ? 'bg-blue-50 text-blue-600 font-medium' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              <LayoutList size={15} /> Table
            </button>
          </div>
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
          <p className="text-xs text-gray-500">SMSC Server</p>
          <p className="text-xl font-bold text-yellow-600">{allSmscServer.length}</p>
          <p className="text-[10px] text-gray-400">{smscServerBound} bound</p>
        </div>
        <div className="bg-white rounded-xl p-3 border text-center">
          <p className="text-xs text-gray-500">ESME Client</p>
          <p className="text-xl font-bold text-blue-600">{allEsmeClient.length}</p>
          <p className="text-[10px] text-gray-400">{esmeClientBound} bound</p>
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
          <p className="text-xl font-bold text-blue-600">{allSmppSuppliers.length}</p>
        </div>
        <div className="bg-white rounded-xl p-3 border text-center">
          <p className="text-xs text-gray-500">OTT</p>
          <p className="text-xl font-bold text-purple-600">{allOttSuppliers.length}</p>
        </div>
        {/* Asterisk Status */}
        <div className={`rounded-xl p-3 border text-center ${!asteriskStatus ? 'bg-gray-50' : asteriskStatus.service_active && asteriskStatus.ami_connected ? 'bg-green-50 border-green-200' : asteriskStatus.service_active ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200'}`}>
          <p className="text-xs text-gray-500">Asterisk</p>
          {!asteriskStatus ? (
            <RefreshCw size={16} className="animate-spin text-gray-400 mx-auto mt-1" />
          ) : (
            <>
              <div className="flex items-center justify-center gap-1 mt-1">
                {asteriskStatus.ami_connected ? <Phone size={16} className="text-green-600" /> : <PhoneOff size={16} className="text-red-500" />}
                <p className={`text-lg font-bold ${asteriskStatus.ami_connected ? 'text-green-600' : asteriskStatus.service_active ? 'text-yellow-600' : 'text-red-600'}`}>
                  {asteriskStatus.ami_connected ? 'Online' : asteriskStatus.service_active ? 'AMI' : 'Off'}
                </p>
              </div>
              {asteriskStatus.version && <p className="text-[10px] text-gray-400">v{asteriskStatus.version.split(' ')[0]}</p>}
              <p className="text-[10px] text-gray-400">{asteriskStatus.sip_online}/{asteriskStatus.sip_peers} SIP</p>
            </>
          )}
        </div>
      </div>

      {/* ESME: Client Bind Status */}
      <Card title={`ESME — Client SMPP Connections (${filteredClients.length})`} subtitle={searchQuery ? `Filtered from ${clients.length} total` : 'Real session data from smpp_sessions table. Green = bound, Red = no active session'}>
        {filteredClients.length === 0 ? (
          <p className="text-gray-500 text-sm py-4">{searchQuery ? 'No clients match your search.' : 'No clients with SMPP credentials configured.'}</p>
        ) : viewMode === 'table' ? (
          renderClientTable(filteredClients)
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {filteredClients.map(client => (
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
      {/* SMSC Server Mode — Inbound GSM Gateways */}

      {/* SIP Peer Registration Monitor */}
      <Card title={`SIP Peer Registration — ${sipPeers.length} peer${sipPeers.length !== 1 ? 's' : ''}`} subtitle="Real-time PJSIP peer monitoring: status, latency (RTT), and last registration time">
        {sipLoading ? (
          <div className="flex items-center gap-2 py-4"><RefreshCw size={16} className="animate-spin text-gray-400" /><span className="text-sm text-gray-500">Loading SIP peers...</span></div>
        ) : sipPeers.length === 0 ? (
          <p className="text-gray-500 text-sm py-4">No SIP peers configured. Add PJSIP endpoints in Asterisk to see them here.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b bg-gray-50">
                  <th className="pb-2.5 pt-2 px-3 font-medium">Status</th>
                  <th className="pb-2.5 pt-2 px-3 font-medium">Peer Name</th>
                  <th className="pb-2.5 pt-2 px-3 font-medium">Contact URI</th>
                  <th className="pb-2.5 pt-2 px-3 font-medium">Registration</th>
                  <th className="pb-2.5 pt-2 px-3 font-medium">RTT (ms)</th>
                  <th className="pb-2.5 pt-2 px-3 font-medium">Auth</th>
                  <th className="pb-2.5 pt-2 px-3 font-medium">Registered At</th>
                </tr>
              </thead>
              <tbody>
                {sipPeers.map((peer, i) => (
                  <tr key={i} className={`border-b border-gray-100 hover:bg-gray-50 transition-colors ${peer.registered ? 'bg-green-50/30' : 'bg-red-50/20'}`}>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1.5">
                        <Radio size={14} className={peer.registered ? 'text-green-500' : 'text-red-400'} />
                        <Badge variant={peer.registered ? 'success' : 'danger'} dot size="sm">
                          {peer.status.toUpperCase()}
                        </Badge>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 font-medium text-gray-800">{peer.name}</td>
                    <td className="py-2.5 px-3 font-mono text-xs text-gray-600 max-w-[200px] truncate" title={peer.contact_uri}>{peer.contact_uri}</td>
                    <td className="py-2.5 px-3">
                      <Badge variant={peer.registered ? 'success' : 'warning'} size="sm">{peer.registered ? 'Registered' : 'Unregistered'}</Badge>
                    </td>
                    <td className="py-2.5 px-3">
                      {peer.rtt_ms !== null ? (
                        <span className={`font-mono text-xs font-medium ${peer.rtt_ms < 50 ? 'text-green-600' : peer.rtt_ms < 150 ? 'text-yellow-600' : 'text-red-600'}`}>
                          {typeof peer.rtt_ms === 'number' ? peer.rtt_ms.toFixed(1) : peer.rtt_ms} ms
                        </span>
                      ) : (
                        <span className="text-gray-400 text-xs">—</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-xs text-gray-600">{peer.auth_name || '—'}</td>
                    <td className="py-2.5 px-3 text-xs text-gray-600 whitespace-nowrap">
                      {peer.registered_at ? new Date(peer.registered_at).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* SMSC Server Mode — Inbound GSM Gateways */}
      {allSmscServer.length > 0 && (
        <Card title={`SMSC Server Mode — Inbound Gateways (${allSmscServer.length})`} subtitle={searchQuery ? `Filtered from ${allSmscServer.length} total` : 'These gateways connect TO us on port 2775. Bind/unbind is automatic — managed by the Java SMPP gateway.'}>
          {smscServerSuppliers.length === 0 && searchQuery ? (
            <p className="text-gray-500 text-sm py-4">No inbound gateways match your search.</p>
          ) : viewMode === 'table' ? renderSupplierTable(smscServerSuppliers) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {smscServerSuppliers.map(s => renderSupplierCard(s))}
            </div>
          )}
        </Card>
      )}

      {/* ESME Client Mode — Outbound SMSCs */}
      {allEsmeClient.length > 0 && (
        <Card title={`ESME Client Mode — Outbound SMSCs (${allEsmeClient.length})`} subtitle={searchQuery ? `Filtered from ${allEsmeClient.length} total` : 'We connect TO these SMSCs. You can manually bind/unbind to control outbound connections.'}>
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
        {viewMode === 'table' ? renderSupplierTable(esmeClientSuppliers) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {esmeClientSuppliers.map(s => renderSupplierCard(s))}
        </div>
        )}
      </Card>
      )}

      {/* OTT Connections */}
      <Card title={`Supplier — OTT Connections (WhatsApp / Telegram) — ${ottSuppliers.length}`}>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {ottSuppliers.map(supplier => {
            const isConnected = supplier.session_state === 'connected';
            return (
            <div key={supplier.id}
              className={`p-4 rounded-xl border-2 transition-all ${
                isConnected ? 'border-green-200 bg-green-50' :
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
                {getStatusBadge(isConnected ? 'connected' : 'disconnected', supplier.consecutive_failures)}
              </div>
              <div className="mt-3 space-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-gray-500">Platform:</span><span className="font-medium text-gray-700">{supplier.connection_type === 'ott_whatsapp' ? 'WhatsApp' : 'Telegram'}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Status:</span><span className={`font-medium ${isConnected ? 'text-green-600' : 'text-red-600'}`}>{isConnected ? 'Connected' : 'Disconnected'}</span></div>
              </div>
            </div>
          )})}
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
