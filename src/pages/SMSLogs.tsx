import React, { useState, useEffect, useCallback } from 'react';
import { Search, Download, RefreshCw, Eye, Phone, MessageSquare, Radio, Globe, CheckCircle, XCircle, Clock, AlertTriangle, ArrowRight, ArrowDown, RotateCcw, Zap, Smartphone, Send } from 'lucide-react';
import { useData } from '../store/DataContext';
import { Card } from '../components/UI/Card';
import { Button } from '../components/UI/Button';
import { Badge } from '../components/UI/Badge';
import { Table, Pagination } from '../components/UI/Table';
import { Modal } from '../components/UI/Modal';
import { translationsApi } from '../services/api';


// Extended log entry for all types
interface ExtendedLog {
  id: string; message_id: string; destination: string; sender_id: string; message: string;
  original_destination?: string; original_sender_id?: string; original_message?: string;
  status: string; client_code?: string; supplier_code?: string; country?: string; operator?: string;
  mcc?: string; mnc?: string; route_name?: string; trunk_name?: string; client_rate?: number; supplier_rate?: number;
  profit?: number; currency?: string; dlr_status?: string; submit_time: string; delivery_time?: string;
  source: string; error_code?: string; error_message?: string; language?: string; provider?: string;
  is_billed?: boolean; // true only when balance was actually deducted
}

