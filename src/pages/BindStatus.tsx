import React, { useState, useEffect } from 'react';
import { Wifi, WifiOff, RefreshCw, AlertTriangle, Clock } from 'lucide-react';
import { useData } from '../store/DataContext';
import { Card } from '../components/UI/Card';
import { Button } from '../components/UI/Button';
import { Badge } from '../components/UI/Badge';

export const BindStatus: React.FC = () => {
  const { suppliers, updateSupplier, clients } = useData();
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Get client bind status by checking if any supplier in the client's routes is bound
  const getClientDetailedStatus = (clientId: string): { status: 'bound' | 'unbound' | 'error'; boundSuppliers: number; totalSuppliers: number } => {
    const client = clients.find(c => c.id === clientId);
    if (!client || client.status !== 'active') return { status: 'unbound', boundSuppliers: 0, totalSuppliers: 0 };
    
    const boundSuppliers = suppliers.filter(s => s.bind_status === 'bound' && s.status === 'active');
    const totalSuppliers = suppliers.filter(s => s.status === 'active');
    
    // If client has routes and at least one supplier is bound, client is bound
    const hasRoute = client.routing_plan_id && client.routing_plan_id !== '';
    const hasCreds = client.smpp_username && client.smpp_password;
    
    if (hasCreds && hasRoute && boundSuppliers.length > 0) {
      return { status: 'bound', boundSuppliers: boundSuppliers.length, totalSuppliers: totalSuppliers.length };
    }
    return { status: 'unbound', boundSuppliers: boundSuppliers.length, totalSuppliers: totalSuppliers.length };
  };

  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => setLastRefresh(new Date()), 30000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const smppSuppliers = suppliers.filter(s => ['smpp', 'http', 'voice_otp', 'local_bypass'].includes(s.connection_type));
  const ottSuppliers = suppliers.filter(s => ['ott_whatsapp', 'ott_telegram'].includes(s.connection_type));

  const supplierStats = {
    total: suppliers.length,
    bound: suppliers.filter(s => s.bind_status === 'bound').length,
    unbound: suppliers.filter(s => s.bind_status === 'unbound').length,
    error: suppliers.filter(s => s.bind_status === 'error').length,
    blocked: suppliers.filter(s => s.consecutive_failures >= 20).length,
  };

  const clientStats = {
    total: clients.length,
    bound: clients.filter(c => getClientDetailedStatus(c.id).status === 'bound').length,
    unbound: clients.filter(c => getClientDetailedStatus(c.id).status === 'unbound').length,
    active: clients.filter(c => c.status === 'active').length,
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'bound': return <Wifi size={18} className="text-green-500" />;
      case 'unbound': return <WifiOff size={18} className="text-red-400" />;
      case 'binding': return <Clock size={18} className="text-yellow-500 animate-pulse" />;
      case 'error': return <AlertTriangle size={18} className="text-red-500" />;
      default: return <WifiOff size={18} className="text-red-400" />;
    }
  };

  const getStatusBadge = (status: string, failures?: number) => {
    if (failures !== undefined && failures >= 20) {
      return <Badge variant="danger" dot>BLOCKED</Badge>;
    }
    const variants: Record<string, 'success' | 'warning' | 'danger' | 'default'> = {
      bound: 'success', unbound: 'danger', binding: 'warning', error: 'danger',
    };
    return <Badge variant={variants[status] || 'danger'} dot size="sm">{status.toUpperCase()}</Badge>;
  };

  const handleReconnect = (supplierId: string) => {
    updateSupplier(supplierId, { bind_status: 'binding', consecutive_failures: 0 });
    setTimeout(() => { updateSupplier(supplierId, { bind_status: 'bound' }); }, 2000);
  };

  const handleDisconnect = (supplierId: string) => {
    updateSupplier(supplierId, { bind_status: 'unbound' });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Bind Status</h1>
          <p className="text-gray-500 mt-1">Monitor Client and Supplier SMPP/OTT connection status</p>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-blue-600" />
            <span className="text-sm text-gray-600">Auto-refresh</span>
          </label>
          <span className="text-sm text-gray-500">Updated: {lastRefresh.toLocaleTimeString()}</span>
          <Button variant="secondary" icon={<RefreshCw size={16} />} onClick={() => setLastRefresh(new Date())}>Refresh</Button>
        </div>
      </div>

      {/* Combined Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <div className="bg-white rounded-xl p-3 border text-center">
          <p className="text-xs text-gray-500">Total Clients</p>
          <p className="text-xl font-bold text-gray-800">{clientStats.total}</p>
          <p className="text-[10px] text-gray-400">{clientStats.active} active</p>
        </div>
        <div className="bg-white rounded-xl p-3 border text-center">
          <p className="text-xs text-gray-500">Clients Bound</p>
          <p className="text-xl font-bold text-green-600">{clientStats.bound}</p>
          <p className="text-[10px] text-gray-400">{clientStats.unbound} unbound</p>
        </div>
        <div className="bg-white rounded-xl p-3 border text-center">
          <p className="text-xs text-gray-500">Total Suppliers</p>
          <p className="text-xl font-bold text-gray-800">{supplierStats.total}</p>
        </div>
        <div className="bg-white rounded-xl p-3 border text-center">
          <p className="text-xs text-gray-500">Suppliers Bound</p>
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

      {/* Client Bind Status */}
      <Card title="Client Bind Status" subtitle={`${clients.length} clients — Green = has route + bound supplier, Red = no route or no bound supplier`}>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {clients.map(client => {
            const clientStatus = getClientDetailedStatus(client.id);
            return (
              <div key={client.id}
                className={`p-4 rounded-xl border-2 transition-all ${
                  clientStatus.status === 'bound' ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
                }`}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm ${client.status === 'active' ? 'bg-gradient-to-br from-blue-500 to-indigo-600' : 'bg-gray-400'}`}>
                      {client.company_name.charAt(0)}
                    </div>
                    <div>
                      <p className="font-semibold text-gray-800 text-sm">{client.client_code}</p>
                      <p className="text-xs text-gray-600">{client.company_name}</p>
                    </div>
                  </div>
                  {getStatusBadge(clientStatus.status)}
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
                    <span className="text-gray-500">Route Plan:</span>
                    <span className={`font-medium ${client.routing_plan_id ? 'text-green-600' : 'text-red-600'}`}>
                      {client.routing_plan_id ? 'Assigned' : 'None'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Bound Suppliers:</span>
                    <span className="font-medium text-gray-700">{clientStatus.boundSuppliers}/{clientStatus.totalSuppliers}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Max TPS:</span>
                    <span className="font-medium text-gray-700">{client.max_tps}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">Status:</span>
                    <Badge variant={client.status === 'active' ? 'success' : 'danger'} size="sm">{client.status}</Badge>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Supplier Bind Status - SMPP */}
      <Card title="Supplier — SMPP / HTTP Connections" subtitle={`${smppSuppliers.length} connections`}>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {smppSuppliers.map(supplier => (
            <div key={supplier.id}
              className={`p-4 rounded-xl border-2 transition-all ${
                supplier.bind_status === 'bound' ? 'border-green-200 bg-green-50' :
                supplier.bind_status === 'error' || supplier.consecutive_failures >= 20 ? 'border-red-200 bg-red-50' :
                'border-red-200 bg-red-50'
              }`}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  {getStatusIcon(supplier.bind_status)}
                  <div>
                    <p className="font-semibold text-gray-800 text-sm">{supplier.supplier_code}</p>
                    <p className="text-xs text-gray-600">{supplier.company_name}</p>
                  </div>
                </div>
                {getStatusBadge(supplier.bind_status, supplier.consecutive_failures)}
              </div>
              <div className="mt-3 space-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-gray-500">Type:</span><span className="font-medium text-gray-700">{supplier.connection_type.toUpperCase()}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Host:</span><span className="font-mono text-gray-700">{supplier.smpp_host || 'N/A'}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Port:</span><span className="font-mono text-gray-700">{supplier.smpp_port || 'N/A'}</span></div>
                <div className="flex justify-between"><span className="text-gray-500">Failures:</span>
                  <span className={`font-medium ${supplier.consecutive_failures > 10 ? 'text-red-600' : supplier.consecutive_failures > 0 ? 'text-yellow-600' : 'text-green-600'}`}>{supplier.consecutive_failures}</span>
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                {supplier.bind_status === 'bound' ? (
                  <Button size="sm" variant="danger" className="flex-1" onClick={() => handleDisconnect(supplier.id)}>Disconnect</Button>
                ) : (
                  <Button size="sm" variant="success" className="flex-1" onClick={() => handleReconnect(supplier.id)}>Reconnect</Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Supplier Bind Status - OTT */}
      <Card title="Supplier — OTT Connections (WhatsApp / Telegram)" subtitle={`${ottSuppliers.length} connections`}>
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
              <div className="mt-3 flex gap-2">
                {supplier.bind_status === 'bound' ? (
                  <Button size="sm" variant="danger" className="flex-1" onClick={() => handleDisconnect(supplier.id)}>Disconnect</Button>
                ) : (
                  <Button size="sm" variant="success" className="flex-1" onClick={() => handleReconnect(supplier.id)}>Connect</Button>
                )}
              </div>
            </div>
          ))}
        </div>
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
