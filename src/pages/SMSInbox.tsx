import React, { useState, useEffect, useCallback } from 'react';
import { Search, Inbox, RefreshCw, Eye, Phone, Clock, MessageSquare, Download, UserPlus, XCircle } from 'lucide-react';
import { Card } from '../components/UI/Card';
import { Button } from '../components/UI/Button';
import { Badge } from '../components/UI/Badge';
import { Table, Pagination } from '../components/UI/Table';
import { Modal } from '../components/UI/Modal';
import { InboundTrafficWidget } from '../components/Dashboard/InboundTrafficWidget';
import { ErrorBoundary } from '../components/UI/ErrorBoundary';
import { smsApi } from '../services/api';
import { useData } from '../store/DataContext';

interface MOSMS {
  id: string;
  from: string;
  to: string;
  message: string;
  received_at: string;
  mcc: string;
  mnc: string;
  country: string;
  keyword?: string;
  processed: boolean;
  reply_sent: boolean;
  notes?: string;
  client_code?: string | null;
  client_id?: number | null;
  source?: string;
}

// MO SMS inbox — real data from sms_logs. Includes both classic SMPP MO
// receipts (source='smpp_mo') and Android gateway MO messages
// (source='android_gateway_mo') from Net2appPro devices.
export const SMSInbox: React.FC = () => {
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [viewModal, setViewModal] = useState<MOSMS | null>(null);
  const [moSMS, setMoSMS] = useState<MOSMS[]>([]);
  const [replyText, setReplyText] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assignModal, setAssignModal] = useState<MOSMS | null>(null);
  const [assignClientId, setAssignClientId] = useState<string>('');
  const [assignSaving, setAssignSaving] = useState(false);
  const { clients } = useData();

  const fetchMoMessages = useCallback(async () => {
    setError(null);
    try {
      const res: any = await smsApi.getLogs({ source: 'smpp_mo,android_gateway_mo', limit: 200, offset: 0 });
      if (res.success && res.data) {
        const rows = res.data.data || res.data.rows || res.data || [];
        const mapped: MOSMS[] = rows.map((r: any) => ({
          id: String(r.id || r.message_id),
          from: r.sender_id || '',
          to: r.supplier_code || r.destination || '',
          message: r.message || '',
          received_at: r.submit_time || r.created_at || '',
          mcc: r.mcc || '',
          mnc: r.mnc || '',
          country: r.country || '',
          // 'received' = not yet processed; anything else (assigned/replied/forwarded) counts as processed
          processed: r.status !== 'received',
          reply_sent: false,
          client_code: r.client_code || null,
          client_id: r.client_id || null,
          source: r.source || '',
        }));
        setMoSMS(mapped);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to fetch MO messages');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMoMessages();
    const interval = setInterval(fetchMoMessages, 30000); // auto-refresh every 30s
    return () => clearInterval(interval);
  }, [fetchMoMessages]);

  const itemsPerPage = 15;
  const filtered = moSMS.filter(m => m.from.includes(search) || m.to.toLowerCase().includes(search.toLowerCase()) || m.message.toLowerCase().includes(search.toLowerCase()));
  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const paginated = filtered.slice((currentPage-1)*itemsPerPage, currentPage*itemsPerPage);

  const handleReply = (sms: MOSMS) => {
    if (!replyText) return;
    setMoSMS(prev => prev.map(m => m.id === sms.id ? { ...m, reply_sent: true, processed: true } : m));
    setReplyText('');
    setViewModal(null);
    alert(`Reply sent to ${sms.from}: "${replyText}"`);
  };

  // Optional manual assignment — link an MO message to a client (null to unassign)
  const openAssign = (sms: MOSMS) => {
    setAssignClientId(sms.client_id ? String(sms.client_id) : '');
    setAssignModal(sms);
  };

  const handleAssign = async () => {
    if (!assignModal) return;
    setAssignSaving(true);
    try {
      const clientId = assignClientId ? parseInt(assignClientId, 10) : null;
      const res: any = await smsApi.assignMo(assignModal.id, clientId);
      if (!res.success) throw new Error(res.error || 'Assign failed');
      const updated = res.data?.data || res.data;
      setMoSMS(prev => prev.map(m => m.id === assignModal.id
        ? { ...m, client_id: updated?.client_id ?? clientId, client_code: updated?.client_code ?? (clients.find(c => String(c.id) === assignClientId)?.client_code ?? null) }
        : m));
      setAssignModal(null);
    } catch (e: any) {
      alert('Failed to assign: ' + (e?.message || e));
    } finally {
      setAssignSaving(false);
    }
  };

  const columns = [
    { key:'from', header:'From', render:(m:MOSMS)=><div className="flex items-center gap-2"><Phone size={14} className="text-gray-400"/><span className="font-mono text-sm">{m.from}</span></div> },
    { key:'to', header:'To', render:(m:MOSMS)=><Badge variant="info">{m.to}</Badge> },
    { key:'message', header:'Message', render:(m:MOSMS)=><span className="text-sm text-gray-700 line-clamp-1 block max-w-[250px]">{m.message}</span> },
    { key:'country', header:'Country', render:(m:MOSMS)=><span className="text-xs">{m.country} ({m.mcc}{m.mnc})</span> },
    { key:'time', header:'Received', render:(m:MOSMS)=><span className="text-xs text-gray-500">{new Date(m.received_at).toLocaleString()}</span> },
    { key:'keyword', header:'Keyword', render:(m:MOSMS)=>m.keyword ? <Badge variant="purple" size="sm">{m.keyword}</Badge> : <span className="text-xs text-gray-400">-</span> },
    { key:'client', header:'Client', render:(m:MOSMS)=>m.client_code
      ? <Badge variant="success" size="sm">{m.client_code}</Badge>
      : <button onClick={()=>openAssign(m)} className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md" title="Assign to client (optional)"><UserPlus size={12}/> Assign</button> },
    { key:'status', header:'Status', render:(m:MOSMS)=><div className="flex gap-1">{!m.processed&&<Badge variant="warning" size="sm">New</Badge>}{m.reply_sent&&<Badge variant="success" size="sm">Replied</Badge>}</div> },
    { key:'actions', header:'', render:(m:MOSMS)=><button onClick={()=>setViewModal(m)} className="p-1.5 rounded hover:bg-gray-100"><Eye size={14} className="text-gray-500"/></button> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-gray-800">SMS Inbox (MO)</h1><p className="text-gray-500 mt-1">Mobile Originated messages — incoming SMS from GSM gateways</p></div>
        <div className="flex gap-2">
          <Button variant="secondary" icon={<RefreshCw size={16} />} onClick={fetchMoMessages} disabled={loading}>Refresh</Button>
          <Button variant="secondary" icon={<Download size={16} />}>Export</Button>
        </div>
      </div>

      {/* Inbound Traffic Widget — real-time MO stats from GSM gateways */}
      <ErrorBoundary>
        <InboundTrafficWidget />
      </ErrorBoundary>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">{error}</div>
      )}

      {/* Stats cards from real data */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-4 border"><Inbox size={20} className="text-blue-500 mb-1"/><p className="text-2xl font-bold">{loading ? '...' : moSMS.length}</p><p className="text-sm text-gray-500">Total MO</p></div>
        <div className="bg-white rounded-xl p-4 border"><Clock size={20} className="text-yellow-500 mb-1"/><p className="text-2xl font-bold">{loading ? '...' : moSMS.filter(m=>!m.processed).length}</p><p className="text-sm text-gray-500">Unread</p></div>
        <div className="bg-white rounded-xl p-4 border"><MessageSquare size={20} className="text-green-500 mb-1"/><p className="text-2xl font-bold">{loading ? '...' : moSMS.filter(m=>m.reply_sent).length}</p><p className="text-sm text-gray-500">Replied</p></div>
        <div className="bg-white rounded-xl p-4 border"><Download size={20} className="text-purple-500 mb-1"/><p className="text-2xl font-bold">{loading ? '...' : '—'}</p><p className="text-sm text-gray-500">2-Way SMS (Future)</p></div>
      </div>

      <Card><div className="relative"><Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/><input type="text" placeholder="Search MO messages by number, keyword..." value={search} onChange={e=>setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/></div></Card>

      <Card noPadding><Table columns={columns} data={paginated} keyExtractor={m=>m.id}/><Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} totalItems={filtered.length} itemsPerPage={itemsPerPage}/></Card>

      <Modal isOpen={!!viewModal} onClose={()=>setViewModal(null)} title="MO Message Details" footer={viewModal && !viewModal.reply_sent ? <div className="flex gap-3 w-full"><input type="text" value={replyText} onChange={e=>setReplyText(e.target.value)} placeholder="Type reply..." className="flex-1 px-3 py-2 border rounded-lg text-sm"/><Button onClick={()=>handleReply(viewModal!)} icon={<MessageSquare size={14}/>}>Send Reply</Button></div> : undefined}>
        {viewModal && <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm"><div><p className="text-gray-500">From</p><p className="font-mono font-medium">{viewModal.from}</p></div><div><p className="text-gray-500">To (Short Code)</p><p className="font-medium">{viewModal.to}</p></div><div><p className="text-gray-500">Country</p><p>{viewModal.country} ({viewModal.mcc}{viewModal.mnc})</p></div><div><p className="text-gray-500">Received</p><p>{new Date(viewModal.received_at).toLocaleString()}</p></div></div>
          <div className="bg-gray-50 p-4 rounded-lg"><p className="text-xs text-gray-500 mb-1">Message</p><p className="text-gray-800">{viewModal.message}</p></div>
          <div className="flex flex-wrap items-center gap-2">{viewModal.keyword && <Badge variant="purple">Keyword: {viewModal.keyword}</Badge>}<Badge variant={viewModal.processed?'success':'warning'}>{viewModal.processed?'Processed':'Pending'}</Badge><Badge variant={viewModal.reply_sent?'success':'default'}>{viewModal.reply_sent?'Reply Sent':'No Reply'}</Badge>
            {viewModal.client_code
              ? <span className="inline-flex items-center gap-1"><Badge variant="success">Client: {viewModal.client_code}</Badge><button onClick={()=>openAssign(viewModal)} className="text-xs text-gray-400 hover:text-gray-600" title="Change">✎</button></span>
              : <button onClick={()=>openAssign(viewModal)} className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md"><UserPlus size={12}/> Assign to client</button>}
          </div>
        </div>}
      </Modal>

      {/* Assign-to-client modal (optional manual linking) */}
      <Modal
        isOpen={!!assignModal}
        onClose={()=>setAssignModal(null)}
        title="Assign MO Message to Client"
        footer={
          <div className="flex justify-end gap-3 w-full">
            <Button variant="secondary" onClick={()=>setAssignModal(null)}>Cancel</Button>
            {assignModal?.client_id && (
              <Button variant="danger" icon={<XCircle size={14}/>} onClick={async () => { setAssignSaving(true); try { await smsApi.assignMo(assignModal.id, null); setMoSMS(prev => prev.map(m => m.id === assignModal.id ? { ...m, client_id: null, client_code: null } : m)); setAssignModal(null); } catch (e: any) { alert('Failed to unassign: ' + (e?.message || e)); } finally { setAssignSaving(false); } }}>Unassign</Button>
            )}
            <Button loading={assignSaving} onClick={handleAssign}>Assign</Button>
          </div>
        }
      >
        {assignModal && (
          <div className="space-y-4">
            <div className="text-sm text-gray-600">
              <p><span className="text-gray-400">From:</span> <span className="font-mono">{assignModal.from}</span></p>
              <p className="mt-1"><span className="text-gray-400">Message:</span> <span className="line-clamp-2">{assignModal.message}</span></p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Client (optional)</label>
              <select
                value={assignClientId}
                onChange={e=>setAssignClientId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              >
                <option value="">— Unassigned —</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.client_code} — {c.company_name || c.contact_person || c.id}</option>)}
              </select>
              <p className="text-xs text-gray-400 mt-2">Assigning links this incoming SMS to the client for reporting and replies. You can leave it unassigned.</p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
