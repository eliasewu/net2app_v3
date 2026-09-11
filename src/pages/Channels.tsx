import React, { useState, useEffect, useCallback } from 'react';
import { Send, MessageSquare, Smartphone, Globe, Zap, Radio, Search, RefreshCw, CheckCircle, XCircle, Phone } from 'lucide-react';
import { channelsApi } from '../services/api';
import { Card } from '../components/UI/Card';
import { Button } from '../components/UI/Button';
import { Badge } from '../components/UI/Badge';
import { Table, Pagination } from '../components/UI/Table';

interface ChannelLog {
  id: number;
  message_id: string;
  channel: string;
  destination: string;
  message_text: string;
  media_url?: string;
  status: string;
  http_status?: number;
  error?: string;
  submitted_at: string;
  delivered_at?: string;
  device_id?: number;
  sender_id?: string;
}

const CHANNEL_OPTIONS = [
  { value: 'rcs', label: 'RCS', icon: <MessageSquare size={16} />, color: 'bg-blue-500' },
  { value: 'flash_sms', label: 'Flash SMS', icon: <Zap size={16} />, color: 'bg-yellow-500' },
  { value: 'whatsapp', label: 'WhatsApp', icon: <Smartphone size={16} />, color: 'bg-green-500' },
  { value: 'telegram', label: 'Telegram', icon: <Phone size={16} />, color: 'bg-blue-400' },
  { value: 'http', label: 'HTTP API', icon: <Globe size={16} />, color: 'bg-purple-500' },
];

const CHANNEL_ICONS: Record<string, React.ReactNode> = {
  rcs: <MessageSquare size={14} className="text-blue-500" />,
  flash_sms: <Zap size={14} className="text-yellow-500" />,
  whatsapp: <Smartphone size={14} className="text-green-500" />,
  telegram: <Phone size={14} className="text-blue-400" />,
  http: <Globe size={14} className="text-purple-500" />,
};

const getStatusBadge = (status: string) => {
  const variants: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'default'> = {
    delivered: 'success',
    sending: 'info',
    queued: 'warning',
    failed: 'danger',
    pending: 'warning',
  };
  return <Badge variant={variants[status] || 'default'}>{status}</Badge>;
};

