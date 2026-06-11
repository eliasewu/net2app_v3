import React, { useState, useEffect } from 'react';
import { Shield, Server, Users, MessageSquare, CheckCircle, XCircle, AlertTriangle, Copy, Plus, Edit, Trash2, Gauge, BarChart3, Key, Clock, Zap, Monitor, RefreshCw } from 'lucide-react';
import { useAuth } from '../../store/AuthContext';
import { Card } from '../../components/UI/Card';
import { Button } from '../../components/UI/Button';
import { Badge } from '../../components/UI/Badge';
import { Modal } from '../../components/UI/Modal';
import { Input, Select } from '../../components/UI/Input';
import { Table } from '../../components/UI/Table';

// ============================================================
// LICENSE PACKAGES
// ============================================================
// All packages are 30-day volume-based rentals
const PACKAGES: Record<string, {
  name: string;
  days: number;
  sms_monthly: number;
  max_clients: number;
  max_suppliers: number;
  max_tps: number;
  sms_per_client: number;
  tps_per_client: number;
  features: { smpp: boolean; http: boolean; whatsapp: boolean; telegram: boolean; rcs: boolean; voice_otp: boolean; };
  color: string;
  desc: string;
}> = {
  trial: {
    name: 'Trial',
    days: 30,
    sms_monthly: 1000,
    max_clients: 999999,
    max_suppliers: 999999,
    max_tps: 50,
    sms_per_client: 999999,
    tps_per_client: 50,
    features: { smpp: true, http: true, whatsapp: false, telegram: false, rcs: false, voice_otp: false },
    color: 'from-blue-500 to-blue-600',
    desc: '1,000 SMS/month trial',
  },
  volume_100k: {
    name: '100K Volume',
    days: 30,
    sms_monthly: 100000,
    max_clients: 999999,
    max_suppliers: 999999,
    max_tps: 100,
    sms_per_client: 999999,
    tps_per_client: 50,
    features: { smpp: true, http: true, whatsapp: true, telegram: false, rcs: false, voice_otp: true },
    color: 'from-purple-500 to-purple-600',
    desc: '100,000 SMS/month rental',
  },
  volume_500k: {
    name: '500K Volume',
    days: 30,
    sms_monthly: 500000,
    max_clients: 999999,
    max_suppliers: 999999,
    max_tps: 250,
    sms_per_client: 999999,
    tps_per_client: 100,
    features: { smpp: true, http: true, whatsapp: true, telegram: true, rcs: false, voice_otp: true },
    color: 'from-indigo-500 to-indigo-700',
    desc: '500,000 SMS/month rental',
  },
  volume_1m: {
    name: '1M Volume',
    days: 30,
    sms_monthly: 1000000,
    max_clients: 999999,
    max_suppliers: 999999,
    max_tps: 500,
    sms_per_client: 999999,
    tps_per_client: 200,
    features: { smpp: true, http: true, whatsapp: true, telegram: true, rcs: true, voice_otp: true },
    color: 'from-green-500 to-emerald-600',
    desc: '1,000,000 SMS/month rental',
  },
  volume_5m: {
    name: '5M Volume',
    days: 30,
    sms_monthly: 5000000,
    max_clients: 999999,
    max_suppliers: 999999,
    max_tps: 1000,
    sms_per_client: 999999,
    tps_per_client: 500,
    features: { smpp: true, http: true, whatsapp: true, telegram: true, rcs: true, voice_otp: true },
    color: 'from-orange-500 to-red-600',
    desc: '5,000,000 SMS/month rental',
  },
  volume_10m: {
    name: '10M Volume',
    days: 30,
    sms_monthly: 10000000,
    max_clients: 999999,
    max_suppliers: 999999,
    max_tps: 2000,
    sms_per_client: 999999,
    tps_per_client: 1000,
    features: { smpp: true, http: true, whatsapp: true, telegram: true, rcs: true, voice_otp: true },
    color: 'from-pink-500 to-rose-600',
    desc: '10,000,000 SMS/month rental',
  },
  volume_25m: {
    name: '25M Volume',
    days: 30,
    sms_monthly: 25000000,
    max_clients: 999999,
    max_suppliers: 999999,
    max_tps: 5000,
    sms_per_client: 999999,
    tps_per_client: 2000,
    features: { smpp: true, http: true, whatsapp: true, telegram: true, rcs: true, voice_otp: true },
    color: 'from-teal-500 to-cyan-600',
    desc: '25,000,000 SMS/month rental',
  },
  volume_50m: {
    name: '50M Volume',
    days: 30,
    sms_monthly: 50000000,
    max_clients: 999999,
    max_suppliers: 999999,
    max_tps: 10000,
    sms_per_client: 999999,
    tps_per_client: 5000,
    features: { smpp: true, http: true, whatsapp: true, telegram: true, rcs: true, voice_otp: true },
    color: 'from-violet-500 to-purple-700',
    desc: '50,000,000 SMS/month rental',
  },
};

