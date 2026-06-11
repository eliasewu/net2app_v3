import React, { useState, useMemo } from 'react';
import { Plus, Search, Download, Trash2, Edit, CheckSquare, Square, Mail, Clock, RefreshCw } from 'lucide-react';
import { useData } from '../../store/DataContext';
import { Card } from '../../components/UI/Card';
import { Button } from '../../components/UI/Button';
import { Badge } from '../../components/UI/Badge';
import { Table, Pagination } from '../../components/UI/Table';
import { Modal } from '../../components/UI/Modal';
import { Input, Select } from '../../components/UI/Input';
import { Rate } from '../../types';
import { exportCSV } from '../../services/exportService';

export const SupplierRates: React.FC = () => {
  const { rates: allRates, suppliers, addRate, updateRate, deleteRate, mccmnc } = useData();
  const [search, setSearch] = useState(''); const [supplierFilter, setSupplierFilter] = useState<string>('all');
  const [countryFilter, setCountryFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [showModal, setShowModal] = useState(false); const [showBulkModal, setShowBulkModal] = useState(false);
  const [showNotifyModal, setShowNotifyModal] = useState(false); const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [editingRate, setEditingRate] = useState<Rate | null>(null);
  const [selectedRates, setSelectedRates] = useState<string[]>([]);
  const [notifyRate, setNotifyRate] = useState<Rate | null>(null);
  const [historyRates, setHistoryRates] = useState<Rate[]>([]);
  const [sendNotification, setSendNotification] = useState(true);
  const [notifyEmail, setNotifyEmail] = useState('');
  const [bulkCountry, setBulkCountry] = useState(''); const [bulkMCC, setBulkMCC] = useState('');
  const [bulkNewRate, setBulkNewRate] = useState(0); const [bulkSelectedMncs, setBulkSelectedMncs] = useState<string[]>([]);

  const [formData, setFormData] = useState({ entity_id:'', mcc:'', mnc:'*', country:'', operator:'All', rate:0, effective_from: new Date().toISOString().split('T')[0], effective_to:'', is_active:true });
  const itemsPerPage = 20;

  const supplierRates = allRates.filter(r => r.entity_type === 'supplier');
  const countries = useMemo(() => [...new Set(mccmnc.map(m => m.country))].sort(), [mccmnc]);
  const filteredRates = supplierRates.filter(rate => {
    const ms = rate.country.toLowerCase().includes(search.toLowerCase()) || rate.mcc.includes(search);
    const mc = supplierFilter === 'all' || rate.entity_id === supplierFilter;
    const mco = countryFilter === 'all' || rate.country === countryFilter;
    return ms && mc && mco;
  });
  const totalPages = Math.ceil(filteredRates.length / itemsPerPage);
  const paginatedRates = filteredRates.slice((currentPage-1)*itemsPerPage, currentPage*itemsPerPage);
  const getSupplierName = (id: string) => { const s = suppliers.find(x => x.id === id); return s ? `${s.supplier_code} - ${s.company_name}` : 'Unknown'; };
  const getSupplierEmail = (id: string) => { const s = suppliers.find(x => x.id === id); return s?.email || ''; };

  const openModal = (rate?: Rate) => {
    if (rate) { setEditingRate(rate); setSendNotification(false); setFormData({ entity_id:rate.entity_id, mcc:rate.mcc, mnc:rate.mnc, country:rate.country, operator:rate.operator, rate:rate.rate, effective_from:rate.effective_from, effective_to:rate.effective_to||'', is_active:rate.is_active }); }
    else { setEditingRate(null); setSendNotification(true); setFormData({ entity_id:supplierFilter!=='all'?supplierFilter:'', mcc:'', mnc:'*', country:'', operator:'All', rate:0, effective_from:new Date().toISOString().split('T')[0], effective_to:'', is_active:true }); }
    setShowModal(true);
  };

  const handleSubmit = () => {
    if (editingRate) {
      if (editingRate.rate!==formData.rate && editingRate.is_active) {
        updateRate(editingRate.id, { is_active:false, effective_to:new Date().toISOString().split('T')[0] });
        addRate({ entity_type:'supplier', entity_id:editingRate.entity_id, mcc:editingRate.mcc, mnc:editingRate.mnc, country:editingRate.country, operator:editingRate.operator, rate:formData.rate, currency:'EUR', effective_from:new Date().toISOString().split('T')[0], effective_to:null, is_active:true });
        if (sendNotification) { setNotifyRate(editingRate); setNotifyEmail(getSupplierEmail(editingRate.entity_id)); setShowNotifyModal(true); }
      } else { updateRate(editingRate.id, { ...formData, entity_type:'supplier', currency:'EUR' }); }
    } else {
      const existingActive = supplierRates.find(r => r.entity_id===formData.entity_id && r.mcc===formData.mcc && r.mnc===formData.mnc && r.is_active);
      if (existingActive) { updateRate(existingActive.id, { is_active:false, effective_to:new Date().toISOString().split('T')[0] }); }
      addRate({ ...formData, entity_type:'supplier', effective_to:formData.effective_to||null, currency:'EUR' });
      if (sendNotification && existingActive) { setNotifyRate(existingActive); setNotifyEmail(getSupplierEmail(formData.entity_id)); setShowNotifyModal(true); }
    }
    setShowModal(false);
  };

  const handleBulkCountryUpdate = () => {
    if (!bulkNewRate || !supplierFilter || supplierFilter==='all') { alert('Select a supplier and enter rate'); return; }
    let count=0;
    for (const mnc of bulkSelectedMncs) {
      const countryName = bulkCountry; const opName = mccmnc.find(m=>m.mcc===bulkMCC&&m.mnc===mnc)?.operator||'All';
      const existing = supplierRates.find(r=>r.entity_id===supplierFilter&&r.mcc===bulkMCC&&r.mnc===mnc&&r.is_active);
      if (existing) { updateRate(existing.id,{is_active:false,effective_to:new Date().toISOString().split('T')[0]}); }
      addRate({ entity_type:'supplier', entity_id:supplierFilter, mcc:bulkMCC, mnc, country:countryName, operator:opName, rate:bulkNewRate, currency:'EUR', effective_from:new Date().toISOString().split('T')[0], effective_to:null, is_active:true });
      count++;
    }
    setShowBulkModal(false); alert(`Updated ${count} operators`);
  };

  const handleBulkDelete = () => { selectedRates.forEach(id => deleteRate(id)); setSelectedRates([]); };
  const toggleSelect = (id: string) => setSelectedRates(p => p.includes(id) ? p.filter(i => i!==id) : [...p, id]);
  const showRateHistory = (rate: Rate) => { setHistoryRates(supplierRates.filter(r => r.entity_id===rate.entity_id && r.mcc===rate.mcc && r.mnc===rate.mnc).sort((a,b) => b.effective_from.localeCompare(a.effective_from))); setShowHistoryModal(true); };
  const handleSendNotification = (rate: Rate) => { setNotifyRate(rate); setNotifyEmail(getSupplierEmail(rate.entity_id)); setShowNotifyModal(true); };
  const sendRateEmail = () => { alert(`Notification sent to ${notifyEmail}`); setShowNotifyModal(false); };

  const handleExportCSV = () => {
    exportCSV('supplier_rates_export.csv',
      ['supplier_id','supplier_name','mcc','mnc','country','operator','rate','currency','effective_from','effective_to','is_active','status'],
      filteredRates.map(r => [r.entity_id, getSupplierName(r.entity_id), r.mcc, r.mnc, r.country, r.operator, r.rate.toFixed(6), r.currency, r.effective_from, r.effective_to||'', String(r.is_active), r.is_active?'Active':'Inactive'])
    );
  };

  const columns = [
    { key:'select', header:'☑', width:'40px', render:(rate:Rate) => <button onClick={(e)=>{e.stopPropagation();toggleSelect(rate.id);}} className="p-1">{selectedRates.includes(rate.id)?<CheckSquare size={16} className="text-blue-600"/>:<Square size={16} className="text-gray-400"/>}</button> },
    { key:'supplier', header:'Supplier', render:(rate:Rate) => <span className="text-sm">{getSupplierName(rate.entity_id)}</span> },
    { key:'destination', header:'Destination', render:(rate:Rate) => <div><p className="font-medium text-sm">{rate.country}</p><p className="text-xs text-gray-500">{rate.operator}</p></div> },
    { key:'mccmnc', header:'MCC/MNC', render:(rate:Rate) => <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-xs">{rate.mcc}{rate.mnc}</span> },
    { key:'rate', header:'Rate (EUR)', align:'right' as const, render:(rate:Rate) => <div className="text-right"><p className={`font-semibold text-sm ${rate.is_active?'text-gray-800':'text-red-500 line-through'}`}>€{rate.rate.toFixed(4)}</p></div> },
    { key:'effective', header:'Effective', render:(rate:Rate) => <span className="text-xs">{rate.effective_from}</span> },
    { key:'status', header:'Status', render:(rate:Rate) => <Badge variant={rate.is_active?'success':'danger'} dot size="sm">{rate.is_active?'Active':'Inactive'}</Badge> },
    { key:'actions', header:'', render:(rate:Rate) => <div className="flex gap-1">{rate.is_active&&<><button onClick={(e)=>{e.stopPropagation();openModal(rate);}} className="p-1 rounded hover:bg-gray-100"><Edit size={14} className="text-gray-500"/></button><button onClick={(e)=>{e.stopPropagation();handleSendNotification(rate);}} className="p-1 rounded hover:bg-gray-100"><Mail size={14} className="text-blue-500"/></button></>}<button onClick={(e)=>{e.stopPropagation();showRateHistory(rate);}} className="p-1 rounded hover:bg-gray-100"><Clock size={14} className="text-purple-500"/></button><button onClick={(e)=>{e.stopPropagation();deleteRate(rate.id);}} className="p-1 rounded hover:bg-gray-100"><Trash2 size={14} className="text-red-500"/></button></div> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold text-gray-800">Supplier Rates</h1><p className="text-gray-500 mt-1">{supplierRates.length} rates</p></div><div className="flex gap-2"><Button variant="secondary" icon={<RefreshCw size={16}/>} onClick={()=>setShowBulkModal(true)}>Bulk Update</Button><Button variant="secondary" icon={<Download size={16}/>} onClick={handleExportCSV}>Export CSV</Button><Button icon={<Plus size={18}/>} onClick={()=>openModal()}>Add Rate</Button></div></div>

      {selectedRates.length > 0 && <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center justify-between"><span className="text-blue-700 font-medium text-sm">{selectedRates.length} selected</span><div className="flex gap-2"><Button size="sm" variant="secondary" icon={<Mail size={14}/>} onClick={()=>handleSendNotification(supplierRates.find(r=>r.id===selectedRates[0])!)}>Send Notice</Button><Button size="sm" variant="danger" icon={<Trash2 size={14}/>} onClick={handleBulkDelete}>Delete</Button></div></div>}

      <Card><div className="flex flex-col md:flex-row gap-3"><div className="flex-1 relative"><Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/><input type="text" placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/></div><select value={supplierFilter} onChange={e=>{setSupplierFilter(e.target.value);setCurrentPage(1);}} className="px-4 py-2 border border-gray-300 rounded-lg text-sm"><option value="all">All Suppliers</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.supplier_code}</option>)}</select><select value={countryFilter} onChange={e=>{setCountryFilter(e.target.value);setCurrentPage(1);}} className="px-4 py-2 border border-gray-300 rounded-lg text-sm"><option value="all">All Countries</option>{countries.map(c=><option key={c} value={c}>{c}</option>)}</select></div></Card>

      <Card noPadding><Table columns={columns} data={paginatedRates} keyExtractor={r=>r.id}/><Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} totalItems={filteredRates.length} itemsPerPage={itemsPerPage}/></Card>

      <Modal isOpen={showModal} onClose={()=>setShowModal(false)} title={editingRate?'Edit Rate':'Add Rate'} footer={<div className="flex justify-end gap-3"><Button variant="secondary" onClick={()=>setShowModal(false)}>Cancel</Button><Button onClick={handleSubmit}>{editingRate?'Update':'Add'}</Button></div>}>
        <div className="space-y-4">
          {editingRate&&editingRate.is_active&&<div className="bg-yellow-50 p-3 rounded-lg text-sm text-yellow-700">⚠ Changing rate deactivates current (€{editingRate.rate.toFixed(4)})</div>}
          <Select label="Supplier" value={formData.entity_id} onChange={e=>setFormData(p=>({...p,entity_id:e.target.value}))} options={[{value:'',label:'Select'},...suppliers.map(s=>({value:s.id,label:`${s.supplier_code} - ${s.company_name}`}))]} required/>
          <Select label="Country / MCC" value={formData.mcc} onChange={e=>{const entry=mccmnc.find(m=>m.mcc===e.target.value);setFormData(p=>({...p,mcc:e.target.value,country:entry?.country||''}));}} options={[{value:'',label:'Select'},...Array.from(new Set(mccmnc.map(m=>m.mcc))).map(mcc=>({value:mcc,label:`${mcc} - ${mccmnc.find(m=>m.mcc===mcc)?.country||''}`}))]} required/>
          <Input label="MNC (*=all)" value={formData.mnc} onChange={e=>setFormData(p=>({...p,mnc:e.target.value}))} placeholder="*"/>
          <Input label="Rate (EUR)" type="number" step="0.0001" value={formData.rate} onChange={e=>setFormData(p=>({...p,rate:parseFloat(e.target.value)}))} required/>
          <div className="grid grid-cols-2 gap-4"><Input label="Effective From" type="date" value={formData.effective_from} onChange={e=>setFormData(p=>({...p,effective_from:e.target.value}))}/><Input label="Effective To" type="date" value={formData.effective_to} onChange={e=>setFormData(p=>({...p,effective_to:e.target.value}))}/></div>
          {!editingRate&&<div className="bg-blue-50 p-3 rounded-lg"><label className="flex items-center gap-2"><input type="checkbox" checked={sendNotification} onChange={e=>setSendNotification(e.target.checked)} className="w-4 h-4 rounded"/><span className="text-sm font-medium text-blue-700">Send notification email</span></label></div>}
        </div>
      </Modal>

      <Modal isOpen={showBulkModal} onClose={()=>setShowBulkModal(false)} title="Bulk Update by Country" size="lg" footer={<div className="flex justify-end gap-3"><Button variant="secondary" onClick={()=>setShowBulkModal(false)}>Cancel</Button><Button onClick={handleBulkCountryUpdate}>Update {bulkSelectedMncs.length} Ops</Button></div>}>
        <div className="space-y-4">
          <Select label="Country" value={bulkCountry} onChange={e=>{setBulkCountry(e.target.value);setBulkMCC('');setBulkSelectedMncs([]);}} options={[{value:'',label:'Select Country'},...countries.map(c=>({value:c,label:c}))]}/>
          {bulkCountry && (<div className="flex flex-wrap gap-2">{([...new Set((mccmnc.filter(m=>m.country===bulkCountry)||[]).map(x=>x.mcc))]).map(mcc=><button key={mcc} onClick={()=>{setBulkMCC(mcc);setBulkSelectedMncs(mccmnc.filter(m=>m.mcc===mcc).map(o=>o.mnc));}} className={`text-sm px-3 py-1.5 rounded-lg border ${bulkMCC===mcc?'border-blue-500 bg-blue-50':'border-gray-200'}`}>MCC {mcc}</button>)}</div>)}
          {bulkMCC && (<div className="max-h-60 overflow-y-auto grid grid-cols-2 gap-2">{(mccmnc.filter(m=>m.mcc===bulkMCC)).map(op=><label key={op.mnc} className={`flex items-center gap-2 p-2 rounded border text-xs ${bulkSelectedMncs.includes(op.mnc)?'border-blue-500 bg-blue-50':'border-gray-200'}`}><input type="checkbox" checked={bulkSelectedMncs.includes(op.mnc)} onChange={()=>setBulkSelectedMncs(p=>p.includes(op.mnc)?p.filter(x=>x!==op.mnc):[...p,op.mnc])} className="w-3 h-3 rounded"/><span className="font-mono">{op.mnc}</span><span className="text-gray-600 truncate">{op.operator}</span></label>)}</div>)}
          <Input label="New Rate (EUR)" type="number" step="0.0001" value={bulkNewRate} onChange={e=>setBulkNewRate(parseFloat(e.target.value))} required/>
        </div>
      </Modal>

      <Modal isOpen={showNotifyModal} onClose={()=>setShowNotifyModal(false)} title="Send Notification" footer={<div className="flex justify-end gap-3"><Button variant="secondary" onClick={()=>setShowNotifyModal(false)}>Cancel</Button><Button icon={<Mail size={14}/>} onClick={sendRateEmail}>Send Email</Button></div>}><div className="space-y-3"><div className="bg-blue-50 p-3 rounded-lg text-sm"><p><strong>Supplier:</strong> {getSupplierName(notifyRate?.entity_id||'')}</p><p><strong>Old:</strong> <span className="text-red-500 line-through">€{notifyRate?.rate.toFixed(4)}</span> <strong>New:</strong> <span className="text-green-600">€{formData.rate.toFixed(4)}</span></p></div><Input label="Email" value={notifyEmail} onChange={e=>setNotifyEmail(e.target.value)}/></div></Modal>
      <Modal isOpen={showHistoryModal} onClose={()=>setShowHistoryModal(false)} title="Rate History" size="lg"><table className="w-full text-sm"><thead><tr className="bg-gray-50"><th className="px-3 py-2 text-left">Version</th><th className="px-3 py-2 text-left">Rate</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">From</th><th className="px-3 py-2 text-left">To</th></tr></thead><tbody className="divide-y">{historyRates.map((r,i)=><tr key={r.id} className={!r.is_active?'bg-red-50':'bg-green-50'}><td className="px-3 py-2 font-mono text-xs">v{historyRates.length-i}</td><td className={`px-3 py-2 font-semibold ${!r.is_active?'text-red-600 line-through':'text-green-600'}`}>€{r.rate.toFixed(4)}</td><td className="px-3 py-2"><Badge variant={r.is_active?'success':'danger'} size="sm">{r.is_active?'ACTIVE':'Inactive'}</Badge></td><td className="px-3 py-2 text-xs">{r.effective_from}</td><td className="px-3 py-2 text-xs">{r.effective_to||'Present'}</td></tr>)}</tbody></table></Modal>
    </div>
  );
};
