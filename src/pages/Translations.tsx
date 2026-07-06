import React, { useState, useEffect, useRef } from 'react';
import { Plus, Search, Edit, Trash2, Play, Type, RefreshCw } from 'lucide-react';
import { useData } from '../store/DataContext';
import { Card } from '../components/UI/Card';
import { Button } from '../components/UI/Button';
import { Badge } from '../components/UI/Badge';
import { Table, Pagination } from '../components/UI/Table';
import { Modal } from '../components/UI/Modal';
import { Input, Select, Textarea } from '../components/UI/Input';

type TranslationType = 'number' | 'sid' | 'content' | 'dynamic_body' | 'random_body' | 'random_sid';

interface TransEntry {
  id: string; name: string; type: TranslationType; priority: number;
  apply_to: 'client' | 'supplier' | 'both'; entity_id: string;
  source_pattern: string; replace_pattern: string;
  is_active: boolean; description: string; created_at: string;
}

const TYPE_LABELS: Record<TranslationType, {label:string;desc:string;color:'info'|'success'|'warning'|'purple'|'default'|'danger'}> = {
  number: {label:'Number',desc:'Prefix, E.164, formatting',color:'warning'},
  sid: {label:'Sender ID',desc:'Mask, alpha↔numeric',color:'info'},
  content: {label:'Content',desc:'Text replace, OTP extract',color:'success'},
  dynamic_body: {label:'Dynamic Body',desc:'Preserve context, replace OTP',color:'purple'},
  random_body: {label:'Random Body',desc:'Random template anti-detection',color:'danger'},
  random_sid: {label:'Random SID',desc:'Random sender ID rotation',color:'default'},
};

function applyTrans(input:string, entry:TransEntry): string {
  if (!input || !entry.source_pattern) return input;
  try {
    const re = new RegExp(entry.source_pattern, 'gi');
    if (entry.type === 'random_body' || entry.type === 'random_sid') {
      const options = entry.replace_pattern.split('|').map(s=>s.trim());
      const match = input.match(re);
      if (match) {
        const random = options[Math.floor(Math.random() * options.length)];
        return random.replace('{{OTP}}', match[0]);
      }
      return input;
    }
    if (entry.type === 'dynamic_body') {
      const match = input.match(re);
      if (match) {
        const re2 = new RegExp(entry.source_pattern.replace(/\\(\d{4,8})/, '{{OTP}}'), 'gi');
        return input.replace(re2, entry.replace_pattern.replace(/\\$\\{1\\}/g, match[1]||''));
      }
      return input;
    }
    return input.replace(re, entry.replace_pattern);
  } catch { return input; }
}

