import React, { useState, useEffect } from 'react';
import { Plus, Search, Edit, Trash2, Play, Globe, Phone, Settings, Save, CheckCircle, XCircle } from 'lucide-react';
import { Card } from '../../components/UI/Card';
import { Button } from '../../components/UI/Button';
import { Badge } from '../../components/UI/Badge';
import { Modal } from '../../components/UI/Modal';
import { Input, Select } from '../../components/UI/Input';
import { Table } from '../../components/UI/Table';
import { voiceOtpApi } from '../../services/api';

interface VoiceSIPConfig {
  id: number | string;
  language: string;
  language_code: string;
  country_prefix: string;
  greeting_text: string;
  retry_text: string;
  sip_host: string;
  sip_port: number;
  sip_username: string;
  sip_password: string;
  caller_id: string;
  is_active: boolean;
  created_at: string;
}

const emptyForm = {
  language: '', language_code: 'en', country_prefix: '',
  greeting_text: '', retry_text: '',
  sip_host: '', sip_port: 5060, sip_username: '', sip_password: '',
  caller_id: '', is_active: true,
};

export const VoiceOTP: React.FC = () => {
  const [sipConfigs, setSipConfigs] = useState<VoiceSIPConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<VoiceSIPConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState(emptyForm);

  const loadConfigs = async () => {
    setLoading(true);
    try {
      const res: any = await voiceOtpApi.getConfigs();
      if (res.success && res.data?.data) setSipConfigs(res.data.data);
      else if (res.success && Array.isArray(res.data)) setSipConfigs(res.data);
    } catch (e) { console.warn('VoiceOTP fetch failed'); }
    setLoading(false);
  };

  useEffect(() => { loadConfigs(); }, []);

  const filtered = sipConfigs.filter((s: any) =>
    (s.language || '').toLowerCase().includes(search.toLowerCase()) ||
    (s.country_prefix || '').includes(search)
  );

  const openAdd = () => { setEditing(null); setError(''); setForm(emptyForm); setShowModal(true); };
  const openEdit = (s: VoiceSIPConfig) => {
    setEditing(s); setError('');
    setForm({
      language: s.language || '', language_code: s.language_code || 'en',
      country_prefix: s.country_prefix || '', greeting_text: s.greeting_text || '',
      retry_text: s.retry_text || '', sip_host: s.sip_host || '',
      sip_port: s.sip_port || 5060, sip_username: s.sip_username || '',
      sip_password: s.sip_password || '', caller_id: s.caller_id || '',
      is_active: s.is_active !== false,
    });
    setShowModal(true);
  };

  const handleSave = async () => {
    setError(''); setSaving(true);
    try {
      if (editing) {
        await voiceOtpApi.updateConfig(String(editing.id), form);
      } else {
        await voiceOtpApi.createConfig(form);
      }
      setShowModal(false);
      await loadConfigs();
    } catch (e: any) { setError(e.message); }
    setSaving(false);
  };

  const handleDelete = async (id: string | number) => {
    if (!window.confirm('Delete this SIP endpoint?')) return;
    try { await voiceOtpApi.deleteConfig(String(id)); await loadConfigs(); } catch (e: any) { alert(e.message); }
  };

  const handleToggle = async (s: VoiceSIPConfig) => {
    try { await voiceOtpApi.updateConfig(String(s.id), { is_active: !s.is_active }); await loadConfigs(); } catch (e: any) { alert(e.message); }
  };

  const columns = [
    { key: 'language', header: 'Language / Group', render: (s: any) => <div><p className="font-medium text-sm">{s.language || 'Unnamed'}</p><p className="text-[10px] text-gray-500">{s.country_prefix || '-'} • {s.language_code || '-'}</p></div> },
    { key: 'sip', header: 'SIP Host', render: (s: any) => <span className="font-mono text-xs">{s.sip_host || '-'}:{s.sip_port || 5060}</span> },
    { key: 'greeting', header: 'Greeting', render: (s: any) => <span className="text-xs truncate block max-w-[200px]">{s.greeting_text || '-'}</span> },
    { key: 'status', header: 'Status', render: (s: any) => <Badge variant={s.is_active ? 'success' : 'danger'} dot size="sm">{s.is_active ? 'Active' : 'Inactive'}</Badge> },
    { key: 'actions', header: 'Actions', render: (s: any) => <div className="flex gap-0.5">
      <button onClick={() => openEdit(s)} className="p-1 rounded hover:bg-gray-100"><Edit size={14} className="text-gray-500" /></button>
      <button onClick={() => handleToggle(s)} className="p-1 rounded hover:bg-gray-100">{s.is_active ? <XCircle size={14} className="text-red-500" /> : <CheckCircle size={14} className="text-green-500" />}</button>
      <button onClick={() => handleDelete(s.id)} className="p-1 rounded hover:bg-gray-100"><Trash2 size={14} className="text-red-500" /></button>
    </div> },
  ];

  if (loading) return <div className="p-8 text-center text-gray-500">Loading SIP configurations...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-gray-800">Voice OTP — SIP Endpoints</h1><p className="text-gray-500 mt-1">{sipConfigs.length} configurations loaded from database</p></div>
        <Button icon={<Plus size={18} />} onClick={openAdd}>Add Configuration</Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-4 border"><Phone size={20} className="text-purple-500 mb-1" /><p className="text-xl font-bold">{sipConfigs.length}</p><p className="text-xs text-gray-500">Total</p></div>
        <div className="bg-white rounded-xl p-4 border"><CheckCircle size={20} className="text-green-500 mb-1" /><p className="text-xl font-bold">{sipConfigs.filter((s:any) => s.is_active).length}</p><p className="text-xs text-gray-500">Active</p></div>
        <div className="bg-white rounded-xl p-4 border"><Globe size={20} className="text-blue-500 mb-1" /><p className="text-xl font-bold">{new Set(sipConfigs.map((s:any) => s.language_code)).size}</p><p className="text-xs text-gray-500">Languages</p></div>
        <div className="bg-white rounded-xl p-4 border"><Settings size={20} className="text-orange-500 mb-1" /><p className="text-xl font-bold">{new Set(sipConfigs.map((s:any) => s.country_prefix)).size}</p><p className="text-xs text-gray-500">Prefixes</p></div>
      </div>

      <Card><div className="relative"><Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input type="text" placeholder="Search by language or prefix..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm" /></div></Card>

      <Card noPadding><Table columns={columns} data={filtered} keyExtractor={(s: any) => String(s.id)} /></Card>

      <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit SIP Configuration' : 'Add Voice OTP Configuration'} size="lg"
        footer={<div className="flex justify-end gap-3"><Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button><Button icon={<Save size={14} />} onClick={handleSave} loading={saving}>{editing ? 'Update' : 'Add'}</Button></div>}>
        <div className="space-y-4">
          {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}
          <div className="grid grid-cols-2 gap-4">
            <Input label="Language / Group Name *" value={form.language} onChange={e => setForm(p => ({ ...p, language: e.target.value }))} required />
            <Input label="Language Code" value={form.language_code} onChange={e => setForm(p => ({ ...p, language_code: e.target.value }))} />
            <Input label="Country Prefix" value={form.country_prefix} onChange={e => setForm(p => ({ ...p, country_prefix: e.target.value }))} />
            <Input label="Caller ID" value={form.caller_id} onChange={e => setForm(p => ({ ...p, caller_id: e.target.value }))} />
          </div>
          <div className="border rounded-lg p-4 bg-gray-50">
            <p className="text-sm font-medium text-gray-700 mb-3">SIP Configuration</p>
            <div className="grid grid-cols-2 gap-4">
              <Input label="SIP Host" value={form.sip_host} onChange={e => setForm(p => ({ ...p, sip_host: e.target.value }))} />
              <Input label="SIP Port" type="number" value={form.sip_port} onChange={e => setForm(p => ({ ...p, sip_port: parseInt(e.target.value) || 5060 }))} />
              <Input label="SIP Username" value={form.sip_username} onChange={e => setForm(p => ({ ...p, sip_username: e.target.value }))} />
              <Input label="SIP Password" type="password" value={form.sip_password} onChange={e => setForm(p => ({ ...p, sip_password: e.target.value }))} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Greeting Text" value={form.greeting_text} onChange={e => setForm(p => ({ ...p, greeting_text: e.target.value }))} />
            <Input label="Retry Text" value={form.retry_text} onChange={e => setForm(p => ({ ...p, retry_text: e.target.value }))} />
          </div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))} className="w-4 h-4 rounded" /><span className="text-sm">Active</span></label>
        </div>
      </Modal>
    </div>
  );
};
