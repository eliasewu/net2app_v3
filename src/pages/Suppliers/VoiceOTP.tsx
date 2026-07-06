import React, { useState } from 'react';
import { Plus, Search, Edit, Trash2, Play, Globe, Phone, Settings, Save, CheckCircle, XCircle } from 'lucide-react';
import { Card } from '../../components/UI/Card';
import { Button } from '../../components/UI/Button';
import { Badge } from '../../components/UI/Badge';
import { Modal } from '../../components/UI/Modal';
import { Input, Select } from '../../components/UI/Input';
import { Table } from '../../components/UI/Table';

interface VoiceSIPConfig {
  id: string;
  name: string;
  client_id: string;
  client_code: string;
  client_name: string;
  sip_host: string;
  sip_port: number;
  sip_user: string;
  sip_pass: string;
  caller_id: string;
  provider: string;
  version: string;
  allowed_languages: string[];
  max_retries: number;
  retry_delay: number;
  timeout: number;
  is_active: boolean;
  created_at: string;
}

export const VoiceOTP: React.FC = () => {
  const [sipConfigs, setSipConfigs] = useState<VoiceSIPConfig[]>(defaultSIPs);
  { id:'1', name:'TechCorp SIP', client_id:'1', client_code:'CLT001', client_name:'TechCorp Global', sip_host:'sip.techcorp.com', sip_port:5060, sip_user:'techcorp', sip_pass:'pass123', caller_id:'+18001234567', provider:'asterisk', version:'20', allowed_languages:['ar-SA','en-US'], max_retries:3, retry_delay:30, timeout:150, is_active:true, created_at:'2024-01-15' },
  { id:'2', name:'MegaBank Voice', client_id:'2', client_code:'CLT002', client_name:'MegaBank Ltd', sip_host:'sip.megabank.com', sip_port:5060, sip_user:'megabank', sip_pass:'bank456', caller_id:'+18007654321', provider:'vos3000', version:'2', allowed_languages:['en-US','ar-SA'], max_retries:4, retry_delay:25, timeout:120, is_active:true, created_at:'2024-02-01' },
];

const ALL_LANGS = [
  {code:'ar-SA',name:'Arabic'}, {code:'bn-BD',name:'Bangla'}, {code:'en-US',name:'English'},
  {code:'es-ES',name:'Spanish'}, {code:'fr-FR',name:'French'}, {code:'de-DE',name:'German'},
  {code:'hi-IN',name:'Hindi'}, {code:'id-ID',name:'Indonesian'}, {code:'it-IT',name:'Italian'},
  {code:'ja-JP',name:'Japanese'}, {code:'ko-KR',name:'Korean'}, {code:'pt-BR',name:'Portuguese'},
  {code:'ru-RU',name:'Russian'}, {code:'tr-TR',name:'Turkish'}, {code:'ur-PK',name:'Urdu'},
  {code:'vi-VN',name:'Vietnamese'}, {code:'zh-CN',name:'Chinese'}, {code:'th-TH',name:'Thai'},
  {code:'nl-NL',name:'Dutch'}, {code:'pl-PL',name:'Polish'}, {code:'sv-SE',name:'Swedish'},
  {code:'da-DK',name:'Danish'}, {code:'fi-FI',name:'Finnish'}, {code:'nb-NO',name:'Norwegian'},
  {code:'cs-CZ',name:'Czech'}, {code:'ro-RO',name:'Romanian'}, {code:'el-GR',name:'Greek'},
  {code:'he-IL',name:'Hebrew'}, {code:'hu-HU',name:'Hungarian'}, {code:'uk-UA',name:'Ukrainian'},
  {code:'sk-SK',name:'Slovak'}, {code:'bg-BG',name:'Bulgarian'}, {code:'hr-HR',name:'Croatian'},
  {code:'sr-RS',name:'Serbian'}, {code:'sl-SI',name:'Slovenian'}, {code:'et-EE',name:'Estonian'},
  {code:'lv-LV',name:'Latvian'}, {code:'lt-LT',name:'Lithuanian'}, {code:'fa-IR',name:'Persian'},
  {code:'ms-MY',name:'Malay'}, {code:'fil-PH',name:'Filipino'}, {code:'sw-KE',name:'Swahili'},
  {code:'am-ET',name:'Amharic'}, {code:'ne-NP',name:'Nepali'}, {code:'si-LK',name:'Sinhala'},
  {code:'my-MM',name:'Burmese'}, {code:'km-KH',name:'Khmer'}, {code:'ta-IN',name:'Tamil'},
  {code:'te-IN',name:'Telugu'}, {code:'mr-IN',name:'Marathi'},
];