export const SMSLogs: React.FC = () => {
  const { smsLogs, smsTotal, fetchSMSLogs, clients, suppliers } = useData();
  const [search, setSearch] = useState(''); const [statusFilter, setStatusFilter] = useState<string>('all');
  const [clientFilter, setClientFilter] = useState<string>('all'); const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);  const [detailModal, setDetailModal] = useState<ExtendedLog | null>(null);
  const [replayLog, setReplayLog] = useState<ExtendedLog | null>(null);
  const [replayResult, setReplayResult] = useState<{ original: { destination: string; sender_id: string; message: string }; current: { destination: string; sender_id: string; message: string }; changed: { destination: boolean; sender_id: boolean; message: boolean } } | null>(null);
  const [replayError, setReplayError] = useState('');
  const [replayLoading, setReplayLoading] = useState(false);
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
    original_destination: l.original_destination || undefined,
    original_sender_id: l.original_sender_id || undefined,
    original_message: l.original_message || undefined,
    is_billed: !!(l.is_billed),
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
    else if (sourceFilter === 'test') sourceParam = 'test_sms,e2e_test';
    else if (sourceFilter === 'rcs') sourceParam = 'rcs';
    else if (sourceFilter === 'flash') sourceParam = 'flash_sms,flash';
    else if (sourceFilter === 'ott') sourceParam = 'ott,ott_device,whatsapp,whatsapp_business,telegram,telegram_business';
    else if (sourceFilter === 'campaign') sourceParam = 'campaign';
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

  // Auto-refresh: poll for new SMS every 10 seconds without page refresh
  useEffect(() => {
    const interval = setInterval(() => {
      loadLogs(currentPage);
    }, 10000);
    return () => clearInterval(interval);
  }, [currentPage, loadLogs]);

  const getClientName = (code?: string) => { const c = clients.find(x=>x.client_code===code); return c?.company_name||code||'-'; };
  const getSupplierName = (code?: string) => { const s = suppliers.find(x=>x.supplier_code===code); return s?.company_name||code||'-'; };
  const totalPages = Math.max(1, Math.ceil(smsTotal / itemsPerPage));
  const paginated = smsLogEntries;

  // ============================================================
  // ENTERPRISE-GRADE STATUS DISPLAY
  // ============================================================

  /** Human-readable reason for pre-submit rejection */
  const getRejectionReason = (log: ExtendedLog): string => {
    if (log.error_message) return log.error_message;
    if (!log.error_code) return 'Delivery failed';
    const map: Record<string,string> = {
      NO_RATE: 'No client rate configured',
      NO_SUPPLIER_RATE: 'No supplier rate',
      NO_SUPPLIER: 'No supplier available',
      ROUTE_BLOCKED: 'Route blocked',
      LOW_BALANCE: 'Insufficient balance',
      NO_ROUTE: 'No route to destination',
      NO_PROFIT: 'Client rate ≤ supplier cost',
      CLIENT_NOT_FOUND: 'Client not active',
      DEAD_LETTER: 'Max retries exhausted',
      DLR_TIMEOUT: 'DLR timeout (75s)',
      UNDELIV: 'Supplier reported undelivered',
    };
    return map[log.error_code] || log.error_code;
  };

  /** Send Result: was the message submitted to the supplier? */
  const getSendResult = (log: ExtendedLog) => {
    if (log.status === 'delivered' || log.status === 'completed') {
      return (
        <div className="flex items-center gap-1.5">
          <CheckCircle size={14} className="text-green-500 flex-shrink-0" />
          <div>
            <p className="text-xs font-semibold text-green-700">Success</p>
            <p className="text-[9px] text-green-500">Submitted to supplier</p>
          </div>
        </div>
      );
    }
    if (log.status === 'submitted' || log.status === 'pending' || log.status === 'sent') {
      return (
        <div className="flex items-center gap-1.5">
          <div className="w-3.5 h-3.5 rounded-full border-2 border-blue-400 flex-shrink-0" />
          <div>
            <p className="text-xs font-semibold text-blue-700">Success</p>
            <p className="text-[9px] text-blue-500">Awaiting DLR</p>
          </div>
        </div>
      );
    }
    if (log.status === 'failed') {
      // Has dlr_status = WAS submitted, DLR says failed
      if (log.dlr_status && log.dlr_status !== 'PENDING') {
        return (
          <div className="flex items-center gap-1.5">
            <CheckCircle size={14} className="text-green-500 flex-shrink-0" />
            <div>
              <p className="text-xs font-semibold text-green-700">Success</p>
              <p className="text-[9px] text-gray-400">Submitted, DLR failed</p>
            </div>
          </div>
        );
      }
      // Has error_code = pre-submit rejection
      if (log.error_code) {
        return (
          <div className="flex items-center gap-1.5">
            <XCircle size={14} className="text-red-500 flex-shrink-0" />
            <div>
              <p className="text-xs font-semibold text-red-700">Rejected</p>
              <p className="text-[11px] text-red-500">{getRejectionReason(log)}</p>
            </div>
          </div>
        );
      }
      // Unknown failure
      return (
        <div className="flex items-center gap-1.5">
          <AlertTriangle size={14} className="text-amber-500 flex-shrink-0" />
          <div>
            <p className="text-xs font-semibold text-amber-700">Failed</p>
            <p className="text-[9px] text-amber-500">Supplier offline</p>
          </div>
        </div>
      );
    }
    if (log.status === 'rejected') {
      return (
        <div className="flex items-center gap-1.5">
          <XCircle size={14} className="text-red-500 flex-shrink-0" />
          <div>
            <p className="text-xs font-semibold text-red-700">Rejected</p>
            <p className="text-[9px] text-red-500">{getRejectionReason(log)}</p>
          </div>
        </div>
      );
    }
    return <span className="text-xs text-gray-400">{log.status || '—'}</span>;
  };

  /** Deliver Result: what did the supplier report? */
  const getDeliverResult = (log: ExtendedLog) => {
    const dlr = log.dlr_status;
    // Calculate DLR duration
    let dlrDuration = '';
    if (log.delivery_time && log.submit_time) {
      const sec = Math.round((new Date(log.delivery_time).getTime() - new Date(log.submit_time).getTime()) / 1000);
      if (sec >= 0) dlrDuration = sec >= 60 ? `${Math.floor(sec/60)}m ${sec%60}s` : `${sec}s`;
    }

    // No DLR yet → check if this was a pre-submit rejection
    if (!dlr || dlr === 'PENDING') {
      // Pre-submit rejection: any failed/rejected message without delivery confirmation
      if (log.status === 'failed' || log.status === 'rejected') {
        return (
          <div className="flex items-center gap-1.5">
            <XCircle size={14} className="text-red-500 flex-shrink-0" />
            <div>
              <p className="text-xs font-semibold text-red-700">Failed</p>
              <p className="text-[11px] text-red-500">{getRejectionReason(log)}</p>
            </div>
          </div>
        );
      }
      return (
        <div className="flex items-center gap-1.5">
          <Clock size={14} className="text-gray-300 flex-shrink-0" />
          <div>
            <p className="text-xs text-gray-400">Pending</p>
            {log.status === 'submitted' && <p className="text-[9px] text-gray-300">Awaiting response</p>}
          </div>
        </div>
      );
    }

    // Delivered
    if (dlr === 'DELIVRD') {
      return (
        <div className="flex items-center gap-1.5">
          <CheckCircle size={14} className="text-green-500 flex-shrink-0" />
          <div>
            <p className="text-xs font-semibold text-green-700">Delivered</p>
            {dlrDuration && <p className="text-[9px] text-green-500">{dlrDuration}</p>}
            {log.delivery_time && <p className="text-[9px] text-gray-400">{new Date(log.delivery_time).toLocaleTimeString()}</p>}
          </div>
        </div>
      );
    }

    // Undelivered / Failed
    if (dlr === 'UNDELIV' || dlr === 'FAILED') {
      const reason = log.error_code === 'UNDELIV' ? 'Supplier rejected' :
                     log.error_code === 'DLR_TIMEOUT' ? 'Timeout (75s)' :
                     log.error_message || 'Delivery failed';
      return (
        <div className="flex items-center gap-1.5">
          <XCircle size={14} className="text-red-500 flex-shrink-0" />
          <div>
            <p className="text-xs font-semibold text-red-700">Failed</p>
            <p className="text-[11px] text-red-500">{reason}</p>
            {dlrDuration && <p className="text-[9px] text-gray-400">{dlrDuration}</p>}
          </div>
        </div>
      );
    }

    // Expired
    if (dlr === 'EXPIRED') {
      return (
        <div className="flex items-center gap-1.5">
          <Clock size={14} className="text-amber-500 flex-shrink-0" />
          <div>
            <p className="text-xs font-semibold text-amber-700">Timeout</p>
            <p className="text-[9px] text-amber-500">TTL exceeded</p>
          </div>
        </div>
      );
    }

    // Rejected by supplier
    if (dlr === 'REJECTD') {
      return (
        <div className="flex items-center gap-1.5">
          <XCircle size={14} className="text-red-500 flex-shrink-0" />
          <div>
            <p className="text-xs font-semibold text-red-700">Rejected</p>
            <p className="text-[9px] text-red-500">Supplier blocked</p>
          </div>
        </div>
      );
    }

    return <span className="text-xs text-gray-500">{dlr}</span>;
  };

  const getSourceB = (source: string) => {
    const s = (source || '').toLowerCase();
    if (s.startsWith('smpp')) return <Badge variant="info" size="sm"><Radio size={12} className="mr-1"/>SMPP</Badge>;
    if (s === 'voice_otp' || s === 'voice_otp_test') return <Badge variant="warning" size="sm"><Phone size={12} className="mr-1"/>Voice OTP</Badge>;
    if (s === 'test_sms' || s === 'e2e_test') return <Badge variant="success" size="sm"><Zap size={12} className="mr-1"/>Test SMS</Badge>;
    if (s === 'external_api' || s === 'api' || s === 'http_api') return <Badge variant="default" size="sm"><Globe size={12} className="mr-1"/>HTTP</Badge>;
    if (s === 'rcs' || s.startsWith('rcs')) return <Badge variant="info" size="sm"><Smartphone size={12} className="mr-1"/>RCS</Badge>;
    if (s === 'flash_sms' || s === 'flash') return <Badge variant="danger" size="sm"><Zap size={12} className="mr-1"/>Flash SMS</Badge>;
    if (s === 'whatsapp' || s === 'whatsapp_business') return <Badge variant="success" size="sm"><Send size={12} className="mr-1"/>WhatsApp</Badge>;
    if (s === 'telegram' || s === 'telegram_business') return <Badge variant="info" size="sm"><Send size={12} className="mr-1"/>Telegram</Badge>;
    if (s === 'ott' || s === 'ott_device') return <Badge variant="default" size="sm"><Smartphone size={12} className="mr-1"/>OTT</Badge>;
    if (s === 'campaign') return <Badge variant="default" size="sm"><Send size={12} className="mr-1"/>Campaign</Badge>;
    return <Badge variant="default" size="sm"><MessageSquare size={12} className="mr-1"/>{source || 'SMS'}</Badge>;
  };

  const columns = [
    { key:'id', header:'#', render:(log:ExtendedLog) => <span className="font-mono text-xs text-gray-400">{log.id}</span> },
    { key:'source', header:'Type', render:(log:ExtendedLog) => getSourceB(log.source) },
    { key:'message_id', header:'ID', hideOnMobile:true, render:(log:ExtendedLog) => <span className="font-mono text-[10px] bg-gray-100 px-1.5 py-0.5 rounded">{(log.message_id||'').slice(-12)}</span> },
    { key:'client', header:'Client', render:(log:ExtendedLog) => <div><p className="text-xs font-medium">{getClientName(log.client_code)}</p><p className="text-[10px] text-gray-400">{log.client_code || '-'}</p></div> },
    { key:'supplier', header:'Supplier', hideOnMobile:true, render:(log:ExtendedLog) => <span className="text-xs text-gray-500">{getSupplierName(log.supplier_code) || log.supplier_code || '-'}</span> },
    { key:'destination', header:'Number In → Out', render:(log:ExtendedLog) => {
      const hasTransaction = log.original_destination && log.original_destination !== log.destination;
      return <div>
        {hasTransaction ? (
          <div className="flex items-center gap-1 flex-wrap">
            <code className="text-[10px] bg-red-50 text-red-600 px-1 py-0.5 rounded font-mono">{log.original_destination}</code>
            <ArrowRight size={10} className="text-gray-400 flex-shrink-0" />
            <code className="text-[10px] bg-green-50 text-green-700 px-1 py-0.5 rounded font-mono font-semibold">{log.destination}</code>
          </div>
        ) : (
          <p className="font-mono text-xs">{log.destination||'-'}</p>
        )}
        {(log.mcc||log.mnc) && <p className="text-[10px] text-gray-400 mt-0.5">{log.mcc}{log.mnc ? '/' + log.mnc : ''}</p>}
      </div>;
    } },
    { key:'operator', header:'Operator', hideOnMobile:true, render:(log:ExtendedLog) => <span className="text-xs text-gray-500">{log.operator || log.country || '—'}</span> },
    { key:'sender', header:'SID In → Out', hideOnMobile:true, render:(log:ExtendedLog) => {
      const hasChange = log.original_sender_id && log.original_sender_id !== log.sender_id;
      if (!hasChange) return <span className="text-xs text-gray-400 font-mono">{log.sender_id || '—'}</span>;
      return <div className="flex items-center gap-1">
        <code className="text-[10px] bg-red-50 text-red-600 px-1 py-0.5 rounded font-mono max-w-[60px] truncate">{log.original_sender_id}</code>
        <ArrowRight size={10} className="text-gray-400 flex-shrink-0" />
        <code className="text-[10px] bg-green-50 text-green-700 px-1 py-0.5 rounded font-mono font-semibold max-w-[60px] truncate">{log.sender_id}</code>
      </div>;
    } },
    { key:'content', header:'Content', hideOnMobile:true, render:(log:ExtendedLog) => {
      const hasChange = log.original_message && log.original_message !== log.message;
      if (!hasChange) return <span className="text-xs text-gray-400">—</span>;
      return <div className="flex items-center gap-1" title={`In: ${log.original_message}\nOut: ${log.message}`}>
        <span className="inline-flex items-center gap-0.5 text-[10px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded-full font-medium">
          <ArrowDown size={10} /> translated
        </span>
      </div>;
    } },
    { key:'client_rate', header:'Client €', align:'right' as const, hideOnMobile:true, render:(log:ExtendedLog) => {
      if (!log.client_rate || log.client_rate === 0) return <span className="text-xs text-gray-400">—</span>;
      const charged = log.is_billed;
      return <span className={`text-xs font-mono font-medium ${charged ? 'text-gray-700' : 'text-red-400 line-through'}`}>
        €{Number(log.client_rate).toFixed(4)}
      </span>;
    } },
    { key:'supplier_rate', header:'Supplier €', align:'right' as const, hideOnMobile:true, render:(log:ExtendedLog) => {
      if (!log.supplier_rate || log.supplier_rate === 0) return <span className="text-xs text-gray-400">—</span>;
      return <span className="text-xs font-mono text-gray-500">€{Number(log.supplier_rate).toFixed(4)}</span>;
    } },
    { key:'profit', header:'Profit €', align:'right' as const, hideOnMobile:true, render:(log:ExtendedLog) => {
      if (log.profit == null) return <span className="text-xs text-gray-400">—</span>;
      const p = Number(log.profit);
      return <span className={`text-xs font-mono font-medium ${p > 0 ? 'text-emerald-600' : p < 0 ? 'text-red-600' : 'text-gray-500'}`}>
        €{p.toFixed(4)}
      </span>;
    } },
    { key:'billing', header:'Billing', hideOnMobile:true, render:(log:ExtendedLog) => {
      if (log.is_billed) {
        return <Badge variant="success" size="sm">Billed</Badge>;
      }
      if (log.client_rate && log.client_rate > 0 && !log.is_billed) {
        return <Badge variant="warning" size="sm">Pending</Badge>;
      }
      return <span className="text-xs text-gray-400">—</span>;
    } },
    { key:'send', header:'Send Result', render:(log:ExtendedLog) => getSendResult(log) },
    { key:'dlr', header:'Deliver Result', hideOnMobile:true, render:(log:ExtendedLog) => getDeliverResult(log) },
    { key:'reason', header:'Reason', hideOnMobile:true, render:(log:ExtendedLog) => {
      if (!log.error_code && !log.error_message) return <span className="text-xs text-gray-300">—</span>;
      const reason = log.error_message || getRejectionReason(log);
      return <span className="text-[11px] text-red-600 bg-red-50 px-2 py-0.5 rounded">{reason}</span>;
    }},
    { key:'time', header:'Submit Time', hideOnMobile:true, render:(log:ExtendedLog) => <span className="text-[10px] text-gray-500">{new Date(log.submit_time).toLocaleString()}</span> },
    { key:'actions', header:'', render:(log:ExtendedLog) => (
      <div className="flex gap-1">
        <button onClick={async () => {
          setReplayLog(log);
          setReplayResult(null);
          setReplayError('');
          setReplayLoading(true);
          try {
            const res: any = await translationsApi.replay({
              original_destination: log.original_destination || log.destination,
              original_sender_id: log.original_sender_id || log.sender_id,
              original_message: log.original_message || log.message,
              client_id: log.client_code || undefined,
              supplier_id: log.supplier_code || undefined,
            });
            if (res.success && res.data?.data) setReplayResult(res.data.data);
            else setReplayError(res.error || 'Replay returned no result');
          } catch (e: any) { setReplayError(e?.message || 'Replay failed'); }
          setReplayLoading(false);
        }} className="p-1 rounded hover:bg-purple-100 transition-colors" title="Replay with current rules">
          <RotateCcw size={14} className={`${replayLoading && replayLog?.id === log.id ? 'animate-spin text-purple-700' : 'text-purple-500'}`} />
        </button>
        <button onClick={()=>setDetailModal(log)} className="p-1 rounded hover:bg-gray-100"><Eye size={14} className="text-gray-500"/></button>
      </div>
    ) },
  ];

  const handleToggleDeleted = (checked: boolean) => {
    setShowDeleted(checked);
    setCurrentPage(1);
  };

  const total = smsTotal;
  const delivered = smsLogEntries.filter(l => l.status==='delivered'||l.status==='completed').length;
  const sent = smsLogEntries.filter(l => l.status==='submitted'||l.status==='pending'||l.status==='sent'||(l.status==='failed' && l.dlr_status && l.dlr_status!=='PENDING')).length;
  const rejected = smsLogEntries.filter(l => (l.status==='failed' && l.error_code && !l.dlr_status) || l.status==='rejected').length;

  return (<div className="space-y-6">
    <div className="flex items-center justify-between"><div><h1 className="text-2xl font-bold text-gray-800">SMS Logs (All Channels)</h1><p className="text-gray-500 mt-1">{smsTotal.toLocaleString()} logs — All channels: SMPP • Voice OTP • HTTP • RCS • Flash • OTT • Campaign</p></div><div className="flex gap-2"><Button variant="secondary" icon={<RefreshCw size={16}/>}>Refresh</Button><Button variant="secondary" icon={<Download size={16}/>}>Export CSV</Button></div></div>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <div className="bg-white rounded-xl p-4 border"><MessageSquare size={20} className="text-blue-500 mb-1"/><p className="text-xl font-bold">{total.toLocaleString()}</p><p className="text-xs text-gray-500">Total</p></div>
      <div className="bg-white rounded-xl p-4 border"><CheckCircle size={20} className="text-green-500 mb-1"/><p className="text-xl font-bold text-green-600">{delivered.toLocaleString()}</p><p className="text-xs text-gray-500">Delivered ({total>0?((delivered/total)*100).toFixed(1):0}%)</p></div>
      <div className="bg-white rounded-xl p-4 border"><ArrowRight size={20} className="text-blue-500 mb-1"/><p className="text-xl font-bold text-blue-600">{sent.toLocaleString()}</p><p className="text-xs text-gray-500">Sent</p></div>
      <div className="bg-white rounded-xl p-4 border"><XCircle size={20} className="text-red-500 mb-1"/><p className="text-xl font-bold text-red-600">{rejected.toLocaleString()}</p><p className="text-xs text-gray-500">Rejected</p></div>
    </div>
    <Card><div className="flex flex-col md:flex-row gap-3">
      <div className="flex-1 relative"><Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/><input type="text" placeholder="Search ID, destination, sender..." value={search} onChange={e=>setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border rounded-lg text-sm"/></div>
      <select value={sourceFilter} onChange={e=>{setSourceFilter(e.target.value);setCurrentPage(1);}} className="px-3 py-2 border rounded-lg text-sm"><option value="all">All Sources</option>
              <option value="smpp">SMPP</option>
              <option value="voice_otp">Voice OTP</option>
              <option value="http">HTTP API</option>
              <option value="test">Test SMS</option>
              <option value="campaign">Campaign</option>
              <option value="rcs">RCS</option>
              <option value="flash">Flash SMS</option>
              <option value="ott">OTT / WhatsApp</option></select>
      <select value={clientFilter} onChange={e=>{setClientFilter(e.target.value);setCurrentPage(1);}} className="px-3 py-2 border rounded-lg text-sm"><option value="all">All Clients</option>{clients.map(c=><option key={c.id} value={c.client_code}>{c.client_code}</option>)}</select>
      <select value={statusFilter} onChange={e=>{setStatusFilter(e.target.value);setCurrentPage(1);}} className="px-3 py-2 border rounded-lg text-sm"><option value="all">All Status</option><option value="delivered">Delivered</option><option value="submitted">Sent</option><option value="failed">Failed</option><option value="all_rejected">─ All Rejected ─</option><option value="rej_rate">• Rate Issues</option><option value="rej_supplier">• No Supplier</option><option value="rej_balance">• Low Balance</option></select>
      <label className="flex items-center gap-2 px-3 py-2 border rounded-lg text-sm cursor-pointer select-none"><input type="checkbox" checked={showDeleted} onChange={(e) => handleToggleDeleted(e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-blue-600" /><span>Show Deleted</span></label>
    </div></Card>      <Card noPadding>
        {loading ? (
          <div className="flex items-center justify-center py-12"><span className="animate-pulse text-gray-400">Loading logs...</span></div>
        ) : (
          <>
            <div className="overflow-auto max-h-[70vh]">
              <Table columns={columns} data={paginated} keyExtractor={l=>l.id}/>
            </div>
            <Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} totalItems={smsTotal} itemsPerPage={itemsPerPage}/>
          </>
        )}
      </Card>
    <Modal isOpen={!!detailModal} onClose={()=>setDetailModal(null)} title="Log Detail" size="lg">
      {detailModal && (<div className="space-y-4">
        {/* Translation comparison — shown when any field was translated */}
        {((detailModal.original_sender_id != null && detailModal.original_sender_id !== detailModal.sender_id) ||
          (detailModal.original_destination != null && detailModal.original_destination !== detailModal.destination) ||
          (detailModal.original_message != null && detailModal.original_message !== detailModal.message)) && (
          <div className="bg-gradient-to-r from-blue-50 to-purple-50 border border-blue-200 rounded-xl p-4">
            <h4 className="text-sm font-semibold text-blue-800 mb-3 flex items-center gap-2">
              <ArrowRight size={16} /> Translation Applied
            </h4>
            <div className="space-y-3">
              {/* Number Translation */}
              {detailModal.original_destination && detailModal.original_destination !== detailModal.destination && (
                <div className="bg-white rounded-lg p-3 border border-blue-100">
                  <p className="text-[10px] font-medium text-gray-500 uppercase mb-1">Number Translation</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="text-xs bg-red-50 text-red-700 px-2 py-1 rounded font-mono line-through">{detailModal.original_destination}</code>
                    <ArrowRight size={14} className="text-green-500" />
                    <code className="text-xs bg-green-50 text-green-700 px-2 py-1 rounded font-mono font-bold">{detailModal.destination}</code>
                  </div>
                </div>
              )}
              {/* SID Translation */}
              {detailModal.original_sender_id && detailModal.original_sender_id !== detailModal.sender_id && (
                <div className="bg-white rounded-lg p-3 border border-purple-100">
                  <p className="text-[10px] font-medium text-gray-500 uppercase mb-1">Sender ID Translation</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="text-xs bg-red-50 text-red-700 px-2 py-1 rounded font-mono line-through">{detailModal.original_sender_id}</code>
                    <ArrowRight size={14} className="text-green-500" />
                    <code className="text-xs bg-green-50 text-green-700 px-2 py-1 rounded font-mono font-bold">{detailModal.sender_id}</code>
                  </div>
                </div>
              )}
              {/* Content Translation */}
              {detailModal.original_message && detailModal.original_message !== detailModal.message && (
                <div className="bg-white rounded-lg p-3 border border-indigo-100">
                  <p className="text-[10px] font-medium text-gray-500 uppercase mb-1">Content Translation</p>
                  <div className="space-y-1">
                    <div className="bg-red-50 rounded p-2">
                      <p className="text-[9px] text-red-500 mb-0.5">INCOMING</p>
                      <p className="text-xs text-red-700 line-through">{detailModal.original_message}</p>
                    </div>
                    <ArrowDown size={14} className="text-green-500 mx-auto" />
                    <div className="bg-green-50 rounded p-2">
                      <p className="text-[9px] text-green-500 mb-0.5">OUTGOING</p>
                      <p className="text-xs text-green-700 font-semibold">{detailModal.message}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-4 text-sm">
        <div><p className="text-xs text-gray-500">ID</p><p className="font-mono">{detailModal.message_id}</p></div>
        <div><p className="text-xs text-gray-500">Source</p>{getSourceB(detailModal.source)}</div>
        <div><p className="text-xs text-gray-500">Sender ID</p><p className="font-mono text-xs">{detailModal.sender_id||'-'}</p></div>
        <div><p className="text-xs text-gray-500">Destination</p><p className="font-mono">{detailModal.destination||'-'}</p></div>
        <div><p className="text-xs text-gray-500">Client</p><p>{getClientName(detailModal.client_code)}</p></div>
        <div><p className="text-xs text-gray-500">Supplier</p><p>{getSupplierName(detailModal.supplier_code)}</p></div>
        <div><p className="text-xs text-gray-500">Send Result</p>{getSendResult(detailModal)}</div>
        <div><p className="text-xs text-gray-500">Deliver Result</p>{getDeliverResult(detailModal)}</div>
        {detailModal.client_rate && (<>
          <div><p className="text-xs text-gray-500">Client Rate</p><p>€{Number(detailModal.client_rate).toFixed(4)}</p></div>
          <div><p className="text-xs text-gray-500">Supplier Rate</p><p>€{Number(detailModal.supplier_rate || 0).toFixed(4)}</p></div>
          <div className="col-span-2">
            <p className="text-xs text-gray-500">Billing</p>
            {detailModal.is_billed ? (
              <p className="text-green-600 font-semibold">Charged: €{Number(detailModal.profit || 0).toFixed(4)} profit</p>
            ) : (
              <p className="text-red-500 font-semibold">€0.00 — not charged (failed/pending)</p>
            )}
          </div>
        </>)}
        <div><p className="text-xs text-gray-500">Submit Time</p><p className="text-xs">{new Date(detailModal.submit_time).toLocaleString()}</p></div>
        <div><p className="text-xs text-gray-500">Delivery Time</p><p className="text-xs">{detailModal.delivery_time ? new Date(detailModal.delivery_time).toLocaleString() : '—'}</p></div>
        {detailModal.delivery_time && detailModal.submit_time && (
          <div className="col-span-2">
            <p className="text-xs text-gray-500">DLR Duration</p>
            <p className="text-sm font-mono">
              {(() => { const sec = Math.round((new Date(detailModal.delivery_time).getTime() - new Date(detailModal.submit_time).getTime()) / 1000); return sec >= 60 ? `${Math.floor(sec/60)}m ${sec%60}s` : `${sec}s`; })()}
            </p>
          </div>
        )}
        {detailModal.error_message && <div className="col-span-2 bg-red-50 p-3 rounded-lg text-sm text-red-600">{detailModal.error_message}</div>}
      </div>
      {detailModal.message && !(detailModal.original_message && detailModal.original_message !== detailModal.message) && <div className="bg-gray-50 p-3 rounded-lg"><p className="text-xs text-gray-500 mb-1">Message</p><p className="text-sm">{detailModal.message}</p></div>}</div>)}
    </Modal>

    {/* Replay Modal — re-run original message through current translation rules */}
    <Modal isOpen={!!replayLog} onClose={() => { setReplayLog(null); setReplayResult(null); setReplayError(''); }} title="Replay with Current Rules" size="lg">
      {replayLog && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 bg-purple-50 border border-purple-200 rounded-lg p-3">
            <Zap size={16} className="text-purple-600" />
            <div>
              <p className="text-sm text-purple-700">
                Re-running <strong>original message</strong> through <strong>current active translation rules</strong>.
              </p>
              <p className="text-[10px] text-purple-500 font-mono mt-0.5">{replayLog.message_id} → {replayLog.destination}</p>
            </div>
          </div>

          {replayLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw size={24} className="animate-spin text-purple-500 mr-2" />
              <span className="text-gray-500">Replaying with current rules...</span>
            </div>
          ) : replayResult ? (
            <div className="space-y-4">
              {/* Error banner */}
              {replayError && (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
                  <XCircle size={16} className="text-red-600" />
                  <p className="text-sm text-red-700">{replayError}</p>
                </div>
              )}
              {/* Summary */}
              <div className="grid grid-cols-3 gap-3">
                <div className={`rounded-lg p-3 text-center border ${replayResult.changed?.destination ? 'bg-amber-50 border-amber-200' : 'bg-gray-50 border-gray-200'}`}>
                  <p className="text-[10px] font-medium text-gray-500 uppercase mb-1">Number</p>
                  <p className={`text-lg font-bold ${replayResult.changed?.destination ? 'text-amber-600' : 'text-gray-400'}`}>
                    {replayResult.changed?.destination ? 'CHANGED' : 'SAME'}
                  </p>
                </div>
                <div className={`rounded-lg p-3 text-center border ${replayResult.changed?.sender_id ? 'bg-purple-50 border-purple-200' : 'bg-gray-50 border-gray-200'}`}>
                  <p className="text-[10px] font-medium text-gray-500 uppercase mb-1">Sender ID</p>
                  <p className={`text-lg font-bold ${replayResult.changed?.sender_id ? 'text-purple-600' : 'text-gray-400'}`}>
                    {replayResult.changed?.sender_id ? 'CHANGED' : 'SAME'}
                  </p>
                </div>
                <div className={`rounded-lg p-3 text-center border ${replayResult.changed?.message ? 'bg-green-50 border-green-200' : 'bg-gray-50 border-gray-200'}`}>
                  <p className="text-[10px] font-medium text-gray-500 uppercase mb-1">Content</p>
                  <p className={`text-lg font-bold ${replayResult.changed?.message ? 'text-green-600' : 'text-gray-400'}`}>
                    {replayResult.changed?.message ? 'CHANGED' : 'SAME'}
                  </p>
                </div>
              </div>

              {/* Destination comparison */}
              {replayResult.changed?.destination && (
                <div className="bg-white rounded-lg p-3 border border-amber-200">
                  <p className="text-[10px] font-medium text-gray-500 uppercase mb-2">Number Translation</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="text-xs bg-red-50 text-red-700 px-2 py-1 rounded font-mono line-through">{replayLog.destination}</code>
                    <ArrowRight size={14} className="text-green-500" />
                    <code className="text-xs bg-green-50 text-green-700 px-2 py-1 rounded font-mono font-bold">{replayResult.current?.destination}</code>
                  </div>
                </div>
              )}

              {/* Sender ID comparison */}
              {replayResult.changed?.sender_id && (
                <div className="bg-white rounded-lg p-3 border border-purple-200">
                  <p className="text-[10px] font-medium text-gray-500 uppercase mb-2">Sender ID Translation</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <code className="text-xs bg-red-50 text-red-700 px-2 py-1 rounded font-mono line-through">{replayLog.sender_id}</code>
                    <ArrowRight size={14} className="text-green-500" />
                    <code className="text-xs bg-green-50 text-green-700 px-2 py-1 rounded font-mono font-bold">{replayResult.current?.sender_id}</code>
                  </div>
                </div>
              )}

              {/* Content comparison */}
              {replayResult.changed?.message && (
                <div className="bg-white rounded-lg p-3 border border-green-200">
                  <p className="text-[10px] font-medium text-gray-500 uppercase mb-2">Content Translation (OTP Extract / Replace)</p>
                  <div className="space-y-2">
                    <div className="bg-red-50 rounded p-2">
                      <p className="text-[9px] text-red-500 mb-0.5">CURRENTLY STORED</p>
                      <p className="text-xs text-red-700">{replayLog.message}</p>
                    </div>
                    <ArrowDown size={14} className="text-green-500 mx-auto" />
                    <div className="bg-green-50 rounded p-2">
                      <p className="text-[9px] text-green-500 mb-0.5">WOULD BE SENT NOW</p>
                      <p className="text-xs text-green-700 font-semibold">{replayResult.current?.message}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Nothing changed */}
              {!replayResult.changed?.destination && !replayResult.changed?.sender_id && !replayResult.changed?.message && (
                <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg p-4">
                  <CheckCircle size={18} className="text-gray-400" />
                  <p className="text-sm text-gray-500">All fields would remain the same with current rules. No changes detected.</p>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center justify-center py-8 text-gray-400">
              <p>Click a Replay button on a log entry to see the result here.</p>
            </div>
          )}

          {/* Original message reference */}
          {replayLog.original_message && replayLog.original_message !== replayLog.message && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
              <p className="text-[10px] font-medium text-blue-600 uppercase mb-1">Original (pre-translation) message</p>
              <p className="text-sm text-blue-800">{replayLog.original_message}</p>
            </div>
          )}
        </div>
      )}
    </Modal>
  </div>);
};

