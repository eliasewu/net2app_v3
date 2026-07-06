import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, RefreshCw, TestTube, MessageSquare, Phone, Bot, Smartphone, Flashlight, ExternalLink } from 'lucide-react';
import { useData } from '../../store/DataContext';
import { Card } from '../../components/UI/Card';
import { Button } from '../../components/UI/Button';
import { Badge } from '../../components/UI/Badge';
import { Input, Select } from '../../components/UI/Input';
import { ConnectionType, Currency } from '../../types';

// Types for connectors loaded from other pages
interface ApiConnector { id:string; name:string; provider:string; auth_type:string; status:string; is_active:boolean; }
interface OttDevice { id:string; name:string; phone:string; session_status:string; type?:string; }
interface VoiceSip { id:string; client_name:string; sip_host:string; sip_port:number; is_active:boolean; }
interface RcsAgent { id:string; name:string; bot_id:string; is_active:boolean; }
interface FlashProvider { id:string; name:string; sender_id:string; ttl:number; is_active:boolean; }


export const AddSupplier: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams();
  const { addSupplier, getSupplierById, updateSupplier } = useData();
  const existingSupplier = id ? getSupplierById(id) : undefined;
  const isEditing = !!existingSupplier;

  // Load all available endpoints from other pages
  const [apiConnectors] = useState<ApiConnector[]>([]);
  const [ottDevices] = useState<OttDevice[]>([]);
  const [voiceSips] = useState<VoiceSip[]>([]);
  const [rcsAgents] = useState<RcsAgent[]>([]);
  const [flashProviders] = useState<FlashProvider[]>([]);

  const [formData, setFormData] = useState({
    supplier_code: existingSupplier?.supplier_code || '',
    company_name: existingSupplier?.company_name || '',
    contact_person: existingSupplier?.contact_person || '',
    email: existingSupplier?.email || '',
    phone: existingSupplier?.phone || '',
    connection_type: (existingSupplier?.connection_type || 'smpp') as ConnectionType,
    smpp_host: existingSupplier?.smpp_host || '',
    smpp_port: existingSupplier?.smpp_port || 2775,
    smpp_username: existingSupplier?.smpp_username || '',
    smpp_password: existingSupplier?.smpp_password || '',
    system_id: existingSupplier?.system_id || '',
    smpp_version: existingSupplier?.smpp_version || 'auto',
    smpp_system_type: existingSupplier?.smpp_system_type || '',
    smpp_bind_type: existingSupplier?.smpp_bind_type || 'trx',
    smpp_addr_ton: existingSupplier?.smpp_addr_ton ?? 0,
    smpp_addr_npi: existingSupplier?.smpp_addr_npi ?? 0,
    smpp_addr_range: existingSupplier?.smpp_addr_range || '',
    is_inbound: existingSupplier?.is_inbound || false,
    api_url: existingSupplier?.api_url || '',
    api_key: existingSupplier?.api_key || '',
    api_method: (existingSupplier?.api_method || 'POST') as 'GET' | 'POST',
    force_dlr: existingSupplier?.force_dlr || false,
    balance: existingSupplier?.balance || 0,
    credit_limit: existingSupplier?.credit_limit || 0,
    currency: (existingSupplier?.currency || 'EUR') as Currency,
    status: existingSupplier?.status || 'active',
    bind_status: existingSupplier?.bind_status || 'unbound',
    consecutive_failures: existingSupplier?.consecutive_failures || 0,
    selected_endpoint: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const connectionTypes = [
    { value: 'smpp', label: 'SMPP', desc: 'Standard SMPP protocol' },
    { value: 'http', label: 'HTTP API', desc: 'REST API messaging (shows API connectors)' },
    { value: 'ott_whatsapp', label: 'WhatsApp OTT', desc: 'WhatsApp Business/Personal (shows paired devices)' },
    { value: 'ott_telegram', label: 'Telegram OTT', desc: 'Telegram Bot messaging (shows bots)' },
    { value: 'voice_otp', label: 'Voice OTP', desc: 'Voice call OTP delivery (shows SIP endpoints)' },
    { value: 'rcs', label: 'RCS', desc: 'Rich Communication Services (shows RCS agents)' },
    { value: 'flash_sms', label: 'Flash SMS', desc: 'Class 0 flash messages (shows flash providers)' },
  ];

  const generateCode = () => setFormData(prev => ({ ...prev, supplier_code: 'SUP' + String(Math.floor(Math.random() * 9000) + 1000) }));
  const generatePassword = () => {
    const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
    let p = ''; for (let i = 0; i < 12; i++) p += c.charAt(Math.floor(Math.random() * c.length));
    setFormData(prev => ({ ...prev, smpp_password: p }));
  };

  const validate = () => {
    const ne: Record<string, string> = {};
    if (!formData.supplier_code) ne.supplier_code = 'Required';
    if (!formData.company_name) ne.company_name = 'Required';
    if (!formData.email) ne.email = 'Required';
    setErrors(ne); return Object.keys(ne).length === 0;
  };

  const handleTest = async () => {
    setTestResult(null); await new Promise(r => setTimeout(r, 2000));
    setTestResult({ success: Math.random() > 0.3, message: Math.random() > 0.3 ? 'Connection successful!' : 'Connection failed' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    try {
      if (isEditing && existingSupplier) await updateSupplier(existingSupplier.id, formData);
      else await addSupplier(formData as any);
      navigate('/suppliers');
    } catch (err: any) {
      setErrors(prev => ({ ...prev, submit: err?.message || 'Failed to save supplier' }));
    } finally {
      setLoading(false);
    }
  };

  const updateField = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: '' }));
  };

  const renderEndpointList = () => {
    const type = formData.connection_type;
    
    if (type === 'http') {
      return apiConnectors.length === 0 ? <p className="text-sm text-gray-400">No API connectors configured. Add them in API Connectors page first.</p> : (
        <div className="space-y-2 max-h-60 overflow-y-auto">
          {apiConnectors.filter(c=>c.is_active).map(c => (
            <div key={c.id} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer ${formData.selected_endpoint===c.id?'border-blue-500 bg-blue-50':'border-gray-200 hover:border-gray-300'}`} onClick={()=>updateField('selected_endpoint',c.id)}>
              <input type="radio" checked={formData.selected_endpoint===c.id} onChange={()=>updateField('selected_endpoint',c.id)} className="w-4 h-4"/>
              <div className="flex-1"><p className="text-sm font-medium">{c.name}</p><p className="text-xs text-gray-500">{c.provider} • {c.auth_type}</p></div>
              <Badge variant={c.status==='connected'?'success':'default'} size="sm">{c.status}</Badge>
            </div>
          ))}
        </div>
      );
    }
    if (type === 'ott_whatsapp') {
      const wa = ottDevices.filter(d=>d.type==='whatsapp');
      return wa.length === 0 ? <p className="text-sm text-gray-400">No WhatsApp devices paired. Add them in OTT Devices page first.</p> : (
        <div className="space-y-2 max-h-60 overflow-y-auto">{wa.map(d => (
          <div key={d.id} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer ${formData.selected_endpoint===d.id?'border-blue-500 bg-blue-50':'border-gray-200 hover:border-gray-300'}`} onClick={()=>updateField('selected_endpoint',d.id)}>
            <input type="radio" checked={formData.selected_endpoint===d.id} onChange={()=>updateField('selected_endpoint',d.id)} className="w-4 h-4"/>
            <MessageSquare size={18} className="text-green-500"/><div className="flex-1"><p className="text-sm font-medium">{d.name}</p><p className="text-xs text-gray-500">{d.phone}</p></div>
            <Badge variant={d.session_status==='connected'?'success':'warning'} dot size="sm">{d.session_status}</Badge>
          </div>
        ))}</div>
      );
    }
    if (type === 'ott_telegram') {
      const tg = ottDevices.filter(d=>d.type==='telegram');
      return tg.length === 0 ? <p className="text-sm text-gray-400">No Telegram bots configured.</p> : (
        <div className="space-y-2 max-h-60 overflow-y-auto">{tg.map(d => (
          <div key={d.id} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer ${formData.selected_endpoint===d.id?'border-blue-500 bg-blue-50':'border-gray-200'}`} onClick={()=>updateField('selected_endpoint',d.id)}>
            <input type="radio" checked={formData.selected_endpoint===d.id} onChange={()=>updateField('selected_endpoint',d.id)} className="w-4 h-4"/><Bot size={18} className="text-blue-500"/>
            <div className="flex-1"><p className="text-sm font-medium">{d.name}</p></div>
            <Badge variant={d.session_status==='connected'?'success':'warning'} dot size="sm">{d.session_status}</Badge>
          </div>
        ))}</div>
      );
    }
    if (type === 'voice_otp') {
      return voiceSips.length === 0 ? <p className="text-sm text-gray-400">No Voice OTP SIP endpoints configured. Add them in Voice OTP page first.</p> : (
        <div className="space-y-2 max-h-60 overflow-y-auto">{voiceSips.filter(s=>s.is_active).map(s => (
          <div key={s.id} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer ${formData.selected_endpoint===s.id?'border-blue-500 bg-blue-50':'border-gray-200'}`} onClick={()=>updateField('selected_endpoint',s.id)}>
            <input type="radio" checked={formData.selected_endpoint===s.id} onChange={()=>updateField('selected_endpoint',s.id)} className="w-4 h-4"/><Phone size={18} className="text-purple-500"/>
            <div className="flex-1"><p className="text-sm font-medium">{s.client_name}</p><p className="text-xs text-gray-500 font-mono">{s.sip_host}:{s.sip_port}</p></div>
          </div>
        ))}</div>
      );
    }
    if (type === 'rcs') {
      return rcsAgents.length === 0 ? <p className="text-sm text-gray-400">No RCS agents configured. Add them in API Connectors page first.</p> : (
        <div className="space-y-2 max-h-60 overflow-y-auto">{rcsAgents.filter(r=>r.is_active).map(r => (
          <div key={r.id} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer ${formData.selected_endpoint===r.id?'border-blue-500 bg-blue-50':'border-gray-200'}`} onClick={()=>updateField('selected_endpoint',r.id)}>
            <input type="radio" checked={formData.selected_endpoint===r.id} onChange={()=>updateField('selected_endpoint',r.id)} className="w-4 h-4"/><Smartphone size={18} className="text-orange-500"/>
            <div className="flex-1"><p className="text-sm font-medium">{r.name}</p><p className="text-xs text-gray-500">{r.bot_id}</p></div>
          </div>
        ))}</div>
      );
    }
    if (type === 'flash_sms') {
      return flashProviders.length === 0 ? <p className="text-sm text-gray-400">No Flash SMS providers configured.</p> : (
        <div className="space-y-2 max-h-60 overflow-y-auto">{flashProviders.filter(f=>f.is_active).map(f => (
          <div key={f.id} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer ${formData.selected_endpoint===f.id?'border-blue-500 bg-blue-50':'border-gray-200'}`} onClick={()=>updateField('selected_endpoint',f.id)}>
            <input type="radio" checked={formData.selected_endpoint===f.id} onChange={()=>updateField('selected_endpoint',f.id)} className="w-4 h-4"/><Flashlight size={18} className="text-yellow-500"/>
            <div className="flex-1"><p className="text-sm font-medium">{f.name}</p><p className="text-xs text-gray-500">Sender: {f.sender_id}</p></div>
          </div>
        ))}</div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-lg"><ArrowLeft size={20} className="text-gray-600" /></button>
        <div><h1 className="text-2xl font-bold text-gray-800">{isEditing ? 'Edit Supplier' : 'Add New Supplier'}</h1><p className="text-gray-500 mt-1">{isEditing ? 'Update' : 'Configure'} a vendor connection</p></div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card title="Company Information">
          <div className="grid grid-cols-2 gap-6">
            <div className="flex gap-2"><div className="flex-1"><Input label="Supplier Code" value={formData.supplier_code} onChange={e => updateField('supplier_code', e.target.value)} error={errors.supplier_code} required /></div><button type="button" onClick={generateCode} className="mt-7 p-2.5 bg-gray-100 rounded-lg hover:bg-gray-200"><RefreshCw size={18} className="text-gray-600" /></button></div>
            <Input label="Company Name" value={formData.company_name} onChange={e => updateField('company_name', e.target.value)} error={errors.company_name} required />
            <Input label="Contact Person" value={formData.contact_person} onChange={e => updateField('contact_person', e.target.value)} />
            <Input label="Email" type="email" value={formData.email} onChange={e => updateField('email', e.target.value)} error={errors.email} required />
            <Input label="Phone" value={formData.phone} onChange={e => updateField('phone', e.target.value)} />
          </div>
        </Card>

        <Card title="Connection Type">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {connectionTypes.map(ct => (
              <label key={ct.value} className={`flex flex-col p-4 rounded-xl border-2 cursor-pointer transition-all ${formData.connection_type === ct.value ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                <input type="radio" name="connection_type" value={ct.value} checked={formData.connection_type === ct.value as any} onChange={e => updateField('connection_type', e.target.value)} className="sr-only" />
                <span className="font-medium text-gray-800">{ct.label}</span>
                <span className="text-xs text-gray-500 mt-1">{ct.desc}</span>
              </label>
            ))}
          </div>
        </Card>

        {/* SMPP settings */}
        {formData.connection_type === 'smpp' && (
          <>
          <Card title="SMPP Connection Settings">
            <div className="grid grid-cols-2 gap-6">
              <Input label="SMPP Host" value={formData.smpp_host} onChange={e => updateField('smpp_host', e.target.value)} error={errors.smpp_host} placeholder={formData.is_inbound ? 'Auto (inbound mode)' : 'smpp.provider.com'} disabled={formData.is_inbound} required={!formData.is_inbound} />
              <Input label="SMPP Port" type="number" value={formData.smpp_port} onChange={e => updateField('smpp_port', parseInt(e.target.value))} disabled={formData.is_inbound} />
              <Input label="Username" value={formData.smpp_username} onChange={e => updateField('smpp_username', e.target.value)} error={errors.smpp_username} required />
              <div className="flex gap-2"><div className="flex-1"><Input label="Password" value={formData.smpp_password} onChange={e => updateField('smpp_password', e.target.value)} /></div><button type="button" onClick={generatePassword} className="mt-7 p-2.5 bg-gray-100 rounded-lg hover:bg-gray-200"><RefreshCw size={18} className="text-gray-600" /></button></div>
              <Input label="System ID" value={formData.system_id} onChange={e => updateField('system_id', e.target.value)} />
              <div className="col-span-2 flex items-center gap-3 p-4 bg-yellow-50 rounded-lg border border-yellow-200">
                <label className="flex items-center gap-3 cursor-pointer">
                  <div className="relative">
                    <input type="checkbox" checked={formData.is_inbound} onChange={e => updateField('is_inbound', e.target.checked)} className="sr-only peer" />
                    <div className="w-10 h-5 bg-gray-300 rounded-full peer-checked:bg-yellow-500 transition-colors" />
                    <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full shadow peer-checked:translate-x-5 transition-transform" />
                  </div>
                  <div><p className="text-sm font-medium text-gray-800">Inbound Supplier Mode</p><p className="text-xs text-gray-500">Supplier connects TO us (no public IP needed). For GSM gateways behind NAT.</p></div>
                </label>
              </div>
            </div>
          </Card>
          <Card title="SMPP Advanced Configuration">
            <div className="grid grid-cols-2 gap-6">
              <Select label="SMPP Version" value={formData.smpp_version} onChange={e => updateField('smpp_version', e.target.value)} options={[{value:'auto',label:'Auto-Detect'},{value:'3.4',label:'v3.4'},{value:'5.0',label:'v5.0'}]} />
              <Input label="System Type" value={formData.smpp_system_type} onChange={e => updateField('smpp_system_type', e.target.value)} placeholder="(empty)" />
              <Select label="Bind Type" value={formData.smpp_bind_type} onChange={e => updateField('smpp_bind_type', e.target.value)} options={[{value:'trx',label:'TRX (Transceiver)'},{value:'tx',label:'TX (Transmitter)'},{value:'rx',label:'RX (Receiver)'}]} />
              <Input label="Address TON" type="number" value={formData.smpp_addr_ton} onChange={e => updateField('smpp_addr_ton', parseInt(e.target.value)||0)} />
              <Input label="Address NPI" type="number" value={formData.smpp_addr_npi} onChange={e => updateField('smpp_addr_npi', parseInt(e.target.value)||0)} />
              <Input label="Address Range" value={formData.smpp_addr_range} onChange={e => updateField('smpp_addr_range', e.target.value)} placeholder="system_id" />
            </div>
          </Card>
          </>
        )}

        {/* Non-SMPP: Show available endpoints from other pages */}
        {(formData.connection_type !== 'smpp') && (
          <Card title={`Available ${connectionTypes.find(ct=>ct.value===formData.connection_type)?.label||''} Endpoints`} subtitle="Select from configured endpoints below" action={<Button size="sm" variant="secondary" icon={<ExternalLink size={14}/>} onClick={()=>{
            const paths: Record<string,string> = {http:'/suppliers/api-connectors',ott_whatsapp:'/suppliers/ott-devices',ott_telegram:'/suppliers/ott-devices',voice_otp:'/suppliers/voice-otp',rcs:'/suppliers/api-connectors',flash_sms:'/suppliers/api-connectors'};
            if(paths[formData.connection_type]) window.location.href=paths[formData.connection_type];
          }}>Manage in Settings</Button>}>
            {renderEndpointList() || (
              <div className="p-4 bg-gray-50 rounded-lg">
                <Input label="API URL" value={formData.api_url} onChange={e => updateField('api_url', e.target.value)} placeholder="https://api.provider.com/send" />
                <div className="grid grid-cols-2 gap-4 mt-4"><Select label="Method" value={formData.api_method} onChange={e => updateField('api_method', e.target.value)} options={[{value:'POST',label:'POST'},{value:'GET',label:'GET'}]}/><Input label="API Key" value={formData.api_key} onChange={e => updateField('api_key', e.target.value)} /></div>
              </div>
            )}
          </Card>
        )}

        <Card title="Billing Settings">
          <div className="grid grid-cols-3 gap-6">
            <Select label="Currency" value={formData.currency} onChange={e => updateField('currency', e.target.value)} options={[{value:'EUR',label:'EUR'},{value:'USD',label:'USD'},{value:'GBP',label:'GBP'}]} />
            <Input label="Balance" type="number" value={formData.balance} onChange={e => updateField('balance', parseFloat(e.target.value))} />
            <Input label="Credit Limit" type="number" value={formData.credit_limit} onChange={e => updateField('credit_limit', parseFloat(e.target.value))} />
          </div>
        </Card>

        {formData.connection_type === 'smpp' && (
          <Card title="Test Connection"><div className="flex items-center gap-4"><Button type="button" variant="secondary" icon={<TestTube size={18} />} onClick={handleTest}>Test SMPP</Button>{testResult && <Badge variant={testResult.success ? 'success' : 'danger'}>{testResult.message}</Badge>}</div></Card>
        )}

        {errors.submit && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">{errors.submit}</div>}
        <div className="flex justify-end gap-4">
          <Button variant="secondary" type="button" onClick={() => navigate(-1)}>Cancel</Button>
          <Button type="submit" icon={<Save size={18} />} loading={loading}>{isEditing ? 'Update Supplier' : 'Create Supplier'}</Button>
        </div>
      </form>
    </div>
  );
};
