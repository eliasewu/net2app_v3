import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Edit, Trash2, Send, CreditCard, BarChart3, MessageSquare, Radio } from 'lucide-react';
import { useData } from '../../store/DataContext';
import { Card } from '../../components/UI/Card';
import { Button } from '../../components/UI/Button';
import { Badge } from '../../components/UI/Badge';
import { Modal } from '../../components/UI/Modal';
import { Input } from '../../components/UI/Input';

export const ClientDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { getClientById, updateClient, deleteClient, smsLogs, invoices, routePlans } = useData();
  const client = id ? getClientById(id) : undefined;
  const [showTopup, setShowTopup] = useState(false);
  const [topupAmount, setTopupAmount] = useState(1000);
  const [activeTab, setActiveTab] = useState<'overview' | 'cdr' | 'usage' | 'payments'>('overview');

  if (!client) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600 text-lg">Client not found</p>
        <Button variant="secondary" onClick={() => navigate('/clients')} className="mt-4">Back to Clients</Button>
      </div>
    );
  }

  const clientSMS = smsLogs.filter(l => l.client_id === client.id);
  const clientInvoices = invoices.filter(i => i.entity_id === client.id && i.entity_type === 'client');
  const clientPayments = [
    { id: '1', amount: 10000, date: '2024-01-05', method: 'Bank Transfer', reference: 'BT-123456', status: 'completed' },
    { id: '2', amount: 5000, date: '2024-02-10', method: 'Credit Card', reference: 'CC-789012', status: 'completed' },
  ];
  const routePlan = routePlans.find(p => p.id === client.routing_plan_id);

  const handleTopup = () => {
    updateClient(client.id, { balance: client.balance + topupAmount });
    setShowTopup(false);
  };

  const handleDelete = () => {
    if (window.confirm('Are you sure you want to delete this client?')) {
      deleteClient(client.id);
      navigate('/clients');
    }
  };

  const usageData = [
    { month: 'Jan', sms: 150000, cost: 3750 },
    { month: 'Feb', sms: 180000, cost: 4500 },
    { month: 'Mar', sms: 220000, cost: 5500 },
    { month: 'Apr', sms: 195000, cost: 4875 },
    { month: 'May', sms: 210000, cost: 5250 },
    { month: 'Jun', sms: 240000, cost: 6000 },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-lg">
            <ArrowLeft size={20} className="text-gray-600" />
          </button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-800">{client.company_name}</h1>
              <Badge variant={client.status === 'active' ? 'success' : client.status === 'suspended' ? 'danger' : 'warning'}>{client.status}</Badge>
            </div>
            <p className="text-gray-500">{client.client_code} • {client.email}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" icon={<Edit size={16} />} onClick={() => navigate(`/clients/${client.id}/edit`)}>Edit</Button>
          <Button variant="secondary" icon={<Send size={16} />} onClick={() => {}}>Send Welcome Email</Button>
          <Button variant="danger" icon={<Trash2 size={16} />} onClick={handleDelete}>Delete</Button>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-5 text-white">
          <CreditCard size={20} className="mb-2" />
          <p className="text-sm opacity-80">Balance</p>
          <p className="text-2xl font-bold">€{client.balance.toLocaleString()}</p>
        </div>
        <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl p-5 text-white">
          <BarChart3 size={20} className="mb-2" />
          <p className="text-sm opacity-80">Credit Limit</p>
          <p className="text-2xl font-bold">€{client.credit_limit.toLocaleString()}</p>
        </div>
        <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl p-5 text-white">
          <MessageSquare size={20} className="mb-2" />
          <p className="text-sm opacity-80">SMS This Month</p>
          <p className="text-2xl font-bold">{clientSMS.length.toLocaleString()}</p>
        </div>
        <div className="bg-gradient-to-br from-indigo-500 to-indigo-600 rounded-xl p-5 text-white">
          <Radio size={20} className="mb-2" />
          <p className="text-sm opacity-80">Max TPS</p>
          <p className="text-2xl font-bold">{client.max_tps}</p>
        </div>
        <div className="bg-white rounded-xl p-5 border border-gray-200">
          <p className="text-sm text-gray-500">Actions</p>
          <Button size="sm" onClick={() => setShowTopup(true)} className="mt-2 w-full">Top Up</Button>
          <Button size="sm" variant="secondary" onClick={() => navigate('/testing/sms')} className="mt-2 w-full">Send Test SMS</Button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200">
        {(['overview', 'cdr', 'usage', 'payments'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors capitalize ${
              activeTab === tab
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card title="Company Details">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><p className="text-gray-500">Company</p><p className="font-medium">{client.company_name}</p></div>
              <div><p className="text-gray-500">Client Code</p><p className="font-mono">{client.client_code}</p></div>
              <div><p className="text-gray-500">Contact</p><p>{client.contact_person}</p></div>
              <div><p className="text-gray-500">Email</p><p>{client.email}</p></div>
              <div><p className="text-gray-500">Phone</p><p>{client.phone}</p></div>
              <div><p className="text-gray-500">Country</p><p>{client.country}</p></div>
              <div className="col-span-2"><p className="text-gray-500">Address</p><p>{client.address}</p></div>
            </div>
          </Card>

          <Card title="SMPP/HTTP Settings">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><p className="text-gray-500">SMPP Username</p><p className="font-mono">{client.smpp_username}</p></div>
              <div><p className="text-gray-500">System Type</p><p>{client.system_type}</p></div>
              <div><p className="text-gray-500">Allowed IP</p><p className="font-mono">{client.smpp_ip || 'Any'}</p></div>
              <div><p className="text-gray-500">Port</p><p>{client.smpp_port}</p></div>
              <div><p className="text-gray-500">Max TPS</p><p>{client.max_tps}</p></div>
              <div><p className="text-gray-500">Billing Mode</p><Badge variant={client.billing_mode === 'dlr' ? 'info' : 'warning'}>{client.billing_mode}</Badge></div>
              <div><p className="text-gray-500">API Enabled</p><Badge variant={client.api_enabled ? 'success' : 'default'}>{client.api_enabled ? 'Yes' : 'No'}</Badge></div>
              <div><p className="text-gray-500">Force DLR</p><Badge variant={client.force_dlr ? 'success' : 'default'}>{client.force_dlr ? 'Yes' : 'No'}</Badge></div>
              {client.webhook_url && <div className="col-span-2"><p className="text-gray-500">Webhook</p><p className="text-xs font-mono">{client.webhook_url}</p></div>}
            </div>
          </Card>

          <Card title="Routing Configuration">
            <div className="space-y-3">
              <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                <span className="text-gray-600">Route Plan</span>
                <Badge variant="info">{routePlan?.plan_name || 'None'}</Badge>
              </div>
              <div className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                <span className="text-gray-600">Currency</span>
                <Badge>{client.currency}</Badge>
              </div>
            </div>
          </Card>

          <Card title="Recent Invoices">
            {clientInvoices.length === 0 ? (
              <p className="text-gray-500 text-sm">No invoices yet</p>
            ) : (
              <div className="space-y-3">
                {clientInvoices.slice(0, 3).map(inv => (
                  <div key={inv.id} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                    <div>
                      <p className="font-medium text-gray-800">{inv.invoice_number}</p>
                      <p className="text-xs text-gray-500">{new Date(inv.period_start).toLocaleDateString()} - {new Date(inv.period_end).toLocaleDateString()}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">€{inv.grand_total.toLocaleString()}</p>
                      <Badge variant={inv.status === 'paid' ? 'success' : inv.status === 'overdue' ? 'danger' : 'warning'}>{inv.status}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {activeTab === 'cdr' && (
        <Card title="CDR (Call Detail Records)" noPadding>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Message ID</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Destination</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Rate</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {clientSMS.slice(0, 20).map(sms => (
                  <tr key={sms.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3"><span className="font-mono text-xs">{sms.message_id.slice(0, 12)}...</span></td>
                    <td className="px-4 py-3"><span className="font-mono">{sms.destination}</span></td>
                    <td className="px-4 py-3"><Badge variant={sms.status === 'delivered' ? 'success' : sms.status === 'failed' ? 'danger' : 'warning'} size="sm">{sms.status}</Badge></td>
                    <td className="px-4 py-3">€{sms.client_rate.toFixed(4)}</td>
                    <td className="px-4 py-3 text-gray-500">{new Date(sms.submit_time).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {activeTab === 'usage' && (
        <Card title="Monthly Usage">
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-blue-50 p-4 rounded-lg text-center">
                <p className="text-sm text-blue-600">Total SMS</p>
                <p className="text-2xl font-bold text-blue-700">1.2M</p>
              </div>
              <div className="bg-green-50 p-4 rounded-lg text-center">
                <p className="text-sm text-green-600">Total Cost</p>
                <p className="text-2xl font-bold text-green-700">€30,000</p>
              </div>
              <div className="bg-purple-50 p-4 rounded-lg text-center">
                <p className="text-sm text-purple-600">Avg Rate/SMS</p>
                <p className="text-2xl font-bold text-purple-700">€0.025</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-4 py-3 text-left font-medium text-gray-500">Month</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">SMS Count</th>
                    <th className="px-4 py-3 text-right font-medium text-gray-500">Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {usageData.map((row, i) => (
                    <tr key={i}>
                      <td className="px-4 py-3 font-medium">{row.month}</td>
                      <td className="px-4 py-3 text-right">{row.sms.toLocaleString()}</td>
                      <td className="px-4 py-3 text-right font-semibold">€{row.cost.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Card>
      )}

      {activeTab === 'payments' && (
        <Card title="Payment History" noPadding>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b">
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Reference</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Method</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Amount</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {clientPayments.map(p => (
                <tr key={p.id}>
                  <td className="px-4 py-3 font-mono text-xs">{p.reference}</td>
                  <td className="px-4 py-3">{p.method}</td>
                  <td className="px-4 py-3 text-right font-semibold">€{p.amount.toLocaleString()}</td>
                  <td className="px-4 py-3">{p.date}</td>
                  <td className="px-4 py-3"><Badge variant="success">{p.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {/* Topup Modal */}
      <Modal isOpen={showTopup} onClose={() => setShowTopup(false)} title="Top Up Balance"
        footer={<div className="flex justify-end gap-3"><Button variant="secondary" onClick={() => setShowTopup(false)}>Cancel</Button><Button onClick={handleTopup}>Confirm Top Up</Button></div>}>
        <div className="space-y-4">
          <div className="bg-blue-50 p-4 rounded-lg">
            <p className="text-sm text-blue-700">Current Balance: <strong>€{client.balance.toLocaleString()}</strong></p>
          </div>
          <Input label="Top Up Amount (EUR)" type="number" value={topupAmount} onChange={(e) => setTopupAmount(Number(e.target.value))} min={1} />
          <div className="bg-green-50 p-4 rounded-lg">
            <p className="text-sm text-green-700">New Balance: <strong>€{(client.balance + topupAmount).toLocaleString()}</strong></p>
          </div>
        </div>
      </Modal>
    </div>
  );
};
