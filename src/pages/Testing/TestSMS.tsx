import React, { useState } from 'react';
import { Send, TrendingUp, TrendingDown } from 'lucide-react';
import { useData } from '../../store/DataContext';
import { api, smsApi } from '../../services/api';
import { Card } from '../../components/UI/Card';
import { Button } from '../../components/UI/Button';
import { Input, Select, Textarea } from '../../components/UI/Input';
import { Badge } from '../../components/UI/Badge';
import type { Supplier } from '../../types';

interface TestResult {
  id: string;
  destination: string; sender_id: string; message: string;
  status: 'pending' | 'validating' | 'sent' | 'delivered' | 'failed' | 'rejected';
  timestamp: string; message_id?: string; error?: string; route?: string;
  supplier?: string; latency?: number;
  validation?: { authentication?: string; balance?: string; credit?: string; rate?: string; mccmnc?: string; profit?: string; channel?: string; numberCheck?: string; };
  client_rate?: number; supplier_rate?: number; profit?: number; currency?: string;
  billing_mode?: string; charge_status?: string; dlr_status?: string; channel_type?: string;
  translation_applied?: boolean; extracted_otp?: string | null;
}

export const TestSMS: React.FC = () => {
  const { clients, routePlans, rates, mccmnc, suppliers, routes, trunks } = useData();
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

  // Route Simulator state
  const [simClientId, setSimClientId] = useState('');
  const [simDest, setSimDest] = useState('');
  const [simLoading, setSimLoading] = useState(false);
  const [simResults, setSimResults] = useState<any>(null);

  const handleSubmitClick = async (e?: React.MouseEvent) => {
    if (e) e.preventDefault();
    if (loading) return;
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

    // Step 1: Client Selection — no authentication; test mode allows ANY client
    if (!formData.client_id) {
      setValidationLog(prev => [...prev, '[Client] ❌ No client selected']);
      setResults(prev => prev.map(r => r.id === newResult.id ? { ...r, status: 'rejected' as const, error: 'Please select a client before sending' } : r));
      setLoading(false); return;
    }
    const client = clients.find(c => String(c.id) === String(formData.client_id));
    const clientLabel = client ? `${client.client_code}${client.status !== 'active' ? ' (inactive)' : ''}` : `ID:${formData.client_id}`;
    setValidationLog(prev => [...prev, `[Client] ✅ Test mode — using ${clientLabel} (auth bypassed)`]);
    newResult.validation!.authentication = `✅ ${clientLabel} (test)`;

    // Step 2: Supplier Check + determine if this is Voice OTP
    const supplier: Supplier | undefined = formData.supplier_id
      ? suppliers.find(s => String(s.id) === String(formData.supplier_id))
      : undefined;
    let isVoiceOtpTest = false;
    let resolvedVoiceOtpSupplier: Supplier | undefined = undefined;
    let resolvedVoiceOtpConfigId: string | number | null = null;

    if (supplier) {
      const suppStatus = supplier.bind_status === 'bound' ? '✅ Bound' : (supplier.connection_type === 'voice_otp' ? '✅ Voice OTP' : '⚠ Unbound');
      setValidationLog(prev => [...prev, `[Supplier] ${suppStatus} | ${supplier.supplier_code} (${supplier.company_name}) | Type: ${supplier.connection_type}`]);
      if (supplier.connection_type === 'voice_otp') {
        isVoiceOtpTest = true;
        resolvedVoiceOtpSupplier = supplier;
        newResult.channel_type = 'voice_otp';
      }
    }

    // Step 2b: Route Plan → Voice OTP auto-detection
    // If no manual supplier selected, inspect the route plan for voice_otp trunks.
    // This mirrors the server's resolveRoute() logic: routes → trunks → suppliers.
    if (!isVoiceOtpTest && !formData.supplier_id && formData.route_plan_id) {
      const rp = routePlans.find(p => String(p.id) === String(formData.route_plan_id));
      if (rp?.route_ids?.length) {
        const planRoutes = routes.filter(r => rp.route_ids.map(String).includes(String(r.id)) && r.is_active);
        for (const route of planRoutes) {
          if (!route.trunk_ids?.length) continue;
          const planTrunks = trunks.filter(t => route.trunk_ids.map(String).includes(String(t.id)) && t.is_active);
          for (const trunk of planTrunks) {
            const trunkSupplier = suppliers.find(s => String(s.id) === String(trunk.supplier_id) && s.status === 'active');
            if (trunkSupplier?.connection_type === 'voice_otp') {
              isVoiceOtpTest = true;
              resolvedVoiceOtpSupplier = trunkSupplier;
              // Voice OTP config priority: route > trunk > supplier
              resolvedVoiceOtpConfigId = route.voice_otp_config_id || trunk.voice_otp_config_id || trunkSupplier.voice_otp_config_id || null;
              newResult.channel_type = 'voice_otp';
              setValidationLog(prev => [...prev, `[Route Plan] ✅ Route '${route.route_name}' → Trunk '${trunk.trunk_name}' → Supplier '${trunkSupplier.supplier_code}' (${trunkSupplier.connection_type})`]);
              setValidationLog(prev => [...prev, `[VoiceOTP] 🔍 Auto-detected via route plan — using ${trunkSupplier.company_name}`]);
              newResult.validation!.channel = '✅ Voice OTP (via Route Plan)';
              break;
            }
          }
          if (isVoiceOtpTest) break;
        }
      }
    }

    // ── VOICE OTP BRANCH: send via /api/voice-otp/test ──
    if (isVoiceOtpTest) {
      const effectiveSupplier = supplier || resolvedVoiceOtpSupplier;
      setValidationLog(prev => [...prev, `[VoiceOTP] ⏳ Initiating voice call to ${formData.destination}...`]);
      if (!newResult.validation!.channel) {
        newResult.validation!.channel = '✅ Voice OTP';
      }
      const sendStart = Date.now();
      try {
        const res: any = await api.post('/voice-otp/send', {
          destination: formData.destination,
          message: formData.message,
          client_id: formData.client_id || null,
          supplier_id: effectiveSupplier?.id || formData.supplier_id || null,
          config_id: resolvedVoiceOtpConfigId || undefined,
        });

        if (res.success && res.data?.data) {
          const otpData = res.data.data;
          const callId = otpData.call_id || `VOICE_${Date.now()}`;
          const latency = Date.now() - sendStart;
          const translMsg = (res.data?.translation_applied && res.data?.extracted_otp)
            ? `[VoiceOTP] 🧬 Translation applied: OTP extracted → ${res.data.extracted_otp}`
            : res.data?.translation_applied
              ? `[VoiceOTP] 🧬 Translation applied (rule active)`
              : null;
          if (translMsg) setValidationLog(prev => [...prev, translMsg]);
          setValidationLog(prev => [...prev, `[VoiceOTP] ✅ Call initiated: ${callId} | Latency: ${latency}ms`]);
          setResults(prev => prev.map(r => r.id === newResult.id ? {
            ...r,
            status: 'sent' as const,
            message_id: callId,
            route: 'Voice OTP',
            latency,
            supplier: effectiveSupplier?.company_name || 'Voice OTP',
            channel_type: 'voice_otp',
            translation_applied: res.data?.translation_applied || false,
            extracted_otp: res.data?.extracted_otp || null,
          } : r));

          // Poll voice_otp_logs for DLR status (voice calls take ~8-15s)
          setTimeout(async () => {
            try {
              const logsRes: any = await api.get('/voice-otp/logs');
              if (logsRes.success && logsRes.data?.data) {
                const callRecord = logsRes.data.data.find((l: any) => l.call_id === callId);
                if (callRecord) {
                  const dlr = callRecord.dlr_status === 'DELIVRD' ? 'delivered' :
                    callRecord.dlr_status === 'FAILED' || callRecord.dlr_status === 'UNDELIV' ? 'failed' : 'sent';
                  setResults(prev => prev.map(r => r.id === newResult.id ? {
                    ...r,
                    status: dlr as 'delivered' | 'sent' | 'failed',
                    dlr_status: callRecord.dlr_status,
                  } : r));
                  setValidationLog(prev => [...prev, `[Voice DLR] ${dlr === 'delivered' ? '✅ Call delivered' : dlr === 'failed' ? '❌ Call failed' : '⏳ In progress'}`]);
                }
              }
            } catch {
              // DLR poll best-effort
            }
          }, 10000);
        } else {
          throw new Error(res.error || res.data?.error || 'Voice OTP initiation failed');
        }
      } catch (err: any) {
        setResults(prev => prev.map(r => r.id === newResult.id ? {
          ...r,
          status: 'failed' as const,
          error: err.message || 'Voice OTP call failed',
        } : r));
        setValidationLog(prev => [...prev, `[VoiceOTP] ❌ Failed: ${err.message || 'Unknown error'}`]);
      }
      setLoading(false);
      return;
    }

    // ── SMS BRANCH (original flow) ──
    // Step 3: Route Plan Check
    const rp = routePlans.find(p => String(p.id) === String(formData.route_plan_id));
    if (!rp) {
      setValidationLog(prev => [...prev, '[Route Plan] ❌ Route plan is mandatory']);
      setResults(prev => prev.map(r => r.id === newResult.id ? { ...r, status: 'rejected' as const, error: 'Route plan is mandatory for SMS sending' } : r));
      setLoading(false); return;
    }
    setValidationLog(prev => [...prev, `[Route Plan] ✅ Selected: ${rp.plan_name}`]);

    // Step 4: MCCMNC Lookup — longest calling_code prefix wins (most specific match)
    // Strip + and 00 prefixes; backend normalizeDestination() also strips non-digits
    const cleanDest = formData.destination.replace(/^\+/, '').replace(/^(00)+/, '');
    const sortedMccmnc = [...mccmnc].sort((a, b) => String(b.calling_code || b.mcc || '').length - String(a.calling_code || a.mcc || '').length);
    const destMCC = sortedMccmnc.find(m => cleanDest.startsWith(String(m.calling_code || m.mcc)));
    const mccmncValid = !!destMCC;
    setValidationLog(prev => [...prev, `[MCCMNC] ${mccmncValid ? `✅ Found: ${destMCC!.country} (MCC:${destMCC!.mcc} MNC:${destMCC!.mnc})` : '⚠ No MCC/MNC match — using default route'}`]);
    newResult.validation!.mccmnc = mccmncValid ? `✅ ${destMCC!.country}` : '⚠ Default';

    // Step 5: Rate Lookup — informational only; test mode doesn't block on missing rates
    const clientRate = rates.find(r => r.entity_type === 'client' && String(r.entity_id) === String(formData.client_id) && r.is_active);
    const supplierRate = formData.supplier_id 
      ? rates.find(r => r.entity_type === 'supplier' && String(r.entity_id) === String(formData.supplier_id) && r.is_active)
      : rates.find(r => r.entity_type === 'supplier' && r.is_active);
    const clientRateVal = clientRate?.rate || 0;
    const supplierRateVal = supplierRate?.rate || 0;
    const profit = parseFloat((clientRateVal - supplierRateVal).toFixed(6));
    newResult.client_rate = clientRateVal;
    newResult.supplier_rate = supplierRateVal;
    newResult.profit = profit;
    newResult.currency = formData.currency;

    if (!clientRate) {
      setValidationLog(prev => [...prev, `[Rate] ⚠ No client rate found — using €0 (test mode allows this)`]);
    }
    if (!supplierRate && formData.supplier_id) {
      setValidationLog(prev => [...prev, `[Rate] ⚠ No supplier rate found — using €0 (test mode allows this)`]);
    }
    if (profit <= 0) {
      setValidationLog(prev => [...prev, `[Rate] ⚠ Profit €${Number(profit).toFixed(4)} (negative/none) — test mode bypasses this`]);
    } else {
      setValidationLog(prev => [...prev, `[Rate] ✅ Client: €${Number(clientRateVal).toFixed(4)} | Supplier: €${Number(supplierRateVal).toFixed(4)} | Profit: €${Number(profit).toFixed(4)}`]);
    }
    newResult.validation!.rate = profit > 0 ? `✅ €${Number(profit).toFixed(4)} profit` : `⚠ €${Number(profit).toFixed(4)} (bypassed)`;
    newResult.validation!.profit = profit > 0 ? `✅ Profit €${Number(profit).toFixed(4)}` : `⚠ Test mode bypass`;

    // Step 6: Balance Check — informational only in test mode
    const balance = Number(client?.balance || 0);
    const creditLimit = Number(client?.credit_limit || 0);
    const totalAvailable = balance + creditLimit;
    const estimatedCost = clientRateVal || 0.05;

    if (totalAvailable < estimatedCost) {
      setValidationLog(prev => [...prev, `[Balance] ⚠ Low balance: €${balance.toFixed(2)} + €${creditLimit.toFixed(2)} credit = €${totalAvailable.toFixed(2)} (test mode bypasses this)`]);
    } else {
      setValidationLog(prev => [...prev, `[Balance] ✅ Balance: €${balance.toFixed(2)} | Credit: €${creditLimit.toFixed(2)} | Available: €${totalAvailable.toFixed(2)}`]);
    }
    newResult.validation!.balance = `✅ €${balance.toFixed(2)} (info)`;
    newResult.validation!.credit = `✅ €${creditLimit.toFixed(2)} (info)`;

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
        // serverData may be { message_id, id, ... } or { message_id, ... }
        const msgId = serverData.message_id || serverData.data?.message_id || `MSG_${Date.now()}`;
        const logId = serverData.id || serverData.data?.id;
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
          supplier: formData.supplier_id ? supplier?.company_name || 'Server' : (serverData.supplier_code || 'Server'),
        } : r));
        setValidationLog(prev => [...prev, `[Send] ✅ Sent! Message ID: ${msgId} | Latency: ${latency}ms`]);

        // Poll for DLR status via the sms_logs entry
        setTimeout(async () => {
          try {
            const lookupId = logId || serverData.data?.id;
            if (lookupId) {
              const dlrRes: any = await smsApi.getLog(lookupId);
              const logStatus = dlrRes.success && dlrRes.data?.data?.status;
              const dlrStatus = logStatus === 'delivered' ? 'delivered' : 'sent';
              setResults(prev => prev.map(r => r.id === newResult.id ? { 
                ...r, 
                status: dlrStatus as 'delivered' | 'sent',
                dlr_status: dlrStatus,
              } : r));
              setValidationLog(prev => [...prev, `[DLR] ${dlrStatus === 'delivered' ? '✅ Delivered' : '⏳ Sent (pending)'}`]);
            }
          } catch {
            // DLR poll is best-effort
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
        <p className="text-gray-500 mt-1">Test Mode: Route Plan → MCCMNC → Send → DLR (auth &amp; rate checks bypassed for testing)</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Send Form */}
        <Card title="Send Test Message (Full Validation Flow)">
          <div className="space-y-4">
            <Select label="Client (Test Mode — Any Client)" value={formData.client_id} onChange={e => setFormData(p => ({ ...p, client_id: e.target.value }))}
              options={[{ value: '', label: 'Select Client (All)' }, ...clients.map(c => ({ value: String(c.id), label: `${c.client_code} - ${c.company_name}${c.status !== 'active' ? ' (inactive)' : ''}` }))]} required />

            <Select label="Supplier (Optional — route via specific supplier)" value={formData.supplier_id} onChange={e => setFormData(p => ({ ...p, supplier_id: e.target.value }))}
              options={[{ value: '', label: 'Auto-select (default)' }, ...suppliers.filter(s => s.status === 'active').map(s => ({ value: s.id, label: `${s.supplier_code} - ${s.company_name} (${s.connection_type})` }))]} />

            <Select label="Route Plan * (Mandatory)" value={formData.route_plan_id} onChange={e => setFormData(p => ({ ...p, route_plan_id: e.target.value }))}
              options={[{ value: '', label: 'Select Route Plan (Mandatory)' }, ...routePlans.map(rp => ({ value: rp.id, label: rp.plan_name }))]} required />

            <Input label="Destination Number *" value={formData.destination} onChange={e => setFormData(p => ({ ...p, destination: e.target.value }))} placeholder="8801615069178 (E.164 — no + or 00)" required />
            <Input label="Sender ID *" value={formData.sender_id} onChange={e => setFormData(p => ({ ...p, sender_id: e.target.value }))} placeholder="NET2APP" required />
            <Textarea label="Message *" value={formData.message} onChange={e => setFormData(p => ({ ...p, message: e.target.value }))} rows={3} required />

            <Select label="Currency" value={formData.currency}
              onChange={e => setFormData(p => ({ ...p, currency: e.target.value as 'EUR' }))}
              options={[{ value: 'EUR', label: 'EUR (€)' }, { value: 'USD', label: 'USD ($)' }, { value: 'GBP', label: 'GBP (£)' }]} />

            <div className="text-xs text-gray-500">
              Characters: {formData.message.length} | Parts: {Math.ceil(formData.message.length / 160)} | 
              Est. Cost: €{((rates.find(r => r.entity_type === 'client' && r.entity_id === formData.client_id && r.is_active)?.rate || 0.025) * Math.ceil(formData.message.length / 160)).toFixed(4)}
            </div>

            <Button type="button" icon={<Send size={18} />} loading={loading} className="w-full" onClick={handleSubmitClick}>
              Send Test SMS (Full Validation)
            </Button>
          </div>
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
                    {r.translation_applied && r.extracted_otp && (
                      <div className="mt-1 text-xs font-medium text-purple-600 bg-purple-50 px-2 py-0.5 rounded inline-block">
                        🧬 Translation: OTP → {r.extracted_otp}
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

      {/* ==================== ROUTE SIMULATOR ==================== */}
      <Card title="📊 Route Simulator — Check Rates, Profits & Viability">
        <p className="text-sm text-gray-500 mb-4">Select a client and enter a destination number to see ALL possible routes, rates, and profit margins. Red rows = supplier rate exceeds client rate (⚠ no profit).</p>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
          <Select label="Client" value={simClientId} onChange={e => setSimClientId(e.target.value)}
            options={[{ value: '', label: 'Select Client' }, ...clients.map(c => ({ value: String(c.id), label: `${c.client_code}` }))]} />
          <Input label="Destination Number" value={simDest} onChange={e => setSimDest(e.target.value)} placeholder="8801615069178" />
          <div className="flex items-end"><Button onClick={async () => {
            if (!simClientId || !simDest) return;
            setSimLoading(true);
            try {
              const res: any = await api.post('/sms/simulate', { client_id: simClientId, destination: simDest });
              // Unwrap double-nested API response: res.data = { success:true, data:{...} }
              if (res.success) setSimResults(res.data?.data || res.data);
              else setSimResults({ error: res.error || 'Simulation failed' });
            } catch (e: any) { setSimResults({ error: e.message }); }
            setSimLoading(false);
          }} loading={simLoading} icon={<TrendingUp size={16} />}>Simulate</Button></div>
        </div>

        {simResults && !simResults.error && Array.isArray(simResults.routes) && (
          <div className="space-y-3">
            <div className="flex gap-4 text-sm">
              <Badge variant="info">{simResults.country || 'Unknown'} — MCC:{simResults.mcc || '?'} MNC:{simResults.mnc || '?'}</Badge>
              <Badge variant="success">{simResults.viable} viable routes</Badge>
              {simResults.warnings > 0 && <Badge variant="danger">{simResults.warnings} ⚠ warnings</Badge>}
              <Badge variant="default">{simResults.total_combinations} combinations</Badge>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border">
                <thead><tr className="bg-gray-50 text-left text-xs">
                  <th className="p-2 border">Client</th><th className="p-2 border">Client Rate</th>
                  <th className="p-2 border">Supplier</th><th className="p-2 border">Supp Rate</th>
                  <th className="p-2 border">Profit</th><th className="p-2 border">Route</th>
                  <th className="p-2 border">Status</th>
                </tr></thead>
                <tbody>
                  {simResults.routes.slice(0, 50).map((r: any, i: number) => (
                    <tr key={i} className={`border-t ${r.viable ? 'hover:bg-green-50' : 'bg-red-50 hover:bg-red-100'}`}>
                      <td className="p-2 border text-xs">{r.client_code}</td>
                      <td className="p-2 border font-mono text-xs">€{Number(r.client_rate).toFixed(5)}</td>
                      <td className="p-2 border text-xs">{r.supplier_code} <span className="text-gray-400">({r.supplier_type})</span></td>
                      <td className="p-2 border font-mono text-xs">€{Number(r.supplier_rate).toFixed(5)}</td>
                      <td className={`p-2 border font-mono text-xs font-bold ${r.viable ? 'text-green-600' : 'text-red-600'}`}>
                        {r.viable ? <TrendingUp size={12} className="inline mr-1" /> : <TrendingDown size={12} className="inline mr-1" />}
                        €{Number(r.profit).toFixed(5)}
                      </td>
                      <td className="p-2 border text-xs text-gray-500">{r.route_name || r.trunk_name || '—'}</td>
                      <td className="p-2 border">
                        {r.viable ? <Badge variant="success" size="sm">✅ Viable</Badge> : <Badge variant="danger" size="sm">⚠ {r.warning}</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {(simResults.routes?.length || 0) > 50 && <p className="text-xs text-gray-400">Showing 50 of {simResults.routes.length} results. Refine your search for more precision.</p>}
          </div>
        )}
        {simResults?.error && <div className="p-4 bg-red-50 text-red-700 rounded-lg text-sm">{simResults.error}</div>}
      </Card>
    </div>
  );
};
