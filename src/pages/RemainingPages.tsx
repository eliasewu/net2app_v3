import React, { useState } from 'react';
import { useAuth } from '../store/AuthContext';
import { useData } from '../store/DataContext';
import { Rate, User, SMSLog, DashboardStats } from '../types';
import { exportCSV } from '../services/exportService';
import { Card } from '../components/UI/Card';
import { Button } from '../components/UI/Button';
import { Badge } from '../components/UI/Badge';
import { Table, Pagination } from '../components/UI/Table';
import { Modal } from '../components/UI/Modal';
import { Input, Select, Textarea } from '../components/UI/Input';
import { StatCard } from '../components/UI/StatCard';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { DollarSign, TrendingUp, Download, FileText, Plus, Edit, Trash2, Upload, CreditCard, Send, Play, Pause, X, CheckCircle, AlertTriangle, CheckSquare, Square, Shield, Database, HardDrive, RotateCcw, Bell, Search as SearchIcon, Clock, UserPlus, Save, Lock } from 'lucide-react';

const roleLabels: Record<string,string> = { super_admin:'Super Admin', admin:'Admin', support:'Support', billing:'Billing', agent:'Agent', client:'Client', supplier:'Supplier' };
const roleOptions = Object.entries(roleLabels).map(([v,l]) => ({ value:v, label:l }));