export const Channels: React.FC = () => {
  const [logs, setLogs] = useState<ChannelLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ success: boolean; message: string } | null>(null);

  // Send form
  const [form, setForm] = useState({
    channel: 'whatsapp',
    destination: '',
    message: '',
    sender_id: '',
    media_url: '',
    api_connector_id: '',
  });

  // Log filters
  const [search, setSearch] = useState('');
  const [channelFilter, setChannelFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);

  const itemsPerPage = 15;

  const loadLogs = useCallback(async () => {
    try {
      const filters: any = {};
      if (channelFilter !== 'all') filters.channel = channelFilter;
      if (statusFilter !== 'all') filters.status = statusFilter;
      const response = await channelsApi.getLogs(filters);
      if (response.success) {
        setLogs((response.data as any)?.data || []);
      }
    } catch (e) {
      console.error('Error loading channel logs:', e);
    } finally {
      setLoading(false);
    }
  }, [channelFilter, statusFilter]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    setSending(true);
    setSendResult(null);

    try {
      const payload: any = {
        channel: form.channel,
        destination: form.destination,
        message: form.message,
      };
      if (form.sender_id) payload.sender_id = form.sender_id;
      if (form.media_url) payload.media_url = form.media_url;
      if (form.api_connector_id) payload.api_connector_id = form.api_connector_id;

      const response = await channelsApi.send(payload);
      if (response.success) {
        setSendResult({ success: true, message: (response.data as any)?.message || 'Message sent' });
        setForm(prev => ({ ...prev, destination: '', message: '' }));
        loadLogs();
      } else {
        setSendResult({ success: false, message: response.error || 'Send failed' });
      }
    } catch (e: any) {
      setSendResult({ success: false, message: e.message || 'Send failed' });
    } finally {
      setSending(false);
    }
  };

  const filteredLogs = logs.filter(log => {
    if (search) {
      const q = search.toLowerCase();
      const dest = (log.destination || '').toLowerCase();
      const msgId = (log.message_id || '').toLowerCase();
      if (!dest.includes(q) && !msgId.includes(q)) return false;
    }
    return true;
  });

  const totalPages = Math.ceil(filteredLogs.length / itemsPerPage);
  const paginatedLogs = filteredLogs.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const columns = [
    {
      key: 'message_id',
      header: 'Message ID',
      render: (log: ChannelLog) => (
        <span className="text-xs font-mono text-gray-600 truncate block max-w-[140px]" title={log.message_id}>
          {log.message_id}
        </span>
      ),
    },
    {
      key: 'channel',
      header: 'Channel',
      render: (log: ChannelLog) => (
        <div className="flex items-center gap-1.5">
          {CHANNEL_ICONS[log.channel] || <Radio size={14} className="text-gray-400" />}
          <span className="text-xs font-medium text-gray-700 capitalize">{log.channel.replace('_', ' ')}</span>
        </div>
      ),
    },
    {
      key: 'destination',
      header: 'Destination',
      render: (log: ChannelLog) => (
        <span className="text-sm font-mono">{log.destination}</span>
      ),
    },
    {
      key: 'message_text',
      header: 'Message',
      render: (log: ChannelLog) => (
        <span className="text-sm text-gray-700 line-clamp-1 block max-w-[200px]" title={log.message_text}>
          {log.message_text}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (log: ChannelLog) => getStatusBadge(log.status),
    },
    {
      key: 'submitted_at',
      header: 'Submitted',
      render: (log: ChannelLog) => (
        <span className="text-xs text-gray-500">{new Date(log.submitted_at).toLocaleString()}</span>
      ),
    },
  ];

  const channelInfo = CHANNEL_OPTIONS.find(c => c.value === form.channel);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Multi-Channel Messaging</h1>
          <p className="text-gray-500 mt-1">Send messages via RCS, Flash SMS, WhatsApp, Telegram, or HTTP API</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {CHANNEL_OPTIONS.map(ch => (
          <div key={ch.value} className={`bg-white rounded-xl p-4 border cursor-pointer transition-all hover:shadow-md ${form.channel === ch.value ? 'ring-2 ring-blue-500 border-blue-500' : 'border-gray-200'}`}
            onClick={() => setForm(prev => ({ ...prev, channel: ch.value }))}>
            <div className={`w-8 h-8 rounded-lg ${ch.color} bg-opacity-20 flex items-center justify-center mb-2`}>
              {ch.icon}
            </div>
            <p className="text-sm font-medium text-gray-800">{ch.label}</p>
            <p className="text-xs text-gray-500 mt-0.5">
              {logs.filter(l => l.channel === ch.value).length} sent
            </p>
          </div>
        ))}
      </div>

      {/* Send Form */}
      <Card title={`Send ${channelInfo?.label || 'Message'}`} subtitle={channelInfo ? `via ${channelInfo.label} channel` : ''}>
        <form onSubmit={handleSend} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Channel</label>
              <div className="flex flex-wrap gap-2">
                {CHANNEL_OPTIONS.map(ch => (
                  <button
                    key={ch.value}
                    type="button"
                    onClick={() => setForm(prev => ({ ...prev, channel: ch.value }))}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                      form.channel === ch.value
                        ? 'bg-blue-600 text-white shadow-md'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {ch.icon}
                    {ch.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="md:col-span-1" />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Destination *</label>
              <input
                type="text"
                value={form.destination}
                onChange={e => setForm(prev => ({ ...prev, destination: e.target.value }))}
                placeholder="+1234567890"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Message *</label>
              <input
                type="text"
                value={form.message}
                onChange={e => setForm(prev => ({ ...prev, message: e.target.value }))}
                placeholder="Type your message..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Sender ID (optional)</label>
              <input
                type="text"
                value={form.sender_id}
                onChange={e => setForm(prev => ({ ...prev, sender_id: e.target.value }))}
                placeholder="MyApp"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Media URL (optional)</label>
              <input
                type="url"
                value={form.media_url}
                onChange={e => setForm(prev => ({ ...prev, media_url: e.target.value }))}
                placeholder="https://example.com/image.jpg"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            {form.channel === 'http' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">API Connector ID *</label>
                <input
                  type="number"
                  value={form.api_connector_id}
                  onChange={e => setForm(prev => ({ ...prev, api_connector_id: e.target.value }))}
                  placeholder="1"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required={form.channel === 'http'}
                />
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={sending} icon={<Send size={16} />}>
              {sending ? 'Sending...' : `Send via ${channelInfo?.label || form.channel}`}
            </Button>
            {sendResult && (
              <span className={`text-sm flex items-center gap-1 ${sendResult.success ? 'text-green-600' : 'text-red-600'}`}>
                {sendResult.success ? <CheckCircle size={14} /> : <XCircle size={14} />}
                {sendResult.message}
              </span>
            )}
          </div>
        </form>
      </Card>

      {/* Log Viewer */}
      <Card
        title="Message Logs"
        subtitle="Recent channel message history"
        noPadding
      >
        {/* Refresh & Filters */}
        <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
          <button onClick={loadLogs} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-gray-100 text-gray-500 text-sm" title="Refresh">
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
        <div className="px-5 py-3 border-b border-gray-100">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="flex-1 relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="Search by destination or message ID..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <select
              value={channelFilter}
              onChange={e => setChannelFilter(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Channels</option>
              {CHANNEL_OPTIONS.map(ch => (
                <option key={ch.value} value={ch.value}>{ch.label}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Status</option>
              <option value="queued">Queued</option>
              <option value="sending">Sending</option>
              <option value="delivered">Delivered</option>
              <option value="failed">Failed</option>
            </select>
          </div>
        </div>

        {/* Table */}
        {loading ? (
          <div className="p-8 text-center text-gray-400">Loading...</div>
        ) : (
          <>
            <Table columns={columns} data={paginatedLogs} keyExtractor={log => String(log.id)} />
            <Pagination
              currentPage={currentPage}
              totalPages={totalPages}
              onPageChange={setCurrentPage}
              totalItems={filteredLogs.length}
              itemsPerPage={itemsPerPage}
            />
          </>
        )}
      </Card>
    </div>
  );
};

export default Channels;
