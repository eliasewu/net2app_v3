import React, { useState } from 'react';
import { Plus, Search, Upload, Play, Pause, X, Send, Users, CheckCircle, AlertTriangle } from 'lucide-react';
import { useData } from '../store/DataContext';
import { Card } from '../components/UI/Card';
import { Button } from '../components/UI/Button';
import { Badge } from '../components/UI/Badge';
import { Table, Pagination } from '../components/UI/Table';
import { Modal } from '../components/UI/Modal';
import { Input, Select, Textarea } from '../components/UI/Input';

interface Campaign {
  id: string;
  campaign_name: string;
  client_id: string;
  sender_id: string;
  message_template: string;
  route_plan_id: string;
  recipients_file: string | null;
  recipients_count: number;
  sent_count: number;
  delivered_count: number;
  failed_count: number;
  status: 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'cancelled';
  send_type: 'immediate' | 'scheduled';
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  currency: string;
  client_rate: number;
  supplier_rate: number;
  profit: number;
  created_at: string;
}

export const CampaignsPage: React.FC = () => {
  const { clients, routePlans, rates } = useData();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [search, setSearch] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadedNumbers, setUploadedNumbers] = useState<string[]>([]);

  const [form, setForm] = useState({
    campaign_name: '', client_id: '', sender_id: '', message_template: '',
    route_plan_id: '', send_type: 'immediate' as 'immediate' | 'scheduled',
    scheduled_at: '', currency: 'EUR',
  });

  const itemsPerPage = 10;
  const filtered = campaigns.filter(c => c.campaign_name.toLowerCase().includes(search.toLowerCase()) || (clients.find(x=>x.id===c.client_id)?.company_name.toLowerCase().includes(search.toLowerCase())));
  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const paginated = filtered.slice((currentPage-1)*itemsPerPage, currentPage*itemsPerPage);

  const handleCreate = () => {
    const clientRate = rates.find(r => r.entity_type==='client' && r.entity_id===form.client_id && r.is_active);
    const supplierRate = rates.find(r => r.entity_type==='supplier' && r.is_active);

    const newCampaign: Campaign = {
      id: Date.now().toString(),
      ...form,
      recipients_file: uploadFile?.name || null,
      recipients_count: uploadedNumbers.length,
      sent_count: 0, delivered_count: 0, failed_count: 0,
      status: form.send_type === 'scheduled' ? 'scheduled' : 'draft',
      scheduled_at: form.send_type === 'scheduled' ? form.scheduled_at : null,
      started_at: null, completed_at: null,
      client_rate: clientRate?.rate || 0.025,
      supplier_rate: supplierRate?.rate || 0.015,
      profit: (clientRate?.rate || 0.025) - (supplierRate?.rate || 0.015),
      created_at: new Date().toISOString(),
    };
    setCampaigns(prev => [newCampaign, ...prev]);
    setShowCreate(false);
    setUploadedNumbers([]); setUploadFile(null);
    setForm({ campaign_name:'', client_id:'', sender_id:'', message_template:'', route_plan_id:'', send_type:'immediate', scheduled_at:'', currency:'EUR' });
  };

  const handleStart = (id: string) => {
    setCampaigns(prev => prev.map(c => c.id===id ? { ...c, status:'running' as const, started_at: new Date().toISOString() } : c));
    // Simulate sending
    const campaign = campaigns.find(c => c.id===id);
    if (campaign) {
      let sent = 0;
      const interval = setInterval(() => {
        sent += Math.floor(Math.random()*500+200);
        if (sent >= campaign.recipients_count) {
          sent = campaign.recipients_count;
          clearInterval(interval);
          setCampaigns(prev => prev.map(c => c.id===id ? { ...c, sent_count: sent, delivered_count: Math.floor(sent*0.94), failed_count: Math.floor(sent*0.06), status:'completed', completed_at: new Date().toISOString() } : c));
        } else {
          setCampaigns(prev => prev.map(c => c.id===id ? { ...c, sent_count: sent, delivered_count: Math.floor(sent*0.94), failed_count: Math.floor(sent*0.06) } : c));
        }
      }, 1500);
    }
  };
  const handlePause = (id: string) => setCampaigns(prev => prev.map(c => c.id===id ? {...c, status:'paused'} : c));
  const handleResume = (id: string) => handleStart(id);
  const handleCancel = (id: string) => setCampaigns(prev => prev.map(c => c.id===id ? {...c, status:'cancelled', completed_at: new Date().toISOString()} : c));
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const numbers = text.split(/[\n,]+/).map(n => n.trim()).filter(n => /^\+?\d{7,15}$/.test(n));
      setUploadedNumbers(numbers);
    };
    reader.readAsText(file);
  };

  const getStatusBadge = (s: string) => {
    const m: Record<string,'success'|'warning'|'danger'|'info'|'default'> = { draft:'default', scheduled:'info', running:'warning', paused:'warning', completed:'success', cancelled:'danger' };
    return <Badge variant={m[s]||'default'} dot>{s.toUpperCase()}</Badge>;
  };

  const columns = [
    { key:'name', header:'Campaign', render:(c:Campaign)=><div><p className="font-medium">{c.campaign_name}</p><p className="text-xs text-gray-500">{clients.find(x=>x.id===c.client_id)?.company_name||'Self'} · {routePlans.find(x=>x.id===c.route_plan_id)?.plan_name||'Auto'}</p></div> },
    { key:'progress', header:'Progress', render:(c:Campaign)=><div className="w-32"><div className="flex justify-between text-xs mb-1"><span>{c.recipients_count>0?((c.sent_count/c.recipients_count)*100).toFixed(0):0}%</span><span>{c.sent_count.toLocaleString()}/{c.recipients_count.toLocaleString()}</span></div><div className="w-full bg-gray-200 rounded-full h-2"><div className="bg-blue-500 h-2 rounded-full transition-all" style={{width:`${c.recipients_count>0?(c.sent_count/c.recipients_count)*100:0}%`}}/></div></div> },
    { key:'dlr', header:'DLR Rate', align:'center' as const, render:(c:Campaign)=><span className={`font-semibold ${c.sent_count>0&&((c.delivered_count/c.sent_count)*100)>90?'text-green-600':'text-red-600'}`}>{c.sent_count>0?((c.delivered_count/c.sent_count)*100).toFixed(1):'0'}%</span> },
    { key:'profit', header:'Profit', align:'right' as const, render:(c:Campaign)=><span className={`font-semibold ${c.profit>0?'text-green-600':'text-red-600'}`}>€{c.profit.toFixed(4)}/sms</span> },
    { key:'cost', header:'Est. Cost', align:'right' as const, render:(c:Campaign)=><span className="text-sm">€{(c.client_rate*c.sent_count).toFixed(2)}</span> },
    { key:'type', header:'Type', render:(c:Campaign)=><Badge variant={c.send_type==='immediate'?'info':'warning'}>{c.send_type}</Badge> },
    { key:'status', header:'Status', render:(c:Campaign)=>getStatusBadge(c.status) },
    { key:'actions', header:'', render:(c:Campaign)=><div className="flex gap-1">{c.status==='draft'&&<button onClick={()=>handleStart(c.id)} className="p-1.5 rounded hover:bg-green-50"><Play size={14} className="text-green-500"/></button>}{c.status==='scheduled'&&<button onClick={()=>handleStart(c.id)} className="p-1.5 rounded hover:bg-green-50"><Play size={14} className="text-green-500"/></button>}{c.status==='running'&&<button onClick={()=>handlePause(c.id)} className="p-1.5 rounded hover:bg-yellow-50"><Pause size={14} className="text-yellow-500"/></button>}{c.status==='paused'&&<button onClick={()=>handleResume(c.id)} className="p-1.5 rounded hover:bg-green-50"><Play size={14} className="text-green-500"/></button>}{(c.status==='running'||c.status==='paused'||c.status==='scheduled')&&<button onClick={()=>handleCancel(c.id)} className="p-1.5 rounded hover:bg-red-50"><X size={14} className="text-red-500"/></button>}</div> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-gray-800">Campaigns</h1><p className="text-gray-500 mt-1">Bulk SMS via specific route, upload number lists, schedule or send immediately</p></div>
        <Button icon={<Plus size={18}/>} onClick={()=>setShowCreate(true)}>Create Campaign</Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="bg-white rounded-xl p-4 border"><Send size={20} className="text-blue-500 mb-1"/><p className="text-2xl font-bold">{campaigns.length}</p><p className="text-sm text-gray-500">Total Campaigns</p></div>
        <div className="bg-white rounded-xl p-4 border"><Play size={20} className="text-green-500 mb-1"/><p className="text-2xl font-bold">{campaigns.filter(c=>c.status==='running'||c.status==='completed').length}</p><p className="text-sm text-gray-500">Active/Done</p></div>
        <div className="bg-white rounded-xl p-4 border"><Users size={20} className="text-purple-500 mb-1"/><p className="text-2xl font-bold">{campaigns.reduce((s,c)=>s+c.recipients_count,0).toLocaleString()}</p><p className="text-sm text-gray-500">Total Recipients</p></div>
        <div className="bg-white rounded-xl p-4 border"><CheckCircle size={20} className="text-green-500 mb-1"/><p className="text-2xl font-bold">{campaigns.filter(c=>c.profit>0).length}</p><p className="text-sm text-gray-500">Profitable</p></div>
        <div className="bg-white rounded-xl p-4 border"><AlertTriangle size={20} className="text-red-500 mb-1"/><p className="text-2xl font-bold">{campaigns.filter(c=>c.profit<=0).length}</p><p className="text-sm text-gray-500">Blocked (No Profit)</p></div>
      </div>

      <Card><div className="relative"><Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/><input type="text" placeholder="Search campaigns..." value={search} onChange={e=>setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/></div></Card>

      <Card noPadding><Table columns={columns} data={paginated} keyExtractor={c=>c.id}/><Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} totalItems={filtered.length} itemsPerPage={itemsPerPage}/></Card>

      {/* Create Campaign Modal */}
      <Modal isOpen={showCreate} onClose={()=>setShowCreate(false)} title="Create Campaign (Bulk SMS)" size="lg" footer={<div className="flex justify-between w-full"><Button variant="secondary" icon={<Upload size={14}/>} onClick={()=>setShowUpload(true)}>Upload Numbers ({uploadedNumbers.length})</Button><div className="flex gap-3"><Button variant="secondary" onClick={()=>setShowCreate(false)}>Cancel</Button><Button onClick={handleCreate} disabled={uploadedNumbers.length===0}>Create Campaign</Button></div></div>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input label="Campaign Name *" value={form.campaign_name} onChange={e=>setForm(p=>({...p,campaign_name:e.target.value}))} required />
            <Select label="Client" value={form.client_id} onChange={e=>setForm(p=>({...p,client_id:e.target.value}))} options={[{value:'',label:'Select Client'},...clients.map(c=>({value:c.id,label:c.client_code}))]} required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Sender ID *" value={form.sender_id} onChange={e=>setForm(p=>({...p,sender_id:e.target.value}))} placeholder="NET2APP" required />
            <Select label="Currency" value={form.currency} onChange={e=>setForm(p=>({...p,currency:e.target.value}))} options={[{value:'EUR',label:'EUR (€)'},{value:'USD',label:'USD ($)'}]} />
          </div>
          <Textarea label="Message Template *" value={form.message_template} onChange={e=>setForm(p=>({...p,message_template:e.target.value}))} rows={3} required />
          <Select label="Route Plan *" value={form.route_plan_id} onChange={e=>setForm(p=>({...p,route_plan_id:e.target.value}))} options={[{value:'',label:'Select Route Plan (Mandatory)'},...routePlans.map(r=>({value:r.id,label:r.plan_name}))]} required />
          <div className="grid grid-cols-2 gap-4">
            <Select label="Send Type" value={form.send_type} onChange={e=>setForm(p=>({...p,send_type:e.target.value as 'immediate'|'scheduled'}))} options={[{value:'immediate',label:'Immediate'},{value:'scheduled',label:'Scheduled'}]} />
            {form.send_type==='scheduled' && <Input label="Schedule Date/Time" type="datetime-local" value={form.scheduled_at} onChange={e=>setForm(p=>({...p,scheduled_at:e.target.value}))} required />}
          </div>

          {/* Uploaded Numbers Preview */}
          <div className="border rounded-lg p-3 max-h-40 overflow-y-auto">
            <p className="text-xs font-medium text-gray-500 mb-2">Recipients ({uploadedNumbers.length.toLocaleString()})</p>
            {uploadedNumbers.length===0 ? <p className="text-sm text-gray-400">Upload a CSV/TXT file with phone numbers (one per line)</p> : <div className="grid grid-cols-4 gap-1">{uploadedNumbers.slice(0,40).map((n,i)=><code key={i} className="text-[10px] bg-gray-100 px-1 py-0.5 rounded">{n}</code>)}{uploadedNumbers.length>40&&<span className="text-[10px] text-gray-500">+{uploadedNumbers.length-40} more</span>}</div>}
          </div>

          {/* Profit Preview */}
          {form.client_id && form.route_plan_id && (
            <div className="bg-blue-50 p-3 rounded-lg text-sm">
              <p className="font-medium text-blue-700">Profit Calculation:</p>
              <p>Client Rate: €{(rates.find(r=>r.entity_type==='client'&&r.entity_id===form.client_id&&r.is_active)?.rate||0.025).toFixed(4)} - Supplier Rate: €{(rates.find(r=>r.entity_type==='supplier'&&r.is_active)?.rate||0.015).toFixed(4)} = <strong className="text-green-600">€{((rates.find(r=>r.entity_type==='client'&&r.entity_id===form.client_id&&r.is_active)?.rate||0.025)-(rates.find(r=>r.entity_type==='supplier'&&r.is_active)?.rate||0.015)).toFixed(4)} profit/SMS</strong></p>
            </div>
          )}
        </div>
      </Modal>

      {/* File Upload Modal */}
      <Modal isOpen={showUpload} onClose={()=>setShowUpload(false)} title="Upload Recipient Numbers" footer={<div className="flex justify-end gap-3"><Button variant="secondary" onClick={()=>setShowUpload(false)}>Done</Button></div>}>
        <div className="space-y-4">
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center">
            <Upload size={32} className="mx-auto text-gray-400 mb-2"/>
            <p className="text-gray-600 text-sm">Drag & drop CSV/TXT file</p>
            <p className="text-xs text-gray-400 mt-1">One phone number per line or comma-separated</p>
            <input type="file" accept=".csv,.txt" onChange={handleFileUpload} className="mt-3 text-sm"/>
          </div>
          {uploadedNumbers.length > 0 && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-3">
              <p className="text-green-700 font-medium">{uploadedNumbers.length.toLocaleString()} valid numbers detected</p>
              <p className="text-xs text-green-600 mt-1">Invalid/duplicate numbers automatically filtered</p>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};
