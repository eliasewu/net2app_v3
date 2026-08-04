import React, { useState, useEffect, useMemo } from 'react';
import { Shield, CheckCircle, AlertTriangle, Copy, Plus, Edit, Trash2, Monitor, RefreshCw, Clock } from 'lucide-react';
import { useAuth } from '../../store/AuthContext';
import { Card } from '../../components/UI/Card';
import { Button } from '../../components/UI/Button';
import { Badge } from '../../components/UI/Badge';
import { Modal } from '../../components/UI/Modal';
import { Input, Select } from '../../components/UI/Input';
import { Table } from '../../components/UI/Table';
import { licenseApi, systemApi } from '../../services/api';

const PACKAGES: Record<string, { name: string; days: number; sms_monthly: number; max_clients: number; max_suppliers: number; max_tps: number; features: { smpp: boolean; http: boolean; ott: boolean; rcs: boolean; voice_otp: boolean; whatsapp: boolean; telegram: boolean; flash_sms: boolean; email: boolean; voip: boolean; }; color: string; }> = {
  trial: { name: 'Trial', days: 30, sms_monthly: 1000, max_clients: 999999, max_suppliers: 999999, max_tps: 30, features: { smpp: true, http: true, ott: false, rcs: false, voice_otp: false, whatsapp: false, telegram: false, flash_sms: false, email: false, voip: false }, color: 'from-slate-500 to-slate-600' },
  volume_100k: { name: '100K', days: 30, sms_monthly: 100000, max_clients: 999999, max_suppliers: 999999, max_tps: 100, features: { smpp: true, http: true, ott: true, rcs: false, voice_otp: true, whatsapp: true, telegram: false, flash_sms: true, email: false, voip: false }, color: 'from-blue-500 to-blue-600' },
  volume_1m: { name: '1M', days: 30, sms_monthly: 1000000, max_clients: 999999, max_suppliers: 999999, max_tps: 300, features: { smpp: true, http: true, ott: true, rcs: true, voice_otp: true, whatsapp: true, telegram: true, flash_sms: true, email: true, voip: false }, color: 'from-purple-500 to-purple-600' },
  volume_5m: { name: '5M', days: 30, sms_monthly: 5000000, max_clients: 999999, max_suppliers: 999999, max_tps: 800, features: { smpp: true, http: true, ott: true, rcs: true, voice_otp: true, whatsapp: true, telegram: true, flash_sms: true, email: true, voip: true }, color: 'from-indigo-500 to-indigo-600' },
  volume_10m: { name: '10M', days: 30, sms_monthly: 10000000, max_clients: 999999, max_suppliers: 999999, max_tps: 1500, features: { smpp: true, http: true, ott: true, rcs: true, voice_otp: true, whatsapp: true, telegram: true, flash_sms: true, email: true, voip: true }, color: 'from-green-500 to-emerald-600' },
  volume_15m: { name: '15M', days: 30, sms_monthly: 15000000, max_clients: 999999, max_suppliers: 999999, max_tps: 2500, features: { smpp: true, http: true, ott: true, rcs: true, voice_otp: true, whatsapp: true, telegram: true, flash_sms: true, email: true, voip: true }, color: 'from-amber-500 to-orange-600' },
  volume_30m: { name: '30M', days: 30, sms_monthly: 30000000, max_clients: 999999, max_suppliers: 999999, max_tps: 4000, features: { smpp: true, http: true, ott: true, rcs: true, voice_otp: true, whatsapp: true, telegram: true, flash_sms: true, email: true, voip: true }, color: 'from-rose-500 to-pink-600' },
  unlimited: { name: 'Unlimited', days: 365, sms_monthly: 999999999, max_clients: 999999, max_suppliers: 999999, max_tps: 10000, features: { smpp: true, http: true, ott: true, rcs: true, voice_otp: true, whatsapp: true, telegram: true, flash_sms: true, email: true, voip: true }, color: 'from-pink-500 to-rose-600' },
};

const FEATURE_LABELS: Record<string, string> = {
  smpp: 'SMPP', http: 'HTTP API', ott: 'OTT', rcs: 'RCS',
  voice_otp: 'Voice OTP', whatsapp: 'WhatsApp Business', telegram: 'Telegram Business',
  flash_sms: 'Flash SMS', email: 'Email', voip: 'VoIP',
};