export const TranslationsPage: React.FC = () => {
  const { clients, suppliers, translations: apiTranslations } = useData();
  const [entries, setEntries] = useState<TransEntry[]>([]);
  const seededRef = useRef(false);
  // Sync from API when data arrives — map DB columns to local TransEntry format (once)
  useEffect(() => {
    if (seededRef.current || apiTranslations.length === 0) return;
    seededRef.current = true;
    const mapped: TransEntry[] = apiTranslations.map((t: any) => ({
      id: String(t.id),
      name: t.name || `Rule #${t.id}`,
      type: (t.subtype === 'content_random_body' ? 'random_body' : t.subtype === 'sender_id_masking' ? 'random_sid' : t.subtype === 'dynamic_content' ? 'content' : t.translation_type === 'sender_id' ? 'sid' : t.translation_type === 'content' ? 'content' : t.translation_type === 'origination' ? 'number' : 'content') as TranslationType,
      priority: t.priority || 1,
      apply_to: (t.apply_to === 'client' || t.apply_to === 'supplier' ? t.apply_to : 'both') as 'client' | 'supplier' | 'both',
      entity_id: t.apply_entity_id || String(t.client_id || t.supplier_id || ''),
      source_pattern: t.source_pattern || '',
      replace_pattern: t.target_value || '',
      is_active: t.is_active !== false,
      description: t.description || '',
      created_at: t.created_at || '',
    }));
    setEntries(mapped);
  }, [apiTranslations]);
  const [search, setSearch] = useState(''); const [typeFilter, setTypeFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1); const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<TransEntry|null>(null);
  const [testInput, setTestInput] = useState(''); const [testOutput, setTestOutput] = useState('');
  const [showTestModal, setShowTestModal] = useState(false);
  const itemsPerPage = 15;

  const [form, setForm] = useState({ name:'', type:'number' as TranslationType, priority:1, apply_to:'client' as 'client'|'supplier'|'both', entity_id:'', source_pattern:'', replace_pattern:'', description:'', is_active:true });

  const filtered = entries.filter(e => {
    const ms = e.name.toLowerCase().includes(search.toLowerCase()) || e.description.toLowerCase().includes(search.toLowerCase());
    const mt = typeFilter==='all' || e.type===typeFilter;
    return ms && mt;
  });
  const totalPages = Math.ceil(filtered.length/itemsPerPage);
  const paginated = filtered.slice((currentPage-1)*itemsPerPage, currentPage*itemsPerPage);

  const openModal = (e?: TransEntry) => {
    if (e) { setEditing(e); setForm({ name:e.name, type:e.type, priority:e.priority, apply_to:e.apply_to, entity_id:e.entity_id, source_pattern:e.source_pattern, replace_pattern:e.replace_pattern, description:e.description, is_active:e.is_active }); }
    else { setEditing(null); setForm({ name:'', type:'number', priority:entries.length+1, apply_to:'client', entity_id:'', source_pattern:'', replace_pattern:'', description:'', is_active:true }); }
    setShowModal(true);
  };
  const save = () => {
    const data = { ...form, created_at: new Date().toISOString().split('T')[0] };
    if (editing) { setEntries(p => { const n = p.map(x => x.id===editing.id ? {...x, ...form} : x); return n; }); }
    else { setEntries(p => { const n = [...p, {...data, id:Date.now().toString()}]; return n; }); }
    setShowModal(false);
  };
  const del = (id:string) => { setEntries(p => { const n = p.filter(x => x.id!==id); return n; }); };
  const testTrans = () => {
    if (!editing && !form.source_pattern) { alert('Save or select a translation first'); return; }
    const entry = editing || {...form, id:'', created_at:''};
    const output = applyTrans(testInput || 'Test 123456 message', entry);
    setTestOutput(output);
    setShowTestModal(true);
  };
  const getName = (type:string, id:string) => {
    if (type==='client') { const c=clients.find(x=>x.id===id); return c?.company_name||c?.client_code||'All'; }
    const s=suppliers.find(x=>x.id===id); return s?.company_name||s?.supplier_code||'All';
  };

  const cols = [
    { key:'name', header:'Translation', render:(e:TransEntry)=><div className="flex items-center gap-2"><div className={`p-1.5 rounded ${e.is_active?'bg-blue-50':'bg-gray-50'}`}><Type size={14} className="text-blue-500"/></div><div><p className="font-medium text-sm">{e.name}</p><p className="text-[10px] text-gray-500">{e.description}</p></div></div> },
    { key:'type', header:'Type', render:(e:TransEntry)=><div><Badge variant={TYPE_LABELS[e.type].color} size="sm">{TYPE_LABELS[e.type].label}</Badge><p className="text-[10px] text-gray-400">{e.apply_to}</p></div> },
    { key:'apply', header:'Applied To', render:(e:TransEntry)=><Badge variant={e.apply_to==='client'?'info':e.apply_to==='supplier'?'purple':'warning'} size="sm">{e.apply_to==='both'?'All':getName(e.apply_to,e.entity_id)}</Badge> },
    { key:'pattern', header:'Pattern', render:(e:TransEntry)=><code className="text-[10px] bg-gray-100 px-1 py-0.5 rounded">{e.source_pattern.slice(0,25)}...</code> },
    { key:'replace', header:'Replace', render:(e:TransEntry)=><code className="text-[10px] bg-green-50 px-1 py-0.5 rounded text-green-700">{e.replace_pattern.slice(0,20)}...</code> },
    { key:'priority', header:'Pri', align:'center' as const, render:(e:TransEntry)=><span className="font-bold text-xs">{e.priority}</span> },
    { key:'status', header:'Status', render:(e:TransEntry)=><Badge variant={e.is_active?'success':'danger'} dot size="sm">{e.is_active?'Active':'Inactive'}</Badge> },
    { key:'actions', header:'', render:(e:TransEntry)=><div className="flex gap-1"><button onClick={()=>{setEditing(e);setTestInput('');setTestOutput('');setShowTestModal(true)}} className="p-1 rounded hover:bg-gray-100"><Play size={14} className="text-green-500"/></button><button onClick={()=>openModal(e)} className="p-1 rounded hover:bg-gray-100"><Edit size={14} className="text-gray-500"/></button><button onClick={()=>del(e.id)} className="p-1 rounded hover:bg-gray-100"><Trash2 size={14} className="text-red-500"/></button></div> },
  ];

  return (<div className="space-y-6">
    <div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold text-gray-800">Translations</h1><p className="text-gray-500 mt-1">{entries.length} rules — Client/Supplier specific: Number, SID, Content, Dynamic Body, Random Body, Random SID</p></div><Button icon={<Plus size={18}/>} onClick={()=>openModal()}>Add Translation</Button></div>
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
      {Object.entries(TYPE_LABELS).map(([k,v])=><div key={k} className="bg-white rounded-xl border p-3 text-center hover:shadow-sm transition-shadow"><Badge variant={v.color} size="sm">{v.label}</Badge><p className="text-[10px] text-gray-500 mt-1">{v.desc}</p></div>)}
    </div>
    <Card><div className="flex flex-col md:flex-row gap-3"><div className="flex-1 relative"><Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/><input type="text" placeholder="Search translations..." value={search} onChange={e=>setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm"/></div><select value={typeFilter} onChange={e=>{setTypeFilter(e.target.value);setCurrentPage(1);}} className="px-4 py-2 border rounded-lg text-sm"><option value="all">All Types</option>{Object.entries(TYPE_LABELS).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</select></div></Card>
    <Card noPadding><Table columns={cols} data={paginated} keyExtractor={e=>e.id}/><Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} totalItems={filtered.length} itemsPerPage={itemsPerPage}/></Card>
    <Modal isOpen={showModal} onClose={()=>setShowModal(false)} title={editing?'Edit Translation':'Add Translation'} size="lg" footer={<div className="flex justify-end gap-3"><Button variant="secondary" onClick={()=>setShowModal(false)}>Cancel</Button><Button onClick={save}>{editing?'Update':'Create'}</Button></div>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4"><Input label="Name *" value={form.name} onChange={e=>setForm(p=>({...p,name:e.target.value}))} required/>
          <Select label="Type *" value={form.type} onChange={e=>setForm(p=>({...p,type:e.target.value as TranslationType}))} options={Object.entries(TYPE_LABELS).map(([k,v])=>({value:k,label:v.label}))} required/></div>
        <div className="grid grid-cols-3 gap-4">
          <Select label="Apply To *" value={form.apply_to} onChange={e=>setForm(p=>({...p,apply_to:e.target.value as any,entity_id:''}))} options={[{value:'client',label:'Client'},{value:'supplier',label:'Supplier'},{value:'both',label:'Both'}]} required/>
          {form.apply_to!=='both'&&<Select label={form.apply_to==='client'?'Client *':'Supplier *'} value={form.entity_id} onChange={e=>setForm(p=>({...p,entity_id:e.target.value}))} options={[{value:'',label:'Select...'},...(form.apply_to==='client'?clients.map(c=>({value:c.id,label:`${c.client_code} - ${c.company_name}`})):suppliers.map(s=>({value:s.id,label:`${s.supplier_code} - ${s.company_name}`})))]} required/>}
          {form.apply_to==='both'&&<Input label="Applies to all" disabled value="All clients/suppliers"/>}
          <Input label="Priority" type="number" value={form.priority} onChange={e=>setForm(p=>({...p,priority:parseInt(e.target.value)}))} min={1}/></div>
        <div><label className="text-sm font-medium text-gray-700 mb-1 block">Source Pattern (Regex)</label><Textarea value={form.source_pattern} onChange={e=>setForm(p=>({...p,source_pattern:e.target.value}))} rows={2} placeholder="\\b(\\d{4,8})\\b" className="font-mono text-sm"/></div>
        <div><label className="text-sm font-medium text-gray-700 mb-1 block">Replace Pattern</label><Textarea value={form.replace_pattern} onChange={e=>setForm(p=>({...p,replace_pattern:e.target.value}))} rows={2} placeholder="{{OTP}}" className="font-mono text-sm"/></div>
        {(form.type==='random_body'||form.type==='random_sid')&&<div className="bg-blue-50 p-3 rounded-lg text-sm text-blue-700">Use | to separate multiple random templates. Example for random SID: <code className="text-xs">SENDER1|SENDER2|SENDER3</code></div>}
        <Input label="Description" value={form.description} onChange={e=>setForm(p=>({...p,description:e.target.value}))} placeholder="What this translation does"/>
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.is_active} onChange={e=>setForm(p=>({...p,is_active:e.target.checked}))} className="w-4 h-4 rounded"/><span className="text-sm">Active</span></label>
        <div className="bg-blue-50 p-3 rounded-lg text-sm"><button type="button" onClick={testTrans} className="text-blue-700"><Play size={14} className="inline"/> Test Translation</button></div>
      </div>
    </Modal>
    <Modal isOpen={showTestModal} onClose={()=>setShowTestModal(false)} title="Test Translation" size="lg" footer={<div className="flex justify-end gap-3"><Button variant="secondary" onClick={()=>setShowTestModal(false)}>Close</Button></div>}>
      <div className="space-y-4">
        <Input label="Test Input" value={testInput} onChange={e=>setTestInput(e.target.value)} placeholder="Your code is 123456. Do not share."/>
        <Button size="sm" variant="secondary" icon={<RefreshCw size={14}/>} onClick={testTrans}>Apply Translation</Button>
        {testOutput&&<div className="bg-green-50 border border-green-200 rounded-lg p-4"><p className="text-xs text-green-600 font-medium mb-1">Output</p><p className="font-semibold text-green-800">{testOutput}</p></div>}
      </div>
    </Modal>
  </div>);
};
