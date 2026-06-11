import React, { useState } from 'react';
import { Search, Inbox, RefreshCw, Eye, Phone, Clock, MessageSquare, Download } from 'lucide-react';
import { Card } from '../components/UI/Card';
import { Button } from '../components/UI/Button';
import { Badge } from '../components/UI/Badge';
import { Table, Pagination } from '../components/UI/Table';
import { Modal } from '../components/UI/Modal';

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
}

// MO SMS inbox - incoming messages from clients/suppliers
const mockMO: MOSMS[] = [
  { id:'1', from:'+1234567890', to:'NET2APP', message:'STOP', received_at:'2024-06-10T14:30:00Z', mcc:'310', mnc:'260', country:'United States', keyword:'STOP', processed:true, reply_sent:true },
  { id:'2', from:'+1987654321', to:'TECHCORP', message:'HELP', received_at:'2024-06-10T14:25:00Z', mcc:'310', mnc:'410', country:'United States', keyword:'HELP', processed:true, reply_sent:true },
  { id:'3', from:'+447900123456', to:'MEGABANK', message:'Yes, I confirm', received_at:'2024-06-10T14:20:00Z', mcc:'234', mnc:'10', country:'UK', processed:false, reply_sent:false },
  { id:'4', from:'+491761234567', to:'APP', message:'Please send details', received_at:'2024-06-10T14:15:00Z', mcc:'262', mnc:'01', country:'Germany', processed:false, reply_sent:false },
  { id:'5', from:'+33612345678', to:'NET2APP', message:'OK', received_at:'2024-06-10T14:10:00Z', mcc:'208', mnc:'01', country:'France', keyword:'OK', processed:true, reply_sent:false },
  { id:'6', from:'+917012345678', to:'SMSHUB', message:'Where is my order?', received_at:'2024-06-10T14:05:00Z', mcc:'404', mnc:'10', country:'India', processed:false, reply_sent:false },
  { id:'7', from:'+8801712345678', to:'INFO', message:'Call me', received_at:'2024-06-10T14:00:00Z', mcc:'470', mnc:'01', country:'Bangladesh', processed:false, reply_sent:false },
];

export const SMSInbox: React.FC = () => {
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [viewModal, setViewModal] = useState<MOSMS | null>(null);
  const [moSMS, setMoSMS] = useState<MOSMS[]>(mockMO);
  const [replyText, setReplyText] = useState('');

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

  const columns = [
    { key:'from', header:'From', render:(m:MOSMS)=><div className="flex items-center gap-2"><Phone size={14} className="text-gray-400"/><span className="font-mono text-sm">{m.from}</span></div> },
    { key:'to', header:'To', render:(m:MOSMS)=><Badge variant="info">{m.to}</Badge> },
    { key:'message', header:'Message', render:(m:MOSMS)=><span className="text-sm text-gray-700 line-clamp-1 block max-w-[250px]">{m.message}</span> },
    { key:'country', header:'Country', render:(m:MOSMS)=><span className="text-xs">{m.country} ({m.mcc}{m.mnc})</span> },
    { key:'time', header:'Received', render:(m:MOSMS)=><span className="text-xs text-gray-500">{new Date(m.received_at).toLocaleString()}</span> },
    { key:'keyword', header:'Keyword', render:(m:MOSMS)=>m.keyword ? <Badge variant="purple" size="sm">{m.keyword}</Badge> : <span className="text-xs text-gray-400">-</span> },
    { key:'status', header:'Status', render:(m:MOSMS)=><div className="flex gap-1">{!m.processed&&<Badge variant="warning" size="sm">New</Badge>}{m.reply_sent&&<Badge variant="success" size="sm">Replied</Badge>}</div> },
    { key:'actions', header:'', render:(m:MOSMS)=><button onClick={()=>setViewModal(m)} className="p-1.5 rounded hover:bg-gray-100"><Eye size={14} className="text-gray-500"/></button> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div><h1 className="text-2xl font-bold text-gray-800">SMS Inbox (MO)</h1><p className="text-gray-500 mt-1">Mobile Originated messages - incoming SMS. Two-way SMS will be available in future.</p></div>
        <div className="flex gap-2"><Button variant="secondary" icon={<RefreshCw size={16}/>}>Refresh</Button><Button variant="secondary" icon={<Download size={16}/>}>Export</Button></div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-4 border"><Inbox size={20} className="text-blue-500 mb-1"/><p className="text-2xl font-bold">{moSMS.length}</p><p className="text-sm text-gray-500">Total MO</p></div>
        <div className="bg-white rounded-xl p-4 border"><MessageSquare size={20} className="text-green-500 mb-1"/><p className="text-2xl font-bold">{moSMS.filter(m=>m.reply_sent).length}</p><p className="text-sm text-gray-500">Replied</p></div>
        <div className="bg-white rounded-xl p-4 border"><Clock size={20} className="text-yellow-500 mb-1"/><p className="text-2xl font-bold">{moSMS.filter(m=>!m.processed).length}</p><p className="text-sm text-gray-500">Unread</p></div>
        <div className="bg-white rounded-xl p-4 border"><Download size={20} className="text-purple-500 mb-1"/><p className="text-2xl font-bold">Future</p><p className="text-sm text-gray-500">2-Way SMS</p></div>
      </div>

      <Card><div className="relative"><Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/><input type="text" placeholder="Search MO messages by number, keyword..." value={search} onChange={e=>setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/></div></Card>

      <Card noPadding><Table columns={columns} data={paginated} keyExtractor={m=>m.id}/><Pagination currentPage={currentPage} totalPages={totalPages} onPageChange={setCurrentPage} totalItems={filtered.length} itemsPerPage={itemsPerPage}/></Card>

      <Modal isOpen={!!viewModal} onClose={()=>setViewModal(null)} title="MO Message Details" footer={viewModal && !viewModal.reply_sent ? <div className="flex gap-3 w-full"><input type="text" value={replyText} onChange={e=>setReplyText(e.target.value)} placeholder="Type reply..." className="flex-1 px-3 py-2 border rounded-lg text-sm"/><Button onClick={()=>handleReply(viewModal!)} icon={<MessageSquare size={14}/>}>Send Reply</Button></div> : undefined}>
        {viewModal && <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4 text-sm"><div><p className="text-gray-500">From</p><p className="font-mono font-medium">{viewModal.from}</p></div><div><p className="text-gray-500">To (Short Code)</p><p className="font-medium">{viewModal.to}</p></div><div><p className="text-gray-500">Country</p><p>{viewModal.country} ({viewModal.mcc}{viewModal.mnc})</p></div><div><p className="text-gray-500">Received</p><p>{new Date(viewModal.received_at).toLocaleString()}</p></div></div>
          <div className="bg-gray-50 p-4 rounded-lg"><p className="text-xs text-gray-500 mb-1">Message</p><p className="text-gray-800">{viewModal.message}</p></div>
          <div className="flex gap-2">{viewModal.keyword && <Badge variant="purple">Keyword: {viewModal.keyword}</Badge>}<Badge variant={viewModal.processed?'success':'warning'}>{viewModal.processed?'Processed':'Pending'}</Badge><Badge variant={viewModal.reply_sent?'success':'default'}>{viewModal.reply_sent?'Reply Sent':'No Reply'}</Badge></div>
        </div>}
      </Modal>
    </div>
  );
};