// ============================================================
// LICENSE TYPES
// ============================================================
interface LicenseInfo {
  key: string;
  type: string;
  status: 'active' | 'expired' | 'invalid';
  issued_to: string;
  issued_date: string;
  expiry_date: string;
  activated_at: string;
  system_ip: string;
  system_mac: string;
  features: { smpp: boolean; http: boolean; whatsapp: boolean; telegram: boolean; rcs: boolean; voice_otp: boolean; };
  limits: { max_clients: number; max_suppliers: number; max_sms_monthly: number; max_tps: number; max_sms_per_client: number; max_tps_per_client: number; };
  usage: { sms_this_month: number; sms_total: number; days_used: number; };
  extended_by: string;
  extended_at: string;
  extension_sms: number;
}

interface Tenant {
  id: string; name: string; code: string; status: 'active' | 'inactive' | 'suspended';
  features: { smpp: boolean; http: boolean; whatsapp: boolean; telegram: boolean; rcs: boolean; voice_otp: boolean; };
  limits: { max_sms_monthly: number; max_tps: number; };
  usage: { sms_this_month: number; current_tps: number; sms_today: number; };
  ip: string; mac: string; license_expiry: string;
  created_at: string;
}

// ============================================================
// AUTO-DETECT SERVER IP & MAC
// ============================================================
async function detectServerInfo(): Promise<{ ip: string; mac: string }> {
  // Try to get public IP
  let ip = '127.0.0.1';
  try {
    const res = await fetch('https://api.ipify.org?format=json');
    if (res.ok) { const data = await res.json(); ip = data.ip; }
  } catch {}
  // MAC is generated from IP hash (in production: real system MAC)
  const mac = '00:' + ip.split('.').map((n: string) => parseInt(n).toString(16).padStart(2, '0').toUpperCase()).slice(0, 4).join(':') + ':' + Array(2).fill(0).map(() => Math.floor(Math.random() * 256).toString(16).padStart(2, '0').toUpperCase()).join(':');
  return { ip, mac };
}

// Load/Save
function load<T>(key: string, fallback: T): T { try { const s=localStorage.getItem(key); if(s) return JSON.parse(s); } catch{} return fallback; }
function save<T>(key: string, v: T) { localStorage.setItem(key, JSON.stringify(v)); }

// Default license — Trial 1000 SMS
const defaultLicense: LicenseInfo = {
  key: 'N2A-TRI-2026-UZ1P-IQGQ-7Z7F',
  type: 'trial',
  status: 'active',
  issued_to: 'NET2APP Hub',
  issued_date: new Date().toISOString().split('T')[0],
  expiry_date: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
  activated_at: new Date().toISOString(),
  system_ip: '192.168.1.100',
  system_mac: '00:1A:2B:3C:4D:5E',
  features: PACKAGES.trial.features,
  limits: {
    max_clients: PACKAGES.trial.max_clients,
    max_suppliers: PACKAGES.trial.max_suppliers,
    max_sms_monthly: PACKAGES.trial.sms_monthly,
    max_tps: PACKAGES.trial.max_tps,
    max_sms_per_client: PACKAGES.trial.sms_per_client,
    max_tps_per_client: PACKAGES.trial.tps_per_client,
  },
  usage: { sms_this_month: 0, sms_total: 0, days_used: 0 },
  extended_by: '',
  extended_at: '',
  extension_sms: 0,
};

