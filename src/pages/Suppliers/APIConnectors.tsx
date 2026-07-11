import React, { useState } from 'react';
import { Plus, Search, Edit, Trash2, CheckCircle, XCircle, Upload, Wand2, ChevronDown, ChevronRight } from 'lucide-react';
import { Card } from '../../components/UI/Card';
import { Button } from '../../components/UI/Button';
import { Badge } from '../../components/UI/Badge';
import { Modal } from '../../components/UI/Modal';
import { Input, Select, Textarea } from '../../components/UI/Input';
import { Table, Pagination } from '../../components/UI/Table';
import { useData } from '../../store/DataContext';
import { api } from '../../services/api';
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
  username: '', password: '',
  phone_number_id: '', business_account_id: '', bot_token: '',
  dlr_url: '', http_method: 'POST', connector_type: '',
  // Response configuration
  send_url: '', submit_pattern: '', dlr_pattern: '', dlr_value: '',
  params: '', dlr_status_mapping: '{"failed":"UNDELIV","delivered":"DELIVRD"}',
  auth_type: 'API_KEY', dlr_webhook_secret: '',
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
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [bulkImporting, setBulkImporting] = useState(false);
  const [bulkResult, setBulkResult] = useState<{created:number;errors?:any[]}|null>(null);
  const [showResponseConfig, setShowResponseConfig] = useState(false);
  
  // AI Auto-Config state
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiProviderName, setAiProviderName] = useState('');
  const [aiDocs, setAiDocs] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<any>(null);
  
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
    setShowResponseConfig(false);
    setShowModal(true);
  };
  const openEdit = (c: any) => {
    setEditing(c); setError('');
    const sm = c.dlr_status_mapping;
    const smStr = typeof sm === 'object' ? JSON.stringify(sm) : (sm || '{"failed":"UNDELIV","delivered":"DELIVRD"}');
    setForm({
      name: c.name || '', type: c.type || 'http', base_url: c.base_url || '',
      api_key: c.api_key || '', api_secret: c.api_secret || '',
      region: c.region || 'Global', description: c.description || '',
      is_active: c.is_active !== false,
      username: c.username || '', password: c.password || '',
      phone_number_id: c.phone_number_id || '', business_account_id: c.business_account_id || '',
      bot_token: c.bot_token || '',
      dlr_url: c.dlr_url || '', http_method: c.http_method || 'POST', connector_type: c.connector_type || '',
      send_url: c.send_url || '', submit_pattern: c.submit_pattern || '',
      dlr_pattern: c.dlr_pattern || '', dlr_value: c.dlr_value || '',
      params: c.params || '', dlr_status_mapping: smStr,
      auth_type: c.auth_type || 'API_KEY', dlr_webhook_secret: c.dlr_webhook_secret || '',
    });
    setShowResponseConfig(!!(c.send_url || c.submit_pattern || c.dlr_pattern || c.dlr_value || c.params));
    setShowModal(true);
  };
  const handleSave = async () => {
    setError('');
    if (form.type === 'whatsapp' && !form.phone_number_id) { setError('Phone Number ID is required for WhatsApp'); return; }
    if (form.type === 'telegram' && !form.bot_token) { setError('Bot Token is required for Telegram'); return; }
    if (form.type === 'voice_otp' && !form.api_key) { setError('API Key is required for Voice OTP'); return; }
    if (form.type === 'voice_otp' && !form.dlr_url) { setError('Check Delivery URL is required for Voice OTP'); return; }
    if (!form.name) { setError('Name is required'); return; }
    setSaving(true);
    try {
      // Parse dlr_status_mapping to JSON for DB
      let dlrMap = form.dlr_status_mapping;
      try { dlrMap = JSON.parse(form.dlr_status_mapping); } catch {}
      const payload = { ...form, dlr_status_mapping: dlrMap, send_url: form.send_url || form.base_url };
      if (editing) {
        await updateApiConnector(String(editing.id), payload as any);
      } else {
        await addApiConnector(payload as any);
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

  // AI Auto-Config: call backend to parse API docs
  const handleAiConfig = async () => {
    if (!aiDocs.trim()) { setError('Please paste API documentation or details'); return; }
    setAiLoading(true);
    try {
      const res = await api.post<any>('/connectors/ai-config', {
        provider_name: aiProviderName || form.name,
        api_docs: aiDocs,
        api_key_sample: form.api_key,
      });
      const data = (res as any).data?.data || (res as any).data || res;
      if (data) {
        setAiResult(data);
        // Auto-fill the form with AI results
        setForm(prev => ({
          ...prev,
          send_url: data.send_url || prev.send_url,
          dlr_url: data.dlr_url || prev.dlr_url,
          submit_pattern: data.submit_pattern || prev.submit_pattern,
          dlr_pattern: data.dlr_pattern || prev.dlr_pattern,
          dlr_value: data.dlr_value || prev.dlr_value,
          params: data.params || prev.params,
          dlr_status_mapping: typeof data.dlr_status_mapping === 'object' ? JSON.stringify(data.dlr_status_mapping) : (data.dlr_status_mapping || prev.dlr_status_mapping),
        }));
        setShowResponseConfig(true);
      }
    } catch (e: any) { setError(e.message || 'AI config failed'); }
    setAiLoading(false);
  };

  const getStatus = (c: any) => {
    if (!c.is_active) return { variant: 'danger' as const, label: 'Inactive' };
    const hasDlr = c.dlr_url && c.dlr_pattern;
    if (c.send_url && c.submit_pattern && hasDlr) return { variant: 'success' as const, label: 'Configured' };
    if (c.send_url) return { variant: 'info' as const, label: 'Send Only' };
    return { variant: 'warning' as const, label: 'Needs Config' };
  };

  const columns = [
    { key: 'name', header: 'Connector', render: (c: any) => <div><p className="font-medium text-sm">{c.name || 'Unnamed'}</p><p className="text-[10px] text-gray-500">{c.provider || c.type || 'http'} • {c.region || '-'}</p></div> },
    { key: 'url', header: 'Send URL', render: (c: any) => <div><code className="text-[10px] bg-gray-100 px-1.5 py-0.5 rounded truncate block max-w-[200px]">{c.send_url?.slice(0, 40) || c.base_url?.slice(0, 40) || '-'}</code>{c.dlr_url && <p className="text-[10px] text-green-600 mt-0.5">+ DLR configured</p>}</div> },
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
      <div className="flex gap-2"><Button variant="secondary" icon={<Upload size={16} />} onClick={() => { setBulkText(''); setBulkResult(null); setShowBulkModal(true); }}>Bulk Import</Button><Button icon={<Plus size={18} />} onClick={openAdd}>Add Connector</Button></div>
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

    {/* Edit/Add Modal */}
    <Modal isOpen={showModal} onClose={() => setShowModal(false)} title={editing ? 'Edit API Connector' : 'Add API Connector'} size="xl"
      footer={<div className="flex justify-end gap-3"><Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button><Button onClick={handleSave} loading={saving}>{editing ? 'Update' : 'Add'}</Button></div>}>
      <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
        {error && <div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}
        
        {/* Basic Info */}
        <div className="grid grid-cols-3 gap-4">
          <Input label="Name *" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} required />
          <Select label="Type" value={form.type} onChange={e => {
            const newType = e.target.value;
            setForm(p => ({ ...p, type: newType, username: '', password: '', phone_number_id: '', business_account_id: '', bot_token: '' }));
          }} options={[
            { value: 'http', label: 'HTTP API' }, { value: 'rest', label: 'REST API' }, { value: 'flash_sms', label: 'Flash SMS API' },
            { value: 'whatsapp', label: 'WhatsApp Business API' }, { value: 'telegram', label: 'Telegram Business API' },
            { value: 'voice_otp', label: 'Voice OTP API' }, { value: 'smpp', label: 'SMPP' },
          ]} />
          <Select label="Region" value={form.region} onChange={e => setForm(p => ({ ...p, region: e.target.value }))} options={REGIONS.filter(r => r.key !== 'all').map(r => ({ value: r.key, label: r.flag + ' ' + r.label }))} />
        </div>
        
        {/* Endpoint URLs */}
        <div className="grid grid-cols-2 gap-4">
          <Input label="Base URL" value={form.base_url} onChange={e => setForm(p => ({ ...p, base_url: e.target.value }))} placeholder="https://api.example.com" />
          <Input label="Send SMS URL" value={form.send_url} onChange={e => setForm(p => ({ ...p, send_url: e.target.value }))} placeholder="https://api.example.com/send — used for outbound SMS" />
        </div>
        <Input label="DLR / Status Check URL" value={form.dlr_url} onChange={e => setForm(p => ({ ...p, dlr_url: e.target.value }))} placeholder="https://api.example.com/dlr — polled for delivery status" />
        
        {/* Auth */}
        <div className="grid grid-cols-3 gap-4">
          <Select label="Auth Type" value={form.auth_type} onChange={e => setForm(p => ({ ...p, auth_type: e.target.value }))} options={[{value:'API_KEY',label:'API Key'},{value:'BASIC',label:'Basic Auth'},{value:'BEARER',label:'Bearer Token'},{value:'OAUTH2',label:'OAuth 2.0'}]} />
          <Input label="API Key" value={form.api_key} onChange={e => setForm(p => ({ ...p, api_key: e.target.value }))} placeholder="Your API key here" />
          <Input label="API Secret" type="password" value={form.api_secret} onChange={e => setForm(p => ({ ...p, api_secret: e.target.value }))} />
        </div>
        {(form.type === 'http' || form.type === 'rest' || form.type === 'flash_sms') && (
          <div className="grid grid-cols-2 gap-4">
            <Input label="Username (Basic Auth)" value={form.username} onChange={e => setForm(p => ({ ...p, username: e.target.value }))} />
            <Input label="Password (Basic Auth)" type="password" value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} />
          </div>
        )}
        {form.type === 'whatsapp' && (
          <div className="grid grid-cols-2 gap-4">
            <Input label="Phone Number ID" value={form.phone_number_id} onChange={e => setForm(p => ({ ...p, phone_number_id: e.target.value }))} placeholder="123456789012345" />
            <Input label="Business Account ID" value={form.business_account_id} onChange={e => setForm(p => ({ ...p, business_account_id: e.target.value }))} placeholder="987654321098765" />
          </div>
        )}
        {form.type === 'telegram' && (
          <Input label="Bot Token" value={form.bot_token} onChange={e => setForm(p => ({ ...p, bot_token: e.target.value }))} placeholder="123456789:ABCdefGHIjklMNOpqrsTUVwxyz" />
        )}
        {form.type === 'voice_otp' && (
          <Select label="HTTP Method" value={form.http_method} onChange={e => setForm(p => ({ ...p, http_method: e.target.value }))} options={[{ value: 'GET', label: 'GET' }, { value: 'POST', label: 'POST' }]} />
        )}

        {/* AI Auto-Config Button */}
        <div className="flex items-center gap-3 p-3 bg-gradient-to-r from-purple-50 to-blue-50 rounded-lg border border-purple-200">
          <Wand2 size={20} className="text-purple-600" />
          <div className="flex-1">
            <p className="text-sm font-medium text-purple-800">AI Auto-Config</p>
            <p className="text-xs text-purple-600">Paste your API docs and we'll auto-fill the response patterns</p>
          </div>
          <Button size="sm" variant="secondary" icon={<Wand2 size={14} />} onClick={() => { setAiProviderName(form.name); setAiDocs(''); setAiResult(null); setShowAiModal(true); }}>Auto-Config</Button>
        </div>

        {/* Response Configuration (collapsible) */}
        <div>
          <button type="button" onClick={() => setShowResponseConfig(!showResponseConfig)} className="flex items-center gap-2 w-full text-left py-2">
            {showResponseConfig ? <ChevronDown size={18} className="text-gray-500" /> : <ChevronRight size={18} className="text-gray-500" />}
            <span className="font-medium text-sm text-gray-700">Response Configuration</span>
            <span className="text-xs text-gray-400">— regex patterns for parsing API responses</span>
          </button>
          {showResponseConfig && (
            <div className="space-y-4 mt-2 pl-6 border-l-2 border-blue-100">
              <div>
                <Input label="Submit Response Pattern" value={form.submit_pattern} onChange={e => setForm(p => ({ ...p, submit_pattern: e.target.value }))} placeholder='regex: "id"\s*:\s*"([^"]+)" — extracts message_id from send response' />
                <p className="text-[10px] text-gray-400 mt-0.5">Regex with capture group to extract the provider's message ID from the HTTP send response body</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Input label="DLR Response Pattern" value={form.dlr_pattern} onChange={e => setForm(p => ({ ...p, dlr_pattern: e.target.value }))} placeholder='regex: "status"\s*:\s*"([^"]+)"' />
                  <p className="text-[10px] text-gray-400 mt-0.5">Regex to parse the DLR callback/webhook response</p>
                </div>
                <div>
                  <Input label="DLR Success Value" value={form.dlr_value} onChange={e => setForm(p => ({ ...p, dlr_value: e.target.value }))} placeholder="delivered" />
                  <p className="text-[10px] text-gray-400 mt-0.5">What the pattern should match for a successful delivery</p>
                </div>
              </div>
              <div>
                <Textarea label="Request Params Template (JSON)" value={form.params} onChange={e => setForm(p => ({ ...p, params: e.target.value }))} rows={3} placeholder='{"to":"{destination}","from":"{sender}","text":"{message}"}' />
                <p className="text-[10px] text-gray-400 mt-0.5">JSON template for the request body. Variables: {'{destination}'}, {'{sender}'}, {'{message}'}</p>
              </div>
              <div>
                <Textarea label="DLR Status Mapping (JSON)" value={form.dlr_status_mapping} onChange={e => setForm(p => ({ ...p, dlr_status_mapping: e.target.value }))} rows={2} placeholder='{"delivered":"DELIVRD","failed":"UNDELIV","buffered":"BUFFERD"}' />
                <p className="text-[10px] text-gray-400 mt-0.5">Maps provider status strings to standard DLR codes</p>
              </div>
            </div>
          )}
        </div>

        <Textarea label="Description" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} rows={2} />
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))} className="w-4 h-4 rounded" /><span className="text-sm">Active</span></label>
        </div>
      </div>
    </Modal>

    {/* AI Auto-Config Modal */}
    <Modal isOpen={showAiModal} onClose={() => setShowAiModal(false)} title="AI Auto-Config" size="lg"
      footer={<div className="flex justify-end gap-3"><Button variant="secondary" onClick={() => setShowAiModal(false)}>Cancel</Button><Button onClick={handleAiConfig} loading={aiLoading} icon={<Wand2 size={16} />}>Generate Config</Button></div>}>
      <div className="space-y-4">
        <p className="text-sm text-gray-600">Paste your API provider documentation or credentials below. The system will auto-detect URLs, response patterns, and DLR configuration.</p>
        <Input label="Provider Name" value={aiProviderName} onChange={e => setAiProviderName(e.target.value)} placeholder="e.g. Twilio, Custom HTTP API" />
        <Textarea label="API Documentation / Details" value={aiDocs} onChange={e => setAiDocs(e.target.value)} rows={8} placeholder={`Paste your API docs, example response, or configuration details here...\n\nExamples:\n- "My API uses POST to https://api.mysms.com/v1/send with JSON body {to, from, text}. Response: {id: "msg_123", status: "queued"}. DLR webhook at https://api.mysms.com/v1/dlr with {message_id, status}"\n- "Twilio account SID: AC123..., Auth Token: xyz..."`} />
        {aiResult && (
          <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-sm font-medium text-green-700 mb-2">✅ Configuration Generated</p>
            <div className="space-y-1 text-xs text-green-600">
              {aiResult.send_url && <p>Send URL: {aiResult.send_url}</p>}
              {aiResult.dlr_url && <p>DLR URL: {aiResult.dlr_url}</p>}
              {aiResult.submit_pattern && <p>Submit Pattern: {aiResult.submit_pattern}</p>}
              {aiResult.dlr_pattern && <p>DLR Pattern: {aiResult.dlr_pattern}</p>}
              {aiResult.params && <p>Params: {aiResult.params}</p>}
            </div>
            <p className="text-xs text-green-500 mt-2">Applied to form — review and save</p>
          </div>
        )}
      </div>
    </Modal>

    {/* Bulk Import Modal */}
    <Modal isOpen={showBulkModal} onClose={() => setShowBulkModal(false)} title="Bulk Import API Connectors" size="lg"
      footer={<div className="flex justify-end gap-3"><Button variant="secondary" onClick={() => setShowBulkModal(false)}>Cancel</Button><Button onClick={async () => {
        setBulkImporting(true); setBulkResult(null);
        try {
          const res = await api.post<any>('/api-connectors/bulk', { csv: bulkText });
          if ((res as any).success && (res as any).data) {
            const d = ((res as any).data as any).data || (res as any).data;
            setBulkResult(d);
            setTimeout(() => window.location.reload(), 1500);
          } else {
            setBulkResult({ created: 0, errors: [{ line: 0, error: (res as any).error || 'Import failed' }] });
          }
        } catch (e: any) { setBulkResult({ created: 0, errors: [{ line: 0, error: e.message }] }); }
        setBulkImporting(false);
      }} loading={bulkImporting}>{bulkImporting ? 'Importing...' : 'Import'}</Button></div>}>
      <div className="space-y-4">
        <div className="bg-yellow-50 p-4 rounded-lg">
          <p className="text-sm text-yellow-700 font-medium mb-2">CSV Format (header + rows):</p>
          <code className="text-xs text-yellow-600">name,type,base_url,api_key,api_secret,region,username,password,phone_number_id,business_account_id,bot_token,description,is_active</code>
          <p className="text-xs text-yellow-600 mt-2">Example: <code>My HTTP API,http,https://api.example.com,key123,secret456,Global,,,,,,,true</code></p>
          <p className="text-xs text-yellow-600 mt-1">Example (WhatsApp): <code>WA Business,whatsapp,https://graph.facebook.com,,,,Global,,,123456789,,,My WhatsApp connector,true</code></p>
          <p className="text-xs text-yellow-600 mt-1">Example (Telegram): <code>TG Bot,telegram,https://api.telegram.org,,,,Global,,,,,,123:ABCdef,Telegram bot,true</code></p>
        </div>
        <Textarea value={bulkText} onChange={e => setBulkText(e.target.value)} rows={10} placeholder="Paste CSV data here..." />
        {bulkResult && (
          <div className={`p-4 rounded-lg ${bulkResult.created > 0 ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
            <p className={`font-medium ${bulkResult.created > 0 ? 'text-green-700' : 'text-red-700'}`}>
              {bulkResult.created} connectors imported successfully
            </p>
            {bulkResult.errors && bulkResult.errors.length > 0 && (
              <div className="mt-2 text-sm text-red-600">
                {bulkResult.errors.map((e: any, i: number) => (
                  <p key={i}>Line {e.line}: {e.error}</p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  </div>);
};
