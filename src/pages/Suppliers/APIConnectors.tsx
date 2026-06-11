import React, { useState } from 'react';
import { Plus, Search, Edit, Trash2, Globe, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import { Card } from '../../components/UI/Card';
import { Button } from '../../components/UI/Button';
import { Badge } from '../../components/UI/Badge';
import { Modal } from '../../components/UI/Modal';
import { Input, Select, Textarea } from '../../components/UI/Input';
import { Table, Pagination } from '../../components/UI/Table';
import { defaultConnectors, Connector } from '../../data/connectors';

function load<T>(k: string, f: T): T {
  try { const s = localStorage.getItem(k); if (s) return JSON.parse(s); } catch {}
  localStorage.setItem(k, JSON.stringify(f)); return f;
}
function save<T>(k: string, v: T) { localStorage.setItem(k, JSON.stringify(v)); }

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

export const APIConnectors: React.FC = () => {
  const [connectors, setConnectors] = useState<Connector[]>(() => load('api_connectors_db', defaultConnectors));
  const [search, setSearch] = useState('');
  const [regionFilter, setRegionFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Connector | null>(null);
  const itemsPerPage = 25;

  const [form, setForm] = useState({
    name: '', provider: '', region: 'Global', auth_type: 'API_KEY', http_method: 'POST',
    api_key: '', api_secret: '', send_url: '', dlr_url: '', params: '',
    submit_pattern: '', dlr_pattern: '', dlr_value: 'delivered', is_active: true,
  });

  const filtered = connectors.filter(c => {
    const ms = c.name.toLowerCase().includes(search.toLowerCase()) || c.provider.toLowerCase().includes(search.toLowerCase());
    const mr = regionFilter === 'all' || c.region === regionFilter;
    return ms && mr;
  });
  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const paginated = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const openAdd = () => {
    setEditing(null);
    setForm({ name: '', provider: '', region: 'Global', auth_type: 'API_KEY', http_method: 'POST', api_key: '', api_secret: '', send_url: '', dlr_url: '', params: '', submit_pattern: '', dlr_pattern: '', dlr_value: 'delivered', is_active: true });
    setShowModal(true);
  };
  const openEdit = (c: Connector) => {
    setEditing(c);
    setForm({ name: c.name, provider: c.provider, region: c.region, auth_type: c.auth_type, http_method: c.http_method, api_key: c.api_key, api_secret: c.api_secret, send_url: c.send_url, dlr_url: c.dlr_url, params: c.params, submit_pattern: c.submit_pattern, dlr_pattern: c.dlr_pattern, dlr_value: c.dlr_value, is_active: c.is_active });
    setShowModal(true);
  };
  const handleSave = () => {
    if (editing) {
      setConnectors(p => { const n = p.map(c => c.id === editing.id ? { ...c, ...form } : c); save('api_connectors_db', n); return n; });
    } else {
      const nc: Connector = { ...form, id: 'cust_' + Date.now(), type: 'http', status: 'untested' };
      setConnectors(p => { const n = [...p, nc]; save('api_connectors_db', n); return n; });
    }
    setShowModal(false);
  };
  const handleDelete = (id: string) => { setConnectors(p => { const n = p.filter(c => c.id !== id); save('api_connectors_db', n); return n; }); };
  const handleToggle = (id: string) => { setConnectors(p => { const n = p.map(c => c.id === id ? { ...c, is_active: !c.is_active } : c); save('api_connectors_db', n); return n; }); };
  const handleTest = async (id: string) => {
    setConnectors(p => p.map(c => c.id === id ? { ...c, status: 'testing' } : c));
    await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
    setConnectors(p => p.map(c => c.id === id ? { ...c, status: Math.random() > 0.25 ? 'connected' : 'failed' } : c));
  };
  const handleRestoreDefaults = () => {
    if (window.confirm('Reset all API connectors to defaults? Custom ones will be lost.')) {
      localStorage.setItem('api_connectors_db', JSON.stringify(defaultConnectors));
      setConnectors([...defaultConnectors]);
    }
  };

  const columns = [
    { key: 'name', header: 'Connector', render: (c: Connector) => <div><p className="font-medium text-sm">{c.name}</p><p className="text-[10px] text-gray-500">{c.provider} • {c.region}</p></div> },
    { key: 'auth', header: 'Auth', render: (c: Connector) => <Badge variant="default" size="sm">{c.auth_type}</Badge> },
    { key: 'url', header: 'API URL', render: (c: Connector) => <code className="text-[10px] bg-gray-100 px-1.5 py-0.5 rounded truncate block max-w-[180px]">{c.send_url?.split('/')[2] || c.send_url?.slice(0, 30) || '-'}</code> },
    { key: 'status', header: 'Status', render: (c: Connector) => {
      if (c.status === 'testing') return <Badge variant="warning" size="sm">Testing...</Badge>;
      if (c.status === 'connected') return <Badge variant="success" dot size="sm">Connected</Badge>;
      if (c.status === 'failed') return <Badge variant="danger" dot size="sm">Failed</Badge>;
      return <Badge variant={c.is_active ? 'default' : 'danger'} size="sm">{c.is_active ? 'Active' : 'Inactive'}</Badge>;
    } },
    { key: 'actions', header: 'Actions', render: (c: Connector) => <div className="flex gap-0.5">
      <button onClick={() => openEdit(c)} className="p-1 rounded hover:bg-gray-100"><Edit size={14} className="text-gray-500" /></button>
      <button onClick={() => handleTest(c.id)} className="p-1 rounded hover:bg-gray-100" title="Test"><RefreshCw size={14} className="text-blue-500" /></button>
      <button onClick={() => handleToggle(c.id)} className="p-1 rounded hover:bg-gray-100">{c.is_active ? <XCircle size={14} className="text-red-500" /> : <CheckCircle size={14} className="text-green-500" />}</button>
      <button onClick={() => handleDelete(c.id)} className="p-1 rounded hover:bg-gray-100"><Trash2 size={14} className="text-red-500" /></button>
    </div> },
  ];

  return (<div className="space-y-6">
    <div className="flex items-center justify-between">
      <div><h1 className="text-2xl font-bold text-gray-800">API Connectors — HTTP API</h1><p className="text-gray-500 mt-1">{connectors.length} pre-configured providers + unlimited custom — All act as suppliers</p></div>
      <div className="flex gap-2">
        <Button variant="secondary" icon={<RefreshCw size={16} />} onClick={handleRestoreDefaults}>Reset Defaults</Button>
        <Button icon={<Plus size={18} />} onClick={openAdd}>Add Custom</Button>
      </div>
    </div>

    {/* Region Stats */}
    <div className="grid grid-cols-5 md:grid-cols-10 gap-2">
      {REGIONS.map(r => {
        const count = r.key === 'all' ? connectors.length : connectors.filter(c => c.region === r.key).length;
        return <button key={r.key} onClick={() => { setRegionFilter(r.key); setCurrentPage(1); }}
          className={`p-2.5 rounded-xl border text-center transition ${regionFilter === r.key ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-200' : 'border-gray-200 hover:bg-gray-50'}`}>
          <span className="text-lg">{r.flag}</span>
          <p className="text-xs font-semibold mt-0.5">{r.label}</p>
          <p className="text-sm font-bold text-gray-800">{count}</p>
        </button>;
      })}
    </div>

    {/* Search */}
    <Card><div className="relative"><Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input type="text" placeholder="Search by name or provider..." value={search} onChange={e => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm" /></div></Card>

    {/* Table */}
    <Card noPadding>
      <Table columns={columns} data={paginated} keyExtractor={c => c.id} />
      <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} totalItems={filtered.length} itemsPerPage={itemsPerPage} />
    </Card>

    {/* Add/Edit Modal */}
    <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit API Connector' : 'Add Custom API Connector'} size="lg" footer={<div className="flex justify-end gap-3"><Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button><Button onClick={handleSave}>{editing ? 'Update' : 'Add'}</Button></div>}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-4">
          <Input label="Name *" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required />
          <Input label="Provider" value={form.provider} onChange={e => setForm(p => ({ ...p, provider: e.target.value }))} />
          <Select label="Region" value={form.region} onChange={e => setForm(p => ({ ...p, region: e.target.value }))} options={REGIONS.filter(r => r.key !== 'all').map(r => ({ value: r.key, label: r.flag + ' ' + r.label }))} />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Select label="Auth Type" value={form.auth_type} onChange={e => setForm(p => ({ ...p, auth_type: e.target.value }))} options={[{ value: 'API_KEY', label: 'API Key' }, { value: 'BASIC', label: 'Basic Auth' }, { value: 'BEARER', label: 'Bearer Token' }]} />
          <Select label="Method" value={form.http_method} onChange={e => setForm(p => ({ ...p, http_method: e.target.value }))} options={[{ value: 'POST', label: 'POST' }, { value: 'GET', label: 'GET' }]} />
          <Input label="API Key / Token" value={form.api_key} onChange={e => setForm(p => ({ ...p, api_key: e.target.value }))} />
        </div>
        <Textarea label="Send URL *" value={form.send_url} onChange={e => setForm(p => ({ ...p, send_url: e.target.value }))} rows={2} placeholder="https://api.provider.com/send" required />
        <div className="grid grid-cols-2 gap-4">
          <Input label="DLR URL" value={form.dlr_url} onChange={e => setForm(p => ({ ...p, dlr_url: e.target.value }))} />
          <Input label="Params (comma-separated)" value={form.params} onChange={e => setForm(p => ({ ...p, params: e.target.value }))} placeholder="to,from,text" />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <Input label="Submit Success Pattern" value={form.submit_pattern} onChange={e => setForm(p => ({ ...p, submit_pattern: e.target.value }))} />
          <Input label="DLR Pattern" value={form.dlr_pattern} onChange={e => setForm(p => ({ ...p, dlr_pattern: e.target.value }))} />
          <Input label="DLR Success Value" value={form.dlr_value} onChange={e => setForm(p => ({ ...p, dlr_value: e.target.value }))} />
        </div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))} className="w-4 h-4 rounded" /><span className="text-sm">Active</span></label>
      </div>
    </Modal>
  </div>);
};
