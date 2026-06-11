import React, { useState } from 'react';
import { Search, Download, RefreshCw, Eye, Phone, MessageSquare, Radio, Wifi, Globe, Mic, CheckCircle, XCircle, Clock } from 'lucide-react';
import { useData } from '../store/DataContext';
import { Card } from '../components/UI/Card';
import { Button } from '../components/UI/Button';
import { Badge } from '../components/UI/Badge';
import { Table, Pagination } from '../components/UI/Table';
import { Modal } from '../components/UI/Modal';

// Extended log entry for all types
interface ExtendedLog {
  id: string; message_id: string; destination: string; sender_id: string; message: string;
  status: string; client_code?: string; supplier_code?: string; country?: string; operator?: string;
  route_name?: string; trunk_name?: string; client_rate?: number; supplier_rate?: number;
  profit?: number; currency?: string; dlr_status?: string; submit_time: string; delivery_time?: string;
  source: string; error_code?: string; error_message?: string; language?: string; provider?: string;
}

export const SMSLogs: React.FC = () => {
  const { smsLogs, clients, suppliers } = useData();
  const [search, setSearch] = useState(''); const [statusFilter, setStatusFilter] = useState<string>('all');
  const [clientFilter, setClientFilter] = useState<string>('all'); const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1); const [detailModal, setDetailModal] = useState<ExtendedLog | null>(null);

  // Load voice OTP logs + OTT logs and merge with SMS logs
  const voiceLogs: ExtendedLog[] = (() => {
    try { return JSON.parse(localStorage.getItem('voice_logs_db')||'[]').map((l:any) => ({...l, message_id:l.call_id, sender_id:'VoiceOTP', source:'voice_otp', message:l.otp_code||'', status:l.status, submit_time:l.created_at, client_code:'CLT001', supplier_code:'SUP005'})); } catch {}
    return [];
  })();

  // OTT device logs from localStorage  
  const ottLogs: ExtendedLog[] = [];
  
  // Test call logs from voice OTP test
  const testCalls: ExtendedLog[] = (() => {
    try { const s = localStorage.getItem('voice_logs_db'); if (s) { return JSON.parse(s).map((l:any)=>({...l, message_id:l.call_id, sender_id:'TestCall', source:'voice_otp_test', message:l.otp_code||'', status:l.status, submit_time:l.created_at, client_code:'TEST', supplier_code:'SUP005'})); } } catch {}
    return [];
  })();

  const smsLogEntries: ExtendedLog[] = smsLogs.map(l=>({id:l.id,message_id:l.message_id,destination:l.destination,sender_id:l.sender_id,message:l.message,status:l.status,client_code:l.client_code||undefined,supplier_code:l.supplier_code||undefined,country:l.country,operator:l.operator,route_name:l.route_name||undefined,trunk_name:l.trunk_name||undefined,client_rate:l.client_rate,supplier_rate:l.supplier_rate,profit:l.profit,currency:l.currency,dlr_status:l.dlr_status||undefined,submit_time:l.submit_time||'',delivery_time:l.delivery_time||undefined,source:'smpp',error_code:l.error_code||undefined,error_message:l.error_message||undefined}));

  // Merge all logs
  const allLogs: ExtendedLog[] = [...smsLogEntries, ...voiceLogs, ...ottLogs, ...testCalls].sort((a,b) => new Date(b.submit_time||'').getTime() - new Date(a.submit_time||'').getTime());

  const getClientName = (code?: string) => { const c = clients.find(x=>x.client_code===code); return c?.company_name||code||'-'; };
  const getSupplierName = (code?: string) => { const s = suppliers.find(x=>x.supplier_code===code); return s?.company_name||code||'-'; };

  const itemsPerPage = 25;
  const filtered = allLogs.filter(log => {
    const ms = (log.destination||'').includes(search) || (log.message_id||'').toLowerCase().includes(search.toLowerCase()) || (log.sender_id||'').toLowerCase().includes(search.toLowerCase());
    const st = statusFilter==='all' || log.status===statusFilter;
    const cl = clientFilter==='all' || log.client_code===clientFilter;
    const sc = sourceFilter==='all' || log.source===sourceFilter;
    return ms && st && cl && sc;
  });
  const totalPages = Math.ceil(filtered.length/itemsPerPage);
  const paginated = filtered.slice((currentPage-1)*itemsPerPage, currentPage*itemsPerPage);

  const getStatusB = (status: string) => {
    const m: Record<string,'success'|'warning'|'danger'|'info'|'default'> = { delivered:'success', completed:'success', sent:'info', submitted:'info', pending:'warning', failed:'danger', busy:'warning', no_answer:'danger' };
    return <Badge variant={m[status]||'default'} size="sm">{status.toUpperCase()}</Badge>;
  };

  const getSourceB = (source: string) => {
    const m: Record<string,{label:string;icon:React.ReactNode;variant:'success'|'warning'|'danger'|'info'|'default'|'purple'}> = {
      smpp: {label:'SMPP',icon:<Radio size={12}/>,variant:'info'},
      voice_otp: {label:'Voice OTP',icon:<Phone size={12}/>,variant:'warning'},
      voice_otp_test: {label:'Test Call',icon:<Mic size={12}/>,variant:'purple'},
      whatsapp: {label:'WhatsApp',icon:<MessageSquare size={12}/>,variant:'success'},
      telegram: {label:'Telegram',icon:<MessageSquare size={12}/>,variant:'info'},
      http_api: {label:'HTTP API',icon:<Globe size={12}/>,variant:'default'},
      ott: {label:'OTT',icon:<Wifi size={12}/>,variant:'success'},
    };
    const c = m[source]||{label:source.toUpperCase(),icon:<Radio size={12}/>,variant:'default' as const};
    return <Badge variant={c.variant} size="sm">{c.label}</Badge>;
  };

  const columns = [
    { key:'source', header:'Type', render:(log:ExtendedLog) => getSourceB(log.source) },
    { key:'message_id', header:'ID', render:(log:ExtendedLog) => <span className="font-mono text-[10px] bg-gray-100 px-1.5 py-0.5 rounded">{(log.message_id||'').slice(-12)}</span> },
    { key:'client', header:'Client', render:(log:ExtendedLog) => <Badge variant="info" size="sm">{log.client_code||'-'}</Badge> },
    { key:'supplier', header:'Supplier', render:(log:ExtendedLog) => <span className="text-xs text-gray-500">{log.supplier_code||'-'}</span> },
    { key:'destination', header:'Destination', render:(log:ExtendedLog) => <div><p className="font-mono text-xs">{log.destination||'-'}</p><p className="text-[10px] text-gray-500">{log.country||log.language||''}</p></div> },
    { key:'rates', header:'Rates', align:'right' as const, render:(log:ExtendedLog) => log.client_rate ? <div className="text-[10px]"><p className="text-gray-600">€{log.client_rate.toFixed(4)}</p><p className="text-green-600">+€{(log.profit||0).toFixed(4)}</p></div> : <span className="text-xs text-gray-400">-</span> },
    { key:'status', header:'Status', render:(log:ExtendedLog) => getStatusB(log.status) },
    { key:'dlr', header:'DLR', render:(log:ExtendedLog) => <Badge variant={log.dlr_status==='DELIVRD'?'success':'default'} size="sm">{log.dlr_status||'-'}</Badge> },
    { key:'time', header:'Time', render:(log:ExtendedLog) => <span className="text-[10px] text-gray-500">{new Date(log.submit_time).toLocaleString()}</span> },
    { key:'actions', header:'', render:(log:ExtendedLog) => <button onClick={()=>setDetailModal(log)} className="p-1 rounded hover:bg-gray-100"><Eye size={14} className="text-gray-500"/></button> },
  ];

  const total = allLogs.length; const delivered = allLogs.filter(l=>l.status==='delivered'||l.status==='completed').length;
  const failed = allLogs.filter(l=>l.status==='failed').length; const pending = allLogs.filter(l=>l.status==='pending'||l.status==='submitted').length;

  return (<div className="space-y-6">
    <div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold text-gray-800">SMS Logs (All Channels)</h1><p className="text-gray-500 mt-1">{allLogs.length.toLocaleString()} logs — SMPP + Voice OTP + Test Calls + HTTP API</p></div><div className="flex gap-2"><Button variant="secondary" icon={<RefreshCw size={16}/>}>Refresh</Button><Button variant="secondary" icon={<Download size={16}/>}>Export CSV</Button></div></div>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className="bg-white rounded-xl p-4 border"><MessageSquare size={20} className="text-blue-500 mb-1"/><p className="text-xl font-bold">{total.toLocaleString()}</p><p className="text-xs text-gray-500">Total</p></div>
      <div className="bg-white rounded-xl p-4 border"><CheckCircle size={20} className="text-green-500 mb-1"/><p className="text-xl font-bold text-green-600">{delivered.toLocaleString()}</p><p className="text-xs text-gray-500">Delivered ({total>0?((delivered/total)*100).toFixed(1):0}%)</p></div>
      <div className="bg-white rounded-xl p-4 border"><XCircle size={20} className="text-red-500 mb-1"/><p className="text-xl font-bold text-red-600">{failed.toLocaleString()}</p><p className="text-xs text-gray-500">Failed</p></div>
      <div className="bg-white rounded-xl p-4 border"><Clock size={20} className="text-yellow-500 mb-1"/><p className="text-xl font-bold text-yellow-600">{pending.toLocaleString()}</p><p className="text-xs text-gray-500">Pending</p></div>
    </div>
    <Card><div className="flex flex-col md:flex-row gap-3">
      <div className="flex-1 relative"><Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/><input type="text" placeholder="Search ID, destination, sender..." value={search} onChange={e=>setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm"/></div>
      <select value={sourceFilter} onChange={e=>{setSourceFilter(e.target.value);setCurrentPage(1);}} className="px-3 py-2 border rounded-lg text-sm"><option value="all">All Sources</option><option value="smpp">SMPP</option><option value="voice_otp">Voice OTP</option><option value="voice_otp_test">Test Call</option><option value="http_api">HTTP API</option></select>
      <select value={clientFilter} onChange={e=>{setClientFilter(e.target.value);setCurrentPage(1);}} className="px-3 py-2 border rounded-lg text-sm"><option value="all">All Clients</option>{clients.map(c=><option key={c.id} value={c.client_code}>{c.client_code}</option>)}</select>
      <select value={statusFilter} onChange={e=>{setStatusFilter(e.target.value);setCurrentPage(1);}} className="px-3 py-2 border rounded-lg text-sm"><option value="all">All Status</option><option value="delivered">Delivered</option><option value="completed">Completed</option><option value="submitted">Submitted</option><option value="pending">Pending</option><option value="failed">Failed</option></select>
    </div></Card>
    <Card noPadding><Table columns={columns} data={paginated} keyExtractor={l=>l.id}/><Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} totalItems={filtered.length} itemsPerPage={itemsPerPage}/></Card>
    <Modal isOpen={!!detailModal} onClose={()=>setDetailModal(null)} title="Log Detail" size="lg">
      {detailModal && (<div className="space-y-4"><div className="grid grid-cols-2 gap-4 text-sm">
        <div><p className="text-xs text-gray-500">ID</p><p className="font-mono">{detailModal.message_id}</p></div>
        <div><p className="text-xs text-gray-500">Source</p>{getSourceB(detailModal.source)}</div>
        <div><p className="text-xs text-gray-500">Sender</p><p>{detailModal.sender_id}</p></div>
        <div><p className="text-xs text-gray-500">Destination</p><p className="font-mono">{detailModal.destination||'-'}</p></div>
        <div><p className="text-xs text-gray-500">Client</p><p>{getClientName(detailModal.client_code)}</p></div>
        <div><p className="text-xs text-gray-500">Supplier</p><p>{getSupplierName(detailModal.supplier_code)}</p></div>
        <div><p className="text-xs text-gray-500">Status</p>{getStatusB(detailModal.status)}</div>
        <div><p className="text-xs text-gray-500">DLR</p><p className="font-mono">{detailModal.dlr_status||'-'}</p></div>
        {detailModal.client_rate && <><div><p className="text-xs text-gray-500">Client Rate</p><p>€{detailModal.client_rate.toFixed(4)}</p></div><div><p className="text-xs text-gray-500">Supplier Rate</p><p>€{detailModal.supplier_rate?.toFixed(4)}</p></div><div className="col-span-2"><p className="text-xs text-gray-500">Profit</p><p className="text-green-600 font-semibold">€{(detailModal.profit||0).toFixed(4)}</p></div></>}
        <div><p className="text-xs text-gray-500">Submit Time</p><p className="text-xs">{new Date(detailModal.submit_time).toLocaleString()}</p></div>
        <div><p className="text-xs text-gray-500">Delivery Time</p><p className="text-xs">{detailModal.delivery_time ? new Date(detailModal.delivery_time).toLocaleString() : '-'}</p></div>
      </div>
      {detailModal.message && <div className="bg-gray-50 p-3 rounded-lg"><p className="text-xs text-gray-500 mb-1">Message</p><p className="text-sm">{detailModal.message}</p></div>}
      {detailModal.error_message && <div className="bg-red-50 p-3 rounded-lg text-sm text-red-600">{detailModal.error_message}</div>}</div>)}
    </Modal>
  </div>);
};