const defaultTenants: Tenant[] = [
  { id:'1', name:'TechCorp Global', code:'TCG', status:'active', features:{ smpp:true, http:true, whatsapp:false, telegram:false, rcs:false, voice_otp:false }, limits:{ max_sms_monthly:500, max_tps:20 }, usage:{ sms_this_month:45, current_tps:2, sms_today:8 }, ip:'192.168.1.101', mac:'00:1A:2B:3C:4D:5F', license_expiry: new Date(Date.now()+30*86400000).toISOString().split('T')[0], created_at:'2024-06-01' },
];

export const License: React.FC = () => {
  const { user, verifySuperAdmin } = useAuth();
  const isSuperUser = user?.role === 'super_admin';
  const [license, setLicense] = useState<LicenseInfo>(() => load('license_active', defaultLicense));
  const [tenants, setTenants] = useState<Tenant[]>(() => load('license_tenants', defaultTenants));
  const [serverIP, setServerIP] = useState('');
  const [serverMAC, setServerMAC] = useState('');
  const [detecting, setDetecting] = useState(false);

  // Super admin verification
  const [superAuthModal, setSuperAuthModal] = useState(false);
  const [superPassword, setSuperPassword] = useState('');
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [authError, setAuthError] = useState('');

  // Modals
  const [showActivate, setShowActivate] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [showTenantModal, setShowTenantModal] = useState(false);
  const [showExtendModal, setShowExtendModal] = useState(false);
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null);
  const [licenseKeyInput, setLicenseKeyInput] = useState('');
  const [generatedKey, setGeneratedKey] = useState('');

  // Forms
  const [tenantForm, setTenantForm] = useState({ name:'', code:'', ip:'', mac:'', features:{ smpp:true, http:false, whatsapp:false, telegram:false, rcs:false, voice_otp:false }, limits:{ max_sms_monthly:100, max_tps:5 } });
  const [extendSMS, setExtendSMS] = useState(1000000);
  const [extendDays, setExtendDays] = useState(30);
  const [generateForm, setGenerateForm] = useState({ type: 'trial', company_name: '', system_ip: '', system_mac: '' });

  // Auto-detect server IP & MAC on mount
  useEffect(() => {
    detectServerInfo().then(({ ip, mac }) => {
      setServerIP(ip); setServerMAC(mac);
      // Auto-update license with detected IP/MAC if not set
      if (!license.system_ip || license.system_ip === '192.168.1.100') {
        const updated = { ...license, system_ip: ip, system_mac: mac };
        setLicense(updated); save('license_active', updated);
      }
    }).catch(() => {});
  }, []);

  // Detect on demand
  const handleDetect = async () => {
    setDetecting(true);
    const { ip, mac } = await detectServerInfo();
    setServerIP(ip); setServerMAC(mac);
    setDetecting(false);
    alert(`Server IP: ${ip}\nServer MAC: ${mac}`);
  };

  // Countdown timer
  useEffect(() => {
    const interval = setInterval(() => {
      setLicense(prev => {
        const daysUsed = Math.ceil((Date.now() - new Date(prev.activated_at).getTime()) / 86400000);
        const pkg = PACKAGES[prev.type];
        if (!pkg) return prev;
        const totalDays = pkg.days + (prev.extended_at ? Math.ceil((new Date(prev.extended_at).getTime() - new Date(prev.activated_at).getTime()) / 86400000) : 0);
        if (prev.usage.days_used !== daysUsed) { return { ...prev, usage: { ...prev.usage, days_used: daysUsed } }; }
        return prev;
      });
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  const requireSuperAuth = (action: () => void) => {
    if (!isSuperUser) { alert('🔒 Only SUPER ADMIN can perform this action.'); return; }
    setPendingAction(() => action); setSuperPassword(''); setAuthError(''); setSuperAuthModal(true);
  };
  const confirmSuperAuth = () => {
    if (verifySuperAdmin(superPassword)) { setSuperAuthModal(false); if (pendingAction) pendingAction(); setPendingAction(null); }
    else { setAuthError('Invalid super admin password'); }
  };

  // Activate license — updates volumes + features automatically
  const handleActivate = () => {
    if (!licenseKeyInput) { alert('Please enter a license key'); return; }
    // Parse key to determine package type
    const typeStr = licenseKeyInput.includes('-TRI-') ? 'trial' : licenseKeyInput.includes('-100K-') ? 'volume_100k' : licenseKeyInput.includes('-500K-') ? 'volume_500k' : licenseKeyInput.includes('-1M-') ? 'volume_1m' : licenseKeyInput.includes('-5M-') ? 'volume_5m' : licenseKeyInput.includes('-10M-') ? 'volume_10m' : licenseKeyInput.includes('-25M-') ? 'volume_25m' : licenseKeyInput.includes('-50M-') ? 'volume_50m' : 'trial';
    const pkg = PACKAGES[typeStr];
    const expiry = new Date(Date.now() + pkg.days * 86400000).toISOString().split('T')[0];
    const updated: LicenseInfo = {
      ...license,
      key: licenseKeyInput,
      type: typeStr as LicenseInfo['type'],
      features: pkg.features,
      limits: {
        max_clients: pkg.max_clients,
        max_suppliers: pkg.max_suppliers,
        max_sms_monthly: pkg.sms_monthly,
        max_tps: pkg.max_tps,
        max_sms_per_client: pkg.sms_per_client,
        max_tps_per_client: pkg.tps_per_client,
      },
      expiry_date: expiry,
      status: 'active',
      system_ip: serverIP || license.system_ip,
      system_mac: serverMAC || license.system_mac,
      issued_date: new Date().toISOString().split('T')[0],
      activated_at: new Date().toISOString(),
      usage: { sms_this_month: 0, sms_total: 0, days_used: 0 },
    };
    setLicense(updated); save('license_active', updated); setShowActivate(false);
    alert(`✅ License activated!\nPackage: ${pkg.name}\nSMS/Month: ${pkg.sms_monthly.toLocaleString()}\nMax TPS: ${pkg.max_tps}`);
  };

  // Extend volume — super user can add more SMS
  const handleExtend = () => {
    const extended: LicenseInfo = {
      ...license,
      limits: { ...license.limits, max_sms_monthly: license.limits.max_sms_monthly + extendSMS },
      expiry_date: new Date(new Date(license.expiry_date).getTime() + extendDays * 86400000).toISOString().split('T')[0],
      extended_by: user?.username || '',
      extended_at: new Date().toISOString(),
      extension_sms: (license.extension_sms || 0) + extendSMS,
    };
    setLicense(extended); save('license_active', extended); setShowExtendModal(false);
    alert(`✅ Volume extended by ${extendSMS.toLocaleString()} SMS\nNew total: ${extended.limits.max_sms_monthly.toLocaleString()} SMS/Month`);
  };

  // Generate key — auto-fills IP/MAC from detection
  const openGenerate = () => {
    setGenerateForm({ type: 'trial', company_name: '', system_ip: serverIP, system_mac: serverMAC });
    setShowGenerate(true);
  };
  const generateKey = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const p = PACKAGES[generateForm.type];
    const code = p ? (p.name === 'Trial' ? 'TRI' : p.name.replace(' Volume','').replace(' ','')) : '100K';
    let k = 'N2A-' + code + '-' + new Date().getFullYear() + '-';
    for (let i = 0; i < 3; i++) { let part = ''; for (let j = 0; j < 4; j++) part += chars.charAt(Math.floor(Math.random() * chars.length)); k += part + (i < 2 ? '-' : ''); }
    setGeneratedKey(k);
  };
  const copyKey = (text: string) => { navigator.clipboard.writeText(text); alert('Copied!'); };

  // Tenant CRUD
  const openTenant = (t?: Tenant) => {
    if (t) { setEditingTenant(t); setTenantForm({ name:t.name, code:t.code, ip:t.ip||'', mac:t.mac||'', features:t.features, limits:t.limits }); }
    else { setEditingTenant(null); setTenantForm({ name:'', code:'', ip:'', mac:'', features:{ smpp:true, http:false, whatsapp:false, telegram:false, rcs:false, voice_otp:false }, limits:{ max_sms_monthly:100, max_tps:5 } }); }
    setShowTenantModal(true);
  };
  const saveTenant = () => {
    requireSuperAuth(() => {
      if (editingTenant) { setTenants(p => { const n = p.map(t => t.id === editingTenant.id ? { ...t, ...tenantForm } : t); save('license_tenants', n); return n; }); }
      else { setTenants(p => { const n = [...p, { ...tenantForm, id: Date.now().toString(), status: 'active' as const, usage: { sms_this_month: 0, current_tps: 0, sms_today: 0 }, license_expiry: license.expiry_date, created_at: new Date().toISOString().split('T')[0] }]; save('license_tenants', n); return n; }); }
      setShowTenantModal(false);
    });
  };
  const deleteTenant = (id: string) => { requireSuperAuth(() => { setTenants(p => { const n = p.filter(t => t.id !== id); save('license_tenants', n); return n; }); }); };

  const pkg = PACKAGES[license.type];
  const daysRemaining = Math.max(0, (pkg?.days || 30) - license.usage.days_used);
  const totalMonthlySMS = license.limits.max_sms_monthly + (license.extension_sms || 0);
  const smsRemaining = Math.max(0, totalMonthlySMS - license.usage.sms_this_month);

  const tenantCols = [
    { key:'name', header:'Tenant', render:(t:Tenant) => <div><p className="font-medium text-sm">{t.name}</p><p className="text-[10px] text-gray-500">{t.code}</p></div> },
    { key:'features', header:'Features', render:(t:Tenant) => <div className="flex gap-0.5">{t.features.smpp&&<Badge variant="info" size="sm">SMPP</Badge>}{t.features.http&&<Badge variant="purple" size="sm">HTTP</Badge>}{t.features.voice_otp&&<Badge variant="warning" size="sm">Voice</Badge>}</div> },
    { key:'usage', header:'SMS Counter', render:(t:Tenant) => { const pct=(t.usage.sms_this_month/t.limits.max_sms_monthly)*100; return <div className="w-28"><div className="flex justify-between text-[10px] mb-0.5"><span>{t.usage.sms_this_month}</span><span className="text-gray-400">/{t.limits.max_sms_monthly}</span></div><div className="w-full bg-gray-200 rounded-full h-1.5"><div className={`h-1.5 rounded-full ${pct>90?'bg-red-500':pct>70?'bg-yellow-500':'bg-green-500'}`} style={{width:`${Math.min(pct,100)}%`}}/></div></div>; } },
    { key:'tps', header:'TPS', render:(t:Tenant) => <span className="text-xs font-mono">{t.usage.current_tps}<span className="text-gray-400">/{t.limits.max_tps}</span></span> },
    { key:'ip', header:'IP', render:(t:Tenant) => <span className="font-mono text-[10px]">{t.ip||'-'}</span> },
    { key:'status', header:'Status', render:(t:Tenant) => <Badge variant={t.status==='active'?'success':'danger'} dot size="sm">{t.status}</Badge> },
    { key:'actions', header:'', render:(t:Tenant) => <div className="flex gap-1"><button onClick={()=>openTenant(t)} className="p-1 rounded hover:bg-gray-100"><Edit size={14} className="text-gray-500"/></button><button onClick={()=>deleteTenant(t.id)} className="p-1 rounded hover:bg-gray-100"><Trash2 size={14} className="text-red-500"/></button></div> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-gray-800">License Management</h1><p className="text-gray-500 mt-1">{isSuperUser ? <span className="text-green-600 font-medium">🔒 Super Admin Access</span> : <span className="text-red-600">⛔ Super Admin only</span>}</p></div>
        <div className="flex gap-2">
          {isSuperUser && <>
            <Button variant="secondary" icon={<Monitor size={16}/>} onClick={handleDetect} loading={detecting}>Detect Server</Button>
            <Button variant="secondary" icon={<RefreshCw size={16}/>} onClick={() => requireSuperAuth(() => setShowExtendModal(true))}>Extend Volume</Button>
            <Button variant="secondary" icon={<Key size={16}/>} onClick={() => requireSuperAuth(() => setShowActivate(true))}>🔒 Activate License</Button>
            <Button icon={<Plus size={16}/>} onClick={openGenerate}>Generate Key</Button>
          </>}
        </div>
      </div>

      {/* Package Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {Object.entries(PACKAGES).map(([key, pkg]) => (
          <div key={key} className={`rounded-xl p-5 text-white bg-gradient-to-br ${pkg.color} ${license.type === key ? 'ring-4 ring-white/50 scale-105 shadow-xl' : 'opacity-70'}`}>
            <h3 className="text-xl font-bold">{pkg.name}</h3>
            <div className="mt-3 space-y-1 text-sm">
              <p>📱 {(pkg.sms_monthly/1000000).toFixed(0)}M SMS/month</p>
              <p>👥 {pkg.max_clients >= 999999 ? 'Unlimited' : pkg.max_clients} clients</p>
              <p>🏢 {pkg.max_suppliers >= 999999 ? 'Unlimited' : pkg.max_suppliers} suppliers</p>
              <p>⚡ {pkg.max_tps >= 99999 ? 'Unlimited' : pkg.max_tps} TPS</p>
              <p>📅 {pkg.days} days</p>
            </div>
            {license.type === key && <Badge variant="success" size="sm">ACTIVE</Badge>}
          </div>
        ))}
      </div>

      {/* License Status */}
      <Card>
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-4">
            <div className={`p-4 rounded-xl ${license.status==='active'?'bg-green-100':'bg-red-100'}`}>{license.status==='active'?<Shield size={32} className="text-green-600"/>:<AlertTriangle size={32} className="text-red-600"/>}</div>
            <div>
              <h3 className="text-xl font-semibold capitalize">{license.type} License {license.extension_sms > 0 && <Badge variant="warning">+{license.extension_sms.toLocaleString()} SMS Extended</Badge>}</h3>
              <p className="text-gray-500">{license.issued_to}</p>
            </div>
          </div>
          <Badge variant={license.status==='active'?'success':'danger'} size="md">{license.status.toUpperCase()}</Badge>
        </div>
        <div className="bg-gray-50 rounded-lg p-3 mb-3"><div className="flex items-center justify-between"><span className="text-sm text-gray-500">License Key</span><button onClick={()=>copyKey(license.key)} className="p-1 rounded hover:bg-gray-200"><Copy size={14} className="text-gray-500"/></button></div><p className="font-mono text-sm">{license.key}</p></div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <div><p className="text-xs text-gray-500">Server IP (Detected)</p><p className="font-mono text-sm">{serverIP || license.system_ip}</p></div>
          <div><p className="text-xs text-gray-500">Server MAC (Detected)</p><p className="font-mono text-sm">{serverMAC || license.system_mac}</p></div>
          <div><p className="text-xs text-gray-500">Activated</p><p>{license.issued_date}</p></div>
          <div><p className="text-xs text-gray-500">Expires</p><p className={daysRemaining < 7 ? 'text-red-600 font-semibold' : ''}>{license.expiry_date} ({daysRemaining}d)</p></div>
        </div>
      </Card>

      {/* Counters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-4 text-white"><Clock size={20} className="mb-1"/><p className="text-2xl font-bold">{daysRemaining}</p><p className="text-sm opacity-80">Days Remaining</p></div>
        <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl p-4 text-white"><MessageSquare size={20} className="mb-1"/><p className="text-2xl font-bold">{license.usage.sms_this_month.toLocaleString()} / {totalMonthlySMS.toLocaleString()}</p><p className="text-sm opacity-80">SMS Used (Monthly)</p></div>
        <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl p-4 text-white"><Gauge size={20} className="mb-1"/><p className="text-2xl font-bold">{license.limits.max_tps}</p><p className="text-sm opacity-80">Max TPS</p></div>
        <div className="bg-gradient-to-br from-amber-500 to-amber-600 rounded-xl p-4 text-white"><BarChart3 size={20} className="mb-1"/><p className="text-2xl font-bold">{smsRemaining.toLocaleString()}</p><p className="text-sm opacity-80">SMS Remaining</p></div>
      </div>

      {/* Limits & Features */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card title="Volume Limits"><div className="space-y-2">
          {[{label:'Monthly SMS',val:totalMonthlySMS.toLocaleString(),icon:<MessageSquare size={14}/>},{label:'Max TPS',val:license.limits.max_tps,icon:<Gauge size={14}/>},{label:'Max Clients',val:license.limits.max_clients>=999999?'Unlimited':String(license.limits.max_clients),icon:<Users size={14}/>},{label:'Max Suppliers',val:license.limits.max_suppliers>=999999?'Unlimited':String(license.limits.max_suppliers),icon:<Server size={14}/>},{label:'SMS Per Client',val:license.limits.max_sms_per_client>=999999?'Unlimited':license.limits.max_sms_per_client.toLocaleString(),icon:<BarChart3 size={14}/>},{label:'TPS Per Client',val:license.limits.max_tps_per_client,icon:<Zap size={14}/>}].map((l,i)=><div key={i} className="flex justify-between items-center p-2.5 bg-gray-50 rounded-lg"><div className="flex items-center gap-2"><span className="text-blue-500">{l.icon}</span><span className="text-sm text-gray-600">{l.label}</span></div><span className="font-semibold text-sm">{l.val}</span></div>)}
        </div></Card>
        <Card title="Enabled Features"><div className="space-y-2">{Object.entries(license.features).map(([f,e])=><div key={f} className="flex items-center justify-between p-2.5 bg-gray-50 rounded-lg"><span className="text-sm font-medium uppercase">{f.replace('_',' ')}</span>{e?<CheckCircle size={18} className="text-green-500"/>:<XCircle size={18} className="text-gray-300"/>}</div>)}</div></Card>
      </div>

      {/* Tenant Table */}
      <Card title="Tenant SMS Counters" subtitle={`${tenants.length} tenants`} action={isSuperUser?<Button size="sm" icon={<Plus size={16}/>} onClick={()=>openTenant()}>Add Tenant</Button>:undefined} noPadding>
        <Table columns={tenantCols} data={tenants} keyExtractor={t=>t.id}/>
      </Card>

      {/* Super Admin Verification */}
      <Modal isOpen={superAuthModal} onClose={()=>{setSuperAuthModal(false);setPendingAction(null);}} title="🔒 Super Admin Verification" footer={<div className="flex justify-end gap-3"><Button variant="secondary" onClick={()=>{setSuperAuthModal(false);setPendingAction(null);}}>Cancel</Button><Button onClick={confirmSuperAuth}>Verify</Button></div>}>
        <div className="space-y-3"><div className="bg-yellow-50 p-3 rounded-lg text-sm"><p className="font-medium">License changes require password verification.</p></div>{authError&&<p className="text-sm text-red-600"><AlertTriangle size={14} className="inline"/> {authError}</p>}<Input label="Password" type="password" value={superPassword} onChange={e=>setSuperPassword(e.target.value)} onKeyDown={e=>{if(e.key==='Enter')confirmSuperAuth();}}/></div>
      </Modal>

      {/* Activate Modal */}
      <Modal isOpen={showActivate} onClose={()=>setShowActivate(false)} title="Activate License" footer={<div className="flex justify-end gap-3"><Button variant="secondary" onClick={()=>setShowActivate(false)}>Cancel</Button><Button onClick={handleActivate}>Activate</Button></div>}>
        <div className="space-y-3"><Input label="License Key *" value={licenseKeyInput} onChange={e=>setLicenseKeyInput(e.target.value)} placeholder="N2A-TRI-2026-XXXX-XXXX-XXXX"/>
          <div className="bg-blue-50 p-3 rounded-lg text-sm text-blue-700">Server IP ({serverIP}) and MAC ({serverMAC}) auto-detected. Volumes and features update automatically based on the package type encoded in the key.</div>
        </div>
      </Modal>

      {/* Extend Volume Modal */}
      <Modal isOpen={showExtendModal} onClose={()=>setShowExtendModal(false)} title="Extend License Volume" footer={<div className="flex justify-end gap-3"><Button variant="secondary" onClick={()=>setShowExtendModal(false)}>Cancel</Button><Button onClick={handleExtend}>Extend</Button></div>}>
        <div className="space-y-3">
          <Input label="Additional SMS/Month" type="number" value={extendSMS} onChange={e=>setExtendSMS(parseInt(e.target.value))}/>
          <Input label="Extend Days" type="number" value={extendDays} onChange={e=>setExtendDays(parseInt(e.target.value))}/>
          <div className="bg-yellow-50 p-3 rounded-lg text-sm">
            <p>Current: {license.limits.max_sms_monthly.toLocaleString()} SMS, Expires: {license.expiry_date}</p>
            <p className="font-medium mt-1">After extension: {((license.limits.max_sms_monthly || 0) + (extendSMS || 0)).toLocaleString()} SMS, +{extendDays} days</p>
          </div>
        </div>
      </Modal>

      {/* Generate Key Modal */}
      <Modal isOpen={showGenerate} onClose={()=>{setShowGenerate(false);setGeneratedKey('');}} title="Generate License Key" size="lg" footer={<div className="flex justify-end gap-3"><Button variant="secondary" onClick={()=>{setShowGenerate(false);setGeneratedKey('');}}>Close</Button>{!generatedKey && <Button onClick={() => requireSuperAuth(generateKey)}>🔒 Generate Key</Button>}</div>}>
        {generatedKey ? (
          <div className="text-center py-4"><CheckCircle size={48} className="mx-auto text-green-500 mb-3"/><h3 className="font-semibold">Key Generated</h3><div className="bg-gray-100 p-3 rounded-lg my-3"><p className="font-mono text-sm break-all">{generatedKey}</p></div><div className="flex justify-center gap-2"><Button size="sm" variant="secondary" icon={<Copy size={14}/>} onClick={()=>copyKey(generatedKey)}>Copy</Button></div>
            <p className="text-xs text-gray-500 mt-3">Server IP: {serverIP} | MAC: {serverMAC}</p></div>
        ) : (
          <div className="space-y-3">
            <Select label="Package" value={generateForm.type} onChange={e=>setGenerateForm(p=>({...p,type:e.target.value}))} options={Object.entries(PACKAGES).map(([k,v])=>({value:k,label:`${v.name} — ${v.sms_monthly>=1000000?(v.sms_monthly/1000000).toFixed(0)+'M':(v.sms_monthly/1000).toFixed(0)+'K'} SMS/month, ${v.max_tps} TPS`}))}/>
            <Input label="Company Name" value={generateForm.company_name} onChange={e=>setGenerateForm(p=>({...p,company_name:e.target.value}))}/>
            <div className="grid grid-cols-2 gap-3"><Input label="Server IP (Auto)" value={generateForm.system_ip} onChange={e=>setGenerateForm(p=>({...p,system_ip:e.target.value}))}/><Input label="MAC (Auto)" value={generateForm.system_mac} onChange={e=>setGenerateForm(p=>({...p,system_mac:e.target.value}))}/></div>
            <div className="bg-blue-50 p-3 rounded-lg text-sm text-blue-700">IP and MAC auto-detected from server. The generated key will include the package type code. Volume and features update automatically on activation.</div>
          </div>
        )}
      </Modal>

      {/* Tenant Modal */}
      <Modal isOpen={showTenantModal} onClose={()=>setShowTenantModal(false)} title={editingTenant?'Edit Tenant':'Add Tenant'} footer={<div className="flex justify-end gap-3"><Button variant="secondary" onClick={()=>setShowTenantModal(false)}>Cancel</Button><Button onClick={saveTenant}>🔒 Save</Button></div>}>
        <div className="space-y-3"><div className="grid grid-cols-2 gap-3"><Input label="Name" value={tenantForm.name} onChange={e=>setTenantForm(p=>({...p,name:e.target.value}))} required/><Input label="Code" value={tenantForm.code} onChange={e=>setTenantForm(p=>({...p,code:e.target.value.toUpperCase()}))} required/></div><div className="grid grid-cols-2 gap-3"><Input label="IP" value={tenantForm.ip} onChange={e=>setTenantForm(p=>({...p,ip:e.target.value}))}/><Input label="MAC" value={tenantForm.mac} onChange={e=>setTenantForm(p=>({...p,mac:e.target.value}))}/></div><div className="grid grid-cols-2 gap-3"><Input label="Monthly SMS Limit" type="number" value={tenantForm.limits.max_sms_monthly} onChange={e=>setTenantForm(p=>({...p,limits:{...p.limits,max_sms_monthly:parseInt(e.target.value)}}))}/><Input label="Max TPS" type="number" value={tenantForm.limits.max_tps} onChange={e=>setTenantForm(p=>({...p,limits:{...p.limits,max_tps:parseInt(e.target.value)}}))}/></div></div>
      </Modal>
    </div>
  );
};
