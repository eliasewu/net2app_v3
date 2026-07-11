import React, { useState, useEffect, useCallback } from 'react';
import { Search, Download, RefreshCw, Eye, Phone, MessageSquare, Radio, Globe, CheckCircle, XCircle, Clock } from 'lucide-react';
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
  mcc?: string; mnc?: string; route_name?: string; trunk_name?: string; client_rate?: number; supplier_rate?: number;
  profit?: number; currency?: string; dlr_status?: string; submit_time: string; delivery_time?: string;
  source: string; error_code?: string; error_message?: string; language?: string; provider?: string;
}

export const SMSLogs: React.FC = () => {
  const { smsLogs, smsTotal, fetchSMSLogs, clients, suppliers } = useData();
  const [search, setSearch] = useState(''); const [statusFilter, setStatusFilter] = useState<string>('all');
  const [clientFilter, setClientFilter] = useState<string>('all'); const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1); const [detailModal, setDetailModal] = useState<ExtendedLog | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [loading, setLoading] = useState(false);

  const itemsPerPage = 25;

  // Map SMS logs to extended format
  const smsLogEntries: ExtendedLog[] = smsLogs.map(l => ({
    id: l.id, message_id: l.message_id, destination: l.destination, sender_id: l.sender_id,
    message: l.message, status: l.status, client_code: l.client_code || undefined,
    supplier_code: l.supplier_code || undefined, country: l.country, operator: l.operator,
    mcc: l.mcc, mnc: l.mnc, route_name: l.route_name || undefined, trunk_name: l.trunk_name || undefined,
    client_rate: l.client_rate, supplier_rate: l.supplier_rate, profit: l.profit, currency: l.currency,
    dlr_status: l.dlr_status || undefined, submit_time: l.submit_time || '',
    delivery_time: l.delivery_time || undefined, source: l.source || 'smpp',
    error_code: l.error_code || undefined, error_message: l.error_message || undefined,
  }));

  // Server-side pagination fetch
  const loadLogs = useCallback(async (page: number) => {
    setLoading(true);
    try {
      // Map simplified filter categories to actual DB source values
      let sourceParam: string | undefined;
      if (sourceFilter === 'smpp') sourceParam = 'smpp,smpp_client,smpp_esme,smpp_mo';
      else if (sourceFilter === 'voice_otp') sourceParam = 'voice_otp,voice_otp_test';
      else if (sourceFilter === 'http') sourceParam = 'external_api,api,http_api';
      else if (sourceFilter !== 'all') sourceParam = sourceFilter;

      // Map status filter: "Sent" = submitted + pending, rejection codes = their error_code
      let statusParam: string | undefined;
      let errorCodeParam: string | undefined;
      if (statusFilter === 'submitted') statusParam = 'submitted,pending';
      else if (statusFilter === 'failed') statusParam = 'failed';
      else if (statusFilter === 'all_rejected') { statusParam = 'failed'; errorCodeParam = 'NO_RATE,NO_SUPPLIER_RATE,NO_SUPPLIER,ROUTE_BLOCKED,LOW_BALANCE'; }
      else if (statusFilter.startsWith('rej_')) {
        const code = statusFilter.replace('rej_', '');
        if (code === 'rate') errorCodeParam = 'NO_RATE,NO_SUPPLIER_RATE,ROUTE_BLOCKED';
        else if (code === 'supplier') errorCodeParam = 'NO_SUPPLIER';
        else if (code === 'balance') errorCodeParam = 'LOW_BALANCE';
        statusParam = 'failed';
      }
      else if (statusFilter !== 'all') statusParam = statusFilter;

      await fetchSMSLogs({
        search: search || undefined,
        status: statusParam,
        client_code: clientFilter !== 'all' ? clientFilter : undefined,
        source: sourceParam,
        error_code: errorCodeParam,
        include_deleted: showDeleted || undefined,
        offset: (page - 1) * itemsPerPage,
        limit: itemsPerPage,
      });
    } catch (e) {
      console.warn('SMS logs fetch failed:', e);
    } finally {
      setLoading(false);
    }
  }, [fetchSMSLogs, search, statusFilter, clientFilter, sourceFilter, showDeleted, itemsPerPage]);

  // Load on mount and on filter/page change
  useEffect(() => { loadLogs(currentPage); }, [currentPage, loadLogs]);

  // Auto-refresh: poll for new SMS every 15 seconds without page refresh
  useEffect(() => {
    const interval = setInterval(() => {
      loadLogs(currentPage);
    }, 15000);
    return () => clearInterval(interval);
  }, [currentPage, loadLogs]);

  const getClientName = (code?: string) => { const c = clients.find(x=>x.client_code===code); return c?.company_name||code||'-'; };
  const getSupplierName = (code?: string) => { const s = suppliers.find(x=>x.supplier_code===code); return s?.company_name||code||'-'; };
  const totalPages = Math.max(1, Math.ceil(smsTotal / itemsPerPage));
  const paginated = smsLogEntries;

  const getStatusB = (status: string) => {
    // SEND = message submitted to supplier successfully
    // FAIL = message could NOT be submitted to supplier
    const sent = ['submitted','pending','delivered','completed','sent'];
    const label = sent.includes(status) ? 'SEND' : 'FAIL';
    const variant = label === 'SEND' ? 'info' as const : 'danger' as const;
    return <Badge variant={variant} size="sm">{label}</Badge>;
  };

  const getDlrB = (dlrStatus?: string) => {
    // DLR shows actual delivery report result when received
    // No DLR yet → blank indicator; DLR received → DELIVRD / FAILED / REJECTED
    if (!dlrStatus || dlrStatus === 'PENDING') return <span className="text-xs text-gray-300">—</span>;
    if (dlrStatus === 'DELIVRD') return <Badge variant="success" size="sm">DELIVRD</Badge>;
    if (dlrStatus === 'UNDELIV') return <Badge variant="danger" size="sm">REJECTED</Badge>;
    if (dlrStatus === 'FAILED') return <Badge variant="danger" size="sm">FAILED</Badge>;
    return <Badge variant="default" size="sm">{dlrStatus}</Badge>;
  };

  const getSourceB = (source: string) => {
    // Connection type: SMPP vs HTTP
    const s = (source || '').toLowerCase();
    if (s.startsWith('smpp')) return <Badge variant="info" size="sm"><Radio size={12} className="mr-1"/>SMPP</Badge>;
    if (s === 'voice_otp' || s === 'voice_otp_test') return <Badge variant="warning" size="sm"><Phone size={12} className="mr-1"/>Voice OTP</Badge>;
    return <Badge variant="default" size="sm"><Globe size={12} className="mr-1"/>HTTP</Badge>;
  };

  const columns = [
    { key:'id', header:'#', render:(log:ExtendedLog) => <span className="font-mono text-xs text-gray-400">{log.id}</span> },
    { key:'source', header:'Type', render:(log:ExtendedLog) => getSourceB(log.source) },
    { key:'message_id', header:'ID', hideOnMobile:true, render:(log:ExtendedLog) => <span className="font-mono text-[10px] bg-gray-100 px-1.5 py-0.5 rounded">{(log.message_id||'').slice(-12)}</span> },
    { key:'client', header:'Client', render:(log:ExtendedLog) => <div><p className="text-xs font-medium">{getClientName(log.client_code)}</p><p className="text-[10px] text-gray-400">{log.client_code || '-'}</p></div> },
    { key:'supplier', header:'Supplier', hideOnMobile:true, render:(log:ExtendedLog) => <span className="text-xs text-gray-500">{getSupplierName(log.supplier_code) || log.supplier_code || '-'}</span> },
    { key:'destination', header:'Destination', render:(log:ExtendedLog) => <div><p className="font-mono text-xs">{log.destination||'-'}</p>{(log.mcc||log.mnc) && <p className="text-[10px] text-gray-400">{log.mcc}{log.mnc ? '/' + log.mnc : ''}</p>}</div> },
    { key:'operator', header:'Operator', hideOnMobile:true, render:(log:ExtendedLog) => <span className="text-xs text-gray-500">{log.operator || log.country || '—'}</span> },
    { key:'rates', header:'Rates', align:'right' as const, hideOnMobile:true, render:(log:ExtendedLog) => log.client_rate ? <div className="text-[10px]"><p className="text-gray-600">€{Number(log.client_rate).toFixed(4)}</p><p className="text-green-600">+€{Number(log.profit||0).toFixed(4)}</p></div> : <span className="text-xs text-gray-400">-</span> },
    { key:'status', header:'Status', render:(log:ExtendedLog) => getStatusB(log.status) },
    { key:'dlr', header:'DLR', hideOnMobile:true, render:(log:ExtendedLog) => getDlrB(log.dlr_status) },
    { key:'time', header:'Time', hideOnMobile:true, render:(log:ExtendedLog) => <span className="text-[10px] text-gray-500">{new Date(log.submit_time).toLocaleString()}</span> },
    { key:'actions', header:'', render:(log:ExtendedLog) => <button onClick={()=>setDetailModal(log)} className="p-1 rounded hover:bg-gray-100"><Eye size={14} className="text-gray-500"/></button> },
  ];

  const handleToggleDeleted = (checked: boolean) => {
    setShowDeleted(checked);
    setCurrentPage(1);
  };

  const total = smsTotal; const delivered = smsLogEntries.filter(l=>l.status==='delivered'||l.status==='completed').length;
  const failed = smsLogEntries.filter(l=>l.status==='failed').length; const sent = smsLogEntries.filter(l=>l.status==='pending'||l.status==='submitted').length;

  return (<div className="space-y-6">
    <div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold text-gray-800">SMS Logs (All Channels)</h1><p className="text-gray-500 mt-1">{smsTotal.toLocaleString()} logs — SMPP + Voice OTP + Test Calls + HTTP API</p></div><div className="flex gap-2"><Button variant="secondary" icon={<RefreshCw size={16}/>}>Refresh</Button><Button variant="secondary" icon={<Download size={16}/>}>Export CSV</Button></div></div>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className="bg-white rounded-xl p-4 border"><MessageSquare size={20} className="text-blue-500 mb-1"/><p className="text-xl font-bold">{total.toLocaleString()}</p><p className="text-xs text-gray-500">Total</p></div>
      <div className="bg-white rounded-xl p-4 border"><CheckCircle size={20} className="text-green-500 mb-1"/><p className="text-xl font-bold text-green-600">{delivered.toLocaleString()}</p><p className="text-xs text-gray-500">Delivered ({total>0?((delivered/total)*100).toFixed(1):0}%)</p></div>
      <div className="bg-white rounded-xl p-4 border"><XCircle size={20} className="text-red-500 mb-1"/><p className="text-xl font-bold text-red-600">{failed.toLocaleString()}</p><p className="text-xs text-gray-500">Failed</p></div>
      <div className="bg-white rounded-xl p-4 border"><Clock size={20} className="text-yellow-500 mb-1"/><p className="text-xl font-bold text-yellow-600">{sent.toLocaleString()}</p><p className="text-xs text-gray-500">Sent</p></div>
    </div>
    <Card><div className="flex flex-col md:flex-row gap-3">
      <div className="flex-1 relative"><Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/><input type="text" placeholder="Search ID, destination, sender..." value={search} onChange={e=>setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm"/></div>
      <select value={sourceFilter} onChange={e=>{setSourceFilter(e.target.value);setCurrentPage(1);}} className="px-3 py-2 border rounded-lg text-sm"><option value="all">All Sources</option><option value="smpp">SMPP</option><option value="voice_otp">Voice OTP</option><option value="http">HTTP</option></select>
      <select value={clientFilter} onChange={e=>{setClientFilter(e.target.value);setCurrentPage(1);}} className="px-3 py-2 border rounded-lg text-sm"><option value="all">All Clients</option>{clients.map(c=><option key={c.id} value={c.client_code}>{c.client_code}</option>)}</select>
      <select value={statusFilter} onChange={e=>{setStatusFilter(e.target.value);setCurrentPage(1);}} className="px-3 py-2 border rounded-lg text-sm"><option value="all">All Status</option><option value="delivered">Delivered</option><option value="submitted">Sent</option><option value="failed">Failed</option><option value="all_rejected">─ All Rejected ─</option><option value="rej_rate">• Rate Issues</option><option value="rej_supplier">• No Supplier</option><option value="rej_balance">• Low Balance</option></select>
      <label className="flex items-center gap-2 px-3 py-2 border rounded-lg text-sm cursor-pointer select-none"><input type="checkbox" checked={showDeleted} onChange={(e) => handleToggleDeleted(e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-blue-600" /><span>Show Deleted</span></label>
    </div></Card>      <Card noPadding>
        {loading ? (
          <div className="flex items-center justify-center py-12"><span className="animate-pulse text-gray-400">Loading logs...</span></div>
        ) : (
          <>
            <Table columns={columns} data={paginated} keyExtractor={l=>l.id}/>
            <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} totalItems={smsTotal} itemsPerPage={itemsPerPage}/>
          </>
        )}
      </Card>
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
        {detailModal.client_rate && <><div><p className="text-xs text-gray-500">Client Rate</p><p>€{Number(detailModal.client_rate).toFixed(4)}</p></div><div><p className="text-xs text-gray-500">Supplier Rate</p><p>€{Number(detailModal.supplier_rate || 0).toFixed(4)}</p></div><div className="col-span-2"><p className="text-xs text-gray-500">Profit</p><p className="text-green-600 font-semibold">€{Number(detailModal.profit||0).toFixed(4)}</p></div></>}
        <div><p className="text-xs text-gray-500">Submit Time</p><p className="text-xs">{new Date(detailModal.submit_time).toLocaleString()}</p></div>
        <div><p className="text-xs text-gray-500">Delivery Time</p><p className="text-xs">{detailModal.delivery_time ? new Date(detailModal.delivery_time).toLocaleString() : '-'}</p></div>
      </div>
      {detailModal.message && <div className="bg-gray-50 p-3 rounded-lg"><p className="text-xs text-gray-500 mb-1">Message</p><p className="text-sm">{detailModal.message}</p></div>}
      {detailModal.error_message && <div className="bg-red-50 p-3 rounded-lg text-sm text-red-600">{detailModal.error_message}</div>}</div>)}
    </Modal>
  </div>);
};

