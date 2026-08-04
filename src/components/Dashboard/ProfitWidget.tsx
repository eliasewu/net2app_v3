import React, { useEffect, useState } from 'react';
import { TrendingUp, TrendingDown, DollarSign, Activity } from 'lucide-react';
import { Card } from '../UI/Card';
import { api } from '../../services/api';

interface ClientProfit {
  client_id: number;
  client_code: string;
  company_name: string;
  total_sms: number;
  billed_sms: number;
  delivered: number;
  failed: number;
  revenue: number;
  cost: number;
  profit: number;
}

interface ProfitData {
  clients: ClientProfit[];
  totals: {
    total_sms: number;
    billed_sms: number;
    delivered: number;
    failed: number;
    revenue: number;
    cost: number;
    profit: number;
  };
}

export const ProfitWidget: React.FC = () => {
  const [data, setData] = useState<ProfitData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchProfit = async () => {
    try {
      const resp = await api.get<any>('/dashboard/profit');
      // API client wraps server response: {success, data: {success, data: {...}}}
      // resp.data = the server response object, resp.data.data = actual profit data
      if (resp.success && resp.data) {
        const profitData = resp.data.data || resp.data; // fallback if single-wrapped
        if (profitData && Array.isArray(profitData.clients) && profitData.totals) {
          setData(profitData);
        }
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProfit();
    const interval = setInterval(fetchProfit, 15000); // refresh every 15s
    return () => clearInterval(interval);
  }, []);

  const fmt = (n: number) => `€${n.toFixed(4)}`;
  const maxProfit = Math.max(...(data?.clients.map(c => Math.abs(c.profit)) || [1]), 1);

  return (
    <Card
      title="Today's Profit Breakdown"
      subtitle={data ? `${data.totals.billed_sms} billed SMS · ${data.clients.length} clients` : 'Loading...'}
      action={<Activity size={18} className="text-green-500" />}
    >
      {loading && (
        <div className="py-8 text-center text-gray-400 text-sm">Loading profit data...</div>
      )}
      {error && (
        <div className="py-8 text-center text-red-400 text-sm">{error}</div>
      )}
      {data && data.clients?.length === 0 && (
        <div className="py-8 text-center text-gray-400 text-sm">No SMS activity today yet</div>
      )}
      {data && data.clients?.length > 0 && (
        <div className="space-y-3">
          {/* Per-client bars */}
          {data.clients.map((c) => {
            const barWidth = Math.max((Math.abs(c.profit) / maxProfit) * 100, 5);
            const isPositive = c.profit >= 0;
            return (
              <div key={c.client_id} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-700">{c.client_code}</span>
                    <span className="text-gray-400">{c.company_name}</span>
                  </div>
                  <div className="flex items-center gap-3 text-gray-500">
                    <span title="Revenue" className="text-blue-600 font-medium">{fmt(c.revenue)}</span>
                    <span title="Cost" className="text-red-500">-{fmt(c.cost)}</span>
                    <span className={`font-semibold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                      {isPositive ? '+' : ''}{fmt(c.profit)}
                    </span>
                  </div>
                </div>
                <div className="relative h-5 bg-gray-100 rounded-full overflow-hidden">
                  {/* Revenue bar */}
                  <div
                    className="absolute inset-y-0 left-0 bg-blue-400 rounded-l-full transition-all duration-500"
                    style={{ width: `${(c.revenue / (maxProfit * 2 || 1)) * 100}%` }}
                  />
                  {/* Profit indicator */}
                  <div
                    className={`absolute inset-y-0 left-0 rounded-full transition-all duration-500 ${isPositive ? 'bg-green-500' : 'bg-red-500'}`}
                    style={{ width: `${barWidth}%`, opacity: 0.6 }}
                  />
                  <div className="absolute inset-y-0 left-0 flex items-center px-2">
                    <span className="text-[10px] font-medium text-white drop-shadow">
                      {c.billed_sms} billed · {c.delivered} del · {c.failed} fail
                    </span>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Totals row */}
          <div className="pt-3 mt-3 border-t border-gray-200">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-gray-800">Today's Total</span>
              <div className="flex items-center gap-4 text-sm">
                <div className="flex items-center gap-1 text-blue-600">
                  <DollarSign size={14} />
                  <span className="font-semibold">{fmt(data.totals.revenue)}</span>
                </div>
                <div className="flex items-center gap-1 text-red-500">
                  <TrendingDown size={14} />
                  <span className="font-semibold">-{fmt(data.totals.cost)}</span>
                </div>
                <div className={`flex items-center gap-1 font-bold text-base ${data.totals.profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  <TrendingUp size={16} />
                  <span>{data.totals.profit >= 0 ? '+' : ''}{fmt(data.totals.profit)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
};