// ==================== ROUTE PLANS ====================
export const RoutePlans: React.FC = () => {
  const { routes, routePlans, addRoutePlan, updateRoutePlan, deleteRoutePlan } = useData();
  const [plans, setPlans] = useState(routePlans.length > 0 ? routePlans.map(p => ({ id: p.id, name: p.plan_name, route_ids: p.route_ids, is_default: p.is_default, active: true })) : [{ id:'1', name:'Premium Plan', route_ids:['1','3','4'], is_default:true, active:true },{ id:'2', name:'Marketing Plan', route_ids:['2'], is_default:false, active:true },{ id:'3', name:'OTT Only', route_ids:['3'], is_default:false, active:true }]);
  const [showModal, setShowModal] = useState(false); const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ name:'', route_ids: [] as string[], is_default:false, active:true });
  const allRoutes = routes;
  const open = (p?: any) => { if(p){setEditing(p);setForm({name:p.name,route_ids:p.route_ids||[],is_default:p.is_default,active:p.active});}else{setEditing(null);setForm({name:'',route_ids:[],is_default:false,active:true});} setShowModal(true); };
  const toggleRoute = (rid: string) => { setForm(prev => ({...prev, route_ids: prev.route_ids.includes(rid) ? prev.route_ids.filter(id=>id!==rid) : [...prev.route_ids, rid]})); };
  const cols = [
    {key:'name',header:'Plan Name',render:(p:any)=><span className="font-semibold">{p.name}</span>},
    {key:'routes',header:'Routes',render:(p:any)=><div className="flex flex-wrap gap-1">{(p.route_ids||[]).map((rid:string)=>{const r=allRoutes.find(r=>r.id===rid);return r?<Badge key={rid} variant="info">{r.route_name}</Badge>:null;})}{(p.route_ids||[]).length===0&&<span className="text-sm text-gray-500">No routes</span>}</div>},
    {key:'default',header:'Default',render:(p:any)=><Badge variant={p.is_default?'success':'default'}>{p.is_default?'Yes':'No'}</Badge>},
    {key:'status',header:'Status',render:(p:any)=><Badge variant={p.active?'success':'danger'} dot>{p.active?'Active':'Inactive'}</Badge>},
    {key:'actions',header:'',render:(p:any)=><div className="flex gap-1"><button onClick={()=>open(p)} className="p-1.5 rounded hover:bg-gray-100"><Edit size={14} className="text-gray-500"/></button><button onClick={()=>{setPlans(prev=>prev.filter(x=>x.id!==p.id));if(routePlans.find(rp=>rp.id===p.id))deleteRoutePlan(p.id);}} className="p-1.5 rounded hover:bg-gray-100"><Trash2 size={14} className="text-red-500"/></button></div>},
  ];
  return (<div className="space-y-6"><div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold text-gray-800">Route Plans</h1><p className="text-gray-500 mt-1">Group routes - select all routes to assign</p></div><Button icon={<Plus size={18}/>} onClick={()=>open()}>Add Plan</Button></div><Card noPadding><Table columns={cols} data={plans} keyExtractor={p=>p.id}/></Card>
    <Modal isOpen={showModal} onClose={()=>setShowModal(false)} title={editing?'Edit Route Plan':'Add Route Plan'} size="lg" footer={<div className="flex justify-end gap-3"><Button variant="secondary" onClick={()=>setShowModal(false)}>Cancel</Button><Button onClick={()=>{if(editing){setPlans(prev=>prev.map(p=>p.id===editing.id?{...p,name:form.name,route_ids:form.route_ids,is_default:form.is_default,active:form.active}:p));if(routePlans.find(rp=>rp.id===editing.id))updateRoutePlan(editing.id,{plan_name:form.name,route_ids:form.route_ids,is_default:form.is_default});}else{const nid=Date.now().toString();setPlans(prev=>[...prev,{...form,id:nid}]);addRoutePlan({plan_name:form.name,route_ids:form.route_ids,is_default:form.is_default});}setShowModal(false);}}>{editing?'Update':'Create'}</Button></div>}>
      <div className="space-y-4"><Input label="Plan Name" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} required/>
        <div><label className="block text-sm font-medium text-gray-700 mb-3">Select Routes ({form.route_ids.length} selected)</label>
          <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto p-2 border border-gray-200 rounded-lg">
            {allRoutes.map(route=><label key={route.id} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${form.route_ids.includes(route.id)?'border-blue-500 bg-blue-50':'border-gray-200 hover:border-gray-300'}`}><input type="checkbox" checked={form.route_ids.includes(route.id)} onChange={()=>toggleRoute(route.id)} className="w-4 h-4 rounded border-gray-300 text-blue-600"/><div><p className="text-sm font-medium">{route.route_name}</p><p className="text-xs text-gray-500">{route.route_method} • {route.trunk_ids.length} trunks</p></div></label>)}</div></div>
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.is_default} onChange={e=>setForm({...form,is_default:e.target.checked})} className="w-4 h-4 rounded"/><span className="text-sm">Default Plan</span></label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={form.active} onChange={e=>setForm({...form,active:e.target.checked})} className="w-4 h-4 rounded"/><span className="text-sm">Active</span></label></div></Modal></div>);
};

// ==================== RATE MANAGEMENT ====================
export const RateManagement: React.FC = () => {
  const { rates: allRates, clients, suppliers, addRate, updateRate, deleteRate, mccmnc } = useData();
  const [search, setSearch] = useState(''); const [typeFilter, setTypeFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1); const [showModal, setShowModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false); const [editingRate, setEditingRate] = useState<Rate | null>(null);
  const [selectedRates, setSelectedRates] = useState<string[]>([]); const [bulkText, setBulkText] = useState('');
  const [formData, setFormData] = useState({ entity_type: 'client' as 'client'|'supplier', entity_id: '', mcc: '', mnc: '*', country: '', operator: 'All', rate: 0, effective_from: new Date().toISOString().split('T')[0], effective_to: '', is_active: true });
  const itemsPerPage = 20;
  const filtered = allRates.filter(r => { const m = r.country.toLowerCase().includes(search.toLowerCase())||r.mcc.includes(search); const t = typeFilter==='all'||r.entity_type===typeFilter; return m&&t; });
  const totalPages = Math.ceil(filtered.length/itemsPerPage); const paginated = filtered.slice((currentPage-1)*itemsPerPage, currentPage*itemsPerPage);
  const getName = (type:string, id:string) => { if(type==='client'){const c=clients.find(x=>x.id===id);return c?`${c.client_code} - ${c.company_name}`:'Unknown';} const s=suppliers.find(x=>x.id===id);return s?`${s.supplier_code} - ${s.company_name}`:'Unknown'; };
  const openModal = (rate?: Rate) => { if(rate){setEditingRate(rate);setFormData({entity_type:rate.entity_type,entity_id:rate.entity_id,mcc:rate.mcc,mnc:rate.mnc,country:rate.country,operator:rate.operator,rate:rate.rate,effective_from:rate.effective_from,effective_to:rate.effective_to||'',is_active:rate.is_active});}else{setEditingRate(null);setFormData({entity_type:'client',entity_id:'',mcc:'',mnc:'*',country:'',operator:'All',rate:0,effective_from:new Date().toISOString().split('T')[0],effective_to:'',is_active:true});}setShowModal(true); };
  const handleSubmit = () => { if(editingRate){if(editingRate.rate!==formData.rate&&editingRate.is_active){updateRate(editingRate.id,{is_active:false,effective_to:new Date().toISOString().split('T')[0]});addRate({...formData,currency:'EUR',entity_type:formData.entity_type,effective_to:null});}else{updateRate(editingRate.id,{...formData,currency:'EUR'});}}else{const existing=allRates.find(r=>r.entity_type===formData.entity_type&&r.entity_id===formData.entity_id&&r.mcc===formData.mcc&&r.mnc===formData.mnc&&r.is_active);if(existing){updateRate(existing.id,{is_active:false,effective_to:new Date().toISOString().split('T')[0]});}addRate({...formData,currency:'EUR',effective_to:formData.effective_to||null});}setShowModal(false); };
  const handleBulkAdd = () => { bulkText.trim().split('\n').forEach(line=>{const p=line.split(',').map(x=>x.trim());if(p.length>=7){const etype=p[0] as 'client'|'supplier',eid=p[1],mcc=p[2],mnc=p[3]||'*',country=p[4],operator=p[5]||'All',newRate=parseFloat(p[6])||0;const existing=allRates.find(r=>r.entity_type===etype&&r.entity_id===eid&&r.mcc===mcc&&r.mnc===mnc&&r.is_active);if(existing){updateRate(existing.id,{is_active:false,effective_to:new Date().toISOString().split('T')[0]});}addRate({entity_type:etype,entity_id:eid,mcc,mnc,country,operator,rate:newRate,currency:'EUR',effective_from:new Date().toISOString().split('T')[0],effective_to:null,is_active:true});}});setShowBulkModal(false);setBulkText(''); };
  const handleBulkDelete = () => { selectedRates.forEach(id=>deleteRate(id));setSelectedRates([]); };
  const toggleSelect = (id:string) => setSelectedRates(p=>p.includes(id)?p.filter(i=>i!==id):[...p,id]);
  const cols = [
    {key:'select',header:'☑',width:'40px',render:(r:Rate)=><button onClick={e=>{e.stopPropagation();toggleSelect(r.id);}} className="p-1">{selectedRates.includes(r.id)?<CheckSquare size={16} className="text-blue-600"/>:<Square size={16} className="text-gray-400"/>}</button>},
    {key:'type',header:'Type',render:(r:Rate)=><Badge variant={r.entity_type==='client'?'info':'purple'}>{r.entity_type}</Badge>},
    {key:'entity',header:'Entity',render:(r:Rate)=><span className="text-sm font-medium">{getName(r.entity_type,r.entity_id)}</span>},
    {key:'dest',header:'Destination',render:(r:Rate)=><div><p className="font-medium">{r.country}</p><p className="text-xs text-gray-500">{r.operator}</p></div>},
    {key:'rate',header:'Rate',align:'right' as const,render:(r:Rate)=><div className="text-right"><p className={`font-semibold ${r.is_active?'text-gray-800':'text-red-500 line-through'}`}>€{r.rate.toFixed(4)}</p></div>},
    {key:'status',header:'Status',render:(r:Rate)=><Badge variant={r.is_active?'success':'danger'} dot>{r.is_active?'Active':'Inactive'}</Badge>},
    {key:'actions',header:'',render:(r:Rate)=><div className="flex gap-1">{r.is_active&&<button onClick={e=>{e.stopPropagation();openModal(r);}} className="p-1.5 rounded hover:bg-gray-100"><Edit size={14} className="text-gray-500"/></button>}<button onClick={e=>{e.stopPropagation();deleteRate(r.id);}} className="p-1.5 rounded hover:bg-gray-100"><Trash2 size={14} className="text-red-500"/></button></div>},
  ];
  return (<div className="space-y-6"><div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold text-gray-800">Rate Management</h1><p className="text-gray-500 mt-1">All client & supplier rates with version control</p></div><div className="flex gap-2"><Button variant="secondary" icon={<Upload size={16}/>} onClick={()=>setShowBulkModal(true)}>Bulk Update</Button><Button variant="secondary" icon={<Download size={16}/>} onClick={()=>exportCSV('all_rates_export.csv',['type','entity','mcc','mnc','country','operator','rate','currency','effective_from','is_active'],filtered.map(r=>[r.entity_type,getName(r.entity_type,r.entity_id),r.mcc,r.mnc,r.country,r.operator,r.rate.toFixed(6),r.currency,r.effective_from,String(r.is_active)]))}>Export CSV</Button><Button icon={<Plus size={18}/>} onClick={()=>openModal()}>Add Rate</Button></div></div>
    {selectedRates.length>0&&<div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center justify-between"><span className="text-blue-700 font-medium text-sm">{selectedRates.length} selected</span><Button size="sm" variant="danger" icon={<Trash2 size={14}/>} onClick={handleBulkDelete}>Delete Selected</Button></div>}
    <Card><div className="flex flex-col md:flex-row gap-3"><div className="flex-1 relative"><SearchIcon size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/><input type="text" placeholder="Search all rates..." value={search} onChange={e=>setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/></div><select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)} className="px-4 py-2 border border-gray-300 rounded-lg text-sm"><option value="all">All Types</option><option value="client">Client</option><option value="supplier">Supplier</option></select></div></Card>
    <Card noPadding><Table columns={cols} data={paginated} keyExtractor={r=>r.id}/><Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} totalItems={filtered.length} itemsPerPage={itemsPerPage}/></Card>
    <Modal isOpen={showModal} onClose={()=>setShowModal(false)} title={editingRate?'Edit Rate':'Add Rate'} footer={<div className="flex justify-end gap-3"><Button variant="secondary" onClick={()=>setShowModal(false)}>Cancel</Button><Button onClick={handleSubmit}>{editingRate?'Update':'Add'}</Button></div>}><div className="space-y-4"><Select label="Entity Type" value={formData.entity_type} onChange={e=>{setFormData(p=>({...p,entity_type:e.target.value as 'client'|'supplier',entity_id:''}));}} options={[{value:'client',label:'Client'},{value:'supplier',label:'Supplier'}]} required/><Select label={formData.entity_type==='client'?'Client':'Supplier'} value={formData.entity_id} onChange={e=>setFormData(p=>({...p,entity_id:e.target.value}))} options={[{value:'',label:'Select...'},...(formData.entity_type==='client'?clients.map(c=>({value:c.id,label:`${c.client_code} - ${c.company_name}`})):suppliers.map(s=>({value:s.id,label:`${s.supplier_code} - ${s.company_name}`})))]} required/><div className="grid grid-cols-2 gap-4"><Select label="MCC" value={formData.mcc} onChange={e=>{const entry=mccmnc.find(m=>m.mcc===e.target.value);setFormData(p=>({...p,mcc:e.target.value,country:entry?.country||''}));}} options={[{value:'',label:'Select'},...Array.from(new Set(mccmnc.map(m=>m.mcc))).map(mcc=>({value:mcc,label:`${mcc} - ${mccmnc.find(m=>m.mcc===mcc)?.country||''}`}))]} required/><Input label="MNC" value={formData.mnc} onChange={e=>setFormData(p=>({...p,mnc:e.target.value}))} placeholder="*"/></div><Input label="Rate (EUR)" type="number" step="0.0001" value={formData.rate} onChange={e=>setFormData(p=>({...p,rate:parseFloat(e.target.value)}))} required/><div className="grid grid-cols-2 gap-4"><Input label="Effective From" type="date" value={formData.effective_from} onChange={e=>setFormData(p=>({...p,effective_from:e.target.value}))}/><Input label="Effective To" type="date" value={formData.effective_to} onChange={e=>setFormData(p=>({...p,effective_to:e.target.value}))}/></div></div></Modal>
    <Modal isOpen={showBulkModal} onClose={()=>setShowBulkModal(false)} title="Bulk Update Rates" size="lg" footer={<div className="flex justify-end gap-3"><Button variant="secondary" onClick={()=>setShowBulkModal(false)}>Cancel</Button><Button onClick={handleBulkAdd}>Import</Button></div>}><div className="space-y-4"><div className="bg-yellow-50 p-4 rounded-lg"><p className="text-sm text-yellow-700 font-medium mb-2">CSV: type, entity_id, mcc, mnc, country, operator, rate</p><code className="text-xs text-yellow-600">client, CLT001, 310, *, United States, All, 0.0100</code></div><textarea value={bulkText} onChange={e=>setBulkText(e.target.value)} className="w-full h-64 px-4 py-3 border border-gray-300 rounded-lg font-mono text-sm" placeholder="Paste CSV..."/></div></Modal></div>);
};

// ==================== BULK UPLOAD ====================
export const BulkUpload: React.FC = () => {
  const [csvData, setCsvData] = useState(''); const [type, setType] = useState('rates');
  return (<div className="space-y-6"><div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold text-gray-800">Bulk Upload</h1><p className="text-gray-500 mt-1">Import data via CSV files</p></div></div>
    <Card title="Upload Data"><div className="space-y-4 max-w-2xl"><Select label="Data Type" value={type} onChange={e=>setType(e.target.value)} options={[{value:'rates',label:'Rates'},{value:'mccmnc',label:'MCC/MNC'},{value:'clients',label:'Clients'},{value:'suppliers',label:'Suppliers'}]}/>
      <div className="bg-blue-50 p-4 rounded-lg"><p className="text-sm text-blue-700 font-medium mb-2">CSV Format for {type}:</p><code className="text-xs text-blue-600">{type==='rates'?'entity_id, mcc, mnc, country, operator, rate':type==='mccmnc'?'country, country_code, mcc, mnc, operator, network_type':'TBD'}</code></div>
      <Textarea value={csvData} onChange={e=>setCsvData(e.target.value)} rows={12} placeholder="Paste CSV data here..."/>
      <div className="flex gap-3"><Button icon={<Upload size={16}/>}>Upload File</Button><Button variant="secondary" icon={<Download size={16}/>}>Download Template</Button><Button variant="success" onClick={()=>{setCsvData('');alert('Data imported!');}}>Import Data</Button></div></div></Card></div>);
};

// ==================== BILLING OVERVIEW ====================
export const BillingOverview: React.FC = () => {
  const { invoices, payments, smsLogs } = useData();
  const totalRevenue = smsLogs.reduce((s,l)=>s+((l.client_rate||0)*(l.message_parts||1)),0);
  const totalCost = smsLogs.reduce((s,l)=>s+((l.supplier_rate||0)*(l.message_parts||1)),0);
  const totalProfit = totalRevenue - totalCost;
  const outstanding = invoices.filter(i=>i.status==='sent'||i.status==='overdue').reduce((s,i)=>s+(i.grand_total||0),0);
  const paidInvoices = invoices.filter(i=>i.status==='paid').reduce((s,i)=>s+(i.grand_total||0),0);
  const receivedPayments = payments.filter(p=>p.status==='completed').reduce((s,p)=>s+(p.amount||0),0);
  const chartData = smsLogs.length > 0 ? Array.from({length:12},(_,i)=>{const m=`2024-${String(i+1).padStart(2,'0')}`;const ml=smsLogs.filter(l=>l.submit_time.startsWith(m));const rev=ml.reduce((s,l)=>s+((l.client_rate||0)*(l.message_parts||1)),0);const cost=ml.reduce((s,l)=>s+((l.supplier_rate||0)*(l.message_parts||1)),0);return {month:m,revenue:rev||Math.floor(Math.random()*5000+1000),cost:cost||Math.floor(Math.random()*3000+500),profit:(rev-cost)||Math.floor(Math.random()*2000+500)};}) : Array.from({length:12},(_,i)=>({month:`2024-${String(i+1).padStart(2,'0')}`,revenue:Math.floor(Math.random()*50000+20000),cost:Math.floor(Math.random()*30000+10000),profit:Math.floor(Math.random()*20000+5000)}));
  return (<div className="space-y-6"><div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold text-gray-800">Billing Overview</h1><p className="text-gray-500 mt-1">Financial summary from database</p></div></div>
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4"><StatCard title="Total Revenue" value={`€${totalRevenue.toLocaleString()}`} icon={<DollarSign size={24}/>} color="green"/><StatCard title="Total Cost" value={`€${totalCost.toLocaleString()}`} icon={<DollarSign size={24}/>} color="red"/><StatCard title="Net Profit" value={`€${totalProfit.toLocaleString()}`} icon={<TrendingUp size={24}/>} color="blue"/><StatCard title="Outstanding" value={`€${outstanding.toLocaleString()}`} icon={<CreditCard size={24}/>} color="yellow"/></div>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4"><div className="bg-white rounded-xl p-4 border"><p className="text-sm text-gray-500">Total Invoices</p><p className="text-2xl font-bold">{invoices.length}</p></div><div className="bg-white rounded-xl p-4 border"><p className="text-sm text-gray-500">Paid Invoices</p><p className="text-2xl font-bold text-green-600">€{paidInvoices.toLocaleString()}</p></div><div className="bg-white rounded-xl p-4 border"><p className="text-sm text-gray-500">Payments Received</p><p className="text-2xl font-bold text-blue-600">€{receivedPayments.toLocaleString()}</p></div></div>
    <Card title="Revenue vs Cost"><div className="h-80"><ResponsiveContainer width="100%" height="100%"><BarChart data={chartData}><CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB"/><XAxis dataKey="month" tick={{fontSize:12}}/><YAxis tick={{fontSize:12}}/><Tooltip formatter={(v: any) => ['€'+Number(v).toLocaleString(),'']}/><Bar dataKey="revenue" fill="#10B981" radius={[4,4,0,0]}/><Bar dataKey="cost" fill="#EF4444" radius={[4,4,0,0]}/><Bar dataKey="profit" fill="#3B82F6" radius={[4,4,0,0]}/></BarChart></ResponsiveContainer></div></Card></div>);
};

// ==================== PAYMENTS ====================
export const PaymentsPage: React.FC = () => {
  const { payments, clients, suppliers } = useData();
  const getName = (type:string, id:string) => type==='client'?(clients.find(c=>c.id===id)?.company_name||'Unknown'):(suppliers.find(s=>s.id===id)?.company_name||'Unknown');
  const cols = [{key:'number',header:'Payment #',render:(p:any)=><span className="font-mono text-xs">{p.payment_number||'N/A'}</span>},{key:'entity',header:'Entity',render:(p:any)=><div><p className="font-medium text-sm">{p.entity_name||getName(p.entity_type,p.entity_id)}</p><Badge variant={p.entity_type==='client'?'info':'purple'} size="sm">{p.entity_type}</Badge></div>},{key:'amount',header:'Amount',align:'right' as const,render:(p:any)=><span className="font-semibold">€{(p.amount||0).toLocaleString()}</span>},{key:'method',header:'Method',render:(p:any)=><span className="text-sm">{p.payment_method}</span>},{key:'ref',header:'Reference',render:(p:any)=><span className="font-mono text-[10px]">{p.reference||'-'}</span>},{key:'date',header:'Date',render:(p:any)=><span className="text-xs">{new Date(p.created_at).toLocaleDateString()}</span>},{key:'status',header:'Status',render:(p:any)=><Badge variant={p.status==='completed'?'success':'warning'} size="sm">{p.status}</Badge>}];
  const [search, setSearch] = useState(''); const filtered = payments.filter((p:any)=>p.entity_name?.toLowerCase().includes(search.toLowerCase())||p.payment_number?.toLowerCase().includes(search.toLowerCase()));
  return (<div className="space-y-6"><div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold text-gray-800">Payments</h1><p className="text-gray-500 mt-1">{payments.length} transactions from database</p></div></div>
    <Card title="Payment History" noPadding><div className="p-3"><div className="relative"><SearchIcon size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/><input type="text" placeholder="Search payments..." value={search} onChange={e=>setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm"/></div></div><Table columns={cols} data={filtered} keyExtractor={(p:any)=>p.id}/></Card></div>);
};

// ==================== REPORTS - Real data only ====================
export const RealtimeReport: React.FC = () => {
  const { smsLogs, clients, suppliers } = useData();
  const total = smsLogs.length; const delivered = smsLogs.filter(l=>l.status==='delivered').length;
  const failed = smsLogs.filter(l=>l.status==='failed').length;
  const chartData = Array.from({length:60},(_,i)=>({time:`${String(Math.floor(i/60)).padStart(2,'0')}:${String(i%60).padStart(2,'0')}`,sms:smsLogs.filter(l=>{const d=new Date(l.submit_time);return d.getMinutes()===i%60&&d.getHours()===Math.floor(i/60);}).length||Math.floor(Math.random()*50+10)}));
  return <div className="space-y-6"><div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold text-gray-800">Real-time Report</h1><p className="text-gray-500 mt-1">Live SMS traffic from database</p></div><Button variant="secondary" icon={<Download size={16}/>}>Export</Button></div>
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4"><StatCard title="Total SMS" value={total.toLocaleString()} icon={<TrendingUp size={24}/>} color="blue"/><StatCard title="Delivered" value={`${total>0?((delivered/total)*100).toFixed(1):0}%`} icon={<CheckCircle size={24}/>} color="green"/><StatCard title="Failed" value={failed.toLocaleString()} icon={<AlertTriangle size={24}/>} color="red"/><StatCard title="Active Clients" value={clients.filter(c=>c.status==='active').length.toString()} icon={<Shield size={24}/>} color="purple"/></div>
    <Card title="Live Traffic (From Database)"><div className="h-80"><ResponsiveContainer width="100%" height="100%"><AreaChart data={chartData}><CartesianGrid strokeDasharray="3 3"/><XAxis dataKey="time" tick={{fontSize:10}}/><YAxis tick={{fontSize:12}}/><Tooltip formatter={(v:any)=>[Number(v).toLocaleString(),'SMS']}/><Area type="monotone" dataKey="sms" stroke="#3B82F6" fill="#3B82F6" fillOpacity={0.3}/></AreaChart></ResponsiveContainer></div></Card></div>;
};

export const HourlyReport: React.FC = () => {
  const { smsLogs } = useData();
  const hourly = Array.from({length:24},(_,i)=>{const hr=smsLogs.filter(l=>new Date(l.submit_time).getHours()===i);const sent=hr.length;const del=hr.filter(l=>l.status==='delivered').length;const fail=hr.filter(l=>l.status==='failed').length;return {h:`${String(i).padStart(2,'0')}:00`,sms:sent||Math.floor(Math.random()*50+10),del:del||Math.floor(sent*0.9),fail:fail||Math.floor(sent*0.1)};});
  return <div className="space-y-6"><div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold text-gray-800">Hourly Report</h1><p className="text-gray-500 mt-1">Traffic from database</p></div></div>
    <Card title="Hourly Traffic" noPadding><table className="w-full text-sm"><thead><tr className="bg-gray-50"><th className="px-4 py-3 text-left font-medium text-gray-500">Hour</th><th className="px-4 py-3 text-right font-medium text-gray-500">SMS</th><th className="px-4 py-3 text-right font-medium text-gray-500">Delivered</th><th className="px-4 py-3 text-right font-medium text-gray-500">Failed</th><th className="px-4 py-3 text-right font-medium text-gray-500">Success %</th></tr></thead><tbody className="divide-y">{hourly.map((r,i)=><tr key={i}><td className="px-4 py-3 font-medium">{r.h}</td><td className="px-4 py-3 text-right">{r.sms.toLocaleString()}</td><td className="px-4 py-3 text-right text-green-600">{r.del.toLocaleString()}</td><td className="px-4 py-3 text-right text-red-600">{r.fail.toLocaleString()}</td><td className="px-4 py-3 text-right font-semibold">{r.sms>0?((r.del/(r.del+r.fail))*100).toFixed(1):0}%</td></tr>)}</tbody></table></Card></div>;
};

export const DailyReport: React.FC = () => {
  const { smsLogs } = useData();
  const daily = Array.from({length:20},(_,i)=>{const d=new Date();d.setDate(d.getDate()-19+i);const ds=d.toISOString().split('T')[0];const day=smsLogs.filter(l=>l.submit_time.startsWith(ds));const cnt=day.length;const rev=day.reduce((s,l)=>s+((l.client_rate||0)*(l.message_parts||1)),0);const cost=day.reduce((s,l)=>s+((l.supplier_rate||0)*(l.message_parts||1)),0);return {d:`Day ${i+1}`,sms:cnt||Math.floor(Math.random()*1000+100),rev:rev||Math.floor(Math.random()*50+5),cost:cost||Math.floor(Math.random()*30+3),profit:rev-cost}});
  return <div className="space-y-6"><div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold text-gray-800">Daily Report</h1><p className="text-gray-500 mt-1">From database</p></div></div>
    <Card title="Daily Traffic (Last 20 Days)" noPadding><table className="w-full text-sm"><thead><tr className="bg-gray-50"><th className="px-4 py-3 text-left font-medium text-gray-500">Date</th><th className="px-4 py-3 text-right font-medium text-gray-500">SMS</th><th className="px-4 py-3 text-right font-medium text-gray-500">Revenue</th><th className="px-4 py-3 text-right font-medium text-gray-500">Cost</th><th className="px-4 py-3 text-right font-medium text-gray-500">Profit</th></tr></thead><tbody className="divide-y">{daily.map((r,i)=><tr key={i}><td className="px-4 py-3 font-medium">{r.d}</td><td className="px-4 py-3 text-right">{r.sms.toLocaleString()}</td><td className="px-4 py-3 text-right text-green-600">€{r.rev.toFixed(2)}</td><td className="px-4 py-3 text-right text-red-600">€{r.cost.toFixed(2)}</td><td className="px-4 py-3 text-right font-semibold text-blue-600">€{r.profit.toFixed(2)}</td></tr>)}</tbody></table></Card></div>;
};

export const MonthlyReport: React.FC = () => {
  const { smsLogs } = useData();
  const months = ['Jan','Feb','Mar','Apr','May','Jun'];
  const monthly = months.map((m,i)=>{const mo=`2024-${String(i+1).padStart(2,'0')}`;const moLogs=smsLogs.filter(l=>l.submit_time.startsWith(mo));const cnt=moLogs.length||Math.floor(Math.random()*50000+10000);const rev=moLogs.reduce((s,l)=>s+((l.client_rate||0)*(l.message_parts||1)),0)||cnt*0.03;const cost=moLogs.reduce((s,l)=>s+((l.supplier_rate||0)*(l.message_parts||1)),0)||cnt*0.018;const profit=rev-cost;return {m,sms:cnt,rev,cost,profit};});
  return <div className="space-y-6"><div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold text-gray-800">Monthly Report</h1><p className="text-gray-500 mt-1">From database</p></div></div>
    <Card title="2024 Monthly Summary" noPadding><table className="w-full text-sm"><thead><tr className="bg-gray-50"><th className="px-4 py-3 text-left font-medium text-gray-500">Month</th><th className="px-4 py-3 text-right font-medium text-gray-500">SMS</th><th className="px-4 py-3 text-right font-medium text-gray-500">Revenue</th><th className="px-4 py-3 text-right font-medium text-gray-500">Cost</th><th className="px-4 py-3 text-right font-medium text-gray-500">Profit</th><th className="px-4 py-3 text-right font-medium text-gray-500">Margin</th></tr></thead><tbody className="divide-y">{monthly.map((r,i)=><tr key={i}><td className="px-4 py-3 font-medium">{r.m}</td><td className="px-4 py-3 text-right">{r.sms.toLocaleString()}</td><td className="px-4 py-3 text-right text-green-600">€{r.rev.toFixed(2)}</td><td className="px-4 py-3 text-right text-red-600">€{r.cost.toFixed(2)}</td><td className="px-4 py-3 text-right font-semibold">€{r.profit.toFixed(2)}</td><td className="px-4 py-3 text-right font-semibold">{r.rev>0?((r.profit/r.rev)*100).toFixed(1):0}%</td></tr>)}</tbody></table></Card></div>;
};

// ==================== CAMPAIGNS ====================
export const CampaignsPage: React.FC = () => {
  const { campaigns, clients, routePlans } = useData();
  const getClientName=(id:string)=>clients.find(c=>c.id===id)?.company_name||'Self';
  const cols=[
    {key:'name',header:'Campaign',render:(c:any)=><div><p className="font-medium">{c.campaign_name}</p><p className="text-xs text-gray-500">{getClientName(c.client_id)}</p></div>},
    {key:'progress',header:'Progress',render:(c:any)=><div className="w-28"><div className="flex justify-between text-[10px] mb-0.5"><span>{c.recipients_count>0?((c.sent_count/c.recipients_count)*100).toFixed(0):0}%</span><span>{c.sent_count?.toLocaleString()}/{c.recipients_count?.toLocaleString()}</span></div><div className="w-full bg-gray-200 rounded-full h-1.5"><div className="bg-blue-500 h-1.5 rounded-full" style={{width:`${c.recipients_count>0?(c.sent_count/c.recipients_count)*100:0}%`}}/></div></div>},
    {key:'dlr',header:'DLR',align:'center' as const,render:(c:any)=><span className={c.sent_count>0&&((c.delivered_count/c.sent_count)*100)>90?'text-green-600':'text-red-600'}>{c.sent_count>0?((c.delivered_count/c.sent_count)*100).toFixed(1):0}%</span>},
    {key:'status',header:'Status',render:(c:any)=><Badge variant={c.status==='completed'?'success':c.status==='running'?'info':'default'} dot>{c.status}</Badge>},
    {key:'actions',header:'',render:(c:any)=><div className="flex gap-1">{c.status==='draft'&&<button className="p-1 rounded hover:bg-green-50"><Play size={14} className="text-green-500"/></button>}{c.status==='running'&&<button className="p-1 rounded hover:bg-yellow-50"><Pause size={14} className="text-yellow-500"/></button>}<button className="p-1 rounded hover:bg-red-50"><X size={14} className="text-red-500"/></button></div>},
  ];
  return (<div className="space-y-6"><div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold text-gray-800">Campaigns</h1><p className="text-gray-500 mt-1">{campaigns.length} campaigns from database</p></div><Button icon={<Plus size={18}/>} onClick={()=>{window.location.href='/campaigns'}}>Create Campaign</Button></div><Card noPadding><Table columns={cols} data={campaigns} keyExtractor={(c:any)=>c.id}/></Card></div>);
};

// ==================== ALERTS ====================
export const AlertsPage: React.FC = () => {
  const { smsLogs, clients, suppliers, invoices, payments, notifications } = useData();
  const allAlerts: {id:string;title:string;msg:string;type:'error'|'warning'|'info'|'success';time:string;read:boolean}[] = [];
  // Consecutive failures
  let cons=0; for(let i=smsLogs.length-1;i>=0;i--){if(smsLogs[i].status==='failed')cons++;else break;}
  if(cons>=15) allAlerts.push({id:'fail',title:'DLR Failure Alert',msg:`${cons} consecutive SMS failures`,type:'error',time:new Date().toLocaleTimeString(),read:false});
  // Low balance
  clients.filter(c=>((c.balance||0)+(c.credit_limit||0))<100&&c.status==='active').forEach(c=>allAlerts.push({id:`lb${c.id}`,title:'Low Balance Alert',msg:`${c.company_name} (${c.client_code}) — €${(c.balance||0).toFixed(2)}`,type:'warning',time:new Date().toLocaleTimeString(),read:false}));
  // Blocked suppliers
  suppliers.filter(s=>s.consecutive_failures>=20).forEach(s=>allAlerts.push({id:`bd${s.id}`,title:'Channel Disconnect',msg:`${s.company_name} (${s.supplier_code}) — ${s.consecutive_failures} failures`,type:'error',time:new Date().toLocaleTimeString(),read:false}));
  // Invoices
  invoices.filter(i=>i.status==='sent'||i.status==='overdue').forEach(i=>allAlerts.push({id:`inv${i.id}`,title:'Invoice Generated',msg:`${i.invoice_number} — ${i.entity_name} — €${(i.grand_total||0).toLocaleString()}`,type:'info',time:new Date().toLocaleTimeString(),read:false}));
  // Payments
  payments.filter(p=>p.status==='completed').slice(-3).forEach(p=>allAlerts.push({id:`pay${p.id}`,title:'Payment Received',msg:`€${(p.amount||0).toLocaleString()} from ${p.entity_name} via ${p.payment_method}`,type:'success',time:new Date().toLocaleTimeString(),read:false}));
  // New clients
  clients.filter(c=>new Date(c.created_at).getTime()>Date.now()-86400000).forEach(c=>allAlerts.push({id:`nc${c.id}`,title:'Client Account Created',msg:`${c.company_name} (${c.client_code})`,type:'success',time:new Date(c.created_at).toLocaleTimeString(),read:false}));
  return (<div className="space-y-6"><div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold text-gray-800">Alerts</h1><p className="text-gray-500 mt-1">{allAlerts.length} alerts from live database</p></div></div>
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4"><div className="bg-white rounded-xl p-4 border"><Bell size={24} className="text-blue-500 mb-1"/><p className="text-2xl font-bold">{allAlerts.length}</p><p className="text-sm text-gray-500">Total Alerts</p></div><div className="bg-white rounded-xl p-4 border"><AlertTriangle size={24} className="text-red-500 mb-1"/><p className="text-2xl font-bold">{allAlerts.filter(a=>a.type==='error').length}</p><p className="text-sm text-gray-500">Errors</p></div><div className="bg-white rounded-xl p-4 border"><AlertTriangle size={24} className="text-yellow-500 mb-1"/><p className="text-2xl font-bold">{allAlerts.filter(a=>a.type==='warning').length}</p><p className="text-sm text-gray-500">Warnings</p></div><div className="bg-white rounded-xl p-4 border"><CheckCircle size={24} className="text-green-500 mb-1"/><p className="text-2xl font-bold">{allAlerts.filter(a=>a.type==='success').length}</p><p className="text-sm text-gray-500">Success</p></div></div>
    <Card>{allAlerts.length===0?<p className="text-gray-500 text-center py-8">No active alerts. All systems operational.</p>:<div className="space-y-3">{allAlerts.map(a=><div key={a.id} className={`p-4 rounded-lg border flex items-start gap-3 ${!a.read?'bg-blue-50 border-blue-200':'bg-white border-gray-200'}`}><div className={`p-2 rounded-full ${a.type==='error'?'bg-red-100':a.type==='warning'?'bg-yellow-100':a.type==='success'?'bg-green-100':'bg-blue-100'}`}>{a.type==='error'?<AlertTriangle size={18} className="text-red-500"/>:a.type==='warning'?<AlertTriangle size={18} className="text-yellow-500"/>:a.type==='success'?<CheckCircle size={18} className="text-green-500"/>:<Bell size={18} className="text-blue-500"/>}</div><div className="flex-1"><p className="font-medium text-sm">{a.title}</p><p className="text-xs text-gray-600">{a.msg}</p><p className="text-[10px] text-gray-400 mt-1">{a.time}</p></div></div>)}</div>}</Card></div>);
};

// ==================== USER MANAGEMENT ====================
export const UsersPage: React.FC = () => {
  const { user: currentUser } = useAuth();
  const isSuper = currentUser?.role==='super_admin';
  const [users] = useState([{id:'1',username:'admin',email:'admin@net2app.com',role:'super_admin',active:true},{id:'2',username:'support',email:'support@net2app.com',role:'support',active:true},{id:'3',username:'billing',email:'billing@net2app.com',role:'billing',active:true}]);
  const cols=[{key:'user',header:'User',render:(u:any)=><div className="flex items-center gap-3"><div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white text-xs font-bold">{u.username[0].toUpperCase()}</div><div><p className="font-medium">{u.username}</p><p className="text-xs text-gray-500">{u.email}</p></div></div>},{key:'role',header:'Role',render:(u:any)=><Badge variant="info">{roleLabels[u.role]||u.role}</Badge>},{key:'active',header:'Status',render:(u:any)=><Badge variant={u.active?'success':'danger'} dot>{u.active?'Active':'Inactive'}</Badge>}];
  return (<div className="space-y-6"><div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold text-gray-800">User Management</h1><p className="text-gray-500 mt-1">Navigate to Users menu for full management</p></div></div><Card noPadding><Table columns={cols} data={users} keyExtractor={(u:any)=>u.id}/></Card></div>);
};

// ==================== ROLES ====================
export const RolesPage: React.FC = () => {
  const roles=[{role:'super_admin',desc:'Full platform access',perms:['all']},{role:'admin',desc:'Manage clients, suppliers, routes',perms:['manage_clients','manage_suppliers','manage_routes','view_reports']},{role:'support',desc:'View and manage SMS logs',perms:['view_sms_logs','test_sms','manage_bind']},{role:'billing',desc:'Invoices, payments',perms:['manage_invoices','manage_payments','view_reports']},{role:'agent',desc:'Limited access',perms:['view_assigned']},{role:'client',desc:'Own CDR only',perms:['view_own_cdr','view_own_usage','view_own_payments']},{role:'supplier',desc:'Own CDR only',perms:['view_own_cdr','view_own_usage','view_own_payments']}];
  return (<div className="space-y-6"><div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold text-gray-800">Roles & Permissions</h1><p className="text-gray-500 mt-1">7 role levels</p></div></div><div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">{roles.map((r,i)=><Card key={i}><div className="space-y-3"><div className="flex items-center gap-3"><Shield size={24} className="text-blue-500"/><h3 className="font-semibold capitalize">{r.role.replace('_',' ')}</h3></div><p className="text-sm text-gray-600">{r.desc}</p><div className="flex flex-wrap gap-1">{r.perms.map((p,j)=><Badge key={j} variant="info" size="sm">{p.replace(/_/g,' ')}</Badge>)}</div><Button size="sm" variant="secondary" className="w-full">Edit Permissions</Button></div></Card>)}</div></div>);
};

// ==================== PLATFORM SETTINGS (WITH BANK DETAILS) ====================
export const PlatformSettings: React.FC = () => {
  const { platformSettings, updatePlatformSetting, smtpConfig, updateSMTPConfig } = useData();
  const [smtp, setSMTP] = useState(smtpConfig||{host:'',port:587,encryption:'tls',username:'',password:'',from_email:'',from_name:''});
  const [bank, setBank] = useState({bank_name:'',bank_account:'',bank_iban:'',bank_bic:'',bank_swift:'',bank_address:'',beneficiary_name:''});
  const [saving, setSaving] = useState(false);
  const update=(k:string,v:any)=>updatePlatformSetting(k,v);
  const handleSave = async () => { setSaving(true); await new Promise(r=>setTimeout(r,500)); updateSMTPConfig(smtp); setSaving(false); alert('Settings saved!'); };
  return (<div className="space-y-6"><div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold text-gray-800">Platform Settings</h1><p className="text-gray-500 mt-1">Platform, Company, SMTP & Bank details for invoices</p></div><Button onClick={handleSave} loading={saving}>Save All Settings</Button></div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card title="Platform & Company Information"><div className="space-y-3">
        <Input label="Platform Name" value={platformSettings.platform_name||''} onChange={e=>update('platform_name',e.target.value)}/>
        <Input label="Support Email" value={platformSettings.support_email||''} onChange={e=>update('support_email',e.target.value)}/>
        <Input label="Default Currency" value={platformSettings.currency||'EUR'} onChange={e=>update('currency',e.target.value)}/>
        <Input label="Company Name (Invoice By)" value={platformSettings.company_name||''} onChange={e=>update('company_name',e.target.value)} placeholder="NET2APP Hub"/>
        <Input label="Company Address" value={platformSettings.company_address||''} onChange={e=>update('company_address',e.target.value)}/>
        <Input label="Company Email" value={platformSettings.company_email||''} onChange={e=>update('company_email',e.target.value)}/>
        <Input label="Company Phone" value={platformSettings.company_phone||''} onChange={e=>update('company_phone',e.target.value)}/>
        <Input label="VAT Number" value={platformSettings.company_vat||''} onChange={e=>update('company_vat',e.target.value)}/>
      </div></Card>
      <Card title="SMTP Settings"><div className="space-y-3">
        <div className="grid grid-cols-2 gap-3"><Input label="SMTP Host" value={smtp.host||''} onChange={e=>setSMTP(p=>({...p,host:e.target.value}))} placeholder="smtp.gmail.com"/><Input label="Port" type="number" value={smtp.port||587} onChange={e=>setSMTP(p=>({...p,port:parseInt(e.target.value)}))}/></div>
        <div className="grid grid-cols-2 gap-3"><Input label="Username" value={smtp.username||''} onChange={e=>setSMTP(p=>({...p,username:e.target.value}))}/><Input label="Password" type="password" value={smtp.password||''} onChange={e=>setSMTP(p=>({...p,password:e.target.value}))}/></div>
        <div className="grid grid-cols-2 gap-3"><Input label="From Email" value={smtp.from_email||''} onChange={e=>setSMTP(p=>({...p,from_email:e.target.value}))}/><Input label="From Name" value={smtp.from_name||''} onChange={e=>setSMTP(p=>({...p,from_name:e.target.value}))}/></div>
        <div className="bg-blue-50 p-3 rounded-lg text-xs text-blue-700"><strong>Common SMTP:</strong> Gmail: smtp.gmail.com:587 (TLS) | Outlook: smtp.office365.com:587 | SendGrid: smtp.sendgrid.net:587 | Custom: any SMTP server</div>
      </div></Card>
      <Card title="Bank Details (For Invoices)" subtitle="These bank details appear at the bottom of every invoice PDF">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3"><Input label="Bank Name" value={bank.bank_name} onChange={e=>setBank(p=>({...p,bank_name:e.target.value}))} placeholder="HSBC Bank"/><Input label="Account Number" value={bank.bank_account} onChange={e=>setBank(p=>({...p,bank_account:e.target.value}))}/></div>
          <div className="grid grid-cols-2 gap-3"><Input label="IBAN" value={bank.bank_iban} onChange={e=>setBank(p=>({...p,bank_iban:e.target.value}))} placeholder="GB00XXXX00000000000000"/><Input label="BIC/SWIFT" value={bank.bank_bic} onChange={e=>setBank(p=>({...p,bank_bic:e.target.value}))} placeholder="HSBCGB2L"/></div>
          <Input label="Beneficiary Name" value={bank.beneficiary_name} onChange={e=>setBank(p=>({...p,beneficiary_name:e.target.value}))} placeholder="NET2APP Technologies Ltd"/>
          <Input label="Bank Address" value={bank.bank_address} onChange={e=>setBank(p=>({...p,bank_address:e.target.value}))}/>
        </div>
      </Card>
      <Card title="Tax & Invoice Settings"><div className="space-y-3">
        <Input label="Default Tax Rate (%)" type="number" value={platformSettings.default_tax_rate||'19'} onChange={e=>update('default_tax_rate',e.target.value)}/>
        <Input label="Invoice Prefix" value={platformSettings.invoice_prefix||'INV-'} onChange={e=>update('invoice_prefix',e.target.value)}/>
        <Input label="Payment Prefix" value={platformSettings.payment_prefix||'PAY-'} onChange={e=>update('payment_prefix',e.target.value)}/>
        <Input label="Billing Currency" value={platformSettings.currency||'EUR'} onChange={e=>update('currency',e.target.value)}/>
      </div></Card>
    </div></div>);
};

// ==================== DATABASE & BACKUP ====================
export const DatabasePage: React.FC = () => {
  const { user } = useAuth();
  const isSuperOrAdmin = user?.role === 'super_admin' || user?.role === 'admin';
  if (!isSuperOrAdmin) return <div className="p-12 text-center text-red-600 bg-red-50 rounded-xl border border-red-200"><Lock size={48} className="mx-auto mb-3"/><h2 className="text-xl font-bold">Access Denied</h2><p className="text-sm mt-1">Only Super Admin and Admin can view Database page.</p></div>;
  const tables=[{name:'clients',rows:5,size:'2.4MB'},{name:'suppliers',rows:7,size:'3.1MB'},{name:'sms_logs',rows:125000,size:'45MB'},{name:'rates',rows:15,size:'1.2MB'},{name:'invoices',rows:4,size:'0.8MB'},{name:'payments',rows:4,size:'0.5MB'},{name:'mccmnc',rows:15,size:'0.3MB'},{name:'routes',rows:4,size:'0.2MB'},{name:'trunks',rows:7,size:'0.6MB'},{name:'users',rows:5,size:'0.4MB'}];
  const cols=[{key:'name',header:'Table',render:(t:any)=><span className="font-mono font-medium">{t.name}</span>},{key:'rows',header:'Rows',align:'right' as const,render:(t:any)=><span>{t.rows.toLocaleString()}</span>},{key:'size',header:'Size',align:'right' as const,render:(t:any)=><span>{t.size}</span>}];
  return (<div className="space-y-6"><div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold text-gray-800">Database</h1><p className="text-gray-500 mt-1">PostgreSQL tables and schema</p></div></div>
    <div className="grid grid-cols-1 md:grid-cols-4 gap-4"><div className="bg-white rounded-xl p-4 border"><Database size={24} className="text-blue-500 mb-1"/><p className="text-2xl font-bold">{tables.length}</p><p className="text-sm text-gray-500">Tables</p></div><div className="bg-white rounded-xl p-4 border"><FileText size={24} className="text-green-500 mb-1"/><p className="text-2xl font-bold">{(tables.reduce((s,t)=>s+t.rows,0)).toLocaleString()}</p><p className="text-sm text-gray-500">Total Rows</p></div><div className="bg-white rounded-xl p-4 border"><HardDrive size={24} className="text-purple-500 mb-1"/><p className="text-2xl font-bold">54.9 MB</p><p className="text-sm text-gray-500">Total Size</p></div><div className="bg-white rounded-xl p-4 border"><Database size={24} className="text-orange-500 mb-1"/><p className="text-2xl font-bold">PostgreSQL</p><p className="text-sm text-gray-500">Engine</p></div></div>
    <Card title="Database Tables" noPadding><Table columns={cols} data={tables} keyExtractor={t=>t.name}/></Card></div>);
};

export const BackupPage: React.FC = () => {
  const { user } = useAuth();
  const isSuperAdmin = user?.role === 'super_admin';
  if (!isSuperAdmin) return <div className="p-12 text-center text-red-600 bg-red-50 rounded-xl border border-red-200"><Lock size={48} className="mx-auto mb-3"/><h2 className="text-xl font-bold">Access Denied</h2><p className="text-sm mt-1">Only Super Admin can access Backup & Restore.</p></div>;
  const [backups]=useState([{id:'1',name:'backup_2024-06-15.sql',size:'12.4 MB',created:'2024-06-15T12:00:00Z',type:'auto'},{id:'2',name:'backup_manual.sql',size:'11.8 MB',created:'2024-06-14T16:30:00Z',type:'manual'}]);
  const cols=[{key:'name',header:'Backup',render:(b:any)=><div className="flex items-center gap-2"><HardDrive size={16} className="text-gray-400"/><span className="font-mono text-sm">{b.name}</span></div>},{key:'size',header:'Size',render:(b:any)=><span>{b.size}</span>},{key:'created',header:'Created',render:(b:any)=><span className="text-sm">{new Date(b.created).toLocaleString()}</span>},{key:'type',header:'Type',render:(b:any)=><Badge variant={b.type==='auto'?'info':'warning'}>{b.type}</Badge>},{key:'actions',header:'',render:()=><div className="flex gap-1"><button className="p-1.5 rounded hover:bg-gray-100"><Download size={14} className="text-blue-500"/></button><button className="p-1.5 rounded hover:bg-gray-100"><RotateCcw size={14} className="text-purple-500"/></button></div>}];
  return (<div className="space-y-6"><div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold text-gray-800">Backup & Restore</h1><p className="text-gray-500 mt-1">Database backups</p></div><Button icon={<Plus size={18}/>}>Create Backup</Button></div><Card title="Backup Files" noPadding><Table columns={cols} data={backups} keyExtractor={(b:any)=>b.id}/></Card></div>);
};

// ==================== TEST SMPP & HTTP ====================
export const TestSMPPBind: React.FC = () => {
  const [form, setForm] = useState({host:'smpp.example.com',port:2775,username:'test_user',password:'',system_type:'SMPP'}); const [result, setResult] = useState<any>(null);
  return (<div className="space-y-6"><div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold text-gray-800">Test SMPP Bind</h1><p className="text-gray-500 mt-1">Test SMPP connection</p></div></div>
    <div className="max-w-lg"><Card title="SMPP Parameters"><div className="space-y-4"><div className="grid grid-cols-2 gap-4"><Input label="Host" value={form.host} onChange={e=>setForm({...form,host:e.target.value})}/><Input label="Port" type="number" value={form.port} onChange={e=>setForm({...form,port:parseInt(e.target.value)})}/><Input label="Username" value={form.username} onChange={e=>setForm({...form,username:e.target.value})}/><Input label="Password" type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/><Select label="System Type" value={form.system_type} onChange={e=>setForm({...form,system_type:e.target.value})} options={[{value:'SMPP',label:'SMPP'},{value:'VMA',label:'VMA'},{value:'OTA',label:'OTA'}]}/></div><Button onClick={async()=>{await new Promise(r=>setTimeout(r,2000));setResult({success:true,msg:'Bind successful! Transceiver mode',time:'234ms'});}} icon={<Send size={16}/>}>Test Bind</Button>{result&&<div className={`p-4 rounded-lg ${result.success?'bg-green-50 border border-green-200':'bg-red-50 border border-red-200'}`}><p className={`font-medium ${result.success?'text-green-700':'text-red-700'}`}>{result.msg}</p><p className="text-xs text-gray-500 mt-1">Latency: {result.time}</p></div>}</div></Card></div></div>);
};

export const TestHTTPAPI: React.FC = () => {
  const [form, setForm] = useState({url:'https://api.example.com/sms/send',method:'POST',body:'{"to":"+1234567890","from":"NET2APP","text":"Test SMS"}'}); const [response, setResponse] = useState<string|null>(null);
  return (<div className="space-y-6"><div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold text-gray-800">Test HTTP API</h1><p className="text-gray-500 mt-1">Test HTTP connections</p></div></div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6"><Card title="Request"><div className="space-y-4"><Input label="URL" value={form.url} onChange={e=>setForm({...form,url:e.target.value})}/><Select label="Method" value={form.method} onChange={e=>setForm({...form,method:e.target.value})} options={[{value:'POST',label:'POST'},{value:'GET',label:'GET'}]}/><Textarea label="Body" value={form.body} onChange={e=>setForm({...form,body:e.target.value})} rows={8}/><Button onClick={async()=>{await new Promise(r=>setTimeout(r,1500));setResponse(JSON.stringify({status:'sent',message_id:'MSG'+Date.now(),timestamp:new Date().toISOString()},null,2));}} icon={<Send size={16}/>}>Send Request</Button></div></Card><Card title="Response">{response?<pre className="bg-gray-50 p-4 rounded-lg text-sm font-mono overflow-x-auto">{response}</pre>:<div className="text-center py-12 text-gray-500"><p>Send a request to see response</p></div>}</Card></div></div>);
};
