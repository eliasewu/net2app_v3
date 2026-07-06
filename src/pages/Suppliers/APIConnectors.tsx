import React, { useState } from 'react';
import { Plus, Search, Edit, Trash2, Globe, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import { Card } from '../../components/UI/Card';
import { Button } from '../../components/UI/Button';
import { Badge } from '../../components/UI/Badge';
import { Modal } from '../../components/UI/Modal';
import { Input, Select, Textarea } from '../../components/UI/Input';
import { Table, Pagination } from '../../components/UI/Table';
import { useData } from '../../store/DataContext';
import type { APIConnector } from '../../types';

const REGIONS = [
  { key: 'all', label: 'All', flag: '📊' },
  { key: 'Global', label: 'Global', flag: '🌍' },
  { key: 'Bangladesh', label: 'Bangladesh', flag: '🇧🇩' },
  { key: 'India', label: 'India', flag: '🇮🇳' },
  { key: 'Pakistan', label: 'Pakistan', flag: '🇵🇰' },
  { key: 'Middle East', label: 'Middle East', flag: '🕌' },
  { key: 'Europe', label: 'Europe', flag: '🇪🇺' },
  { key: 'Africa', label: 'Africa', flag: '🌍' },
  { key: 'Americas', label: 'Americas', flag: '🌎' },
  { key: 'Australia', label: 'Australia', flag: '🇦🇺' },
];

const emptyForm = {
  name: '', type: 'http', base_url: '', api_key: '', api_secret: '',
  region: 'Global', description: '', is_active: true,
};

export const APIConnectors: React.FC = () => {
  const { apiConnectors, addApiConnector, updateApiConnector, deleteApiConnector } = useData();
  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<APIConnector | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const itemsPerPage = 25;

  const [form, setForm] = useState(emptyForm);

  const filtered = apiConnectors.filter((c: any) => {
    const ms = (c.name || '').toLowerCase().includes(search.toLowerCase());
    const mr = regionFilter === 'all' || c.region === regionFilter;
    return ms && mr;
  });
  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const paginated = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const openAdd = () => {
    setEditing(null); setError('');
    setForm(emptyForm);
    setShowModal(true);
  };
  const openEdit = (c: any) => {
    setEditing(c); setError('');
    setForm({
      name: c.name || '', type: c.type || 'http', base_url: c.base_url || '',
      api_key: c.api_key || '', api_secret: c.api_secret || '',
      region: c.region || 'Global', description: c.description || '',
      is_active: c.is_active !== false,
    });
    setShowModal(true);
  };
  const handleSave = async () => {
    setError(''); setSaving(true);
    try {
      if (editing) {
        await updateApiConnector(String(editing.id), form as any);
      } else {
        await addApiConnector(form as any);
      }
      setShowModal(false);
    } catch (e: any) { setError(e.message); }
    setSaving(false);
  };
  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this API connector?')) return;
    try { await deleteApiConnector(id); } catch (e: any) { alert(e.message); }
  };
  const handleToggle = async (c: any) => {
    try { await updateApiConnector(String(c.id), { is_active: !c.is_active }); } catch (e: any) { alert(e.message); }
  };

  const getStatus = (c: any) => {
    if (!c.is_active) return { variant: 'danger' as const, label: 'Inactive' };
    return { variant: 'success' as const, label: 'Active' };
  };

  const columns = [
    { key: 'name', header: 'Connector', render: (c: any) => <div><p className="font-medium text-sm">{c.name || 'Unnamed'}</p><p className="text-[10px] text-gray-500">{c.type || 'http'} • {c.region || '-'}</p></div> },
    { key: 'url', header: 'API URL', render: (c: any) => <code className="text-[10px] bg-gray-100 px-1.5 py-0.5 rounded truncate block max-w-[180px]">{c.base_url?.slice(0, 30) || '-'}</code> },
    { key: 'status', header: 'Status', render: (c: any) => { const s = getStatus(c); return <Badge variant={s.variant} dot size="sm">{s.label}</Badge>; } },
    { key: 'actions', header: 'Actions', render: (c: any) => <div className="flex gap-0.5">
      <button onClick={() => openEdit(c)} className="p-1 rounded hover:bg-gray-100"><Edit size={14} className="text-gray-500" /></button>
      <button onClick={() => handleToggle(c)} className="p-1 rounded hover:bg-gray-100">{c.is_active ? <XCircle size={14} className="text-red-500" /> : <CheckCircle size={14} className="text-green-500" />}</button>
      <button onClick={() => handleDelete(String(c.id))} className="p-1 rounded hover:bg-gray-100"><Trash2 size={14} className="text-red-500" /></button>
    </div> },
  ];

  return (<div className="space-y-6">
    <div className="flex items-center justify-between">
      <div><h1 className="text-2xl font-bold text-gray-800">API Connectors</h1><p className="text-gray-500 mt-1">{apiConnectors.length} connectors loaded from database</p></div>
      <Button icon={<Plus size={18} />} onClick={openAdd}>Add Connector</Button>
    </div>

    {/* Region Stats */}
    <div className="grid grid-cols-5 md:grid-cols-10 gap-2">
      {REGIONS.map(r => {
        const count = r.key === 'all' ? apiConnectors.length : apiConnectors.filter((c: any) => c.region === r.key).length;
        return <button key={r.key} onClick={() => { setRegionFilter(r.key); setCurrentPage(1); }}
          className={`p-2.5 rounded-xl border text-center transition ${regionFilter === r.key ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-200' : 'border-gray-200 hover:bg-gray-50'}`}>
          <span className="text-lg">{r.flag}</span>
          <p className="text-xs font-semibold mt-0.5">{r.label}</p>
          <p className="text-sm font-bold text-gray-800">{count}</p>
        </button>;
      })}
    </div>

    <Card><div className="relative"><Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input type="text" placeholder="Search connectors..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm" /></div></Card>

    <Card noPadding>
      <Table columns={columns} data={paginated} keyExtractor={(c: any) => String(c.id)} />
      <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} totalItems={filtered.length} itemsPerPage={itemsPerPage} />
    </Card>

    <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit API Connector' : 'Add API Connector'} size="lg"
      footer={<div className="flex justify-end gap-3"><Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button><Button onClick={handleSave} loading={saving}>{editing ? 'Update' : 'Add'}</Button></div>}>
      <div className="space-y-4">
        {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}
        <div className="grid grid-cols-3 gap-4">
          <Input label="Name *" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required />
          <Select label="Type" value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))} options={[{ value: 'http', label: 'HTTP' }, { value: 'smpp', label: 'SMPP' }]} />
          <Select label="Region" value={form.region} onChange={e => setForm(p => ({ ...p, region: e.target.value }))} options={REGIONS.filter(r => r.key !== 'all').map(r => ({ value: r.key, label: r.flag + ' ' + r.label }))} />
        </div>
        <Input label="Base URL *" value={form.base_url} onChange={e => setForm(p => ({ ...p, base_url: e.target.value }))} placeholder="https://api.example.com" required />
        <div className="grid grid-cols-2 gap-4">
          <Input label="API Key" value={form.api_key} onChange={e => setForm(p => ({ ...p, api_key: e.target.value }))} />
          <Input label="API Secret" type="password" value={form.api_secret} onChange={e => setForm(p => ({ ...p, api_secret: e.target.value }))} />
        </div>
        <Textarea label="Description" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={2} />
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))} className="w-4 h-4 rounded" /><span className="text-sm">Active</span></label>
      </div>
    </Modal>
  </div>);
};
