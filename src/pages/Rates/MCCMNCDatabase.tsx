import React, { useState, useRef } from 'react';
import { Plus, Search, Upload, Download, Edit, Trash2, Globe } from 'lucide-react';
import { useData } from '../../store/DataContext';
import { Card } from '../../components/UI/Card';
import { Button } from '../../components/UI/Button';
import { Badge } from '../../components/UI/Badge';
import { Table, Pagination } from '../../components/UI/Table';
import { Modal } from '../../components/UI/Modal';
import { Input, Select } from '../../components/UI/Input';
import { MCCMNC } from '../../types';

const CSV_SAMPLE = `country,country_code,mcc,mnc,operator,network_type
United States,US,310,260,T-Mobile USA,GSM
United States,US,310,410,AT&T Mobility,GSM
United Kingdom,GB,234,10,O2 UK,GSM
Bangladesh,BD,470,01,Grameenphone,GSM
Bangladesh,BD,470,02,Robi Axiata,GSM
India,IN,404,10,Airtel India,GSM
India,IN,405,45,Airtel India,GSM`;

export const MCCMNCDatabase: React.FC = () => {
  const { mccmnc, addMCCMNC, updateMCCMNC, deleteMCCMNC } = useData();
  const [search, setSearch] = useState('');
  const [countryFilter, setCountryFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [editingEntry, setEditingEntry] = useState<MCCMNC | null>(null);
  const [deleteModal, setDeleteModal] = useState<MCCMNC | null>(null);
  const [importText, setImportText] = useState('');
  const [importResult, setImportResult] = useState<{added:number;skipped:number;errors:string[]} | null>(null);
  const [selectedEntries, setSelectedEntries] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({ country:'', country_code:'', mcc:'', mnc:'', operator:'', network_type:'GSM', status:'active' as 'active'|'inactive' });
  const itemsPerPage = 20;

  const countries = [...new Set(mccmnc.map(m => m.country))].sort();
  const filteredMCCMNC = mccmnc.filter(entry => {
    const ms = entry.country.toLowerCase().includes(search.toLowerCase()) || entry.operator.toLowerCase().includes(search.toLowerCase()) || entry.mcc.includes(search) || entry.mnc.includes(search);
    const mc = countryFilter === 'all' || entry.country === countryFilter;
    return ms && mc;
  });
  const totalPages = Math.ceil(filteredMCCMNC.length / itemsPerPage);
  const paginatedMCCMNC = filteredMCCMNC.slice((currentPage-1)*itemsPerPage, currentPage*itemsPerPage);

  const openModal = (entry?: MCCMNC) => {
    if (entry) { setEditingEntry(entry); setFormData({ country:entry.country, country_code:entry.country_code, mcc:entry.mcc, mnc:entry.mnc, operator:entry.operator, network_type:entry.network_type, status:entry.status }); }
    else { setEditingEntry(null); setFormData({ country:'', country_code:'', mcc:'', mnc:'', operator:'', network_type:'GSM', status:'active' }); }
    setShowModal(true);
  };

  const handleSubmit = () => {
    if (editingEntry) { updateMCCMNC(editingEntry.id, formData); }
    else { addMCCMNC(formData); }
    setShowModal(false);
  };

  const handleDelete = () => { if (deleteModal) { deleteMCCMNC(deleteModal.id); setDeleteModal(null); } };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const r = new FileReader();
    r.onload = (ev) => { setImportText(ev.target?.result as string); setImportResult(null); };
    r.readAsText(file);
  };

  const parseCSV = (text: string): Omit<MCCMNC, 'id'>[] => {
    const lines = text.trim().split('\n');
    const entries: Omit<MCCMNC, 'id'>[] = [];
    let headerSkipped = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // Skip header row
      if (!headerSkipped && (trimmed.startsWith('country') || trimmed.startsWith('Country'))) { headerSkipped = true; continue; }
      headerSkipped = true;
      const parts = trimmed.split(',').map(s => s.trim());
      if (parts.length >= 5) {
        entries.push({
          country: parts[0], country_code: parts[1] || '',
          mcc: parts[2] || '', mnc: parts[3] || '',
          operator: parts[4] || '', network_type: parts[5] || 'GSM',
          status: 'active',
        });
      }
    }
    return entries;
  };

  const handleImport = () => {
    const entries = parseCSV(importText);
    let added = 0, skipped = 0;
    const errors: string[] = [];
    for (const e of entries) {
      if (!e.mcc || !e.mnc || !e.country) { skipped++; errors.push(`Skipped: missing MCC/MNC for ${e.country || 'unknown'}`); continue; }
      const exists = mccmnc.find(m => m.mcc === e.mcc && m.mnc === e.mnc);
      if (exists) { updateMCCMNC(exists.id, e); skipped++; }
      else { addMCCMNC(e); added++; }
    }
    setImportResult({ added, skipped, errors });
    setImportText('');
  };

  const handleExportCSV = () => {
    const header = 'country,country_code,mcc,mnc,operator,network_type,status';
    const rows = filteredMCCMNC.map(m => `${m.country},${m.country_code},${m.mcc},${m.mnc},${m.operator},${m.network_type},${m.status}`).join('\n');
    const csv = header + '\n' + rows;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'mccmnc_export.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const handleBulkDelete = () => { selectedEntries.forEach(id => deleteMCCMNC(id)); setSelectedEntries([]); };
  const toggleSelect = (id: string) => setSelectedEntries(p => p.includes(id) ? p.filter(i => i !== id) : [...p, id]);

  const columns = [
    { key:'select', header:'☑', width:'40px', render:(entry:MCCMNC) => <button onClick={(e)=>{e.stopPropagation();toggleSelect(entry.id);}} className="p-1">{selectedEntries.includes(entry.id) ? <span className="text-blue-600 font-bold">☑</span> : <span className="text-gray-400">☐</span>}</button> },
    { key:'country', header:'Country', render:(entry:MCCMNC) => <div className="flex items-center gap-2"><Globe size={14} className="text-gray-400"/><div><p className="font-medium text-sm">{entry.country}</p><p className="text-[10px] text-gray-500">{entry.country_code}</p></div></div> },
    { key:'mcc', header:'MCC', render:(entry:MCCMNC) => <span className="font-mono bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs">{entry.mcc}</span> },
    { key:'mnc', header:'MNC', render:(entry:MCCMNC) => <span className="font-mono bg-purple-50 text-purple-700 px-2 py-0.5 rounded text-xs">{entry.mnc}</span> },
    { key:'operator', header:'Operator', render:(entry:MCCMNC) => <span className="text-sm">{entry.operator}</span> },
    { key:'network_type', header:'Network', render:(entry:MCCMNC) => <Badge variant="default" size="sm">{entry.network_type}</Badge> },
    { key:'status', header:'Status', render:(entry:MCCMNC) => <Badge variant={entry.status==='active'?'success':'danger'} dot size="sm">{entry.status}</Badge> },
    { key:'actions', header:'', render:(entry:MCCMNC) => <div className="flex gap-1"><button onClick={()=>openModal(entry)} className="p-1 rounded hover:bg-gray-100"><Edit size={14} className="text-gray-500"/></button><button onClick={()=>setDeleteModal(entry)} className="p-1 rounded hover:bg-gray-100"><Trash2 size={14} className="text-red-500"/></button></div> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-gray-800">MCC/MNC Database</h1><p className="text-gray-500 mt-1">{mccmnc.length} operators across {countries.length} countries</p></div>
        <div className="flex gap-2">
          <Button variant="secondary" icon={<Upload size={16}/>} onClick={()=>{setShowImportModal(true);setImportResult(null);}}>Import CSV</Button>
          <Button variant="secondary" icon={<Download size={16}/>} onClick={handleExportCSV}>Export CSV</Button>
          <Button icon={<Plus size={18}/>} onClick={()=>openModal()}>Add Entry</Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-4 border"><p className="text-sm text-gray-500">Total Entries</p><p className="text-2xl font-bold">{mccmnc.length}</p></div>
        <div className="bg-white rounded-xl p-4 border"><p className="text-sm text-gray-500">Countries</p><p className="text-2xl font-bold text-blue-600">{countries.length}</p></div>
        <div className="bg-white rounded-xl p-4 border"><p className="text-sm text-gray-500">Active</p><p className="text-2xl font-bold text-green-600">{mccmnc.filter(m=>m.status==='active').length}</p></div>
        <div className="bg-white rounded-xl p-4 border"><p className="text-sm text-gray-500">Selected</p><p className="text-2xl font-bold text-purple-600">{selectedEntries.length}</p></div>
      </div>

      {/* Bulk Actions */}
      {selectedEntries.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-center justify-between">
          <span className="text-blue-700 font-medium text-sm">{selectedEntries.length} entries selected</span>
          <Button size="sm" variant="danger" icon={<Trash2 size={14}/>} onClick={handleBulkDelete}>Delete Selected</Button>
        </div>
      )}

      {/* Filters */}
      <Card>
        <div className="flex flex-col md:flex-row gap-3">
          <div className="flex-1 relative"><Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/><input type="text" placeholder="Search by country, operator, MCC..." value={search} onChange={e=>setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/></div>
          <select value={countryFilter} onChange={e=>{setCountryFilter(e.target.value);setCurrentPage(1);}} className="px-4 py-2 border border-gray-300 rounded-lg text-sm"><option value="all">All Countries ({countries.length})</option>{countries.map(c=><option key={c} value={c}>{c}</option>)}</select>
        </div>
      </Card>

      {/* Table */}
      <Card noPadding>
        <Table columns={columns} data={paginatedMCCMNC} keyExtractor={e=>e.id}/>
        <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} totalItems={filteredMCCMNC.length} itemsPerPage={itemsPerPage}/>
      </Card>

      {/* Add/Edit Modal */}
      <Modal isOpen={showModal} onClose={()=>setShowModal(false)} title={editingEntry?'Edit Entry':'Add Entry'} footer={<div className="flex justify-end gap-3"><Button variant="secondary" onClick={()=>setShowModal(false)}>Cancel</Button><Button onClick={handleSubmit}>{editingEntry?'Update':'Add'}</Button></div>}>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Country" value={formData.country} onChange={e=>setFormData(p=>({...p,country:e.target.value}))} required/>
          <Input label="Country Code" value={formData.country_code} onChange={e=>setFormData(p=>({...p,country_code:e.target.value.toUpperCase()}))} placeholder="US" required/>
          <Input label="MCC" value={formData.mcc} onChange={e=>setFormData(p=>({...p,mcc:e.target.value}))} placeholder="310" required/>
          <Input label="MNC" value={formData.mnc} onChange={e=>setFormData(p=>({...p,mnc:e.target.value}))} placeholder="260" required/>
          <div className="col-span-2"><Input label="Operator" value={formData.operator} onChange={e=>setFormData(p=>({...p,operator:e.target.value}))} placeholder="T-Mobile USA" required/></div>
          <Select label="Network" value={formData.network_type} onChange={e=>setFormData(p=>({...p,network_type:e.target.value}))} options={[{value:'GSM',label:'GSM'},{value:'CDMA',label:'CDMA'},{value:'LTE',label:'LTE'},{value:'5G',label:'5G'}]}/>
          <Select label="Status" value={formData.status} onChange={e=>setFormData(p=>({...p,status:e.target.value as 'active'|'inactive'}))} options={[{value:'active',label:'Active'},{value:'inactive',label:'Inactive'}]}/>
        </div>
      </Modal>

      {/* Delete Modal */}
      <Modal isOpen={!!deleteModal} onClose={()=>setDeleteModal(null)} title="Delete Entry" footer={<div className="flex justify-end gap-3"><Button variant="secondary" onClick={()=>setDeleteModal(null)}>Cancel</Button><Button variant="danger" onClick={handleDelete}>Delete</Button></div>}>
        <p className="text-gray-600">Delete <strong>{deleteModal?.operator}</strong> ({deleteModal?.mcc}{deleteModal?.mnc})?</p>
      </Modal>

      {/* Import CSV Modal */}
      <Modal isOpen={showImportModal} onClose={()=>setShowImportModal(false)} title="Import MCC/MNC from CSV" size="lg" footer={<div className="flex justify-between w-full"><Button variant="secondary" icon={<Download size={14}/>} onClick={()=>{setImportText(CSV_SAMPLE);}}>Load Sample</Button><div className="flex gap-3"><Button variant="secondary" onClick={()=>setShowImportModal(false)}>Cancel</Button><Button onClick={handleImport} disabled={!importText.trim()}>Import Data</Button></div></div>}>
        <div className="space-y-4">
          <div className="bg-blue-50 p-3 rounded-lg text-xs">
            <p className="font-medium text-blue-700 mb-1">CSV Format (comma-separated):</p>
            <code className="text-blue-600">country,country_code,mcc,mnc,operator,network_type</code>
            <p className="text-blue-600 mt-1">First row is header (skipped). Existing MCC+MNC combos are updated.</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={()=>fileInputRef.current?.click()}>Browse File</Button>
            <input ref={fileInputRef} type="file" accept=".csv,.txt" onChange={handleFileUpload} className="hidden"/>
            <span className="text-xs text-gray-500 self-center">or paste below</span>
          </div>
          <textarea value={importText} onChange={e=>setImportText(e.target.value)} className="w-full h-48 px-3 py-2 border border-gray-300 rounded-lg font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Paste CSV data here or use Browse File..."/>
          {importResult && (
            <div className={`p-3 rounded-lg text-sm ${importResult.errors.length>0?'bg-yellow-50 border border-yellow-200':'bg-green-50 border border-green-200'}`}>
              <p className="font-medium">{importResult.added} added, {importResult.skipped} updated/skipped</p>
              {importResult.errors.map((e,i)=><p key={i} className="text-xs text-red-600 mt-1">{e}</p>)}
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};
