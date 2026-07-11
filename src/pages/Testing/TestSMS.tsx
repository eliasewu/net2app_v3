import React, { useState } from 'react';
import { Send } from 'lucide-react';
import { useData } from '../../store/DataContext';
import { api, smsApi } from '../../services/api';
import { Card } from '../../components/UI/Card';
import { Button } from '../../components/UI/Button';
import { Input, Select, Textarea } from '../../components/UI/Input';
import { Badge } from '../../components/UI/Badge';

interface TestResult {
  id: string;
  destination: string; sender_id: string; message: string;
  status: 'pending' | 'validating' | 'sent' | 'delivered' | 'failed' | 'rejected';
  timestamp: string; message_id?: string; error?: string; route?: string;
  supplier?: string; latency?: number;
  validation?: { authentication?: string; balance?: string; credit?: string; rate?: string; mccmnc?: string; profit?: string; channel?: string; numberCheck?: string; };
  client_rate?: number; supplier_rate?: number; profit?: number; currency?: string;
  billing_mode?: string; charge_status?: string; dlr_status?: string; channel_type?: string;
}

export const TestSMS: React.FC = () => {
  const { clients, routePlans, rates, mccmnc, suppliers } = useData();
  const [formData, setFormData] = useState({
    client_id: '',
    supplier_id: '',
    destination: '',
    sender_id: '',
    message: 'This is a test message from NET2APP Hub. Your OTP is: 123456',
    route_plan_id: '',
    currency: 'EUR' as const,
  });

  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<TestResult[]>([]);
  const [validationLog, setValidationLog] = useState<string[]>([]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setValidationLog([]);
    
    const newResult: TestResult = {
      id: Date.now().toString(),
      destination: formData.destination,
      sender_id: formData.sender_id,
      message: formData.message,
      status: 'validating',
      timestamp: new Date().toISOString(),
      validation: {},
    };
    setResults(prev => [newResult, ...prev]);

    // Step 1: Authentication Check
    const client = clients.find(c => c.id === formData.client_id);
    const authValid = !!client && client.status === 'active';
    const authMsg = authValid ? '✅ Authenticated' : '❌ Authentication failed';
    setValidationLog(prev => [...prev, `[Auth] ${authMsg}`]);
    newResult.validation!.authentication = authMsg;
    
    if (!authValid) {
      setResults(prev => prev.map(r => r.id === newResult.id ? { ...r, status: 'rejected' as const, error: 'Authentication failed - client not found or inactive' } : r));
      setLoading(false); return;
    }

    // Step 2: Supplier Check (if selected)
    if (formData.supplier_id) {
      const supplier = suppliers.find(s => s.id === formData.supplier_id);
      if (supplier) {
        const suppStatus = supplier.bind_status === 'bound' ? '✅ Bound' : '⚠ Unbound';
        setValidationLog(prev => [...prev, `[Supplier] ${suppStatus} | ${supplier.supplier_code} (${supplier.company_name}) | Type: ${supplier.connection_type}`]);
      }
    }

    // Step 3: Route Plan Check
    const rp = routePlans.find(p => p.id === formData.route_plan_id);
    if (!rp) {
      setValidationLog(prev => [...prev, '[Route Plan] ❌ Route plan is mandatory']);
      setResults(prev => prev.map(r => r.id === newResult.id ? { ...r, status: 'rejected' as const, error: 'Route plan is mandatory for SMS sending' } : r));
      setLoading(false); return;
    }
    setValidationLog(prev => [...prev, `[Route Plan] ✅ Selected: ${rp.plan_name}`]);

    // Step 4: MCCMNC Lookup
    const destMCC = mccmnc.find(m => formData.destination.startsWith('+' + m.mcc));
    const mccmncValid = !!destMCC;
    setValidationLog(prev => [...prev, `[MCCMNC] ${mccmncValid ? `✅ Found: ${destMCC!.country} (${destMCC!.mcc}${destMCC!.mnc})` : '⚠ Using default route'}`]);
    newResult.validation!.mccmnc = mccmncValid ? `✅ ${destMCC!.country}` : '⚠ Default';

    // Step 5: Rate Validation
    const clientRate = rates.find(r => r.entity_type === 'client' && r.entity_id === formData.client_id && r.is_active);
    const supplierRate = rates.find(r => r.entity_type === 'supplier' && r.is_active && (formData.supplier_id ? r.entity_id === formData.supplier_id : true));
    const clientRateVal = clientRate?.rate || 0.025;
    const supplierRateVal = supplierRate?.rate || 0.015;
    const profit = clientRateVal - supplierRateVal;
    newResult.client_rate = clientRateVal;
    newResult.supplier_rate = supplierRateVal;
    newResult.profit = profit;
    newResult.currency = formData.currency;

    if (profit <= 0) {
      setValidationLog(prev => [...prev, `[Rate] ❌ Profit negative! Client: €${Number(clientRateVal).toFixed(4)} | Supplier: €${Number(supplierRateVal).toFixed(4)} | Profit: €${Number(profit).toFixed(4)}`]);
      setResults(prev => prev.map(r => r.id === newResult.id ? { ...r, status: 'rejected' as const, error: `Route blocked: Profit negative (€${Number(profit).toFixed(4)}). Client rate €${Number(clientRateVal).toFixed(4)} < Supplier rate €${Number(supplierRateVal).toFixed(4)}` } : r));
      setLoading(false); return;
    }
    setValidationLog(prev => [...prev, `[Rate] ✅ Client: €${Number(clientRateVal).toFixed(4)} | Supplier: €${Number(supplierRateVal).toFixed(4)} | Profit: €${Number(profit).toFixed(4)}`]);
    newResult.validation!.rate = `✅ €${Number(profit).toFixed(4)} profit`;
    newResult.validation!.profit = `✅ Profit €${Number(profit).toFixed(4)}`;

    // Step 6: Balance + Credit Limit Check
    const balance = Number(client?.balance || 0);
    const creditLimit = Number(client?.credit_limit || 0);
    const totalAvailable = balance + creditLimit;
    const estimatedCost = clientRateVal;

    if (totalAvailable < estimatedCost) {
      setValidationLog(prev => [...prev, `[Balance] ❌ Insufficient! Balance: €${balance.toFixed(2)} | Credit: €${creditLimit.toFixed(2)} | Available: €${totalAvailable.toFixed(2)} | Needed: €${estimatedCost.toFixed(4)}`]);
      setResults(prev => prev.map(r => r.id === newResult.id ? { ...r, status: 'rejected' as const, error: `Insufficient balance/credit. Available: €${totalAvailable.toFixed(2)}. Need: €${estimatedCost.toFixed(4)}` } : r));
      setLoading(false); return;
    }
    setValidationLog(prev => [...prev, `[Balance] ✅ Balance: €${balance.toFixed(2)} | Credit: €${creditLimit.toFixed(2)} | Available: €${totalAvailable.toFixed(2)}`]);
    newResult.validation!.balance = `✅ €${balance.toFixed(2)}`;
    newResult.validation!.credit = `✅ €${creditLimit.toFixed(2)}`;

    // Step 7: SEND SMS via real API endpoint
    setValidationLog(prev => [...prev, `[Send] ⏳ Sending to server...`]);
    const sendStart = Date.now();
    try {
      const res: any = await api.post('/sms/test', {
        destination: formData.destination,
        message: formData.message,
        sender_id: formData.sender_id,
        client_id: formData.client_id || null,
        supplier_id: formData.supplier_id || null,
      });

      if (res.success && res.data?.data) {
        const serverData = res.data.data;
        const msgId = serverData.message_id || `MSG_${Date.now()}`;
        const latency = Date.now() - sendStart;
        
        // Log server response message
        if (res.data?.message) {
          setValidationLog(prev => [...prev, `[Server] ${res.data.message}`]);
        }
        setResults(prev => prev.map(r => r.id === newResult.id ? { 
          ...r, 
          status: 'sent' as const, 
          message_id: msgId, 
          route: rp.plan_name,
          latency,
          supplier: formData.supplier_id ? suppliers.find(s => s.id === formData.supplier_id)?.company_name || 'Server' : (res.data.supplier || 'Server'),
        } : r));
        setValidationLog(prev => [...prev, `[Send] ✅ Sent! Message ID: ${msgId} | Latency: ${latency}ms`]);

        // Server auto-delivers after 2s — poll for DLR status
        setTimeout(async () => {
          try {
            const dlrRes: any = await smsApi.getLog(serverData.id);
            const dlrStatus = dlrRes.success && dlrRes.data?.data?.status === 'delivered' ? 'delivered' : 'sent';
            setResults(prev => prev.map(r => r.id === newResult.id ? { 
              ...r, 
              status: dlrStatus as 'delivered' | 'sent',
              dlr_status: dlrStatus,
            } : r));
            setValidationLog(prev => [...prev, `[DLR] ${dlrStatus === 'delivered' ? '✅ Delivered' : '⏳ Sent (pending)'}`]);
          } catch {
            setValidationLog(prev => [...prev, `[DLR] ⚠ Could not verify DLR status`]);
          }
        }, 3000);
      } else {
        throw new Error(res.error || res.data?.error || 'Server returned failure');
      }
    } catch (err: any) {
      setResults(prev => prev.map(r => r.id === newResult.id ? { 
        ...r, 
        status: 'failed' as const, 
        error: err.message || 'SMS send failed',
      } : r));
      setValidationLog(prev => [...prev, `[Send] ❌ Failed: ${err.message || 'Unknown error'}`]);
    }
    
    setLoading(false);
  };

  const getStatusBadge = (status: string) => {
    const m: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'default'> = {
      delivered: 'success', sent: 'info', pending: 'warning', validating: 'warning', failed: 'danger', rejected: 'danger',
    };
    return <Badge variant={m[status] || 'default'}>{status.toUpperCase()}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Test SMS</h1>
        <p className="text-gray-500 mt-1">Full validation: Auth → Route Plan → MCCMNC → Rate&Profit → Balance&Credit → Send → DLR</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Send Form */}
        <Card title="Send Test Message (Full Validation Flow)">
          <form onSubmit={handleSubmit} className="space-y-4">
            <Select label="Client (Required for Auth)" value={formData.client_id} onChange={e => setFormData(p => ({ ...p, client_id: e.target.value }))}
              options={[{ value: '', label: 'Select Client' }, ...clients.map(c => ({ value: c.id, label: `${c.client_code} - ${c.company_name}` }))]} required />

            <Select label="Supplier (Optional — route via specific supplier)" value={formData.supplier_id} onChange={e => setFormData(p => ({ ...p, supplier_id: e.target.value }))}
              options={[{ value: '', label: 'Auto-select (default)' }, ...suppliers.filter(s => s.status === 'active').map(s => ({ value: s.id, label: `${s.supplier_code} - ${s.company_name} (${s.connection_type})` }))]} />

            <Select label="Route Plan * (Mandatory)" value={formData.route_plan_id} onChange={e => setFormData(p => ({ ...p, route_plan_id: e.target.value }))}
              options={[{ value: '', label: 'Select Route Plan (Mandatory)' }, ...routePlans.map(rp => ({ value: rp.id, label: rp.plan_name }))]} required />

            <Input label="Destination Number *" value={formData.destination} onChange={e => setFormData(p => ({ ...p, destination: e.target.value }))} placeholder="+1234567890" required />
            <Input label="Sender ID *" value={formData.sender_id} onChange={e => setFormData(p => ({ ...p, sender_id: e.target.value }))} placeholder="NET2APP" required />
            <Textarea label="Message *" value={formData.message} onChange={e => setFormData(p => ({ ...p, message: e.target.value }))} rows={3} required />

            <Select label="Currency" value={formData.currency}
              onChange={e => setFormData(p => ({ ...p, currency: e.target.value as 'EUR' }))}
              options={[{ value: 'EUR', label: 'EUR (€)' }, { value: 'USD', label: 'USD ($)' }, { value: 'GBP', label: 'GBP (£)' }]} />

            <div className="text-xs text-gray-500">
              Characters: {formData.message.length} | Parts: {Math.ceil(formData.message.length / 160)} | 
              Est. Cost: €{((rates.find(r => r.entity_type === 'client' && r.entity_id === formData.client_id && r.is_active)?.rate || 0.025) * Math.ceil(formData.message.length / 160)).toFixed(4)}
            </div>

            <Button type="submit" icon={<Send size={18} />} loading={loading} className="w-full">
              Send Test SMS (Full Validation)
            </Button>
          </form>
        </Card>

        {/* Validation Log & Results */}
        <div className="space-y-4">
          {/* Live Validation Log */}
          {validationLog.length > 0 && (
            <Card title="Validation Steps" noPadding>
              <div className="divide-y divide-gray-100 max-h-[300px] overflow-y-auto">
                {validationLog.map((log, i) => (
                  <div key={i} className={`px-4 py-2.5 text-sm font-mono ${log.includes('❌') ? 'bg-red-50 text-red-700' : log.includes('⚠') ? 'bg-yellow-50 text-yellow-700' : 'bg-green-50 text-green-700'}`}>
                    {log}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Results */}
          {results.length > 0 && (
            <Card title={`Test Results (${results.length})`} noPadding>
              <div className="divide-y divide-gray-100 max-h-[400px] overflow-y-auto">
                {results.map(r => (
                  <div key={r.id} className={`px-4 py-3 ${r.status === 'delivered' ? 'bg-green-50' : r.status === 'rejected' || r.status === 'failed' ? 'bg-red-50' : 'bg-gray-50'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-mono text-xs">{r.destination}</span>
                      {getStatusBadge(r.status)}
                    </div>
                    <p className="text-xs text-gray-600 line-clamp-1">{r.message}</p>
                    <div className="mt-1 flex gap-3 text-[10px] text-gray-500">
                      {r.message_id && <span>ID: {r.message_id.slice(-8)}</span>}
                      {r.route && <span>Route: {r.route}</span>}
                      {r.supplier && <span>Supp: {r.supplier}</span>}
                      {r.latency && <span>{r.latency}ms</span>}
                    </div>
                    {/* Profit display */}
                    {r.profit !== undefined && (
                      <div className={`mt-1 text-xs font-semibold ${(r.profit || 0) > 0 ? 'text-green-600' : 'text-red-600'}`}>
                        Client: €{Number(r.client_rate||0).toFixed(4)} | Supp: €{Number(r.supplier_rate||0).toFixed(4)} | Profit: €{Number(r.profit||0).toFixed(4)}
                      </div>
                    )}
                    {r.error && <p className="text-xs text-red-600 mt-1">Error: {r.error}</p>}
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
};
