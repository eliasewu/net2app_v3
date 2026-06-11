import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Edit, Trash2, Wifi, WifiOff, RefreshCw, TestTube, Phone, Globe, Server } from 'lucide-react';
import { useData } from '../../store/DataContext';
import { Card } from '../../components/UI/Card';
import { Button } from '../../components/UI/Button';
import { Badge } from '../../components/UI/Badge';
import { Input } from '../../components/UI/Input';
import { Modal } from '../../components/UI/Modal';

export const SupplierDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getSupplierById, updateSupplier, deleteSupplier, smsLogs, invoices } = useData();
  const supplier = id ? getSupplierById(id) : undefined;
  const [showTopup, setShowTopup] = useState(false);
  const [topupAmount, setTopupAmount] = useState(5000);
  const [activeTab, setActiveTab] = useState<'overview' | 'cdr' | 'usage' | 'payments'>('overview');
  const [testResult, setTestResult] = useState<{success:boolean;msg:string}|null>(null);

  if (!supplier) {
    return <div className="text-center py-12"><p className="text-gray-600 text-lg">Supplier not found</p><Button variant="secondary" onClick={() => navigate('/suppliers')} className="mt-4">Back to Suppliers</Button></div>;
  }

  const supplierSMS = smsLogs.filter(l => l.supplier_id === supplier.id);
  const supplierInvoices = invoices.filter(i => i.entity_id === supplier.id && i.entity_type === 'supplier');
  const supplierPayments = [{id:'1',amount:25000,date:'2024-02-15',method:'Bank Transfer',reference:'BT-901234',status:'completed'}];

  const handleTopup = () => {
    updateSupplier(supplier.id, { balance: (supplier.balance||0) + topupAmount });
    setShowTopup(false);
  };

  const handleTestConnection = async () => {
    setTestResult(null);
    await new Promise(r=>setTimeout(r,2000));
    const ok = Math.random() > 0.3;
    setTestResult({success:ok, msg:ok?'Connection successful! Latency: 145ms':'Connection failed: Host unreachable'});
  };

  const handleReconnect = () => {
    updateSupplier(supplier.id, { bind_status: 'binding', consecutive_failures: 0 });
    setTimeout(() => updateSupplier(supplier.id, { bind_status: 'bound' }), 2000);
  };

  const usageData = [{month:'Jan',sms:180000,cost:2700},{month:'Feb',sms:210000,cost:3150},{month:'Mar',sms:250000,cost:3750},{month:'Apr',sms:220000,cost:3300},{month:'May',sms:280000,cost:4200},{month:'Jun',sms:300000,cost:4500}];

  const connLabel: Record<string,string> = {smpp:'SMPP',http:'HTTP API',ott_whatsapp:'WhatsApp',ott_telegram:'Telegram',voice_otp:'Voice OTP',local_bypass:'Local Bypass',rcs:'RCS',flash_sms:'Flash SMS'};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-lg"><ArrowLeft size={20} className="text-gray-600" /></button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-800">{supplier.company_name}</h1>
              <Badge variant={supplier.status==='active'?'success':supplier.status==='suspended'?'danger':'warning'}>{supplier.status}</Badge>
            </div>
            <p className="text-gray-500">{supplier.supplier_code} • {connLabel[supplier.connection_type]||supplier.connection_type}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" icon={<Edit size={16}/>} onClick={()=>navigate(`/suppliers/${supplier.id}/edit`)}>Edit</Button>
          {supplier.bind_status==='bound'?<Button variant="secondary" icon={<WifiOff size={16}/>} onClick={()=>updateSupplier(supplier.id,{bind_status:'unbound'})}>Disconnect</Button>:<Button variant="success" icon={<RefreshCw size={16}/>} onClick={handleReconnect}>Reconnect</Button>}
          <Button variant="danger" icon={<Trash2 size={16}/>} onClick={()=>{if(window.confirm('Delete this supplier?')){deleteSupplier(supplier.id);navigate('/suppliers');}}}>Delete</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl p-5 text-white"><Wifi size={20} className="mb-2" /><p className="text-sm opacity-80">Bind Status</p><div className="flex items-center gap-2 mt-1">{supplier.bind_status==='bound'?<Wifi size={18}/>:<WifiOff size={18}/>}<Badge variant={supplier.bind_status==='bound'?'success':'danger'}>{supplier.bind_status}</Badge></div></div>
        <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-5 text-white"><Server size={20} className="mb-2" /><p className="text-sm opacity-80">Failures</p><p className={`text-2xl font-bold mt-1 ${supplier.consecutive_failures>10?'text-red-200':supplier.consecutive_failures>0?'text-yellow-200':'text-white'}`}>{supplier.consecutive_failures}{supplier.consecutive_failures>=20&&<span className="text-sm ml-2">⚠ BLOCKED</span>}</p></div>
        <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl p-5 text-white"><Phone size={20} className="mb-2" /><p className="text-sm opacity-80">Balance</p><p className="text-2xl font-bold">€{(supplier.balance||0).toLocaleString()}</p></div>
        <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-xl p-5 text-white"><Globe size={20} className="mb-2" /><p className="text-sm opacity-80">Credit Limit</p><p className="text-2xl font-bold">€{(supplier.credit_limit||0).toLocaleString()}</p></div>
        <div className="bg-white rounded-xl p-5 border border-gray-200"><p className="text-sm text-gray-500">Actions</p><Button size="sm" onClick={()=>setShowTopup(true)} className="mt-2 w-full">Top Up</Button><Button size="sm" variant="secondary" onClick={handleTestConnection} className="mt-2 w-full" icon={<TestTube size={14}/>}>Test</Button></div>
      </div>

      {testResult && <div className={`p-4 rounded-lg ${testResult.success?'bg-green-50 border border-green-200':'bg-red-50 border border-red-200'}`}><p className={`text-sm ${testResult.success?'text-green-700':'text-red-700'}`}>{testResult.msg}</p></div>}

      <div className="flex gap-2 border-b border-gray-200">
        {(['overview','cdr','usage','payments'] as const).map(tab=><button key={tab} onClick={()=>setActiveTab(tab)} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors capitalize ${activeTab===tab?'border-blue-600 text-blue-600':'border-transparent text-gray-500 hover:text-gray-700'}`}>{tab}</button>)}
      </div>

      {activeTab==='overview'&&<div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card title="Connection Details"><div className="grid grid-cols-2 gap-4 text-sm">
          <div><p className="text-gray-500">Connection Type</p><Badge variant="info">{connLabel[supplier.connection_type]||supplier.connection_type}</Badge></div>
          <div><p className="text-gray-500">Status</p><Badge variant={supplier.status==='active'?'success':'danger'} dot>{supplier.status}</Badge></div>
          {(supplier.connection_type==='smpp'||supplier.connection_type==='voice_otp')&&<><div><p className="text-gray-500">Host</p><p className="font-mono">{supplier.smpp_host||'N/A'}</p></div><div><p className="text-gray-500">Port</p><p>{supplier.smpp_port||'N/A'}</p></div><div><p className="text-gray-500">Username</p><p className="font-mono">{supplier.smpp_username||'N/A'}</p></div><div><p className="text-gray-500">System ID</p><p>{supplier.system_id||'N/A'}</p></div></>}
          {supplier.connection_type==='http'&&<><div><p className="text-gray-500">API URL</p><p className="text-xs font-mono">{supplier.api_url||'N/A'}</p></div><div><p className="text-gray-500">Method</p><p>{supplier.api_method||'POST'}</p></div></>}
          {supplier.connection_type==='ott_telegram'&&<div className="col-span-2"><p className="text-gray-500">Bot Token</p><p className="font-mono text-xs">{supplier.api_key?.slice(0,20)+'...'||'N/A'}</p></div>}
        </div></Card>
        <Card title="Contact Information"><div className="grid grid-cols-2 gap-4 text-sm">
          <div><p className="text-gray-500">Company</p><p className="font-medium">{supplier.company_name}</p></div>
          <div><p className="text-gray-500">Code</p><p className="font-mono">{supplier.supplier_code}</p></div>
          <div><p className="text-gray-500">Contact</p><p>{supplier.contact_person}</p></div>
          <div><p className="text-gray-500">Email</p><p>{supplier.email}</p></div>
          <div className="col-span-2"><p className="text-gray-500">Phone</p><p>{supplier.phone}</p></div>
        </div></Card>
        <Card title="Billing"><div className="space-y-3">
          <div className="flex justify-between p-3 bg-gray-50 rounded-lg"><span className="text-gray-600">Balance</span><span className="font-semibold">€{(supplier.balance||0).toLocaleString()}</span></div>
          <div className="flex justify-between p-3 bg-gray-50 rounded-lg"><span className="text-gray-600">Credit Limit</span><span className="font-semibold">€{(supplier.credit_limit||0).toLocaleString()}</span></div>
          <div className="flex justify-between p-3 bg-gray-50 rounded-lg"><span className="text-gray-600">Currency</span><Badge>{supplier.currency||'EUR'}</Badge></div>
        </div></Card>
        <Card title="Recent Invoices">{supplierInvoices.length===0?<p className="text-gray-500 text-sm">No invoices</p>:<div className="space-y-3">{supplierInvoices.slice(0,3).map(inv=><div key={inv.id} className="flex justify-between p-3 bg-gray-50 rounded-lg"><div><p className="font-medium">{inv.invoice_number}</p><p className="text-xs text-gray-500">{new Date(inv.period_start).toLocaleDateString()}</p></div><div className="text-right"><p className="font-semibold">€{inv.grand_total.toLocaleString()}</p><Badge variant={inv.status==='paid'?'success':inv.status==='overdue'?'danger':'warning'}>{inv.status}</Badge></div></div>)}</div>}</Card>
      </div>}

      {activeTab==='cdr'&&<Card title="CDR" noPadding><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="bg-gray-50 border-b"><th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Message ID</th><th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Destination</th><th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Status</th><th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Supplier Rate</th><th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Time</th></tr></thead><tbody className="divide-y">{supplierSMS.slice(0,20).map(sms=><tr key={sms.id} className="hover:bg-gray-50"><td className="px-4 py-3"><span className="font-mono text-xs">{sms.message_id.slice(0,12)}...</span></td><td className="px-4 py-3"><span className="font-mono text-xs">{sms.destination}</span></td><td className="px-4 py-3"><Badge variant={sms.status==='delivered'?'success':sms.status==='failed'?'danger':'warning'} size="sm">{sms.status}</Badge></td><td className="px-4 py-3">€{sms.supplier_rate.toFixed(4)}</td><td className="px-4 py-3 text-gray-500 text-xs">{new Date(sms.submit_time).toLocaleString()}</td></tr>)}</tbody></table></div></Card>}

      {activeTab==='usage'&&<Card title="Monthly Usage"><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="bg-gray-50"><th className="px-4 py-3 text-left font-medium text-gray-500">Month</th><th className="px-4 py-3 text-right font-medium text-gray-500">SMS</th><th className="px-4 py-3 text-right font-medium text-gray-500">Cost</th></tr></thead><tbody className="divide-y">{usageData.map((r,i)=><tr key={i}><td className="px-4 py-3 font-medium">{r.month}</td><td className="px-4 py-3 text-right">{r.sms.toLocaleString()}</td><td className="px-4 py-3 text-right font-semibold">€{r.cost.toLocaleString()}</td></tr>)}</tbody></table></div></Card>}

      {activeTab==='payments'&&<Card title="Payment History" noPadding><table className="w-full text-sm"><thead><tr className="bg-gray-50 border-b"><th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Reference</th><th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Method</th><th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Amount</th><th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Date</th><th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Status</th></tr></thead><tbody className="divide-y">{supplierPayments.map(p=><tr key={p.id}><td className="px-4 py-3 font-mono text-xs">{p.reference}</td><td className="px-4 py-3">{p.method}</td><td className="px-4 py-3 text-right font-semibold">€{p.amount.toLocaleString()}</td><td className="px-4 py-3">{p.date}</td><td className="px-4 py-3"><Badge variant="success">{p.status}</Badge></td></tr>)}</tbody></table></Card>}

      <Modal isOpen={showTopup} onClose={()=>setShowTopup(false)} title="Top Up Balance" footer={<div className="flex justify-end gap-3"><Button variant="secondary" onClick={()=>setShowTopup(false)}>Cancel</Button><Button onClick={handleTopup}>Confirm</Button></div>}>
        <div className="space-y-4"><div className="bg-blue-50 p-4 rounded-lg"><p className="text-sm text-blue-700">Current: <strong>€{(supplier.balance||0).toLocaleString()}</strong></p></div><Input label="Amount (EUR)" type="number" value={topupAmount} onChange={e=>setTopupAmount(Number(e.target.value))} min={1}/><div className="bg-green-50 p-4 rounded-lg"><p className="text-sm text-green-700">New: <strong>€{((supplier.balance||0)+topupAmount).toLocaleString()}</strong></p></div></div>
      </Modal>
    </div>
  );
};
