import React, { useState, useEffect } from 'react';
import { Phone, RotateCcw, CheckCircle, XCircle, Clock, RefreshCw } from 'lucide-react';
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
  created_at: string;
  answered_at: string;
  completed_at: string;
}

export const VoiceOTP: React.FC = () => {
  const [calls, setCalls] = useState<VoiceCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [form, setForm] = useState({
    destination: '',
    otp_code: '',
    max_retries: 4,
    retry_delay: 60,
    dlr_timeout: 150
  });
  const [pollingCallId, setPollingCallId] = useState<string | null>(null);

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
        max_retries: form.max_retries,
        retry_delay: form.retry_delay,
        dlr_timeout: form.dlr_timeout
      });
      
      if (response.data.success) {
        setPollingCallId(response.data.data.call_id);
        loadCalls();
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

  const getStatusBadge = (status: string, dlrStatus: string) => {
    if (dlrStatus === 'DELIVRD') {
      return <span className="px-2 py-1 bg-green-100 text-green-800 rounded-full text-xs flex items-center gap-1"><CheckCircle className="w-3 h-3" /> Delivered</span>;
    }
    if (dlrStatus === 'UNDELIV') {
      return <span className="px-2 py-1 bg-red-100 text-red-800 rounded-full text-xs flex items-center gap-1"><XCircle className="w-3 h-3" /> Failed</span>;
    }
    if (status === 'ringing') {
      return <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs flex items-center gap-1"><Clock className="w-3 h-3" /> Ringing</span>;
    }
    if (status === 'retry_scheduled') {
      return <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs flex items-center gap-1"><RotateCcw className="w-3 h-3" /> Retry Scheduled</span>;
    }
    if (status === 'retrying') {
      return <span className="px-2 py-1 bg-purple-100 text-purple-800 rounded-full text-xs flex items-center gap-1"><RefreshCw className="w-3 h-3" /> Retrying...</span>;
    }
    if (status === 'initiated') {
      return <span className="px-2 py-1 bg-gray-100 text-gray-800 rounded-full text-xs flex items-center gap-1"><Phone className="w-3 h-3" /> Initiating</span>;
    }
    return <span className="px-2 py-1 bg-gray-100 text-gray-800 rounded-full text-xs">{status}</span>;
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
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Call ID</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Destination</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">OTP</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Retries</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Created</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {calls.map((call) => (
                <tr key={call.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 text-sm font-mono">{call.call_id}</td>
                  <td className="px-6 py-4 text-sm">{call.destination}</td>
                  <td className="px-6 py-4 text-sm font-mono font-bold">{call.otp_code}</td>
                  <td className="px-6 py-4">{getStatusBadge(call.status, call.dlr_status)}</td>
                  <td className="px-6 py-4 text-sm">{call.retry_count}/{call.max_retries}</td>
                  <td className="px-6 py-4 text-sm">{new Date(call.created_at).toLocaleString()}</td>
                  <td className="px-6 py-4">
                    {call.status !== 'completed' && call.status !== 'failed' && (
                      <button
                        onClick={() => retryCall(call.call_id)}
                        className="text-blue-600 hover:text-blue-800"
                        title="Force retry"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {calls.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-8 text-center text-gray-500">
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
