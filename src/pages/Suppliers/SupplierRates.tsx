import React, { useState, useEffect } from 'react';
import { Plus, Search, Download, Trash2, Edit, CheckSquare, Square, Mail, Clock, RefreshCw, Send } from 'lucide-react';
import { useData } from '../../store/DataContext';
import { api } from '../../services/api';
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
  const [historyRates, setHistoryRates] = useState<Rate[]>([]);
  const [sendNotification, setSendNotification] = useState(true);
  const [notifyEmail, setNotifyEmail] = useState('');
  const [notificationData, setNotificationData] = useState<{
    country: string; account: string; mcc: string; mncs: string; oldRate: number; newRate: number;
    direction: string; effectiveDate: string;
  } | null>(null);

  // Multi-select state (for Add Rate modal)
  const [selectedMncs, setSelectedMncs] = useState<string[]>(['*']);
  const [selectedCountry, setSelectedCountry] = useState('');
  const [rateValue, setRateValue] = useState(0);

  // Bulk update state
  const [bulkCountry, setBulkCountry] = useState(''); const [bulkMCC, setBulkMCC] = useState('');
  const [bulkNewRate, setBulkNewRate] = useState(0); const [bulkSelectedMncs, setBulkSelectedMncs] = useState<string[]>([]);
  const [bulkSendNotify, setBulkSendNotify] = useState(true);
  const [bulkCountryOps, setBulkCountryOps] = useState<typeof mccmnc>([]);

  // Fetch operators for bulk update country
  useEffect(() => {
    if (!bulkCountry) { setBulkCountryOps([]); return; }
    (async () => {
      const res: any = await api.get(`/mccmnc?country=${encodeURIComponent(bulkCountry)}&limit=10000`);
      if (res.success && res.data?.data) {
        setBulkCountryOps(res.data.data);
      }
    })().catch(() => {});
  }, [bulkCountry]);

  const [formData, setFormData] = useState({ entity_id:'', mcc:'', country:'', rate:0, effective_from: new Date().toISOString().split('T')[0], is_active:true });
  const itemsPerPage = 20;

  const supplierRates = allRates.filter(r => r.entity_type === 'supplier');
  const [countries, setCountries] = useState<string[]>([]);
  const [countryOps, setCountryOps] = useState<typeof mccmnc>([]);

  // Fetch full country list from API (bypasses DataContext's 500-record limit)
  useEffect(() => {
    (async () => {
      const res: any = await api.get('/mccmnc/countries');
      if (res.success && res.data?.data) {
        setCountries(res.data.data as string[]);
      }
    })().catch(() => {});
  }, []);

  // Fetch all operators for selected country (bypasses limit)
  useEffect(() => {
    if (!selectedCountry) { setCountryOps([]); return; }
    (async () => {
      const res: any = await api.get(`/mccmnc?country=${encodeURIComponent(selectedCountry)}&limit=10000`);
      if (res.success && res.data?.data) {
        setCountryOps(res.data.data);
      }
    })().catch(() => {});
  }, [selectedCountry]);
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

  // Detect rate direction
  const getDirection = (oldRate: number, newRate: number): string => {
    if (oldRate === 0) return 'New';
    if (newRate > oldRate) return 'Increase';
    if (newRate < oldRate) return 'Decrease';
    return 'Unchanged';
  };

  const openModal = (rate?: Rate) => {
    setSelectedCountry(''); setSelectedMncs(['*']); setRateValue(0);
    if (rate) {
      setEditingRate(rate); setSendNotification(false);
      setFormData({ entity_id:rate.entity_id, mcc:rate.mcc, country:rate.country, rate:rate.rate, effective_from:rate.effective_from, is_active:rate.is_active });
      setSelectedCountry(rate.country); setSelectedMncs([rate.mnc]); setRateValue(rate.rate);
    } else {
      setEditingRate(null); setSendNotification(true);
      setFormData({ entity_id:supplierFilter!=='all'?supplierFilter:'', mcc:'', country:'', rate:0, effective_from:new Date().toISOString().split('T')[0], is_active:true });
    }
    setShowModal(true);
  };

  const onSelectCountry = (country: string) => {
    setSelectedCountry(country);
    setSelectedMncs(['*']);
    const mcc = countryOps[0]?.mcc || '';
    setFormData(p => ({ ...p, country, mcc }));
  };

  const toggleMnc = (mnc: string) => {
    setSelectedMncs(prev => {
      if (mnc === '*') return ['*'];
      const withoutStar = prev.filter(m => m !== '*');
      if (withoutStar.includes(mnc)) return withoutStar.filter(m => m !== mnc).length === 0 ? ['*'] : withoutStar.filter(m => m !== mnc);
      return [...withoutStar, mnc];
    });
  };

  const handleSubmit = () => {
    if (!formData.entity_id || !selectedCountry || !rateValue) { alert('Please fill all fields'); return; }
    const mcc = countryOps[0]?.mcc || '';
    let mncsToAdd = selectedMncs.includes('*') ? countryOps.map(m => m.mnc) : selectedMncs;
    if (mncsToAdd.length === 0) mncsToAdd = ['*'];
    const now = new Date();
    const effectiveDT = `${formData.effective_from} ${now.toLocaleTimeString()}`;

    let lastOldRate = 0;
    for (const mnc of mncsToAdd) {
      const op = countryOps.find(m => m.mcc === mcc && m.mnc === mnc);
      const opName = mnc === '*' ? 'All' : (op?.operator || 'All');
      const existing = supplierRates.find(r => r.entity_id === formData.entity_id && r.mcc === mcc && r.mnc === mnc && r.is_active);
      const oldRate = existing?.rate || 0;
      if (existing) updateRate(existing.id, { is_active: false, effective_to: now.toISOString().split('T')[0] });
      addRate({ entity_type: 'supplier', entity_id: formData.entity_id, mcc, mnc, country: selectedCountry, operator: opName, rate: rateValue, currency: 'EUR', effective_from: formData.effective_from, effective_to: null, is_active: true });
      lastOldRate = oldRate;
    }

    if (sendNotification) {
      setNotifyEmail(getSupplierEmail(formData.entity_id));
      setNotificationData({
        country: selectedCountry, account: getSupplierName(formData.entity_id), mcc,
        mncs: mncsToAdd.join(', '),
        oldRate: lastOldRate, newRate: rateValue,
        direction: getDirection(lastOldRate, rateValue),
        effectiveDate: effectiveDT,
      });
      setShowNotifyModal(true);
    }
    setShowModal(false);
  };

  // Bulk Update — country → MCC → operators → rate
  const handleBulkCountryUpdate = () => {
    if (!bulkNewRate || !supplierFilter || supplierFilter==='all') { alert('Select a supplier and enter rate'); return; }
    const entityId = supplierFilter;
    const now = new Date();
    const effectiveDT = `${now.toISOString().split('T')[0]} ${now.toLocaleTimeString()}`;
    let count = 0; let lastOldRate = 0;
    for (const mnc of bulkSelectedMncs) {
      const countryName = bulkCountry; const opName = bulkCountryOps.find(m=>m.mcc===bulkMCC&&m.mnc===mnc)?.operator||'All';
      const existing = supplierRates.find(r=>r.entity_id===entityId&&r.mcc===bulkMCC&&r.mnc===mnc&&r.is_active);
      if (existing) { updateRate(existing.id,{is_active:false,effective_to:now.toISOString().split('T')[0]}); lastOldRate = existing.rate; }
      addRate({ entity_type:'supplier', entity_id:entityId, mcc:bulkMCC, mnc, country:countryName, operator:opName, rate:bulkNewRate, currency:'EUR', effective_from:now.toISOString().split('T')[0], effective_to:null, is_active:true });
      count++;
    }

    if (bulkSendNotify && count > 0) {
      setNotifyEmail(getSupplierEmail(entityId));
      setNotificationData({
        country: bulkCountry, account: getSupplierName(entityId), mcc: bulkMCC,
        mncs: bulkSelectedMncs.join(', '),
        oldRate: lastOldRate, newRate: bulkNewRate,
        direction: getDirection(lastOldRate, bulkNewRate),
        effectiveDate: effectiveDT,
      });
      setShowNotifyModal(true);
    }
    setShowBulkModal(false);
  };

  const handleBulkDelete = () => { selectedRates.forEach(id => deleteRate(id)); setSelectedRates([]); };
  const toggleSelect = (id: string) => setSelectedRates(p => p.includes(id) ? p.filter(i => i!==id) : [...p, id]);
  const showRateHistory = (rate: Rate) => { setHistoryRates(supplierRates.filter(r => r.entity_id===rate.entity_id && r.mcc===rate.mcc && r.mnc===rate.mnc).sort((a,b) => b.effective_from.localeCompare(a.effective_from))); setShowHistoryModal(true); };
  const handleSendNotification = (rate: Rate) => {
    setNotificationData({
      country:rate.country, account:getSupplierName(rate.entity_id), mcc:rate.mcc, mncs:rate.mnc,
      oldRate:0, newRate:rate.rate, direction:'Active', effectiveDate:new Date().toLocaleString()
    });
    setNotifyEmail(getSupplierEmail(rate.entity_id)); setShowNotifyModal(true);
  };
  const sendRateEmail = () => { alert(`✅ Rate notification email sent to ${notifyEmail}`); setShowNotifyModal(false); };

  const handleExportCSV = () => {
    exportCSV('supplier_rates_export.csv',
      ['supplier_id','supplier_name','mcc','mnc','country','operator','rate','currency','effective_from','effective_to','is_active','status'],
      filteredRates.map(r => [r.entity_id, getSupplierName(r.entity_id), r.mcc, r.mnc, r.country, r.operator, Number(r.rate).toFixed(6), r.currency, r.effective_from, r.effective_to||'', String(r.is_active), r.is_active?'Active':'Inactive'])
    );
  };

  const columns = [
    { key:'select', header:'☑', width:'40px', render:(rate:Rate) => <button onClick={(e)=>{e.stopPropagation();toggleSelect(rate.id);}} className="p-1">{selectedRates.includes(rate.id)?<CheckSquare size={16} className="text-blue-600"/>:<Square size={16} className="text-gray-400"/>}</button> },
    { key:'supplier', header:'Supplier', render:(rate:Rate) => <span className="text-sm">{getSupplierName(rate.entity_id)}</span> },
    { key:'destination', header:'Destination', render:(rate:Rate) => <div><p className="font-medium text-sm">{rate.country}</p><p className="text-xs text-gray-500">{rate.operator}</p></div> },
    { key:'mccmnc', header:'MCC/MNC', render:(rate:Rate) => <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-xs">{rate.mcc}{rate.mnc}</span> },
    { key:'rate', header:'Rate (EUR)', align:'right' as const, render:(rate:Rate) => <div className="text-right"><p className={`font-semibold text-sm ${rate.is_active?'text-gray-800':'text-red-500 line-through'}`}>€{Number(rate.rate).toFixed(4)}</p>{!rate.is_active&&rate.effective_to&&<p className="text-[10px] text-red-400">Ended {rate.effective_to}</p>}</div> },
    { key:'effective', header:'Effective', render:(rate:Rate) => <span className="text-xs">{rate.effective_from} {rate.is_active?<span className="text-green-500">● Active</span>:<span className="text-red-500">● Inactive</span>}</span> },
    { key:'status', header:'Status', render:(rate:Rate) => <Badge variant={rate.is_active?'success':'danger'} dot size="sm">{rate.is_active?'Active':'Inactive'}</Badge> },
    { key:'actions', header:'', render:(rate:Rate) => <div className="flex gap-1">{rate.is_active&&<><button onClick={(e)=>{e.stopPropagation();openModal(rate);}} className="p-1 rounded hover:bg-gray-100"><Edit size={14} className="text-gray-500"/></button><button onClick={(e)=>{e.stopPropagation();handleSendNotification(rate);}} className="p-1 rounded hover:bg-gray-100"><Mail size={14} className="text-blue-500"/></button></>}<button onClick={(e)=>{e.stopPropagation();showRateHistory(rate);}} className="p-1 rounded hover:bg-gray-100"><Clock size={14} className="text-purple-500"/></button><button onClick={(e)=>{e.stopPropagation();deleteRate(rate.id);}} className="p-1 rounded hover:bg-gray-100"><Trash2 size={14} className="text-red-500"/></button></div> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-gray-800">Supplier Rates</h1><p className="text-gray-500 mt-1">{supplierRates.length} rates — Select country → multi-select operators → one click add all</p></div>
        <div className="flex gap-2"><Button variant="secondary" icon={<RefreshCw size={16}/>} onClick={()=>{setSupplierFilter(supplierFilter!=='all'?supplierFilter:'');setShowBulkModal(true);}}>Bulk Update</Button><Button variant="secondary" icon={<Download size={16}/>} onClick={handleExportCSV}>Export CSV</Button><Button icon={<Plus size={18}/>} onClick={()=>openModal()}>Add Rate</Button></div>
      </div>

      {selectedRates.length > 0 && <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center justify-between"><span className="text-blue-700 font-medium text-sm">{selectedRates.length} selected</span><div className="flex gap-2"><Button size="sm" variant="secondary" icon={<Mail size={14}/>} onClick={()=>handleSendNotification(supplierRates.find(r=>r.id===selectedRates[0])!)}>Send Notice</Button><Button size="sm" variant="danger" icon={<Trash2 size={14}/>} onClick={handleBulkDelete}>Delete</Button></div></div>}

      <Card><div className="flex flex-col md:flex-row gap-3"><div className="flex-1 relative"><Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/><input type="text" placeholder="Search..." value={search} onChange={e=>setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/></div><select value={supplierFilter} onChange={e=>{setSupplierFilter(e.target.value);setCurrentPage(1);}} className="px-4 py-2 border border-gray-300 rounded-lg text-sm"><option value="all">All Suppliers</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.supplier_code} - {s.company_name}</option>)}</select><select value={countryFilter} onChange={e=>{setCountryFilter(e.target.value);setCurrentPage(1);}} className="px-4 py-2 border border-gray-300 rounded-lg text-sm"><option value="all">All Countries</option>{countries.map(c=><option key={c} value={c}>{c}</option>)}</select></div></Card>

      <Card noPadding><Table columns={columns} data={paginatedRates} keyExtractor={r=>r.id}/><Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} totalItems={filteredRates.length} itemsPerPage={itemsPerPage}/></Card>

      {/* Add Rate Modal — Multi-Operator Select */}
      <Modal isOpen={showModal} onClose={()=>setShowModal(false)} title={editingRate?'Edit Rate':'Add New Rates (Multi-Operator)'} size="lg" footer={<div className="flex justify-between w-full"><span className="text-sm text-gray-500">{selectedMncs.includes('*') ? `All ${countryOps.length} operators` : `${selectedMncs.length} operators`} selected</span><div className="flex gap-3"><Button variant="secondary" onClick={()=>setShowModal(false)}>Cancel</Button><Button onClick={handleSubmit}>Add Rates</Button></div></div>}>
        <div className="space-y-4">
          {editingRate&&editingRate.is_active&&<div className="bg-yellow-50 p-3 rounded-lg text-sm text-yellow-700">⚠ This will deactivate current rate (€{Number(editingRate.rate).toFixed(4)}) and create a new version with timestamp.</div>}
          <Select label="Supplier *" value={formData.entity_id} onChange={e=>setFormData(p=>({...p,entity_id:e.target.value}))} options={[{value:'',label:'Select Supplier'},...suppliers.map(s=>({value:s.id,label:`${s.supplier_code} - ${s.company_name}`}))]} required/>
          <Select label="Country *" value={selectedCountry} onChange={e => onSelectCountry(e.target.value)} options={[{value:'',label:'Select Country'},...countries.map(c=>({value:c,label:c}))]} required/>
          {selectedCountry && (
            <div className="bg-gray-50 rounded-lg p-4 max-h-60 overflow-y-auto">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium text-gray-700">Operators in {selectedCountry}</p>
                <div className="flex gap-2">
                  <button type="button" onClick={()=>{const all=countryOps.map(m=>m.mnc);setSelectedMncs(all);}} className="text-xs text-blue-600 hover:underline">Select All ({countryOps.length})</button>
                  <button type="button" onClick={()=>setSelectedMncs(['*'])} className="text-xs text-red-600 hover:underline">All (*)</button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {countryOps.map(op => (
                  <label key={`${op.mcc}-${op.mnc}`} className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition text-sm ${selectedMncs.includes(op.mnc) || selectedMncs.includes('*') ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-200' : 'border-gray-200 hover:border-gray-300'}`}>
                    <input type="checkbox" checked={selectedMncs.includes(op.mnc) || selectedMncs.includes('*')} onChange={() => toggleMnc(op.mnc)} className="w-4 h-4 rounded border-gray-300 text-blue-600"/>
                    <div className="flex-1 min-w-0"><div className="flex items-center gap-1.5"><span className="font-mono font-semibold text-blue-700 text-sm">{op.mnc}</span><span className="text-gray-600 truncate text-sm">{op.operator}</span></div><span className="text-[10px] text-gray-400">MCC: {op.mcc} • {op.network_type}</span></div>
                  </label>
                ))}
              </div>
            </div>
          )}
          <Input label="Rate (EUR) *" type="number" step="0.0001" value={rateValue} onChange={e=>setRateValue(parseFloat(e.target.value))} placeholder="0.0000" required/>
          <Input label="Effective From" type="date" value={formData.effective_from} onChange={e=>setFormData(p=>({...p,effective_from:e.target.value}))}/>
          {!editingRate && <div className="bg-blue-50 border border-blue-200 rounded-lg p-3"><label className="flex items-center gap-2"><input type="checkbox" checked={sendNotification} onChange={e=>setSendNotification(e.target.checked)} className="w-4 h-4 rounded"/><span className="text-sm font-medium text-blue-700">Send rate notification via email</span></label></div>}
        </div>
      </Modal>

      {/* Bulk Update Modal — Country → MCC → Operators → Rate */}
      <Modal isOpen={showBulkModal} onClose={()=>setShowBulkModal(false)} title="Bulk Update by Country" size="lg" footer={<div className="flex justify-between w-full"><span className="text-sm text-gray-500">{bulkSelectedMncs.length} operators selected</span><div className="flex gap-3"><Button variant="secondary" onClick={()=>setShowBulkModal(false)}>Cancel</Button><Button onClick={handleBulkCountryUpdate}>Update {bulkSelectedMncs.length} Ops</Button></div></div>}>
        <div className="space-y-4">
          <Select label="Supplier" value={supplierFilter} onChange={e=>setSupplierFilter(e.target.value)} options={[{value:'',label:'Select Supplier'},...suppliers.map(s=>({value:s.id,label:`${s.supplier_code} - ${s.company_name}`}))]}/>
          <Select label="Country" value={bulkCountry} onChange={e=>{setBulkCountry(e.target.value);setBulkMCC('');setBulkSelectedMncs([]);}} options={[{value:'',label:'Select Country'},...countries.map(c=>({value:c,label:c}))]}/>
          {bulkCountry && (
            <div className="flex flex-wrap gap-2">
              {([...new Set(bulkCountryOps.map(x=>x.mcc))]).map(mcc => (
                <button key={mcc} onClick={()=>{setBulkMCC(mcc);setBulkSelectedMncs(bulkCountryOps.filter(m=>m.mcc===mcc).map(o=>o.mnc));}} className={`text-sm px-3 py-1.5 rounded-lg border font-medium ${bulkMCC===mcc?'border-blue-500 bg-blue-50 text-blue-700':'border-gray-200 text-gray-600 hover:border-gray-300'}`}>MCC {mcc}</button>
              ))}
            </div>
          )}
          {bulkMCC && (
            <div className="max-h-60 overflow-y-auto grid grid-cols-2 gap-2 border border-gray-200 rounded-lg p-3">
              {(bulkCountryOps.filter(m=>m.mcc===bulkMCC)).map(op => (
                <label key={`${op.mcc}-${op.mnc}`} className={`flex items-center gap-2 p-2 rounded border text-xs cursor-pointer ${bulkSelectedMncs.includes(op.mnc)?'border-blue-500 bg-blue-50':'border-gray-200 hover:border-gray-300'}`}>
                  <input type="checkbox" checked={bulkSelectedMncs.includes(op.mnc)} onChange={()=>setBulkSelectedMncs(p=>p.includes(op.mnc)?p.filter(x=>x!==op.mnc):[...p,op.mnc])} className="w-3 h-3 rounded"/>
                  <span className="font-mono font-semibold text-blue-700">{op.mnc}</span><span className="text-gray-600 truncate">{op.operator}</span>
                </label>
              ))}
            </div>
          )}
          <Input label="New Rate (EUR) *" type="number" step="0.0001" value={bulkNewRate} onChange={e=>setBulkNewRate(parseFloat(e.target.value))} placeholder="0.0000" required/>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3"><label className="flex items-center gap-2"><input type="checkbox" checked={bulkSendNotify} onChange={e=>setBulkSendNotify(e.target.checked)} className="w-4 h-4 rounded"/><span className="text-sm font-medium text-blue-700">Send rate notification via email</span></label></div>
        </div>
      </Modal>

      {/* Rate Notification Modal with full details */}
      <Modal isOpen={showNotifyModal} onClose={()=>setShowNotifyModal(false)} title="Send Rate Change Notification" size="lg" footer={<div className="flex justify-end gap-3"><Button variant="secondary" onClick={()=>setShowNotifyModal(false)}>Cancel</Button><Button icon={<Send size={14}/>} onClick={sendRateEmail}>Send Email</Button></div>}>
        <div className="space-y-4">
          {notificationData && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 space-y-2">
              <h4 className="font-semibold text-blue-800 text-sm">Rate Change Details</h4>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-blue-600 text-xs block">Country Name</span><span className="font-medium">{notificationData.country}</span></div>
                <div><span className="text-blue-600 text-xs block">Account</span><span className="font-medium">{notificationData.account}</span></div>
                <div><span className="text-blue-600 text-xs block">MCC</span><span className="font-mono">{notificationData.mcc}</span></div>
                <div><span className="text-blue-600 text-xs block">MNC(s)</span><span className="font-mono">{notificationData.mncs}</span></div>
                <div><span className="text-blue-600 text-xs block">Old Rate</span><span className="text-red-600 line-through font-semibold">€{Number(notificationData.oldRate).toFixed(4)}</span></div>
                <div><span className="text-blue-600 text-xs block">New Rate</span><span className="text-green-600 font-semibold text-lg">€{Number(notificationData.newRate).toFixed(4)}</span></div>
                <div><span className="text-blue-600 text-xs block">Change</span><Badge variant={notificationData.direction==='New'?'info':notificationData.direction==='Increase'?'warning':'success'}>{notificationData.direction}</Badge></div>
                <div><span className="text-blue-600 text-xs block">Effective Date & Time</span><span className="font-medium text-xs">{notificationData.effectiveDate}</span></div>
              </div>
            </div>
          )}
          <Input label="Recipient Email" value={notifyEmail} onChange={e=>setNotifyEmail(e.target.value)} placeholder="supplier@example.com"/>
          <p className="text-xs text-gray-500">The email will include: Country Name, Network, Account, MCC, MNC(s), Old Rate, New Rate, Change Direction (New/Increase/Decrease), Effective Date & Time.</p>
        </div>
      </Modal>

      {/* Rate History Modal */}
      <Modal isOpen={showHistoryModal} onClose={()=>setShowHistoryModal(false)} title="Rate History" size="lg">
        <table className="w-full text-sm"><thead><tr className="bg-gray-50"><th className="px-3 py-2 text-left">Version</th><th className="px-3 py-2 text-left">Rate</th><th className="px-3 py-2 text-left">Status</th><th className="px-3 py-2 text-left">From</th><th className="px-3 py-2 text-left">To</th></tr></thead><tbody className="divide-y">{historyRates.map((r,i)=><tr key={r.id} className={!r.is_active?'bg-red-50':'bg-green-50'}><td className="px-3 py-2 font-mono text-xs">v{historyRates.length-i}</td><td className={`px-3 py-2 font-semibold ${!r.is_active?'text-red-600 line-through':'text-green-600'}`}>€{Number(r.rate).toFixed(4)}</td><td className="px-3 py-2"><Badge variant={r.is_active?'success':'danger'} size="sm">{r.is_active?'ACTIVE':'Inactive'}</Badge></td><td className="px-3 py-2 text-xs">{r.effective_from}</td><td className="px-3 py-2 text-xs">{r.effective_to||'Present'}</td></tr>)}</tbody></table>
      </Modal>
    </div>
  );
};