const FEATURE_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  smpp:      { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  http:      { bg: 'bg-green-50',   text: 'text-green-700',   border: 'border-green-200' },
  voice_otp: { bg: 'bg-purple-50',  text: 'text-purple-700',  border: 'border-purple-200' },
  rcs:       { bg: 'bg-violet-50',  text: 'text-violet-700',  border: 'border-violet-200' },
  whatsapp:  { bg: 'bg-sky-50',     text: 'text-sky-700',     border: 'border-sky-200' },
  telegram:  { bg: 'bg-cyan-50',    text: 'text-cyan-700',    border: 'border-cyan-200' },
  ott:       { bg: 'bg-indigo-50',  text: 'text-indigo-700',  border: 'border-indigo-200' },
  flash_sms: { bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200' },
  email:     { bg: 'bg-slate-50',   text: 'text-slate-700',   border: 'border-slate-200' },
  voip:      { bg: 'bg-purple-50',  text: 'text-purple-700',  border: 'border-purple-200' },
};

interface LicenseInfo {
  id?: number; key?: string; type?: string; status?: string; issued_to?: string;
  issued_date?: string; expiry_date?: string; activated_at?: string;
  system_ip?: string; system_mac?: string;
  features?: any; limits?: any; usage?: any;
}
interface Tenant {
  id: string; name: string; code: string; status: string;
  features?: any; limits?: any; usage?: any;
  ip?: string; mac?: string; license_expiry?: string; created_at?: string;
}

export const License: React.FC = () => {
  const { user } = useAuth();
  const isSuperUser = user?.role === 'super_admin';
  const [license, setLicense] = useState<LicenseInfo>({});
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [serverIP, setServerIP] = useState('');
  const [serverMAC, setServerMAC] = useState('');
  const [detecting, setDetecting] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);

  const [showActivate, setShowActivate] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [showTenantModal, setShowTenantModal] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [licenseKeyInput, setLicenseKeyInput] = useState('');
  const [generatedKey, setGeneratedKey] = useState('');
  const [generatePackage, setGeneratePackage] = useState('trial');
  const [generateCompany, setGenerateCompany] = useState('');
  const [generateTenant, setGenerateTenant] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [featureFilter, setFeatureFilter] = useState<string>('');
  const filteredTenants = useMemo(
    () => featureFilter ? tenants.filter(t => (t.features||{})[featureFilter]) : tenants,
    [tenants, featureFilter]
  );

  const [tenantForm, setTenantForm] = useState({ name:'', code:'', ip:'', mac:'', max_sms_monthly:100, max_tps:5, features: { smpp: true, http: true, ott: false, rcs: false, voice_otp: false, whatsapp: false, telegram: false, flash_sms: false, email: false, voip: false } as Record<string,boolean> });

  // Retention cleanup state
  const [retentionLoading, setRetentionLoading] = useState(false);
  const [retentionMonths, setRetentionMonths] = useState(6);
  const [retentionResult, setRetentionResult] = useState<{ cutoff_months: number; total_cleaned: number; breakdown: Record<string, number>; preserved: string } | null>(null);
  const [retentionError, setRetentionError] = useState('');

  const loadData = async () => {
    try {
      const [infoRes, tenantsRes, sysRes]: any[] = await Promise.all([
        licenseApi.getInfo().catch(() => ({ success: false })),
        licenseApi.getTenants().catch(() => ({ success: false })),
        licenseApi.getSystemInfo().catch(() => ({ success: false })),
      ]);
      if (infoRes.success && infoRes.data?.data) setLicense(infoRes.data.data);
      else if (infoRes.success && infoRes.data) setLicense(infoRes.data);
      if (tenantsRes.success && tenantsRes.data?.data) setTenants(tenantsRes.data.data);
      else if (tenantsRes.success && Array.isArray(tenantsRes.data)) setTenants(tenantsRes.data);
      // Auto-detect server IP/MAC for license key generation
      if (sysRes.success && sysRes.data?.data) {
        setServerIP(sysRes.data.data.ip || '');
        setServerMAC(sysRes.data.data.mac || '');
      }
    } catch (e) { console.warn('License fetch failed'); }
    finally { setDataLoading(false); }
  };

  const handleRetentionCleanup = async () => {
    setRetentionLoading(true);
    setRetentionError('');
    setRetentionResult(null);
    try {
      const res: any = await systemApi.cleanupRetention(retentionMonths);
      if (res.success && res.data?.data) {
        setRetentionResult(res.data.data);
      } else {
        setRetentionError(res.error || 'Cleanup failed');
      }
    } catch (e: any) {
      setRetentionError(e.message || 'Cleanup failed');
    }
    setRetentionLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const handleDetect = async () => {
    setDetecting(true);
    try {
      const sysRes: any = await licenseApi.getSystemInfo();
      if (sysRes.success && sysRes.data?.data) {
        setServerIP(sysRes.data.data.ip || '');
        setServerMAC(sysRes.data.data.mac || '');
      }
    } catch {}
    setDetecting(false);
  };

  const handleActivate = async () => {
    if (!licenseKeyInput) { setError('Please enter a license key'); return; }
    setSaving(true); setError('');
    try {
      await licenseApi.activate(licenseKeyInput);
      setShowActivate(false);
      await loadData();
    } catch (e: any) { setError(e.message); }
    setSaving(false);
  };

  const handleGenerate = async () => {
    if (!isSuperUser) { alert('Super Admin only'); return; }
    setSaving(true); setError('');
    try {
      const res: any = await licenseApi.generateKey({ type: generatePackage, company_name: generateCompany, tenant_code: generateTenant || undefined, system_ip: serverIP, system_mac: serverMAC });
      if (res.success && res.data?.key) setGeneratedKey(res.data.key);
    } catch (e: any) { setError(e.message); }
    setSaving(false);
  };

  const copyKey = (text: string) => { navigator.clipboard.writeText(text); alert('Copied!'); };

  const openTenant = (t?: Tenant) => {
    const defaultFeatures = { smpp: true, http: true, ott: false, rcs: false, voice_otp: false, whatsapp: false, telegram: false, flash_sms: false, email: false, voip: false };
    if (t) { setEditingTenant(t); setTenantForm({ name:t.name, code:t.code, ip:t.ip||'', mac:t.mac||'', max_sms_monthly:t.limits?.max_sms_monthly||100, max_tps:t.limits?.max_tps||5, features: { ...defaultFeatures, ...(t.features || {}) } }); }
    else { setEditingTenant(null); setTenantForm({ name:'', code:'', ip:'', mac:'', max_sms_monthly:100, max_tps:5, features: defaultFeatures }); }
    setShowTenantModal(true);
  };

  const saveTenant = async () => {
    setSaving(true); setError('');
    try {
      if (editingTenant) {
        await licenseApi.updateTenant(editingTenant.id, tenantForm);
      } else {
        await licenseApi.createTenant(tenantForm);
      }
      setShowTenantModal(false);
      await loadData();
    } catch (e: any) { setError(e.message); }
    setSaving(false);
  };

  const deleteTenant = async (id: string) => {
    if (!window.confirm('Delete this tenant?')) return;
    try { await licenseApi.deleteTenant(id); await loadData(); } catch (e: any) { alert(e.message); }
  };

  const pkg = PACKAGES[license.type || 'trial'];
  const daysRemaining = Math.max(0, (pkg?.days || 30) - (license.usage?.days_used || 0));
  const totalSMS = (license.limits?.max_sms_monthly || 1000);
  const smsUsed = license.usage?.sms_this_month || 0;

  const tenantCols = [
    { key:'name', header:'Tenant', render:(t:Tenant) => <div><p className="font-medium text-sm">{t.name}</p><p className="text-[10px] text-gray-500">{t.code}</p></div> },
    { key:'status', header:'Status', render:(t:Tenant) => <Badge variant={t.status==='active'?'success':'danger'} dot size="sm">{t.status}</Badge> },
    { key:'usage', header:'SMS', render:(t:Tenant) => { const pct=((t.usage?.sms_this_month||0)/(t.limits?.max_sms_monthly||1))*100; return <div className="w-28"><div className="flex justify-between text-[10px]"><span>{t.usage?.sms_this_month||0}</span><span className="text-gray-400">/{t.limits?.max_sms_monthly||'-'}</span></div><div className="w-full bg-gray-200 rounded-full h-1.5"><div className={`h-1.5 rounded-full ${pct>90?'bg-red-500':pct>70?'bg-yellow-500':'bg-green-500'}`} style={{width:`${Math.min(pct,100)}%`}}/></div></div>; } },
    { key:'features', header:'Features', render:(t:Tenant) => {
    const feats = t.features || {};
    const enabled = Object.entries(FEATURE_LABELS).filter(([k]) => feats[k]);
    if (enabled.length === 0) return <span className="text-[10px] text-gray-400 italic">none</span>;
    return <div className="flex flex-wrap gap-1 max-w-[220px]">
      {enabled.map(([k, label]) => (
        <span key={k} className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-medium ${(FEATURE_COLORS[k] || FEATURE_COLORS.ott).bg} ${(FEATURE_COLORS[k] || FEATURE_COLORS.ott).text} ${(FEATURE_COLORS[k] || FEATURE_COLORS.ott).border}`}>
          {label}
        </span>
      ))}
    </div>;
  } },
{ key:'ip', header:'IP', render:(t:Tenant) => <span className="font-mono text-[10px]">{t.ip||'-'}</span> },
    { key:'expiry', header:'Expires', render:(t:Tenant) => <span className="text-xs">{t.license_expiry||'-'}</span> },
    { key:'actions', header:'', render:(t:Tenant) => <div className="flex gap-1"><button onClick={()=>openTenant(t)} className="p-1 rounded hover:bg-gray-100"><Edit size={14} className="text-gray-500"/></button><button onClick={()=>deleteTenant(t.id)} className="p-1 rounded hover:bg-gray-100"><Trash2 size={14} className="text-red-500"/></button></div> },
  ];

  

  return (<div className="space-y-6">
    <div className="flex items-center justify-between">
      <div><h1 className="text-2xl font-bold text-gray-800">License Management</h1><p className="text-gray-500 mt-1">{isSuperUser ? <span className="text-green-600 font-medium">🔒 Super Admin Access</span> : <span className="text-red-600">⛔ Super Admin only</span>}</p></div>
      <div className="flex gap-2">
        {isSuperUser && <><Button variant="secondary" icon={<Monitor size={16}/>} onClick={handleDetect} loading={detecting}>Detect Server</Button><Button variant="secondary" icon={<RefreshCw size={16}/>} onClick={() => setShowActivate(true)}>Activate License</Button><Button icon={<Plus size={16}/>} onClick={() => { setShowGenerate(true); setGeneratedKey(''); setGeneratePackage('trial'); setGenerateCompany(''); setGenerateTenant(''); setError(''); }}>Generate Key</Button></>}
      </div>
    </div>

    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {Object.entries(PACKAGES).map(([key, p]) => {
        const active = license.type === key;
        const featuresList = Object.entries(p.features).filter(([,v]) => v).map(([k]) => k);
        return (
        <div key={key} className={`rounded-xl p-4 text-white bg-gradient-to-br ${p.color} transition-all duration-200 ${active ? 'ring-2 ring-white/40 scale-[1.03] shadow-2xl' : 'opacity-75 hover:opacity-90'}`}>
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-bold">{p.name}</h3>
            {active && <Badge variant="success" size="sm">ACTIVE</Badge>}
          </div>
          <div className="mt-2 space-y-0.5 text-xs">
            <p>📱 <span className="font-semibold">{p.sms_monthly >= 999999999 ? '∞' : p.sms_monthly.toLocaleString()}</span> SMS/mo</p>
            <p>⚡ <span className="font-semibold">{p.max_tps.toLocaleString()}</span> TPS</p>
            <p>📅 <span className="font-semibold">{p.days}</span> days</p>
          </div>
          <div className="mt-3 flex flex-wrap gap-1">
            {featuresList.slice(0, 6).map(f => (
              <span key={f} className="px-1.5 py-0.5 bg-white/20 rounded text-[10px] font-medium">{f.replace('_',' ').toUpperCase()}</span>
            ))}
            {featuresList.length > 6 && <span className="px-1.5 py-0.5 bg-white/20 rounded text-[10px] font-medium">+{featuresList.length - 6}</span>}
          </div>
        </div>
        );
      })}
    </div>

    <Card>
      {dataLoading && !license.key ? (
        <div className="animate-pulse space-y-4">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-xl bg-gray-200" />
              <div className="space-y-2">
                <div className="h-5 w-36 bg-gray-200 rounded" />
                <div className="h-3 w-24 bg-gray-100 rounded" />
              </div>
            </div>
            <div className="h-6 w-16 bg-gray-200 rounded-full" />
          </div>
          <div className="bg-gray-100 rounded-lg p-3 mb-3 space-y-2">
            <div className="h-3 w-20 bg-gray-200 rounded" />
            <div className="h-4 w-64 bg-gray-200 rounded" />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div><div className="h-3 w-16 bg-gray-200 rounded mb-1.5" /><div className="h-4 w-20 bg-gray-200 rounded" /></div>
            <div><div className="h-3 w-16 bg-gray-200 rounded mb-1.5" /><div className="h-4 w-20 bg-gray-200 rounded" /></div>
            <div><div className="h-3 w-16 bg-gray-200 rounded mb-1.5" /><div className="h-4 w-20 bg-gray-200 rounded" /></div>
            <div><div className="h-3 w-16 bg-gray-200 rounded mb-1.5" /><div className="h-4 w-20 bg-gray-200 rounded" /></div>
          </div>
        </div>
      ) : (
        <>
          <div className="flex items-start justify-between mb-4"><div className="flex items-center gap-4"><div className={`p-4 rounded-xl ${license.status==='active'?'bg-green-100':'bg-red-100'}`}>{license.status==='active'?<Shield size={32} className="text-green-600"/>:<AlertTriangle size={32} className="text-red-600"/>}</div><div><h3 className="text-xl font-semibold capitalize">{license.type || 'trial'} License</h3><p className="text-gray-500">{license.issued_to || '-'}</p></div></div><Badge variant={license.status==='active'?'success':'danger'} size="md">{(license.status||'').toUpperCase()}</Badge></div>
          <div className="bg-gray-50 rounded-lg p-3 mb-3"><div className="flex items-center justify-between"><span className="text-sm text-gray-500">License Key</span><button onClick={()=>copyKey(license.key||'')} className="p-1 rounded hover:bg-gray-200"><Copy size={14} className="text-gray-500"/></button></div><p className="font-mono text-sm">{license.key || '-'}</p></div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm"><div><p className="text-xs text-gray-500">Server IP</p><p className="font-mono text-sm">{serverIP || license.system_ip || '-'}</p></div><div><p className="text-xs text-gray-500">MAC Address</p><p className="font-mono text-xs text-gray-500">{serverMAC || license.system_mac || '-'}</p></div><div><p className="text-xs text-gray-500">Activated</p><p>{license.issued_date || '-'}</p></div><div><p className="text-xs text-gray-500">Expires</p><p className={daysRemaining < 7 ? 'text-red-600 font-semibold' : ''}>{license.expiry_date || '-'} ({daysRemaining}d)</p></div><div><p className="text-xs text-gray-500">SMS Used</p><p>{smsUsed.toLocaleString()} / {totalSMS.toLocaleString()}</p></div></div>
        </>
      )}
    </Card>        <Card title="Tenants" subtitle={dataLoading && filteredTenants.length === 0 ? 'Loading...' : `${filteredTenants.length} tenants`} action={
          <div className="flex items-center gap-2">
            <select
              value={featureFilter}
              onChange={e => setFeatureFilter(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              <option value="">All features</option>
              {Object.entries(FEATURE_LABELS).map(([k, label]) => (
                <option key={k} value={k}>{label}</option>
              ))}
            </select>
            {isSuperUser && <Button size="sm" icon={<Plus size={16}/>} onClick={()=>openTenant()}>Add Tenant</Button>}
          </div>
        } noPadding>
          {dataLoading && filteredTenants.length === 0 ? (
            <div className="divide-y divide-gray-100">
              {[1,2,3,4,5].map(i => (
                <div key={i} className="flex items-center gap-3 px-4 py-3 animate-pulse">
                  <div className="h-9 w-9 rounded-lg bg-gray-200 shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3.5 w-28 bg-gray-200 rounded" />
                    <div className="h-3 w-16 bg-gray-100 rounded" />
                  </div>
                  <div className="h-5 w-12 bg-gray-200 rounded-full shrink-0" />
                  <div className="h-3 w-14 bg-gray-200 rounded shrink-0" />
                  <div className="h-4 w-20 bg-gray-200 rounded shrink-0" />
                  <div className="h-3 w-10 bg-gray-200 rounded shrink-0" />
                </div>
              ))}
            </div>
          ) : (
            <Table columns={tenantCols} data={filteredTenants} keyExtractor={t=>t.id}/>
          )}
        </Card>

    {/* Data Retention Cleanup */}
    <Card title="Data Retention Cleanup" subtitle="Purge non-critical operational data older than N months. SMS logs, payments, invoices, and financial CDR data are preserved forever.">
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm text-gray-600 whitespace-nowrap">Purge data older than</label>
            <select
              value={retentionMonths}
              onChange={e => setRetentionMonths(parseInt(e.target.value))}
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value={3}>3 months</option>
              <option value={6}>6 months</option>
              <option value={12}>12 months</option>
              <option value={24}>24 months</option>
            </select>
          </div>
          <Button
            variant="danger"
            icon={<Trash2 size={16}/>}
            onClick={handleRetentionCleanup}
            loading={retentionLoading}
          >
            Run Cleanup
          </Button>
          <span className="text-xs text-gray-400">
            <Clock size={12} className="inline mr-1"/>
            Auto-runs weekly on the server
          </span>
        </div>

        {retentionError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">{retentionError}</div>
        )}

        {retentionResult && (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle size={18} className="text-green-600"/>
              <span className="font-semibold text-green-800">
                {retentionResult.total_cleaned.toLocaleString()} rows purged (older than {retentionResult.cutoff_months} months)
              </span>
            </div>
            {retentionResult.total_cleaned > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                {Object.entries(retentionResult.breakdown)
                  .filter(([, count]) => count > 0)
                  .sort(([, a], [, b]) => b - a)
                  .map(([table, count]) => (
                    <div key={table} className="bg-white rounded-md px-3 py-1.5 border border-green-100 flex justify-between">
                      <span className="text-gray-600 font-mono">{table}</span>
                      <span className="font-semibold text-green-700">{count.toLocaleString()}</span>
                    </div>
                  ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No data to clean up — everything is within the retention window.</p>
            )}
            <div className="mt-3 pt-3 border-t border-green-200">
              <p className="text-xs text-gray-500">
                <span className="font-medium text-green-700">✓ Preserved:</span> {retentionResult.preserved}
              </p>
            </div>
          </div>
        )}
      </div>
    </Card>

    <Modal isOpen={showActivate} onClose={()=>setShowActivate(false)} title="Activate License" footer={<div className="flex justify-end gap-3"><Button variant="secondary" onClick={()=>setShowActivate(false)}>Cancel</Button><Button onClick={handleActivate} loading={saving}>Activate</Button></div>}>
      {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm mb-3">{error}</div>}
      <Input label="License Key *" value={licenseKeyInput} onChange={e=>setLicenseKeyInput(e.target.value)} placeholder="N2A-TRI-2026-XXXX-XXXX-XXXX"/>
    </Modal>

    <Modal isOpen={showGenerate} onClose={()=>{setShowGenerate(false);setGeneratedKey('');setGeneratePackage('trial');setGenerateCompany('');setGenerateTenant('');setError('');}} title="Generate License Key" size="lg" footer={<div className="flex justify-end gap-3"><Button variant="secondary" onClick={()=>{setShowGenerate(false);setGeneratedKey('');setGeneratePackage('trial');setGenerateCompany('');setGenerateTenant('');setError('');}}>Close</Button>{!generatedKey && <Button onClick={handleGenerate} loading={saving}>Generate Key</Button>}</div>}>
      {generatedKey ? (<div className="text-center py-4"><CheckCircle size={48} className="mx-auto text-green-500 mb-3"/><h3 className="font-semibold">Key Generated</h3><div className="bg-gray-100 p-3 rounded-lg my-3"><p className="font-mono text-sm break-all">{generatedKey}</p></div><Button size="sm" variant="secondary" icon={<Copy size={14}/>} onClick={()=>copyKey(generatedKey)}>Copy</Button></div>
      ) : (<div className="space-y-3">{error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}<Select label="Package" value={generatePackage} onChange={e => setGeneratePackage(e.target.value)} options={Object.entries(PACKAGES).map(([k,v])=>({value:k,label:`${v.name} — ${v.sms_monthly.toLocaleString()} SMS/month`}))}/><Input label="Company Name" value={generateCompany} onChange={e => setGenerateCompany(e.target.value)} placeholder="My Company Ltd"/><Select label="Tenant (optional)" value={generateTenant} onChange={e => setGenerateTenant(e.target.value)} options={[{value:'',label:'— None (standalone license) —'},...tenants.filter(t=>t.status==='active').map(t=>({value:t.code,label:`${t.name} (${t.code})`}))]}/><div className="bg-gray-50 border border-gray-200 rounded-lg p-3"><div className="flex items-center justify-between mb-2"><span className="text-xs font-medium text-gray-500 uppercase tracking-wider">Server Detection</span><button onClick={handleDetect} disabled={detecting} className="text-xs text-blue-600 hover:text-blue-700 font-medium disabled:opacity-50">{detecting ? 'Detecting...' : '⟳ Refresh'}</button></div><div className="grid grid-cols-2 gap-3 text-sm"><div><span className="text-xs text-gray-400">IP Address</span><p className="font-mono text-sm text-gray-700">{serverIP || 'Not detected'}</p></div><div><span className="text-xs text-gray-400">MAC Address</span><p className="font-mono text-sm text-gray-700">{serverMAC || 'Not detected'}</p></div></div>{(!serverIP && !serverMAC) && <p className="text-xs text-amber-600 mt-2">Click Refresh to detect server IP/MAC before generating.</p>}</div></div>)}
    </Modal>

    <Modal isOpen={showTenantModal} onClose={()=>setShowTenantModal(false)} title={editingTenant?'Edit Tenant':'Add Tenant'} footer={<div className="flex justify-end gap-3"><Button variant="secondary" onClick={()=>setShowTenantModal(false)}>Cancel</Button><Button onClick={saveTenant} loading={saving}>Save</Button></div>}>
      {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm mb-3">{error}</div>}
      <div className="space-y-3"><div className="grid grid-cols-2 gap-3"><Input label="Name" value={tenantForm.name} onChange={e=>setTenantForm(p=>({...p,name:e.target.value}))} required/><Input label="Code" value={tenantForm.code} onChange={e=>setTenantForm(p=>({...p,code:e.target.value.toUpperCase()}))} required/></div><div className="grid grid-cols-2 gap-3"><Input label="IP" value={tenantForm.ip} onChange={e=>setTenantForm(p=>({...p,ip:e.target.value}))}/><Input label="MAC" value={tenantForm.mac} onChange={e=>setTenantForm(p=>({...p,mac:e.target.value}))}/></div><div className="grid grid-cols-2 gap-3"><Input label="Monthly SMS Limit" type="number" value={tenantForm.max_sms_monthly} onChange={e=>setTenantForm(p=>({...p,max_sms_monthly:parseInt(e.target.value)||0}))}/><Input label="Max TPS" type="number" value={tenantForm.max_tps} onChange={e=>setTenantForm(p=>({...p,max_tps:parseInt(e.target.value)||0}))}/></div>
        <div>
          <p className="text-sm font-medium text-gray-700 mb-2">Feature Toggles</p>
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 p-3 bg-gray-50 rounded-lg border">
            {Object.entries(tenantForm.features || {}).map(([key, val]) => (
              <label key={key} className="flex items-center gap-2 cursor-pointer hover:bg-gray-100 px-2 py-1 rounded transition">
                <input
                  type="checkbox"
                  checked={val as boolean}
                  onChange={e => setTenantForm(p => ({ ...p, features: { ...p.features, [key]: e.target.checked } }))}
                  disabled={saving} className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                />
                <span className={`inline-block w-2.5 h-2.5 rounded-full ${(FEATURE_COLORS[key]||FEATURE_COLORS.ott).text.replace('text-','bg-')}`} />
  <span className="text-sm text-gray-700">{FEATURE_LABELS[key] || key}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  </div>);
};