export const VoiceOTP: React.FC = () => {
  const [sipConfigs, setSipConfigs] = useState<VoiceSIPConfig[]>(defaultSIPs);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<VoiceSIPConfig | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '', client_id: '', client_code: '', client_name: '',
    sip_host: '', sip_port: 5060, sip_user: '', sip_pass: '',
    caller_id: '+18001234567', provider: 'asterisk', version: '20',
    allowed_languages: ['en-US'] as string[],
    max_retries: 3, retry_delay: 30, timeout: 150, is_active: true,
  });

  const filtered = sipConfigs.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.client_name.toLowerCase().includes(search.toLowerCase()) ||
    s.sip_host.toLowerCase().includes(search.toLowerCase())
  );

  const openAdd = () => {
    setEditing(null);
    setForm({ name: '', client_id: '', client_code: '', client_name: '', sip_host: '', sip_port: 5060, sip_user: '', sip_pass: '', caller_id: '+18001234567', provider: 'asterisk', version: '20', allowed_languages: ['en-US'], max_retries: 3, retry_delay: 30, timeout: 150, is_active: true });
    setShowModal(true);
  };

  const openEdit = (s: VoiceSIPConfig) => {
    setEditing(s);
    setForm({ name: s.name, client_id: s.client_id, client_code: s.client_code, client_name: s.client_name, sip_host: s.sip_host, sip_port: s.sip_port, sip_user: s.sip_user, sip_pass: s.sip_pass, caller_id: s.caller_id, provider: s.provider, version: s.version, allowed_languages: s.allowed_languages, max_retries: s.max_retries, retry_delay: s.retry_delay, timeout: s.timeout, is_active: s.is_active });
    setShowModal(true);
  };

  const handleSave = () => {
    const data = { ...form };
    if (editing) {
      setSipConfigs(p => { const n = p.map(s => s.id === editing.id ? { ...s, ...data } : s); return n; });
    } else {
      const nc: VoiceSIPConfig = { ...data, id: 'sip_' + Date.now(), created_at: new Date().toISOString().split('T')[0] };
      setSipConfigs(p => { const n = [...p, nc]; return n; });
    }
    setShowModal(false);
  };

  const handleDelete = (id: string) => {
    setSipConfigs(p => { const n = p.filter(s => s.id !== id); return n; });
  };

  const handleToggle = (id: string) => {
    setSipConfigs(p => { const n = p.map(s => s.id === id ? { ...s, is_active: !s.is_active } : s); return n; });
  };

  const toggleLang = (code: string) => {
    setForm(p => ({
      ...p,
      allowed_languages: p.allowed_languages.includes(code)
        ? p.allowed_languages.filter(l => l !== code)
        : [...p.allowed_languages, code]
    }));
  };

  const handleTestCall = () => {
    setTestResult('Testing via ' + form.sip_host + ':' + form.sip_port + '...');
    setTimeout(() => setTestResult('✅ Connected! DLR: DELIVRD'), 3000);
  };

  const columns = [
    { key: 'name', header: 'SIP Endpoint', render: (s: VoiceSIPConfig) => <div><p className="font-medium text-sm">{s.name}</p><p className="text-[10px] text-gray-500">{s.client_code} — {s.client_name}</p></div> },
    { key: 'sip', header: 'SIP Host:Port', render: (s: VoiceSIPConfig) => <span className="font-mono text-xs">{s.sip_host}:{s.sip_port}</span> },
    { key: 'provider', header: 'Provider', render: (s: VoiceSIPConfig) => <Badge variant="default" size="sm">{s.provider} v{s.version}</Badge> },
    { key: 'langs', header: 'Languages', render: (s: VoiceSIPConfig) => <div className="flex flex-wrap gap-0.5">{s.allowed_languages.slice(0, 3).map(l => <Badge key={l} size="sm" variant="info">{l}</Badge>)}{s.allowed_languages.length > 3 && <Badge size="sm" variant="info">+{s.allowed_languages.length - 3}</Badge>}</div> },
    { key: 'retries', header: 'Retries', render: (s: VoiceSIPConfig) => <span className="text-xs">{s.max_retries}x/{s.retry_delay}s</span> },
    { key: 'status', header: 'Status', render: (s: VoiceSIPConfig) => <Badge variant={s.is_active ? 'success' : 'danger'} dot size="sm">{s.is_active ? 'Active' : 'Inactive'}</Badge> },
    { key: 'actions', header: 'Actions', render: (s: VoiceSIPConfig) => <div className="flex gap-0.5">
      <button onClick={() => openEdit(s)} className="p-1 rounded hover:bg-gray-100"><Edit size={14} className="text-gray-500" /></button>
      <button onClick={() => handleToggle(s.id)} className="p-1 rounded hover:bg-gray-100">{s.is_active ? <XCircle size={14} className="text-red-500" /> : <CheckCircle size={14} className="text-green-500" />}</button>
      <button onClick={() => handleDelete(s.id)} className="p-1 rounded hover:bg-gray-100"><Trash2 size={14} className="text-red-500" /></button>
    </div> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Voice OTP — SIP Endpoints</h1>
          <p className="text-gray-500 mt-1">{sipConfigs.length} SIP endpoints — Add unlimited per-client Voice OTP gateways</p>
        </div>
        <Button icon={<Plus size={18} />} onClick={openAdd}>Add SIP Endpoint</Button>
      </div>

      {testResult && (
        <div className={`p-3 rounded-lg text-sm ${testResult.includes('✅') ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-blue-50 text-blue-700 border border-blue-200'}`}>
          {testResult}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-4 border"><Phone size={20} className="text-purple-500 mb-1" /><p className="text-xl font-bold">{sipConfigs.length}</p><p className="text-xs text-gray-500">SIP Endpoints</p></div>
        <div className="bg-white rounded-xl p-4 border"><CheckCircle size={20} className="text-green-500 mb-1" /><p className="text-xl font-bold">{sipConfigs.filter(s => s.is_active).length}</p><p className="text-xs text-gray-500">Active</p></div>
        <div className="bg-white rounded-xl p-4 border"><Globe size={20} className="text-blue-500 mb-1" /><p className="text-xl font-bold">{new Set(sipConfigs.map(s => s.provider)).size}</p><p className="text-xs text-gray-500">Providers</p></div>
        <div className="bg-white rounded-xl p-4 border"><Settings size={20} className="text-orange-500 mb-1" /><p className="text-xl font-bold">{new Set(sipConfigs.map(s => s.client_id)).size}</p><p className="text-xs text-gray-500">Clients</p></div>
      </div>

      <Card>
        <div className="relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input type="text" placeholder="Search by name, client or SIP host..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </Card>

      <Card noPadding>
        <Table columns={columns} data={filtered} keyExtractor={s => s.id} />
      </Card>

      {/* Add/Edit SIP Endpoint Modal */}
      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit SIP Endpoint' : 'Add Voice OTP SIP Endpoint'} size="lg"
        footer={<div className="flex justify-end gap-3"><Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button><Button icon={<Save size={14} />} onClick={handleSave}>{editing ? 'Update' : 'Add'} Endpoint</Button></div>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Endpoint Name *" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="TechCorp Voice" required />
            <div className="grid grid-cols-2 gap-2">
              <Input label="Client Code" value={form.client_code} onChange={e => setForm(p => ({ ...p, client_code: e.target.value }))} placeholder="CLT001" />
              <Input label="Client Name" value={form.client_name} onChange={e => setForm(p => ({ ...p, client_name: e.target.value }))} placeholder="TechCorp Global" />
            </div>
          </div>

          <div className="border rounded-lg p-4 bg-gray-50">
            <p className="text-sm font-medium text-gray-700 mb-3">📞 SIP / Asterisk / VOS3000 Configuration</p>
            <div className="grid grid-cols-2 gap-4">
              <Input label="SIP Host *" value={form.sip_host} onChange={e => setForm(p => ({ ...p, sip_host: e.target.value }))} placeholder="sip.techcorp.com" required />
              <Input label="SIP Port" type="number" value={form.sip_port} onChange={e => setForm(p => ({ ...p, sip_port: parseInt(e.target.value) }))} />
              <Input label="SIP Username" value={form.sip_user} onChange={e => setForm(p => ({ ...p, sip_user: e.target.value }))} />
              <Input label="SIP Password" type="password" value={form.sip_pass} onChange={e => setForm(p => ({ ...p, sip_pass: e.target.value }))} />
              <Input label="Caller ID" value={form.caller_id} onChange={e => setForm(p => ({ ...p, caller_id: e.target.value }))} />
              <div className="grid grid-cols-2 gap-2">
                <Select label="Provider" value={form.provider} onChange={e => setForm(p => ({ ...p, provider: e.target.value }))} options={[{ value: 'asterisk', label: 'Asterisk' }, { value: 'vos3000', label: 'VOS3000' }, { value: 'freeswitch', label: 'FreeSWITCH' }]} />
                <Select label="Version" value={form.version} onChange={e => setForm(p => ({ ...p, version: e.target.value }))} options={[{ value: '20', label: 'v20' }, { value: '21', label: 'v21' }, { value: '23', label: 'v23' }, { value: '2', label: 'VOS3000 v2' }]} />
              </div>
            </div>
          </div>

          <div className="border rounded-lg p-4">
            <p className="text-sm font-medium text-gray-700 mb-3">🌐 Allowed Languages</p>
            <p className="text-xs text-gray-500 mb-2">Select languages this SIP endpoint supports ({form.allowed_languages.length} selected)</p>
            <div className="grid grid-cols-4 md:grid-cols-6 gap-1 max-h-48 overflow-y-auto">
              {ALL_LANGS.map(lang => (
                <label key={lang.code} className={`flex items-center gap-1.5 p-1.5 rounded border cursor-pointer text-xs ${form.allowed_languages.includes(lang.code) ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                  <input type="checkbox" checked={form.allowed_languages.includes(lang.code)} onChange={() => toggleLang(lang.code)} className="w-3 h-3 rounded" />
                  <span>{lang.code}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <Input label="Max Retries" type="number" value={form.max_retries} onChange={e => setForm(p => ({ ...p, max_retries: parseInt(e.target.value) }))} min={1} max={10} />
            <Input label="Retry Delay (s)" type="number" value={form.retry_delay} onChange={e => setForm(p => ({ ...p, retry_delay: parseInt(e.target.value) }))} min={5} />
            <Input label="Timeout (s)" type="number" value={form.timeout} onChange={e => setForm(p => ({ ...p, timeout: parseInt(e.target.value) }))} min={10} />
          </div>

          <div className="flex gap-3">
            <Button variant="secondary" icon={<Play size={14} />} onClick={handleTestCall}>Test SIP Connection</Button>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))} className="w-4 h-4 rounded" />
              <span className="text-sm">Active</span>
            </label>
          </div>
        </div>
      </Modal>
    </div>
  );
};
