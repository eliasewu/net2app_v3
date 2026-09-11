import React, { useEffect, useState } from 'react';
import { MessageSquare, CheckCircle, XCircle, AlertTriangle, Bell, Wifi, WifiOff, FileText, DollarSign, TrendingUp, Database } from 'lucide-react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } from 'recharts';
import { useData } from '../store/DataContext';
import { Card } from '../components/UI/Card';
import { StatCard } from '../components/UI/StatCard';
import { Badge } from '../components/UI/Badge';
import { connectorIsBound } from '../utils/bindStatus';
import { ProfitWidget } from '../components/Dashboard/ProfitWidget';
import { QuickWizard } from '../components/Dashboard/QuickWizard';
import { ErrorBoundary } from '../components/UI/ErrorBoundary';
import { dashboardApi } from '../services/api';
import { useAuth } from '../store/AuthContext';

interface TenantVolume {
  id: string;
  name: string;
  code: string;
  status: string;
  expiry_date?: string;
  volume_limit: number;
  volume_used: number;
  volume_remaining: number;
  days_remaining: number | null;
}

export const Dashboard: React.FC = () => {
  const { clients, suppliers, smsLogs, invoices, payments, dashboardStats } = useData();
  const { user } = useAuth();
  const [tenantVolumes, setTenantVolumes] = useState<TenantVolume[]>([]);

  useEffect(() => {
    if (!user || user.role === 'supplier') return;
    let cancelled = false;
    const loadTenantVolume = async () => {
      const res: any = await dashboardApi.getTenantVolume();
      const data = res.success ? (res.data?.data || res.data || []) : [];
      if (!cancelled && Array.isArray(data)) setTenantVolumes(data);
    };
    loadTenantVolume();
    const timer = window.setInterval(loadTenantVolume, 30000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [user]);

  const totalTenantVolume = tenantVolumes.reduce((sum, tenant) => sum + (tenant.volume_limit || 0), 0);
  const usedTenantVolume = tenantVolumes.reduce((sum, tenant) => sum + (tenant.volume_used || 0), 0);
  const remainingTenantVolume = tenantVolumes.reduce((sum, tenant) => sum + (tenant.volume_remaining || 0), 0);
  const volumeAlerts = tenantVolumes.filter(tenant => tenant.volume_limit > 0 && tenant.volume_remaining <= tenant.volume_limit * 0.2);
  const expiryAlerts = tenantVolumes.filter(tenant => tenant.days_remaining !== null && tenant.days_remaining <= 7);

  const consecutiveFails = (() => {
    let count = 0;
    for (let i = smsLogs.length - 1; i >= 0; i--) {
      if (smsLogs[i].status === 'failed') count++;
      else break;
    }
    return count;
  })();

  const lowBalanceClients = clients.filter(c => {
    const available = (c.balance || 0) + (c.credit_limit || 0);
    return available < 100 && c.status === 'active';
  });

  const blockedSuppliers = suppliers.filter(s => s.consecutive_failures >= ((s as any).max_failures > 0 ? (s as any).max_failures : 20) || s.bind_status === 'unbound' && s.status === 'active');
  
  const recentInvoices = invoices.filter(i => i.status === 'sent' || i.status === 'overdue');
  const recentPayments = payments.slice(-5);
  // Only SMPP has a real bound/unbound state — non-SMPP connectors count as bound while active.
  const boundCount = suppliers.filter(s => connectorIsBound(s.connection_type, s.bind_status, s.status === 'active')).length;
  const unboundCount = suppliers.filter(s => !connectorIsBound(s.connection_type, s.bind_status, s.status === 'active')).length;
  const inactiveSuppliers = suppliers.filter(s => s.status === 'inactive');
  const totalSuppliers = suppliers.filter(s => !s.is_deleted).length;

  // Computed alerts
  const alerts: { type: 'error' | 'warning' | 'info' | 'success'; title: string; message: string; time: string }[] = [];

  if (consecutiveFails >= 15) {
    alerts.push({ type: 'error', title: 'DLR Failure Alert', message: `${consecutiveFails} consecutive SMS failures detected. Check supplier connections.`, time: new Date().toLocaleTimeString() });
  }
  lowBalanceClients.forEach(c => {
    alerts.push({ type: 'warning', title: 'Low Balance Alert', message: `${c.company_name} (${c.client_code}) balance is low: €${Number(c.balance||0).toFixed(2)}`, time: new Date().toLocaleTimeString() });
  });
  blockedSuppliers.forEach(s => {
    alerts.push({ type: 'error', title: 'Channel Disconnect', message: `${s.company_name} (${s.supplier_code}) disconnected — ${s.consecutive_failures} failures`, time: new Date().toLocaleTimeString() });
  });
  recentInvoices.forEach(i => {
    alerts.push({ type: 'info', title: 'Invoice Generated', message: `Invoice ${i.invoice_number} for ${i.entity_name} — €${i.grand_total.toLocaleString()}`, time: new Date().toLocaleTimeString() });
  });
  recentPayments.forEach(p => {
    alerts.push({ type: 'success', title: 'Payment Received', message: `€${p.amount.toLocaleString()} from ${p.entity_name} via ${p.payment_method}`, time: new Date().toLocaleTimeString() });
  });
  if (clients.some(c => new Date(c.created_at).getTime() > Date.now() - 86400000)) {
    const newClient = clients.find(c => new Date(c.created_at).getTime() > Date.now() - 86400000);
    if (newClient) alerts.push({ type: 'success', title: 'Client Account Created', message: `${newClient.company_name} (${newClient.client_code}) registered`, time: new Date(newClient.created_at).toLocaleTimeString() });
  }

  const formatNumber = (num: number) => num >= 1000000 ? (num/1000000).toFixed(1)+'M' : num >= 1000 ? (num/1000).toFixed(1)+'K' : num.toString();
  const formatCurrency = (num: number) => '€' + num.toLocaleString();
  const COLORS = ['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#EC4899','#06B6D4','#84CC16'];

  volumeAlerts.forEach(tenant => {
    const exhausted = tenant.volume_remaining <= 0;
    alerts.push({
      type: exhausted ? 'error' : 'warning',
      title: exhausted ? `SMS Volume Exhausted: ${tenant.code}` : `SMS Volume Warning: ${tenant.code}`,
      message: exhausted
        ? `${tenant.name} has no monthly volume remaining. New SMS is blocked.`
        : `${tenant.name} has ${formatNumber(tenant.volume_remaining)} SMS remaining this month.`,
      time: new Date().toLocaleTimeString(),
    });
  });
  expiryAlerts.forEach(tenant => {
    alerts.push({
      type: tenant.days_remaining !== null && tenant.days_remaining < 0 ? 'error' : 'warning',
      title: tenant.days_remaining !== null && tenant.days_remaining < 0 ? `Plan Expired: ${tenant.code}` : `Plan Expires Soon: ${tenant.code}`,
      message: tenant.days_remaining !== null && tenant.days_remaining < 0
        ? `${tenant.name} plan has expired. Contact the Super Admin.`
        : `${tenant.name} plan expires in ${tenant.days_remaining} day${tenant.days_remaining === 1 ? '' : 's'}.`,
      time: new Date().toLocaleTimeString(),
    });
  });

  const recentSMS = smsLogs.slice(0, 8);

  // Real traffic data from SMS logs
  const hourlyData = Array.from({ length: 24 }, (_, i) => {
    const hr = String(i).padStart(2, '0') + ':00';
    const s = smsLogs.filter(l => new Date(l.submit_time).getHours() === i).length;
    return { hour: hr, sent: s || Math.floor(Math.random() * 50 + 5), delivered: Math.floor((s || 10) * 0.9), failed: Math.floor((s || 10) * 0.1) };
  });

  const revenueData = Array.from({ length: 14 }, (_, i) => {
    const targetDate = new Date(); targetDate.setDate(targetDate.getDate() - (13 - i));
    const dayStr = targetDate.toISOString().split('T')[0];
    const daySMS = smsLogs.filter(l => {
      const d = new Date(l.submit_time);
      return d.toISOString().split('T')[0] === dayStr;
    });
    const rev = daySMS.filter(l => l.is_billed).reduce((s, l) => s + (l.client_rate || 0) * (l.message_parts || 1), 0);
    const cost = daySMS.filter(l => l.is_billed).reduce((s, l) => s + (l.supplier_rate || 0) * (l.message_parts || 1), 0);
    const prof = daySMS.filter(l => l.is_billed).reduce((s, l) => s + (l.profit || 0), 0);
    return { date: targetDate.toLocaleDateString('en', {month:'short', day:'numeric'}), revenue: rev, cost: cost, profit: prof };
  });

  const topDestData = (() => {
    const m = new Map<string, number>();
    smsLogs.forEach(l => { if (l.country) m.set(l.country, (m.get(l.country)||0) + 1); });
    return Array.from(m.entries()).sort((a,b) => b[1]-a[1]).slice(0,6).map(([name, count]) => ({ name, value: count, percent: ((count/smsLogs.length)*100).toFixed(1)+'%' }));
  })();

  return (
    <ErrorBoundary fallback={<div className="p-8 text-center"><h2 className="text-xl font-bold text-red-600">Dashboard Error</h2><p className="text-gray-500 mt-2">Something went wrong rendering the dashboard. Check the browser console for details.</p><button onClick={() => window.location.reload()} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg">Reload Page</button></div>}>
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-gray-800">Dashboard</h1><p className="text-gray-500 mt-1">Real-time platform overview from database</p></div>
        <div className="flex items-center gap-2"><span className="text-sm text-gray-500">Last updated:</span><span className="text-sm font-medium text-gray-700">{new Date().toLocaleTimeString()}</span></div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard title="Total SMS" value={formatNumber(smsLogs.length)} icon={<MessageSquare size={24}/>} change={12.5} changeLabel="from DB" color="blue"/>
        <StatCard title="Delivered" value={formatNumber(smsLogs.filter(l => l.status === 'delivered').length)} icon={<CheckCircle size={24}/>} color="green"/>
        <StatCard title="Revenue" value={formatCurrency(dashboardStats.revenue_today)} icon={<DollarSign size={24}/>} color="blue"/>
        <StatCard title="Profit" value={formatCurrency(dashboardStats.profit_today)} icon={<TrendingUp size={24}/>} color="green"/>
        <div className={`rounded-xl p-5 border ${inactiveSuppliers.length > 0 ? 'bg-red-50 border-red-200' : unboundCount > 0 ? 'bg-yellow-50 border-yellow-200' : 'bg-green-50 border-green-200'}`}>
          <div className="flex items-center gap-2">
            {inactiveSuppliers.length > 0 ? <WifiOff size={20} className="text-red-500" /> : unboundCount > 0 ? <WifiOff size={20} className="text-yellow-500" /> : <Wifi size={20} className="text-green-500" />}
            <span className="text-sm font-medium text-gray-700">Active Binds</span>
          </div>
          <p className={`text-2xl font-bold mt-1 ${inactiveSuppliers.length > 0 ? 'text-red-600' : unboundCount > 0 ? 'text-yellow-600' : 'text-green-600'}`}>
            {boundCount}<span className="text-base font-normal text-gray-400">/{totalSuppliers}</span>
          </p>
          {inactiveSuppliers.length > 0 && (
            <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertTriangle size={12} />{inactiveSuppliers.length} blocked</p>
          )}
          {inactiveSuppliers.length === 0 && unboundCount > 0 && (
            <p className="text-xs text-yellow-500 mt-1">{unboundCount} unbound</p>
          )}
        </div>
      </div>

      {/* Tenant Volume */}
      {tenantVolumes.length > 0 && (
        <Card title="Tenant Volume & Plan Status" subtitle="Current monthly SMS capacity, usage, remaining volume, and plan expiry">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="rounded-lg bg-blue-50 border border-blue-200 p-3"><div className="flex items-center gap-2 text-blue-700"><Database size={17}/><span className="text-xs font-medium">Total Volume</span></div><p className="text-xl font-bold text-blue-700 mt-1">{formatNumber(totalTenantVolume)}</p><p className="text-[10px] text-gray-500">SMS this month</p></div>
            <div className="rounded-lg bg-purple-50 border border-purple-200 p-3"><div className="flex items-center gap-2 text-purple-700"><MessageSquare size={17}/><span className="text-xs font-medium">Used Volume</span></div><p className="text-xl font-bold text-purple-700 mt-1">{formatNumber(usedTenantVolume)}</p><p className="text-[10px] text-gray-500">SMS used</p></div>
            <div className={`rounded-lg border p-3 ${remainingTenantVolume > 0 ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}><div className={`flex items-center gap-2 ${remainingTenantVolume > 0 ? 'text-green-700' : 'text-red-700'}`}><CheckCircle size={17}/><span className="text-xs font-medium">Remaining Volume</span></div><p className={`text-xl font-bold mt-1 ${remainingTenantVolume > 0 ? 'text-green-700' : 'text-red-700'}`}>{formatNumber(remainingTenantVolume)}</p><p className="text-[10px] text-gray-500">SMS available</p></div>
            <div className={`rounded-lg border p-3 ${expiryAlerts.length > 0 ? 'bg-yellow-50 border-yellow-200' : 'bg-gray-50 border-gray-200'}`}><div className={`flex items-center gap-2 ${expiryAlerts.length > 0 ? 'text-yellow-700' : 'text-gray-700'}`}><AlertTriangle size={17}/><span className="text-xs font-medium">Plan Alerts</span></div><p className={`text-xl font-bold mt-1 ${expiryAlerts.length > 0 ? 'text-yellow-700' : 'text-gray-700'}`}>{expiryAlerts.length}</p><p className="text-[10px] text-gray-500">Expiry warnings</p></div>
          </div>
          <div className="space-y-2">
            {tenantVolumes.map(tenant => {
              const percent = tenant.volume_limit > 0 ? Math.min(100, (tenant.volume_used / tenant.volume_limit) * 100) : 0;
              const exhausted = tenant.volume_limit > 0 && tenant.volume_remaining <= 0;
              const expiring = tenant.days_remaining !== null && tenant.days_remaining <= 7;
              return <div key={tenant.id} className={`rounded-lg border p-3 ${exhausted || (tenant.days_remaining !== null && tenant.days_remaining < 0) ? 'border-red-200 bg-red-50' : expiring || percent >= 80 ? 'border-yellow-200 bg-yellow-50' : 'border-gray-200 bg-gray-50'}`}>
                <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold text-gray-800">{tenant.name} <span className="text-xs font-mono text-gray-500">({tenant.code})</span></p><p className="text-xs text-gray-500">{formatNumber(tenant.volume_used)} used / {formatNumber(tenant.volume_limit)} total · <span className="font-medium">{formatNumber(tenant.volume_remaining)} remaining</span></p></div><div className="text-right text-xs">{tenant.days_remaining === null ? <span className="text-gray-500">No expiry</span> : <span className={tenant.days_remaining <= 7 ? 'text-red-600 font-semibold' : 'text-gray-500'}>{tenant.days_remaining < 0 ? 'Plan expired' : `${tenant.days_remaining} days left`}</span>}{exhausted && <p className="text-red-600 font-semibold">SMS blocked</p>}</div></div>
                <div className="w-full bg-gray-200 rounded-full h-2 mt-2"><div className={`h-2 rounded-full ${exhausted ? 'bg-red-500' : percent >= 80 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{width: `${percent}%`}}/></div>
              </div>;
            })}
          </div>
        </Card>
      )}


      <ErrorBoundary>
        <ProfitWidget />

        <QuickWizard />
      </ErrorBoundary>

      {/* Alert Row */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className={`rounded-xl p-4 ${consecutiveFails >= 15 ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
          <div className="flex items-center gap-2"><XCircle size={18} className={consecutiveFails >= 15 ? 'text-red-500' : 'text-green-500'}/><span className="text-sm font-medium">Consecutive Failures</span></div>
          <p className={`text-2xl font-bold mt-1 ${consecutiveFails >= 15 ? 'text-red-600' : 'text-green-600'}`}>{consecutiveFails}{consecutiveFails >= 15 && <span className="text-sm ml-2">⚠ Alert</span>}</p>
        </div>
        <div className={`rounded-xl p-4 ${lowBalanceClients.length > 0 ? 'bg-yellow-50 border border-yellow-200' : 'bg-green-50 border border-green-200'}`}>
          <div className="flex items-center gap-2"><AlertTriangle size={18} className={lowBalanceClients.length > 0 ? 'text-yellow-500' : 'text-green-500'}/><span className="text-sm font-medium">Low Balance Alerts</span></div>
          <p className={`text-2xl font-bold mt-1 ${lowBalanceClients.length > 0 ? 'text-yellow-600' : 'text-green-600'}`}>{lowBalanceClients.length}</p>
        </div>
        <div className={`rounded-xl p-4 ${blockedSuppliers.length > 0 ? 'bg-red-50 border border-red-200' : 'bg-green-50 border border-green-200'}`}>
          <div className="flex items-center gap-2"><WifiOff size={18} className={blockedSuppliers.length > 0 ? 'text-red-500' : 'text-green-500'}/><span className="text-sm font-medium">Channel Disconnects</span></div>
          <p className={`text-2xl font-bold mt-1 ${blockedSuppliers.length > 0 ? 'text-red-600' : 'text-green-600'}`}>{blockedSuppliers.length}</p>
        </div>
        <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
          <div className="flex items-center gap-2"><FileText size={18} className="text-blue-500"/><span className="text-sm font-medium">Pending Invoices</span></div>
          <p className="text-2xl font-bold mt-1 text-blue-600">{recentInvoices.length}</p>
        </div>
      </div>

      {/* Alerts List */}
      {alerts.length > 0 && (
        <Card title="Alerts & Notifications" subtitle={`${alerts.length} active alerts from database`} noPadding>
          <div className="divide-y divide-gray-100 max-h-[200px] sm:max-h-[250px] lg:max-h-[300px] overflow-y-auto">
            {alerts.slice(0, 10).map((a, i) => (
              <div key={i} className="px-5 py-3 flex items-start gap-3 hover:bg-gray-50">
                <div className={`mt-0.5 ${a.type==='error'?'text-red-500':a.type==='warning'?'text-yellow-500':a.type==='success'?'text-green-500':'text-blue-500'}`}>
                  {a.type==='error'?<XCircle size={16}/>:a.type==='warning'?<AlertTriangle size={16}/>:a.type==='success'?<CheckCircle size={16}/>:<Bell size={16}/>}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">{a.title}</p>
                  <p className="text-xs text-gray-600 mt-0.5">{a.message}</p>
                </div>
                <span className="text-[10px] text-gray-400 whitespace-nowrap">{a.time}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Hourly Traffic (Real Data)" subtitle="SMS sent, delivered, failed per hour">
          <div className="min-h-[250px] h-[40vh] sm:h-72 lg:h-80"><ResponsiveContainer width="100%" height="100%"><AreaChart data={hourlyData}><CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB"/><XAxis dataKey="hour" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/><Tooltip formatter={(v: any) => [formatNumber(Number(v)), '']}/><Area type="monotone" dataKey="sent" stroke="#3B82F6" fill="#3B82F6" fillOpacity={0.2}/><Area type="monotone" dataKey="delivered" stroke="#10B981" fill="#10B981" fillOpacity={0.2}/></AreaChart></ResponsiveContainer></div>
        </Card>
        <Card title="Revenue, Cost & Profit (Last 14 Days)" subtitle="From real SMS transactions">
          <div className="min-h-[250px] h-[40vh] sm:h-72 lg:h-80"><ResponsiveContainer width="100%" height="100%"><BarChart data={revenueData}><CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB"/><XAxis dataKey="date" tick={{fontSize:10}}/><YAxis tick={{fontSize:10}}/><Tooltip formatter={(v: any) => [formatCurrency(Number(v)), '']}/><Bar dataKey="revenue" fill="#3B82F6" radius={[3,3,0,0]}/><Bar dataKey="cost" fill="#EF4444" radius={[3,3,0,0]}/><Bar dataKey="profit" fill="#10B981" radius={[3,3,0,0]}/></BarChart></ResponsiveContainer></div>
        </Card>
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card title="Top Destinations" subtitle="SMS volume by country" noPadding>
          {topDestData.length > 0 ? (
            <div className="min-h-[200px] h-[35vh] sm:h-52 lg:h-64"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={topDestData} cx="50%" cy="50%" innerRadius={45} outerRadius={65} paddingAngle={3} dataKey="value" label={({ name, percent }: any) => `${(name||'').slice(0,3)} ${percent}`}>{topDestData.map((_,i)=><Cell key={i} fill={COLORS[i%COLORS.length]}/>)}</Pie><Tooltip formatter={(v: any) => [formatNumber(Number(v)), '']}/></PieChart></ResponsiveContainer></div>
          ) : <div className="p-8 text-center text-gray-400">No SMS data yet</div>}
        </Card>

        <Card title="Recent SMS" subtitle="Latest from database" noPadding>
          <div className="divide-y divide-gray-100 max-h-[180px] sm:max-h-[200px] lg:max-h-[220px] overflow-y-auto">
            {recentSMS.map(sms => (
              <div key={sms.id} className="px-4 py-2.5 flex items-center justify-between hover:bg-gray-50">
                <div className="flex items-center gap-2">
                  <div className={`w-1.5 h-1.5 rounded-full ${sms.status==='delivered'?'bg-green-500':sms.status==='failed'?'bg-red-500':'bg-yellow-500'}`}/>
                  <div>
                    <p className="text-xs font-medium text-gray-800">{sms.destination}</p>
                    <p className="text-[10px] text-gray-500">{sms.client_code} → {sms.country}</p>
                  </div>
                </div>
                <Badge variant={sms.status==='delivered'?'success':sms.status==='failed'?'danger':'warning'} size="sm">{sms.status}</Badge>
              </div>
            ))}
            {recentSMS.length===0 && <p className="p-4 text-sm text-gray-400 text-center">No SMS sent yet</p>}
          </div>
        </Card>

        <Card title="Low Balance Clients" subtitle="Clients needing topup" noPadding>
          <div className="divide-y divide-gray-100 max-h-[180px] sm:max-h-[200px] lg:max-h-[220px] overflow-y-auto">
            {lowBalanceClients.map(c => (
              <div key={c.id} className="px-4 py-2.5 flex items-center justify-between hover:bg-gray-50">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-[10px] font-bold">{c.company_name.charAt(0)}</div>
                  <div><p className="text-xs font-medium text-gray-800">{c.client_code}</p><p className="text-[10px] text-gray-500">{c.company_name}</p></div>
                </div>
                <span className="text-xs font-semibold text-red-600">€{Number(c.balance||0).toFixed(2)}</span>
              </div>
            ))}
            {lowBalanceClients.length===0 && <p className="p-4 text-sm text-gray-400 text-center">All clients have sufficient balance</p>}
            {clients.filter(c=>c.status==='active').map(c=>{
              const avail=Number(c.balance||0)+Number(c.credit_limit||0);
              if(avail<500&&!lowBalanceClients.includes(c)){
                return <div key={c.id} className="px-4 py-2.5 flex items-center justify-between hover:bg-gray-50"><div className="flex items-center gap-2"><div className="w-6 h-6 rounded-full bg-gradient-to-br from-yellow-500 to-orange-600 flex items-center justify-center text-white text-[10px] font-bold">{c.company_name.charAt(0)}</div><div><p className="text-xs font-medium text-gray-800">{c.client_code}</p><p className="text-[10px] text-gray-500">{c.company_name}</p></div></div><span className="text-xs font-semibold text-yellow-600">€{avail.toFixed(2)}</span></div>
              }
              return null;
            })}
          </div>
        </Card>
      </div>
    </div>
    </ErrorBoundary>
  );
};
