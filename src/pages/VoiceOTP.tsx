import React, { useState, useEffect } from 'react';
import { Phone, RotateCcw, CheckCircle, XCircle, Clock, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '../services/api';

interface VoiceCall {
  id: number;
  call_id: string;
  destination: string;
  otp_code: string;
  status: string;
  dlr_status: string;
  retry_count: number;
  max_retries: number;
  language: string;
  duration: number;
  total_cost: number;
  created_at: string;
  completed_at: string;
  error_message: string;
  dial_status: string;
  supplier_id: number;
  supplier_code: string;
  supplier_name: string;
  reconnect_trace: string[];
  billing_status: string;
}

export const VoiceOTP: React.FC = () => {
  const [calls, setCalls] = useState<VoiceCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [form, setForm] = useState({
    destination: '',
    otp_code: '',
    config_id: '',
    max_retries: 4,
    retry_delay: 60,
    dlr_timeout: 150
  });
  const [configs, setConfigs] = useState<any[]>([]);
  const [pollingCallId, setPollingCallId] = useState<string | null>(null);

  // Load language configs so the user can pick which language group to test
  useEffect(() => {
    api.get('/voice-otp/configs')
      .then((res: any) => {
        const arr = res.data?.data || res.data || [];
        if (Array.isArray(arr)) {
          setConfigs(arr.filter((c: any) => c.is_active !== false));
        }
      })
      .catch(() => {});
  }, []);

  const loadCalls = async () => {
    try {
      const response: any = await api.get('/voice-otp/logs');
      if (response.data.success) {
        setCalls(response.data.data);
      }
    } catch (error) {
      console.error('Error loading calls:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCalls();
    
    // Poll for DLR status every 3-5 seconds if there's a call being monitored
    let interval: NodeJS.Timeout;
    if (pollingCallId) {
      interval = setInterval(async () => {
        try {
          const response: any = await api.get(`/voice-otp/dlr/${pollingCallId}`);
          if (response.data.success && response.data.dlr_status) {
            // Update call status
            loadCalls();
            if (response.data.dlr_status === 'DELIVRD' || response.data.dlr_status === 'UNDELIV') {
              setPollingCallId(null);
            }
          }
        } catch (error) {
          console.error('DLR inquiry error:', error);
        }
      }, 4000); // Poll every 4 seconds
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [pollingCallId]);

  const sendVoiceOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    
    try {
      const response: any = await api.post('/voice-otp/send', {
        destination: form.destination,
        otp_code: form.otp_code || undefined,
        config_id: form.config_id || undefined,
        max_retries: form.max_retries,
        retry_delay: form.retry_delay,
        dlr_timeout: form.dlr_timeout
      });
      
      if (response.data.success) {
        setPollingCallId(response.data.data.call_id);
        loadCalls();
        // Keep the selected language group + settings so testing multiple numbers
        // with the same language doesn't require re-selecting it each time.
        setForm({ ...form, destination: '', otp_code: '' });
      }
    } catch (error) {
      console.error('Error sending OTP:', error);
      alert('Failed to send OTP');
    } finally {
      setSending(false);
    }
  };

  const retryCall = async (callId: string) => {
    try {
      const response: any = await api.post(`/voice-otp/retry/${callId}`, {});
      if (response.data.success) {
        loadCalls();
        setPollingCallId(callId);
      }
    } catch (error) {
      console.error('Error retrying call:', error);
      alert('Failed to retry call');
    }
  };

  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  const toggleRow = (id: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const formatDuration = (ms: number) => {
    if (!ms) return '—';
    const sec = ms / 1000;
    if (sec < 60) return `${sec.toFixed(1)}s`;
    const mins = Math.floor(sec / 60);
    const remainSec = sec % 60;
    return `${mins}m ${remainSec.toFixed(0)}s`;
  };

  const getStatusBadge = (status: string, dlrStatus: string) => {
    // Success states
    if (dlrStatus === 'DELIVRD') {
      return <span className="px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Delivered</span>;
    }
    if (status === 'completed') {
      return <span className="px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Completed</span>;
    }
    // Failure states
    if (dlrStatus === 'UNDELIV' || dlrStatus === 'FAILED') {
      return <span className="px-2 py-1 bg-red-100 text-red-800 rounded-full text-xs flex items-center gap-1"><XCircle className="w-3 h-3" /> Failed</span>;
    }
    if (status === 'failed') {
      return <span className="px-2 py-1 bg-red-100 text-red-800 rounded-full text-xs flex items-center gap-1"><XCircle className="w-3 h-3" /> Failed</span>;
    }
    // In-progress states
    if (status === 'sent') {
      return <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs flex items-center gap-1"><Phone className="w-3 h-3" /> Dialing</span>;
    }
    if (status === 'ringing') {
      return <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs flex items-center gap-1"><Clock className="w-3 h-3" /> Ringing</span>;
    }
    if (status === 'retry_scheduled') {
      return <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs flex items-center gap-1"><RotateCcw className="w-3 h-3" /> Retry Scheduled</span>;
    }
    if (status === 'retrying') {
      return <span className="px-2 py-1 bg-purple-100 text-purple-800 rounded-full text-xs flex items-center gap-1"><RefreshCw className="w-3 h-3" /> Retrying</span>;
    }
    if (status === 'initiated') {
      return <span className="px-2 py-1 bg-gray-100 text-gray-800 rounded-full text-xs flex items-center gap-1"><Phone className="w-3 h-3" /> Initiating</span>;
    }
    // Fallback: show raw status
    return <span className="px-2 py-1 bg-gray-100 text-gray-800 rounded-full text-xs">{status || 'unknown'}</span>;
  };

  if (loading) {
    return <div className="p-6 text-center">Loading voice OTP calls...</div>;
  }

  return (
    <div className="p-6">
      <h1 className="text-2xl font-bold mb-6">Voice OTP</h1>
      
      {/* Send Voice OTP Form */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Phone className="w-5 h-5" /> Send Voice OTP
        </h2>
        <form onSubmit={sendVoiceOtp} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Destination Number *</label>
              <input
                type="tel"
                value={form.destination}
                onChange={(e) => setForm({ ...form, destination: e.target.value })}
                placeholder="+1234567890"
                className="w-full px-3 py-2 border rounded-lg"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">OTP Code (leave empty for auto)</label>
              <input
                type="text"
                value={form.otp_code}
                onChange={(e) => setForm({ ...form, otp_code: e.target.value })}
                placeholder="123456"
                maxLength={6}
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Language Group (optional)</label>
              <select
                value={form.config_id}
                onChange={(e) => setForm({ ...form, config_id: e.target.value })}
                className="w-full px-3 py-2 border rounded-lg bg-white"
              >
                <option value="">Auto-detect by country prefix</option>
                {configs.map((c) => (
                  <option key={c.id} value={String(c.id)}>
                    {c.language || 'Unnamed'}{c.is_dual_language ? ' (+Intl)' : ''}
                    {c.country_prefix ? ` (${c.country_prefix})` : ''} · {c.primary_language_code || 'en'}
                    {c.secondary_language_code && c.secondary_language_code !== (c.primary_language_code || 'en') ? ` → ${c.secondary_language_code}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Max Retries</label>
              <input
                type="number"
                value={form.max_retries}
                onChange={(e) => setForm({ ...form, max_retries: parseInt(e.target.value) })}
                min="1"
                max="10"
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Retry Delay (seconds)</label>
              <input
                type="number"
                value={form.retry_delay}
                onChange={(e) => setForm({ ...form, retry_delay: parseInt(e.target.value) })}
                min="30"
                max="120"
                className="w-full px-3 py-2 border rounded-lg"
              />
            </div>
          </div>
          <button
            type="submit"
            disabled={sending}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {sending ? 'Sending...' : 'Send Voice OTP'}
          </button>
        </form>
      </div>
      
      {/* Voice OTP Calls Table */}
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        <div className="px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">Voice OTP Calls</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-5"></th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Destination</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">OTP</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Dial Result</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Duration</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Supplier</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Retries</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Completed</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {calls.map((call) => (
                <React.Fragment key={call.id}>
                  <tr className={`hover:bg-gray-50 ${expandedRows.has(call.id) ? 'bg-blue-50' : ''}`}>
                    <td className="px-4 py-3">
                      {(call.reconnect_trace && call.reconnect_trace.length > 0) || call.error_message ? (
                        <button onClick={() => toggleRow(call.id)} className="text-gray-400 hover:text-gray-600 transition-colors">
                          {expandedRows.has(call.id) ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 text-sm font-mono">{call.destination}</td>
                    <td className="px-4 py-3 text-sm font-mono font-bold">{call.otp_code}</td>
                    <td className="px-4 py-3">{getStatusBadge(call.status, call.dlr_status)}</td>
                    <td className="px-4 py-3 text-sm">
                      {call.dial_status ? (
                        <span className={`px-2 py-0.5 rounded-full text-xs ${
                          call.dial_status === 'ANSWER' ? 'bg-green-100 text-green-700' :
                          call.dial_status === 'NOANSWER' ? 'bg-yellow-100 text-yellow-700' :
                          call.dial_status === 'BUSY' ? 'bg-orange-100 text-orange-700' :
                          call.dial_status === 'CANCEL' ? 'bg-gray-100 text-gray-600' :
                          'bg-red-100 text-red-700'
                        }`}>{call.dial_status}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {call.duration ? (
                        <div>
                          <span className="text-sm font-medium">{formatDuration(call.duration)}</span>
                          {call.duration < 2000 && call.status === 'failed' && (
                            <span className="ml-1 text-xs text-red-500">⚠ drop</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-gray-400 text-sm">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm">{call.supplier_code || call.supplier_name || (call.supplier_id ? `#${call.supplier_id}` : '—')}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className={call.retry_count > 0 ? 'text-orange-600 font-medium' : ''}>
                        {call.retry_count}/{call.max_retries}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{new Date(call.created_at).toLocaleString()}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {call.completed_at ? new Date(call.completed_at).toLocaleString() : (
                        call.status === 'failed' || call.status === 'completed' ? (
                          <span className="text-gray-400">—</span>
                        ) : (
                          <span className="text-blue-500 animate-pulse">in progress...</span>
                        )
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {call.status !== 'completed' && call.status !== 'failed' && (
                        <button
                          onClick={() => retryCall(call.call_id)}
                          className="text-blue-600 hover:text-blue-800"
                          title="Force retry"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      )}
                      {call.billing_status === 'billed' && (
                        <span className="ml-1 px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded text-xs">$</span>
                      )}
                    </td>
                  </tr>
                  {/* Expandable detail row */}
                  {expandedRows.has(call.id) && (
                    <tr key={`detail-${call.id}`}>
                      <td colSpan={11} className="px-6 py-3 bg-gray-50 border-b">
                        <div className="space-y-2 text-sm">
                          <div className="flex flex-wrap gap-x-6 gap-y-1">
                            <span className="text-gray-500">Call ID: <span className="font-mono text-gray-700">{call.call_id}</span></span>
                            <span className="text-gray-500">Language: <span className="text-gray-700">{call.language || '—'}</span></span>
                            <span className="text-gray-500">Billing: <span className={`font-medium ${call.billing_status === 'billed' ? 'text-emerald-600' : 'text-gray-500'}`}>{call.billing_status || 'pending'}</span></span>
                            <span className="text-gray-500">Cost: <span className="text-gray-700">{call.total_cost ? `€${Number(call.total_cost).toFixed(4)}` : '—'}</span></span>
                          </div>
                          {call.error_message && (
                            <div className="bg-red-50 border border-red-200 rounded p-2">
                              <span className="text-red-600 font-medium">Error: </span>
                              <span className="text-red-700">{call.error_message}</span>
                            </div>
                          )}
                          {call.reconnect_trace && call.reconnect_trace.length > 0 && (
                            <div>
                              <span className="text-gray-500 font-medium">Reconnect Trace:</span>
                              <div className="mt-1 space-y-1">
                                {call.reconnect_trace.map((trace, idx) => (
                                  <div key={idx} className="text-xs font-mono bg-white border rounded px-2 py-1 text-gray-600">
                                    {trace}
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
              {calls.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-6 py-8 text-center text-gray-500">
                    No voice OTP calls yet
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default VoiceOTP;
