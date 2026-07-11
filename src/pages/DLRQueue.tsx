import React, { useState } from 'react';
import { Search, RefreshCw, Clock, CheckCircle, XCircle, AlertTriangle, RotateCw, Trash2, Eye, MessageSquare, Smartphone, Wifi, Globe } from 'lucide-react';
import { useData } from '../store/DataContext';
import { Card } from '../components/UI/Card';
import { Button } from '../components/UI/Button';
import { Badge } from '../components/UI/Badge';
import { Table, Pagination } from '../components/UI/Table';
import { Modal } from '../components/UI/Modal';
import { DLRQueue } from '../types';
import { api } from '../services/api';

export const DLRQueuePage: React.FC = () => {
  const contextDlrQueue = useData().dlrQueue;
  const [localQueue, setLocalQueue] = useState<DLRQueue[]>([]);
  const [useLocal, setUseLocal] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [channelFilter, setChannelFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [detailModal, setDetailModal] = useState<DLRQueue | null>(null);
  const [loading, setLoading] = useState(false);

  const itemsPerPage = 25;

  const dlrQueue = useLocal ? localQueue : contextDlrQueue;

  const refresh = async () => {
    setLoading(true);
    try {
      const res: any = await api.get('/dlr-queue');
      if (res.success && res.data?.data) {
        const arr = Array.isArray(res.data.data) ? res.data.data : [];
        setLocalQueue(arr);
        setUseLocal(true);
      }
    } catch (e) {
      console.error('Failed to refresh DLR queue:', e);
    }
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this DLR queue entry?')) return;
    try {
      const res: any = await api.delete(`/dlr-queue/${id}`);
      if (res.success) {
        setLocalQueue(prev => prev.filter(x => x.id !== id));
      }
    } catch (e) {
      console.error('Failed to delete DLR entry:', e);
    }
  };

  const handleRetry = async (id: string) => {
    try {
      const res: any = await api.put(`/dlr-queue/${id}`, { status: 'pending', retry_count: 0 });
      if (res.success && res.data?.data) {
        setLocalQueue(prev => prev.map(x => x.id === id ? res.data.data : x));
      }
    } catch (e) {
      console.error('Failed to reset DLR entry:', e);
    }
  };

  // Status badge
  const getStatusBadge = (status: string) => {
    const m: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'default'> = {
      delivered: 'success',
      pending: 'warning',
      failed: 'danger',
      expired: 'danger',
      sent: 'info',
    };
    return <Badge variant={m[status] || 'default'} size="sm">{status.toUpperCase()}</Badge>;
  };

  // Channel icon
  const getChannelIcon = (channel?: string) => {
    const m: Record<string, { icon: React.ReactNode; label: string }> = {
      smpp: { icon: <Globe size={14} />, label: 'SMPP' },
      sms: { icon: <MessageSquare size={14} />, label: 'SMS' },
      whatsapp: { icon: <MessageSquare size={14} />, label: 'WhatsApp' },
      telegram: { icon: <MessageSquare size={14} />, label: 'Telegram' },
      voice_otp: { icon: <Smartphone size={14} />, label: 'Voice OTP' },
    };
    const c = m[channel || ''] || { icon: <Wifi size={14} />, label: (channel || '—').toUpperCase() };
    return (
      <div className="flex items-center gap-1 text-xs text-gray-500">
        {c.icon}
        <span>{c.label}</span>
      </div>
    );
  };

  const getRetryInfo = (entry: DLRQueue) => {
    const attempts = entry.retry_count || 0;
    const maxRetries = entry.max_retries || 3;
    const remaining = Math.max(0, maxRetries - attempts);
    const ratio = maxRetries > 0 ? attempts / maxRetries : 0;

    return (
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-gray-200 rounded-full overflow-hidden w-16">
          <div
            className={`h-full rounded-full transition-all ${
              ratio >= 1 ? 'bg-red-500' : ratio >= 0.66 ? 'bg-yellow-500' : 'bg-green-500'
            }`}
            style={{ width: `${Math.min(100, ratio * 100)}%` }}
          />
        </div>
        <span className={`text-xs font-medium ${
          remaining === 0 ? 'text-red-600' : remaining <= 1 ? 'text-yellow-600' : 'text-green-600'
        }`}>
          {attempts}/{maxRetries}
        </span>
      </div>
    );
  };

  // Filter & paginate
  const filtered = dlrQueue.filter(entry => {
    const ms = !search || 
      (entry.message_id || '').toLowerCase().includes(search.toLowerCase()) ||
      (entry.destination || '').includes(search) ||
      (entry.channel || '').toLowerCase().includes(search.toLowerCase());
    const st = statusFilter === 'all' || entry.status === statusFilter;
    const ch = channelFilter === 'all' || entry.channel === channelFilter;
    return ms && st && ch;
  });

  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const paginated = filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  const columns = [
    {
      key: 'channel',
      header: 'Channel',
      render: (entry: DLRQueue) => getChannelIcon(entry.channel),
    },
    {
      key: 'message_id',
      header: 'Message ID',
      render: (entry: DLRQueue) => (
        <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">
          {(entry.message_id || '').slice(-16)}
        </span>
      ),
    },
    {
      key: 'destination',
      header: 'Destination',
      render: (entry: DLRQueue) => (
        <span className="font-mono text-xs">{entry.destination || '-'}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (entry: DLRQueue) => getStatusBadge(entry.status || 'pending'),
    },
    {
      key: 'retry',
      header: 'Retries',
      render: (entry: DLRQueue) => getRetryInfo(entry),
    },
    {
      key: 'force_dlr',
      header: 'Force DLR',
      render: (entry: DLRQueue) => (
        <Badge variant={entry.force_dlr ? 'success' : 'default'} size="sm">
          {entry.force_dlr ? 'YES' : 'NO'}
        </Badge>
      ),
    },
    {
      key: 'submitted_at',
      header: 'Submitted',
      render: (entry: DLRQueue) => (
        <span className="text-xs text-gray-500">
          {entry.submitted_at ? new Date(entry.submitted_at).toLocaleString() : '-'}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (entry: DLRQueue) => (
        <div className="flex items-center gap-1">
          <button
            onClick={() => setDetailModal(entry)}
            className="p-1.5 rounded hover:bg-gray-100 transition-colors"
            title="View details"
          >
            <Eye size={14} className="text-gray-500" />
          </button>
          <button
            onClick={() => handleRetry(entry.id)}
            className="p-1.5 rounded hover:bg-blue-50 transition-colors"
            title="Reset retry"
          >
            <RotateCw size={14} className="text-blue-500" />
          </button>
          <button
            onClick={() => handleDelete(entry.id)}
            className="p-1.5 rounded hover:bg-red-50 transition-colors"
            title="Delete entry"
          >
            <Trash2 size={14} className="text-red-500" />
          </button>
        </div>
      ),
    },
  ];

  // Summary stats
  const total = dlrQueue.length;
  const pending = dlrQueue.filter(e => e.status === 'pending' || !e.status).length;
  const delivered = dlrQueue.filter(e => e.status === 'delivered' || e.status === 'sent').length;
  const failed = dlrQueue.filter(e => e.status === 'failed' || e.status === 'expired').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">DLR Queue</h1>
          <p className="text-gray-500 mt-1">
            {total} entries — Delivery receipt tracking & retry management
          </p>
        </div>
        <Button
          variant="secondary"
          icon={<RefreshCw size={16} />}
          onClick={refresh}
          disabled={loading}
        >
          {loading ? 'Refreshing...' : 'Refresh'}
        </Button>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <Clock size={20} className="text-blue-500 mb-1" />
          <p className="text-xl font-bold">{total}</p>
          <p className="text-xs text-gray-500">Total Entries</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <AlertTriangle size={20} className="text-yellow-500 mb-1" />
          <p className="text-xl font-bold text-yellow-600">{pending}</p>
          <p className="text-xs text-gray-500">Pending DLR</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <CheckCircle size={20} className="text-green-500 mb-1" />
          <p className="text-xl font-bold text-green-600">{delivered}</p>
          <p className="text-xs text-gray-500">Delivered</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <XCircle size={20} className="text-red-500 mb-1" />
          <p className="text-xl font-bold text-red-600">{failed}</p>
          <p className="text-xs text-gray-500">Failed</p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <div className="flex flex-col md:flex-row gap-3">
          <div className="flex-1 relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by message ID, destination, channel..."
              value={search}
              onChange={e => { setSearch(e.target.value); setCurrentPage(1); }}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setCurrentPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          >
            <option value="all">All Status</option>
            <option value="pending">Pending</option>
            <option value="sent">Sent</option>
            <option value="delivered">Delivered</option>
            <option value="failed">Failed</option>
            <option value="expired">Expired</option>
          </select>
          <select
            value={channelFilter}
            onChange={e => { setChannelFilter(e.target.value); setCurrentPage(1); }}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
          >
            <option value="all">All Channels</option>
            <option value="sms">SMS</option>
            <option value="smpp">SMPP</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="telegram">Telegram</option>
            <option value="voice_otp">Voice OTP</option>
          </select>
        </div>
      </Card>

      {/* Table */}
      <Card noPadding>
        <Table columns={columns} data={paginated} keyExtractor={e => e.id} />
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          totalItems={filtered.length}
          itemsPerPage={itemsPerPage}
        />
      </Card>

      {/* Detail Modal */}
      <Modal isOpen={!!detailModal} onClose={() => setDetailModal(null)} title="DLR Queue Entry Detail" size="lg">
        {detailModal && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-gray-500 mb-1">ID</p>
                <p className="font-mono text-xs">{detailModal.id}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Message ID</p>
                <p className="font-mono text-xs">{detailModal.message_id}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">SMPP Message ID</p>
                <p className="font-mono text-xs">{detailModal.smpp_message_id || '-'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Destination</p>
                <p className="font-mono">{detailModal.destination}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Status</p>
                {getStatusBadge(detailModal.status || 'pending')}
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Channel</p>
                {getChannelIcon(detailModal.channel)}
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Retry Count</p>
                <p className="font-medium">{detailModal.retry_count || 0} / {detailModal.max_retries || 3}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Force DLR</p>
                <Badge variant={detailModal.force_dlr ? 'success' : 'default'} size="sm">
                  {detailModal.force_dlr ? 'YES' : 'NO'}
                </Badge>
              </div>
              {detailModal.dlr_timeout && (
                <div>
                  <p className="text-xs text-gray-500 mb-1">DLR Timeout</p>
                  <p>{detailModal.dlr_timeout}s</p>
                </div>
              )}
            </div>

            <div className="border-t pt-4 grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-gray-500 mb-1">Submitted At</p>
                <p className="text-xs">{detailModal.submitted_at ? new Date(detailModal.submitted_at).toLocaleString() : '-'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Last Retry</p>
                <p className="text-xs">{detailModal.last_retry_at ? new Date(detailModal.last_retry_at).toLocaleString() : '-'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">DLR Received At</p>
                <p className="text-xs">{detailModal.dlr_received_at ? new Date(detailModal.dlr_received_at).toLocaleString() : '-'}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">DLR Result</p>
                <Badge variant={detailModal.dlr_result === 'DELIVRD' ? 'success' : detailModal.dlr_result === 'UNDELIV' ? 'danger' : 'default'} size="sm">
                  {detailModal.dlr_result || '-'}
                </Badge>
              </div>
            </div>

            {/* Actions */}
            {(detailModal.status === 'failed' || detailModal.status === 'expired' || !detailModal.status) && (
              <div className="border-t pt-4 flex justify-end gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<RotateCw size={14} />}
                  onClick={() => {
                    handleRetry(detailModal.id);
                    setDetailModal(null);
                  }}
                >
                  Reset & Retry
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  icon={<Trash2 size={14} />}
                  onClick={() => {
                    handleDelete(detailModal.id);
                    setDetailModal(null);
                  }}
                >
                  Delete Entry
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};
