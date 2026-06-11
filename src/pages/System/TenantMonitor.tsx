import React, { useState, useEffect } from 'react';
import { Search, RefreshCw, Eye, Server, Globe, Wifi, WifiOff, BarChart3, Gauge, AlertTriangle, Database, Activity, HardDrive, Users, Download } from 'lucide-react';
import { useAuth } from '../../store/AuthContext';
import { Card } from '../../components/UI/Card';
import { Button } from '../../components/UI/Button';
import { Badge } from '../../components/UI/Badge';
import { Table, Pagination } from '../../components/UI/Table';
import { Modal } from '../../components/UI/Modal';
import { Input } from '../../components/UI/Input';
import { exportCSV } from '../../services/exportService';

// Tenant remote monitoring - collected via IP/MAC heartbeat protocol
interface TenantRemote {
  id: string;
  tenant_name: string;
  tenant_code: string;
  remote_ip: string;
  remote_mac: string;
  status: 'online' | 'offline' | 'warning' | 'expired';
  last_heartbeat: string;
  uptime_hours: number;
  version: string;
  
  // License info
  license_type: 'trial' | 'standard' | 'enterprise' | 'unlimited';
  license_expiry: string;
  days_remaining: number;
  
  // Features enabled
  features: {
    smpp: boolean;
    http: boolean;
    whatsapp: boolean;
    telegram: boolean;
    rcs: boolean;
    voice_otp: boolean;
  };
  
  // Volume usage (collected from remote)
  total_sms_limit: number;
  sms_used_this_month: number;
  sms_remaining: number;
  usage_percent: number;
  current_tps: number;
  tps_limit: number;
  
  // Server metrics
  cpu_percent: number;
  memory_percent: number;
  disk_percent: number;
  
  // Counts
  active_clients: number;
  active_suppliers: number;
  active_binds: number;
  
  // Timestamps
  installed_at: string;
  last_updated: string;
}

// Simulate 100 tenants with remote monitoring data
function generateTenants(): TenantRemote[] {
  const tenants: TenantRemote[] = [];
  const names = ['TechCorp', 'MegaBank', 'EcomStore', 'HealthPlus', 'TravelWorld', 'DataSync', 'CloudNet', 'SecureCom', 'PayFlow', 'MarketPro'];
  const codes = ['TCG','MBL','ECM','HPP','TWD','DSC','CLN','SCR','PFL','MPR'];
  
  for (let i = 0; i < 20; i++) {
    const name = names[i % names.length] + ' ' + (i + 1);
    const code = codes[i % codes.length] + String(i + 1).padStart(2, '0');
    const smsTotal = Math.floor(Math.random() * 9000000) + 1000000;
    const smsUsed = Math.floor(Math.random() * smsTotal);
    const online = Math.random() > 0.15;
    const daysRemaining = Math.floor(Math.random() * 365) + 1;
    
    tenants.push({
      id: String(i + 1),
      tenant_name: name,
      tenant_code: code,
      remote_ip: `192.168.${Math.floor(i/254)+1}.${i%254+1}`,
      remote_mac: `00:1A:${String(Math.floor(Math.random()*99)).padStart(2,'0')}:${String(Math.floor(Math.random()*99)).padStart(2,'0')}:${String(Math.floor(Math.random()*99)).padStart(2,'0')}:${String(Math.floor(Math.random()*99)).padStart(2,'0')}`,
      status: online ? (daysRemaining < 30 ? 'warning' : 'online') : 'offline',
      last_heartbeat: online ? new Date(Date.now() - Math.floor(Math.random() * 300000)).toISOString() : new Date(Date.now() - Math.floor(Math.random() * 86400000 * 7)).toISOString(),
      uptime_hours: online ? Math.floor(Math.random() * 720) + 1 : 0,
      version: 'v' + (Math.floor(Math.random() * 3) + 1) + '.' + Math.floor(Math.random() * 10) + '.' + Math.floor(Math.random() * 20),
      license_type: ['trial','standard','enterprise','unlimited'][Math.floor(Math.random()*4)] as any,
      license_expiry: new Date(Date.now() + daysRemaining * 86400000).toISOString().split('T')[0],
      days_remaining: daysRemaining,
      features: {
        smpp: true,
        http: Math.random() > 0.2,
        whatsapp: Math.random() > 0.4,
        telegram: Math.random() > 0.5,
        rcs: Math.random() > 0.7,
        voice_otp: Math.random() > 0.3,
      },
      total_sms_limit: smsTotal,
      sms_used_this_month: smsUsed,
      sms_remaining: smsTotal - smsUsed,
      usage_percent: Math.round((smsUsed / smsTotal) * 100),
      current_tps: online ? Math.floor(Math.random() * 500) : 0,
      tps_limit: Math.floor(Math.random() * 900) + 100,
      cpu_percent: online ? Math.floor(Math.random() * 80) + 5 : 0,
      memory_percent: online ? Math.floor(Math.random() * 70) + 10 : 0,
      disk_percent: Math.floor(Math.random() * 60) + 20,
      active_clients: Math.floor(Math.random() * 50) + 1,
      active_suppliers: Math.floor(Math.random() * 20) + 1,
      active_binds: Math.floor(Math.random() * 15) + 1,
      installed_at: new Date(Date.now() - Math.floor(Math.random() * 365 * 86400000)).toISOString().split('T')[0],
      last_updated: new Date(Date.now() - Math.floor(Math.random() * 14 * 86400000)).toISOString().split('T')[0],
    });
  }
  return tenants.sort((a, b) => a.tenant_name.localeCompare(b.tenant_name));
}

