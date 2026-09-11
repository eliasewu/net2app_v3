import React, { useState, useEffect, useCallback } from 'react';
import { TrendingUp, Radio, Activity } from 'lucide-react';
import { smsApi } from '../../services/api';
import { Card } from '../UI/Card';
import { Badge } from '../UI/Badge';

interface SupplierMOStats {
  supplier_id: number;
  supplier_code: string;
  company_name: string;
  is_inbound: boolean;
  smpp_host: string;
  total_mo_today: number;
  delivered: number;
  failed: number;
  pending: number;
  last_mo_at: string | null;
  throughput_60s: number;
  throughput_per_sec: number;
  delivery_rate: number;
}

interface InboundStats {
  totals: {
    total_mo_today: number;
    delivered: number;
    failed: number;
    pending: number;
  };
  suppliers: SupplierMOStats[];
  has_inbound_traffic: boolean;
}

export const InboundTrafficWidget: React.FC = () => {
  const [stats, setStats] = useState<InboundStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState(new Date());

  const fetchStats = useCallback(async () => {
    setError(null);
    try {
      const res: any = await smsApi.getInboundStats();
      // API client wraps server response: {success, data: {success, data: {...}}}
      if (res.success && res.data) {
        const inboundData = res.data.data || res.data; // fallback if single-wrapped
        if (inboundData && (inboundData.totals || inboundData.suppliers)) {
          setStats(inboundData);
        }
      }
      setLastRefresh(new Date());
    } catch (e: any) {
      setError(e?.message || 'Failed to fetch inbound stats');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 15000); // refresh every 15s
    return () => clearInterval(interval);
  }, [fetchStats]);

  const formatNumber = (num: number) =>
    num >= 1000000 ? (num / 1000000).toFixed(1) + 'M' :
    num >= 1000 ? (num / 1000).toFixed(1) + 'K' : num.toString();

  const formatTime = (ts: string | null) => {
    if (!ts) return '—';
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    if (diffMs < 60000) return `${Math.floor(diffMs / 1000)}s ago`;
    if (diffMs < 3600000) return `${Math.floor(diffMs / 60000)}m ago`;
    return d.toLocaleTimeString();
  };

  if (loading && !stats) {
    return (
      <Card title="Inbound SMS Traffic" subtitle="Real-time MO messages from GSM gateways">
        <div className="flex items-center justify-center h-32">
          <Activity size={24} className="animate-pulse text-blue-400" />
          <span className="ml-3 text-gray-500">Loading inbound traffic data...</span>
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card title="Inbound SMS Traffic" subtitle="Real-time MO messages from GSM gateways">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">
          {error}
        </div>
      </Card>
    );
  }

  const t = stats?.totals;
  const suppliers = stats?.suppliers || [];
  const hasSuppliers = suppliers.length > 0;
  const totalThroughput = suppliers.reduce((s, sup) => s + sup.throughput_per_sec, 0);

  // Color gradient for throughput
  const throughputColor = totalThroughput > 10 ? 'text-green-500' :
    totalThroughput > 1 ? 'text-blue-500' : 'text-gray-400';

  return (
    <Card noPadding>
      {/* Header with gradient */}
      <div className="bg-gradient-to-r from-blue-600 via-blue-700 to-indigo-800 rounded-t-xl px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white/15 rounded-lg">
              <Radio size={20} className="text-white" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-white">Inbound SMS Traffic</h3>
              <p className="text-xs text-blue-200">Real-time MO messages from GSM gateways</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className={`flex items-center gap-1.5 ${throughputColor}`}>
              <Activity size={16} className={totalThroughput > 0 ? 'animate-pulse' : ''} />
              <span className="text-lg font-bold">{totalThroughput.toFixed(1)}</span>
              <span className="text-xs opacity-70">msg/s</span>
            </div>
            <span className="text-[10px] text-blue-300">
              Updated {lastRefresh.toLocaleTimeString()}
            </span>
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-4 gap-3 mt-4">
          <div className="bg-white/10 rounded-lg px-3 py-2 text-center">
            <p className="text-[10px] text-blue-200 uppercase tracking-wide">Total MO</p>
            <p className="text-xl font-bold text-white">{formatNumber(t?.total_mo_today || 0)}</p>
          </div>
          <div className="bg-white/10 rounded-lg px-3 py-2 text-center">
            <p className="text-[10px] text-blue-200 uppercase tracking-wide">Delivered</p>
            <p className="text-xl font-bold text-green-300">{formatNumber(t?.delivered || 0)}</p>
          </div>
          <div className="bg-white/10 rounded-lg px-3 py-2 text-center">
            <p className="text-[10px] text-blue-200 uppercase tracking-wide">Failed</p>
            <p className="text-xl font-bold text-red-300">{formatNumber(t?.failed || 0)}</p>
          </div>
          <div className="bg-white/10 rounded-lg px-3 py-2 text-center">
            <p className="text-[10px] text-blue-200 uppercase tracking-wide">Pending</p>
            <p className="text-xl font-bold text-yellow-300">{formatNumber(t?.pending || 0)}</p>
          </div>
        </div>
      </div>

      {/* Supplier list */}
      <div className="px-5 py-3">
        {!hasSuppliers ? (
          <div className="flex flex-col items-center justify-center py-8 text-gray-400">
            <Radio size={32} className="mb-2 opacity-30" />
            <p className="text-sm">No inbound SMS traffic today</p>
            <p className="text-xs mt-1">MO messages from GSM gateways will appear here</p>
          </div>
        ) : (
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                {suppliers.length} Active Gateway{suppliers.length > 1 ? 's' : ''}
              </p>
            </div>
            <div className="space-y-2">
              {suppliers.map(supplier => (
                <div
                  key={supplier.supplier_id}
                  className={`p-3 rounded-lg border transition-all hover:shadow-sm ${
                    supplier.is_inbound
                      ? 'border-yellow-200 bg-yellow-50/50'
                      : 'border-gray-200 bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Status indicator */}
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        supplier.last_mo_at && (Date.now() - new Date(supplier.last_mo_at).getTime()) < 120000
                          ? 'bg-green-500 animate-pulse'
                          : 'bg-gray-300'
                      }`} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-gray-800 truncate">
                            {supplier.company_name || supplier.supplier_code}
                          </p>
                          {supplier.is_inbound && (
                            <Badge variant="warning" size="sm">Gateway</Badge>
                          )}
                        </div>
                        <p className="text-[10px] text-gray-500 truncate">
                          {supplier.supplier_code}
                          {supplier.smpp_host && ` · ${supplier.smpp_host}`}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 flex-shrink-0">
                      {/* Throughput */}
                      <div className="text-right">
                        <div className="flex items-center gap-1">
                          {supplier.throughput_per_sec > 0 ? (
                            <TrendingUp size={12} className="text-green-500" />
                          ) : (
                            <Activity size={12} className="text-gray-400" />
                          )}
                          <span className={`text-xs font-mono font-bold ${
                            supplier.throughput_per_sec > 0 ? 'text-green-600' : 'text-gray-400'
                          }`}>
                            {supplier.throughput_per_sec.toFixed(1)}/s
                          </span>
                        </div>
                        <p className="text-[9px] text-gray-400">{supplier.throughput_60s} in 60s</p>
                      </div>

                      {/* Volume & rate */}
                      <div className="text-right">
                        <p className="text-sm font-bold text-gray-800">
                          {formatNumber(supplier.total_mo_today)}
                        </p>
                        <div className="flex items-center gap-1.5 justify-end">
                          <span className="text-[9px] text-green-600 font-medium">
                            {supplier.delivery_rate}%
                          </span>
                          <span className="text-[9px] text-gray-400">DR</span>
                        </div>
                      </div>

                      {/* Mini bar */}
                      <div className="hidden sm:flex items-center gap-0.5">
                        {supplier.delivered > 0 && (
                          <div
                            className="w-1.5 bg-green-400 rounded-full"
                            style={{
                              height: `${Math.max(4, Math.min(24, (supplier.delivered / Math.max(supplier.total_mo_today, 1)) * 24))}px`
                            }}
                            title={`${supplier.delivered} delivered`}
                          />
                        )}
                        {supplier.failed > 0 && (
                          <div
                            className="w-1.5 bg-red-400 rounded-full"
                            style={{
                              height: `${Math.max(4, Math.min(24, (supplier.failed / Math.max(supplier.total_mo_today, 1)) * 24))}px`
                            }}
                            title={`${supplier.failed} failed`}
                          />
                        )}
                        {supplier.pending > 0 && (
                          <div
                            className="w-1.5 bg-yellow-400 rounded-full"
                            style={{
                              height: `${Math.max(4, Math.min(24, (supplier.pending / Math.max(supplier.total_mo_today, 1)) * 24))}px`
                            }}
                            title={`${supplier.pending} pending`}
                          />
                        )}
                      </div>

                      {/* Last seen */}
                      <div className="hidden md:block text-right min-w-[50px]">
                        <p className="text-[9px] text-gray-400">Last</p>
                        <p className="text-[10px] text-gray-500 font-mono">
                          {formatTime(supplier.last_mo_at)}
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Progress bar for delivery status */}
                  <div className="mt-2 w-full bg-gray-100 rounded-full h-1 overflow-hidden">
                    {supplier.total_mo_today > 0 && (
                      <>
                        <div
                          className="h-full bg-green-500 float-left"
                          style={{ width: `${(supplier.delivered / supplier.total_mo_today) * 100}%` }}
                        />
                        <div
                          className="h-full bg-red-400 float-left"
                          style={{ width: `${(supplier.failed / supplier.total_mo_today) * 100}%` }}
                        />
                        <div
                          className="h-full bg-yellow-400 float-left"
                          style={{ width: `${(supplier.pending / supplier.total_mo_today) * 100}%` }}
                        />
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
};
