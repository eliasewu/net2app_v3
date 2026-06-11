import React, { useState } from 'react';
import { Plus, Search, Download, Eye, Send, CheckCircle, FileText } from 'lucide-react';
import { useData } from '../../store/DataContext';
import { Card } from '../../components/UI/Card';
import { Button } from '../../components/UI/Button';
import { Badge } from '../../components/UI/Badge';
import { Table, Pagination } from '../../components/UI/Table';
import { Modal } from '../../components/UI/Modal';
import { Input, Select } from '../../components/UI/Input';
import { Invoice } from '../../types';

export const InvoicesList: React.FC = () => {
  const { invoices, clients, suppliers, addInvoice, updateInvoice } = useData();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [showModal, setShowModal] = useState(false);
  const [viewModal, setViewModal] = useState<Invoice | null>(null);

  const [formData, setFormData] = useState({
    entity_type: 'client' as 'client' | 'supplier',
    entity_id: '',
    period_start: '',
    period_end: '',
    notes: '',
  });

  const itemsPerPage = 10;

  const filteredInvoices = invoices.filter(invoice => {
    const matchesSearch = 
      invoice.invoice_number.toLowerCase().includes(search.toLowerCase()) ||
      invoice.entity_name.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || invoice.status === statusFilter;
    const matchesType = typeFilter === 'all' || invoice.entity_type === typeFilter;
    return matchesSearch && matchesStatus && matchesType;
  });

  const totalPages = Math.ceil(filteredInvoices.length / itemsPerPage);
  const paginatedInvoices = filteredInvoices.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'default'> = {
      paid: 'success',
      sent: 'info',
      draft: 'default',
      overdue: 'danger',
      cancelled: 'warning',
    };
    return <Badge variant={statusMap[status] || 'default'}>{status}</Badge>;
  };

  const handleCreateInvoice = () => {
    const entity = formData.entity_type === 'client' 
      ? clients.find(c => c.id === formData.entity_id)
      : suppliers.find(s => s.id === formData.entity_id);

    if (!entity) return;

    const invoiceNumber = `INV-${new Date().getFullYear()}-${String(invoices.length + 1).padStart(3, '0')}`;
    
    addInvoice({
      invoice_number: invoiceNumber,
      entity_type: formData.entity_type,
      entity_id: formData.entity_id,
      entity_name: entity.company_name,
      period_start: formData.period_start,
      period_end: formData.period_end,
      total_sms: Math.floor(Math.random() * 100000 + 10000),
      total_amount: Math.floor(Math.random() * 5000 + 1000),
      tax_amount: Math.floor(Math.random() * 1000),
      grand_total: Math.floor(Math.random() * 6000 + 1500),
      currency: 'EUR',
      status: 'draft',
      due_date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      paid_date: null,
      notes: formData.notes,
    });

    setShowModal(false);
    setFormData({
      entity_type: 'client',
      entity_id: '',
      period_start: '',
      period_end: '',
      notes: '',
    });
  };

  const columns = [
    {
      key: 'invoice_number',
      header: 'Invoice #',
      render: (invoice: Invoice) => (
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-gray-400" />
          <span className="font-medium text-gray-800">{invoice.invoice_number}</span>
        </div>
      ),
    },
    {
      key: 'entity',
      header: 'Entity',
      render: (invoice: Invoice) => (
        <div>
          <p className="font-medium text-gray-800">{invoice.entity_name}</p>
          <Badge variant={invoice.entity_type === 'client' ? 'info' : 'purple'} size="sm">
            {invoice.entity_type}
          </Badge>
        </div>
      ),
    },
    {
      key: 'period',
      header: 'Period',
      render: (invoice: Invoice) => (
        <span className="text-sm text-gray-600">
          {new Date(invoice.period_start).toLocaleDateString()} - {new Date(invoice.period_end).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: 'total_sms',
      header: 'SMS',
      align: 'right' as const,
      render: (invoice: Invoice) => (
        <span className="font-medium text-gray-800">{invoice.total_sms.toLocaleString()}</span>
      ),
    },
    {
      key: 'grand_total',
      header: 'Amount',
      align: 'right' as const,
      render: (invoice: Invoice) => (
        <div className="text-right">
          <p className="font-semibold text-gray-800">€{invoice.grand_total.toLocaleString()}</p>
          <p className="text-xs text-gray-500">(Tax: €{invoice.tax_amount.toLocaleString()})</p>
        </div>
      ),
    },
    {
      key: 'due_date',
      header: 'Due Date',
      render: (invoice: Invoice) => (
        <span className="text-sm text-gray-600">{new Date(invoice.due_date).toLocaleDateString()}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (invoice: Invoice) => getStatusBadge(invoice.status),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right' as const,
      render: (invoice: Invoice) => (
        <div className="flex items-center justify-end gap-1">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setViewModal(invoice);
            }}
            className="p-1.5 rounded hover:bg-gray-100"
            title="View"
          >
            <Eye size={16} className="text-gray-500" />
          </button>
          {invoice.status === 'draft' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                updateInvoice(invoice.id, { status: 'sent' });
              }}
              className="p-1.5 rounded hover:bg-gray-100"
              title="Send"
            >
              <Send size={16} className="text-blue-500" />
            </button>
          )}
          {invoice.status === 'sent' && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                updateInvoice(invoice.id, { status: 'paid', paid_date: new Date().toISOString() });
              }}
              className="p-1.5 rounded hover:bg-gray-100"
              title="Mark Paid"
            >
              <CheckCircle size={16} className="text-green-500" />
            </button>
          )}
          <button className="p-1.5 rounded hover:bg-gray-100" title="Download PDF">
            <Download size={16} className="text-gray-500" />
          </button>
        </div>
      ),
    },
  ];

  const stats = {
    total: invoices.reduce((sum, i) => sum + i.grand_total, 0),
    paid: invoices.filter(i => i.status === 'paid').reduce((sum, i) => sum + i.grand_total, 0),
    pending: invoices.filter(i => ['draft', 'sent'].includes(i.status)).reduce((sum, i) => sum + i.grand_total, 0),
    overdue: invoices.filter(i => i.status === 'overdue').reduce((sum, i) => sum + i.grand_total, 0),
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Invoices</h1>
          <p className="text-gray-500 mt-1">Generate and manage invoices for clients and suppliers</p>
        </div>
        <Button icon={<Plus size={18} />} onClick={() => setShowModal(true)}>
          Generate Invoice
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-sm text-gray-500">Total Invoiced</p>
          <p className="text-2xl font-bold text-gray-800 mt-1">€{stats.total.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-sm text-gray-500">Paid</p>
          <p className="text-2xl font-bold text-green-600 mt-1">€{stats.paid.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-sm text-gray-500">Pending</p>
          <p className="text-2xl font-bold text-yellow-600 mt-1">€{stats.pending.toLocaleString()}</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-sm text-gray-500">Overdue</p>
          <p className="text-2xl font-bold text-red-600 mt-1">€{stats.overdue.toLocaleString()}</p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search invoices..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-2">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Types</option>
              <option value="client">Client</option>
              <option value="supplier">Supplier</option>
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Status</option>
              <option value="draft">Draft</option>
              <option value="sent">Sent</option>
              <option value="paid">Paid</option>
              <option value="overdue">Overdue</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Table */}
      <Card noPadding>
        <Table
          columns={columns}
          data={paginatedInvoices}
          keyExtractor={(invoice) => invoice.id}
          onRowClick={(invoice) => setViewModal(invoice)}
        />
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          totalItems={filteredInvoices.length}
          itemsPerPage={itemsPerPage}
        />
      </Card>

      {/* Generate Invoice Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title="Generate Invoice"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={handleCreateInvoice}>Generate Invoice</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Select
            label="Entity Type"
            value={formData.entity_type}
            onChange={(e) => setFormData(prev => ({ ...prev, entity_type: e.target.value as 'client' | 'supplier', entity_id: '' }))}
            options={[
              { value: 'client', label: 'Client' },
              { value: 'supplier', label: 'Supplier' },
            ]}
          />
          <Select
            label={formData.entity_type === 'client' ? 'Client' : 'Supplier'}
            value={formData.entity_id}
            onChange={(e) => setFormData(prev => ({ ...prev, entity_id: e.target.value }))}
            options={[
              { value: '', label: 'Select...' },
              ...(formData.entity_type === 'client' 
                ? clients.map(c => ({ value: c.id, label: `${c.client_code} - ${c.company_name}` }))
                : suppliers.map(s => ({ value: s.id, label: `${s.supplier_code} - ${s.company_name}` }))
              )
            ]}
            required
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Period Start"
              type="date"
              value={formData.period_start}
              onChange={(e) => setFormData(prev => ({ ...prev, period_start: e.target.value }))}
              required
            />
            <Input
              label="Period End"
              type="date"
              value={formData.period_end}
              onChange={(e) => setFormData(prev => ({ ...prev, period_end: e.target.value }))}
              required
            />
          </div>
          <Input
            label="Notes (optional)"
            value={formData.notes}
            onChange={(e) => setFormData(prev => ({ ...prev, notes: e.target.value }))}
            placeholder="Any additional notes..."
          />
        </div>
      </Modal>

      {/* View Invoice Modal - Professional */}
      <Modal
        isOpen={!!viewModal}
        onClose={() => setViewModal(null)}
        title=""
        size="full"
      >
        {viewModal && (
          <div className="space-y-6" id="invoice-print">
            {/* Professional Invoice Header */}
            <div className="flex justify-between items-start border-b pb-6">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl">📡</span>
                  <span className="text-xl font-bold text-gray-800">NET2APP Hub</span>
                </div>
                <p className="text-sm text-gray-600">Enterprise SMS Platform</p>
                <p className="text-sm text-gray-600">support@net2app.com</p>
              </div>
              <div className="text-right">
                <h2 className="text-3xl font-bold text-gray-800">INVOICE</h2>
                <p className="text-lg font-semibold text-blue-600 mt-1">{viewModal.invoice_number}</p>
                <div className="mt-2">{getStatusBadge(viewModal.status)}</div>
              </div>
            </div>

            {/* Invoice To / Invoice By */}
            <div className="grid grid-cols-2 gap-8">
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Invoice To</p>
                <p className="font-semibold text-gray-800">{viewModal.entity_name}</p>
                <p className="text-sm text-gray-600">{viewModal.entity_type === 'client' ? 'Client' : 'Supplier'}</p>
              </div>
              <div className="p-4 bg-gray-50 rounded-lg">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Invoice By</p>
                <p className="font-semibold text-gray-800">NET2APP Hub</p>
                <p className="text-sm text-gray-600">Platform Provider</p>
                <p className="text-sm text-gray-600">VAT: TBD</p>
              </div>
            </div>

            {/* Key Dates */}
            <div className="grid grid-cols-4 gap-4 text-sm">
              <div><p className="text-xs text-gray-500">Invoice Date</p><p className="font-medium">{new Date(viewModal.created_at).toLocaleDateString()}</p></div>
              <div><p className="text-xs text-gray-500">Period Start</p><p className="font-medium">{new Date(viewModal.period_start).toLocaleDateString()}</p></div>
              <div><p className="text-xs text-gray-500">Period End</p><p className="font-medium">{new Date(viewModal.period_end).toLocaleDateString()}</p></div>
              <div><p className="text-xs text-gray-500">Due Date</p><p className="font-medium text-red-600">{new Date(viewModal.due_date).toLocaleDateString()}</p></div>
            </div>

            {/* Destination Breakdown */}
            <div>
              <h4 className="font-semibold text-gray-800 mb-3">Destination-Wise Breakdown</h4>
              <table className="w-full text-sm border">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-4 py-2 text-left">Destination</th>
                    <th className="px-4 py-2 text-left">MCC/MNC</th>
                    <th className="px-4 py-2 text-right">SMS Count</th>
                    <th className="px-4 py-2 text-right">Rate</th>
                    <th className="px-4 py-2 text-right">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {[
                    { dest: 'United States', mccmnc: '310*', sms: Math.floor(viewModal.total_sms * 0.35), rate: 0.025, amount: Math.floor(viewModal.total_amount * 0.35) },
                    { dest: 'United Kingdom', mccmnc: '234*', sms: Math.floor(viewModal.total_sms * 0.25), rate: 0.022, amount: Math.floor(viewModal.total_amount * 0.25) },
                    { dest: 'Germany', mccmnc: '262*', sms: Math.floor(viewModal.total_sms * 0.15), rate: 0.028, amount: Math.floor(viewModal.total_amount * 0.15) },
                    { dest: 'France', mccmnc: '208*', sms: Math.floor(viewModal.total_sms * 0.12), rate: 0.026, amount: Math.floor(viewModal.total_amount * 0.12) },
                    { dest: 'Others', mccmnc: '*', sms: Math.floor(viewModal.total_sms * 0.13), rate: 0.030, amount: Math.floor(viewModal.total_amount * 0.13) },
                  ].map((d, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-2">{d.dest}</td>
                      <td className="px-4 py-2"><code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">{d.mccmnc}</code></td>
                      <td className="px-4 py-2 text-right">{d.sms.toLocaleString()}</td>
                      <td className="px-4 py-2 text-right">€{d.rate.toFixed(4)}</td>
                      <td className="px-4 py-2 text-right font-medium">€{d.amount.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Totals */}
            <div className="flex justify-end">
              <div className="w-80 space-y-2">
                <div className="flex justify-between text-sm"><span>Subtotal</span><span className="font-medium">€{viewModal.total_amount.toLocaleString()}</span></div>
                <div className="flex justify-between text-sm"><span>Tax (19%)</span><span className="font-medium">€{viewModal.tax_amount.toLocaleString()}</span></div>
                <hr />
                <div className="flex justify-between text-lg font-bold"><span>Total</span><span>€{viewModal.grand_total.toLocaleString()}</span></div>
              </div>
            </div>

            {/* Bank Details */}
            <div className="bg-gray-50 p-4 rounded-lg text-sm">
              <p className="font-semibold mb-2">Payment Information</p>
              <div className="grid grid-cols-2 gap-2 text-gray-600">
                <p>Bank: TBD (from Platform Settings)</p>
                <p>Account: TBD</p>
                <p>IBAN: TBD</p>
                <p>BIC/SWIFT: TBD</p>
              </div>
            </div>

            {viewModal.notes && <div className="text-sm text-gray-600"><strong>Notes:</strong> {viewModal.notes}</div>}

            <div className="flex justify-end gap-3 pt-4 border-t">
              <Button variant="secondary" icon={<Download size={16} />} onClick={() => window.print()}>Download PDF</Button>
              {viewModal.status === 'draft' && (
                <Button icon={<Send size={16} />} onClick={() => { updateInvoice(viewModal.id, { status: 'sent' }); setViewModal(null); }}>Send Invoice</Button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