const SAVED_KEY = 'tenant_monitor_data';
function loadTenants(): TenantRemote[] {
  try { const s = localStorage.getItem(SAVED_KEY); if (s) return JSON.parse(s); } catch {}
  const data = generateTenants();
  localStorage.setItem(SAVED_KEY, JSON.stringify(data));
  return data;
}

export const TenantMonitor: React.FC = () => {
  const { user, isSuperAdmin } = useAuth();
  const [tenants, setTenants] = useState<TenantRemote[]>(loadTenants);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [detailModal, setDetailModal] = useState<TenantRemote | null>(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [refreshing, setRefreshing] = useState(false);
  const itemsPerPage = 20;

  // Auto-refresh every 60 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setTenants(prev => prev.map(t => {
        if (t.status === 'offline') return t;
        return {
          ...t,
          last_heartbeat: new Date().toISOString(),
          sms_used_this_month: Math.min(t.sms_used_this_month + Math.floor(Math.random() * 100), t.total_sms_limit),
          current_tps: Math.floor(Math.random() * t.tps_limit),
          cpu_percent: Math.floor(Math.random() * 80) + 5,
          memory_percent: Math.floor(Math.random() * 70) + 10,
          usage_percent: Math.round(((t.sms_used_this_month + Math.floor(Math.random() * 100)) / t.total_sms_limit) * 100),
        };
      }));
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = async () => {
    setRefreshing(true);
    const fresh = generateTenants();
    localStorage.setItem(SAVED_KEY, JSON.stringify(fresh));
    setTenants(fresh);
    setLastRefresh(new Date());
    setRefreshing(false);
  };

  const filtered = tenants.filter(t => {
    const ms = t.tenant_name.toLowerCase().includes(search.toLowerCase()) || t.tenant_code.toLowerCase().includes(search.toLowerCase()) || t.remote_ip.includes(search);
    const st = statusFilter === 'all' || t.status === statusFilter;
    const tt = typeFilter === 'all' || t.license_type === typeFilter;
    return ms && st && tt;
  });

  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const paginated = filtered.slice((currentPage-1)*itemsPerPage, currentPage*itemsPerPage);

  // Summary stats
  const online = tenants.filter(t => t.status === 'online').length;
  const offline = tenants.filter(t => t.status === 'offline').length;
  const warning = tenants.filter(t => t.status === 'warning' || (t.days_remaining < 30 && t.status !== 'offline')).length;
  const totalSMSUsed = tenants.reduce((s, t) => s + t.sms_used_this_month, 0);
  const totalSMSLimit = tenants.reduce((s, t) => s + t.total_sms_limit, 0);

  const columns = [
    {
      key: 'tenant', header: 'Tenant',
      render: (t: TenantRemote) => (
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${t.status === 'online' ? 'bg-green-100' : t.status === 'warning' ? 'bg-yellow-100' : 'bg-red-100'}`}>
            <Server size={14} className={t.status === 'online' ? 'text-green-600' : t.status === 'warning' ? 'text-yellow-600' : 'text-red-600'} />
          </div>
          <div>
            <p className="font-medium text-sm">{t.tenant_name}</p>
            <p className="text-[10px] text-gray-500">{t.tenant_code}</p>
          </div>
        </div>
      )
    },
    {
      key: 'status', header: 'Status',
      render: (t: TenantRemote) => (
        <div>
          <Badge variant={t.status === 'online' ? 'success' : t.status === 'warning' ? 'warning' : 'danger'} dot size="sm">
            {t.status.toUpperCase()}
          </Badge>
          {t.days_remaining < 30 && t.days_remaining > 0 && <p className="text-[10px] text-yellow-600 mt-0.5">Expires in {t.days_remaining}d</p>}
          {t.days_remaining <= 0 && <p className="text-[10px] text-red-600 mt-0.5">EXPIRED</p>}
        </div>
      )
    },
    {
      key: 'ip', header: 'Remote IP',
      render: (t: TenantRemote) => (
        <div className="flex items-center gap-1">
          <Globe size={12} className="text-gray-400" />
          <span className="font-mono text-xs">{t.remote_ip}</span>
        </div>
      )
    },
    {
      key: 'usage', header: 'SMS Usage',
      render: (t: TenantRemote) => (
        <div className="w-28">
          <div className="flex justify-between text-[10px] mb-0.5">
            <span>{t.usage_percent}%</span>
            <span className="text-gray-400">{(t.total_sms_limit/1000000).toFixed(1)}M</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-1.5">
            <div className={`h-1.5 rounded-full ${t.usage_percent > 90 ? 'bg-red-500' : t.usage_percent > 70 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{width: `${Math.min(t.usage_percent, 100)}%`}} />
          </div>
        </div>
      )
    },
    {
      key: 'tps', header: 'TPS',
      align: 'center' as const,
      render: (t: TenantRemote) => (
        <span className="text-xs font-mono">
          {t.current_tps}<span className="text-gray-400">/{t.tps_limit}</span>
        </span>
      )
    },
    {
      key: 'license', header: 'License',
      render: (t: TenantRemote) => (
        <Badge variant={
          t.license_type === 'enterprise' ? 'purple' :
          t.license_type === 'unlimited' ? 'success' :
          t.license_type === 'standard' ? 'info' : 'default'
        } size="sm">{t.license_type.toUpperCase()}</Badge>
      )
    },
    {
      key: 'features', header: 'Features',
      render: (t: TenantRemote) => (
        <div className="flex gap-0.5">
          {t.features.smpp && <Badge variant="info" size="sm">SMPP</Badge>}
          {t.features.voice_otp && <Badge variant="warning" size="sm">VOICE</Badge>}
          {t.features.whatsapp && <Badge variant="success" size="sm">WA</Badge>}
        </div>
      )
    },
    {
      key: 'system', header: 'System',
      render: (t: TenantRemote) => (
        <div className="text-xs">
          <div className="flex items-center gap-1">
            <Activity size={10} className={t.cpu_percent > 80 ? 'text-red-500' : 'text-green-500'} />
            <span>CPU {t.cpu_percent}%</span>
          </div>
          <div className="flex items-center gap-1">
            <HardDrive size={10} className={t.disk_percent > 80 ? 'text-red-500' : 'text-green-500'} />
            <span>Disk {t.disk_percent}%</span>
          </div>
        </div>
      )
    },
    {
      key: 'actions', header: '',
      render: (t: TenantRemote) => (
        <button onClick={() => setDetailModal(t)} className="p-1.5 rounded hover:bg-gray-100">
          <Eye size={14} className="text-gray-500" />
        </button>
      )
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Central Tenant Monitor</h1>
          <p className="text-gray-500 mt-1">
            {isSuperAdmin() ? 
              <span className="text-green-600 font-medium">🔒 Super Admin — Remote monitoring of {tenants.length} tenants</span> :
              <span className="text-red-600">⛔ Super Admin only</span>}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-500">Last sync: {lastRefresh.toLocaleTimeString()}</span>
          <Button variant="secondary" icon={<RefreshCw size={16} />} onClick={handleRefresh} loading={refreshing}>Refresh All</Button>
          <Button variant="secondary" icon={<Download size={16} />} onClick={() => exportCSV('tenants_monitor.csv',
            ['Tenant','Code','IP','MAC','Status','License','Expiry','Days','SMS Used','SMS Limit','Usage%','TPS','CPU%','Mem%','Disk%','Clients','Suppliers','Binds','Version'],
            tenants.map(t => [t.tenant_name,t.tenant_code,t.remote_ip,t.remote_mac,t.status,t.license_type,t.license_expiry,String(t.days_remaining),String(t.sms_used_this_month),String(t.total_sms_limit),String(t.usage_percent),String(t.current_tps)+'/'+String(t.tps_limit),String(t.cpu_percent),String(t.memory_percent),String(t.disk_percent),String(t.active_clients),String(t.active_suppliers),String(t.active_binds),t.version])
          )}>Export CSV</Button>
        </div>
      </div>

      {/* Summary Dashboard */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <div className="bg-white rounded-xl p-3 border text-center">
          <Server size={20} className="text-blue-500 mx-auto mb-1" />
          <p className="text-xl font-bold">{tenants.length}</p>
          <p className="text-[10px] text-gray-500">Total Tenants</p>
        </div>
        <div className="bg-white rounded-xl p-3 border text-center">
          <Wifi size={20} className="text-green-500 mx-auto mb-1" />
          <p className="text-xl font-bold text-green-600">{online}</p>
          <p className="text-[10px] text-gray-500">Online</p>
        </div>
        <div className="bg-white rounded-xl p-3 border text-center">
          <WifiOff size={20} className="text-red-500 mx-auto mb-1" />
          <p className="text-xl font-bold text-red-600">{offline}</p>
          <p className="text-[10px] text-gray-500">Offline</p>
        </div>
        <div className="bg-white rounded-xl p-3 border text-center">
          <AlertTriangle size={20} className="text-yellow-500 mx-auto mb-1" />
          <p className="text-xl font-bold text-yellow-600">{warning}</p>
          <p className="text-[10px] text-gray-500">Warnings</p>
        </div>
        <div className="bg-white rounded-xl p-3 border text-center">
          <BarChart3 size={20} className="text-blue-500 mx-auto mb-1" />
          <p className="text-xl font-bold">{(totalSMSUsed/1000000).toFixed(0)}M</p>
          <p className="text-[10px] text-gray-500">SMS Used</p>
        </div>
        <div className="bg-white rounded-xl p-3 border text-center">
          <Database size={20} className="text-purple-500 mx-auto mb-1" />
          <p className="text-xl font-bold">{(totalSMSLimit/1000000).toFixed(0)}M</p>
          <p className="text-[10px] text-gray-500">Total Capacity</p>
        </div>
        <div className="bg-white rounded-xl p-3 border text-center">
          <Gauge size={20} className="text-indigo-500 mx-auto mb-1" />
          <p className="text-xl font-bold">{((totalSMSUsed/totalSMSLimit)*100).toFixed(0)}%</p>
          <p className="text-[10px] text-gray-500">Utilization</p>
        </div>
        <div className="bg-white rounded-xl p-3 border text-center">
          <Users size={20} className="text-orange-500 mx-auto mb-1" />
          <p className="text-xl font-bold">{tenants.reduce((s,t)=>s+t.active_clients,0)}</p>
          <p className="text-[10px] text-gray-500">Active Clients</p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <div className="flex flex-col md:flex-row gap-3">
          <div className="flex-1 relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input type="text" placeholder="Search tenant name, code, IP..." value={search} onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setCurrentPage(1); }} className="px-4 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="all">All Status</option>
            <option value="online">Online</option>
            <option value="offline">Offline</option>
            <option value="warning">Warning</option>
          </select>
          <select value={typeFilter} onChange={e => { setTypeFilter(e.target.value); setCurrentPage(1); }} className="px-4 py-2 border border-gray-300 rounded-lg text-sm">
            <option value="all">All License Types</option>
            <option value="trial">Trial</option>
            <option value="standard">Standard</option>
            <option value="enterprise">Enterprise</option>
            <option value="unlimited">Unlimited</option>
          </select>
        </div>
      </Card>

      {/* Table */}
      <Card noPadding>
        <Table columns={columns} data={paginated} keyExtractor={t => t.id} />
        <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} totalItems={filtered.length} itemsPerPage={itemsPerPage} />
      </Card>

      {/* Detail Modal */}
      <Modal isOpen={!!detailModal} onClose={() => setDetailModal(null)} title={`Tenant: ${detailModal?.tenant_name}`} size="lg">
        {detailModal && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-gray-50 p-3 rounded-lg text-center">
                <p className="text-xs text-gray-500">Status</p>
                <Badge variant={detailModal.status === 'online' ? 'success' : detailModal.status === 'warning' ? 'warning' : 'danger'}>{detailModal.status.toUpperCase()}</Badge>
              </div>
              <div className="bg-gray-50 p-3 rounded-lg text-center">
                <p className="text-xs text-gray-500">License</p>
                <p className="font-semibold text-sm">{detailModal.license_type.toUpperCase()}</p>
              </div>
              <div className="bg-gray-50 p-3 rounded-lg text-center">
                <p className="text-xs text-gray-500">Version</p>
                <p className="font-mono text-sm">{detailModal.version}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><p className="text-xs text-gray-500">Remote IP</p><p className="font-mono">{detailModal.remote_ip}</p></div>
              <div><p className="text-xs text-gray-500">MAC Address</p><p className="font-mono">{detailModal.remote_mac}</p></div>
              <div><p className="text-xs text-gray-500">License Expiry</p><p>{detailModal.license_expiry} ({detailModal.days_remaining} days)</p></div>
              <div><p className="text-xs text-gray-500">Last Heartbeat</p><p className="text-xs">{new Date(detailModal.last_heartbeat).toLocaleString()}</p></div>
            </div>

            <div className="border-t pt-3">
              <p className="text-xs font-medium text-gray-500 uppercase mb-2">Volume Usage</p>
              <div className="w-full bg-gray-200 rounded-full h-3 mb-2">
                <div className={`h-3 rounded-full ${detailModal.usage_percent > 90 ? 'bg-red-500' : detailModal.usage_percent > 70 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{width: `${Math.min(detailModal.usage_percent, 100)}%`}} />
              </div>
              <div className="flex justify-between text-xs">
                <span>{detailModal.sms_used_this_month.toLocaleString()} / {detailModal.total_sms_limit.toLocaleString()} SMS</span>
                <span>{detailModal.usage_percent}%</span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="bg-blue-50 p-3 rounded-lg text-center"><p className="text-xs text-blue-600">TPS</p><p className="font-semibold">{detailModal.current_tps}<span className="text-xs text-gray-500">/{detailModal.tps_limit}</span></p></div>
              <div className="bg-green-50 p-3 rounded-lg text-center"><p className="text-xs text-green-600">Clients</p><p className="font-semibold">{detailModal.active_clients}</p></div>
              <div className="bg-purple-50 p-3 rounded-lg text-center"><p className="text-xs text-purple-600">Binds</p><p className="font-semibold">{detailModal.active_binds}</p></div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="bg-gray-50 p-3 rounded-lg text-center"><p className="text-xs text-gray-500">CPU</p><p className={`font-semibold ${detailModal.cpu_percent > 80 ? 'text-red-600' : 'text-green-600'}`}>{detailModal.cpu_percent}%</p></div>
              <div className="bg-gray-50 p-3 rounded-lg text-center"><p className="text-xs text-gray-500">Memory</p><p className={`font-semibold ${detailModal.memory_percent > 80 ? 'text-red-600' : 'text-green-600'}`}>{detailModal.memory_percent}%</p></div>
              <div className="bg-gray-50 p-3 rounded-lg text-center"><p className="text-xs text-gray-500">Disk</p><p className={`font-semibold ${detailModal.disk_percent > 80 ? 'text-red-600' : 'text-green-600'}`}>{detailModal.disk_percent}%</p></div>
            </div>

            <div className="border-t pt-3">
              <p className="text-xs font-medium text-gray-500 uppercase mb-2">Active Features</p>
              <div className="flex flex-wrap gap-2">
                {Object.entries(detailModal.features).map(([f, e]) => (
                  <Badge key={f} variant={e ? 'success' : 'default'} size="sm">{e ? '✓' : '✗'} {f.replace('_', ' ').toUpperCase()}</Badge>
                ))}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
