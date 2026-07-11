import React, { useState, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, Filter, Download, Upload, MoreVertical, Edit, Trash2, Eye, RotateCcw, Wifi, WifiOff } from 'lucide-react';
import { useData } from '../../store/DataContext';
import { Card } from '../../components/UI/Card';
import { Button } from '../../components/UI/Button';
import { Badge } from '../../components/UI/Badge';
import { Table, Pagination } from '../../components/UI/Table';
import { Modal } from '../../components/UI/Modal';
import { Client } from '../../types';
import { bindApi } from '../../services/api';

export const ClientsList: React.FC = () => {
  const navigate = useNavigate();
  const { clients, deleteClient, restoreClient, routePlans } = useData();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [showDeleted, setShowDeleted] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [deleteModal, setDeleteModal] = useState<Client | null>(null);
  const [actionMenu, setActionMenu] = useState<string | null>(null);
  const [bindStatuses, setBindStatuses] = useState<Record<string, string>>({});

  const itemsPerPage = 10;

  const filteredClients = clients.filter(client => {
    if (!showDeleted && client.is_deleted) return false;
    const matchesSearch = 
      client.company_name.toLowerCase().includes(search.toLowerCase()) ||
      client.client_code.toLowerCase().includes(search.toLowerCase()) ||
      client.email.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || client.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const totalPages = Math.ceil(filteredClients.length / itemsPerPage);
  const paginatedClients = filteredClients.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const getRoutePlanName = (id: string | null) => {
    if (!id) return 'None';
    const plan = routePlans.find(p => p.id === id);
    return plan?.plan_name || 'Unknown';
  };

  const handleDelete = () => {
    if (deleteModal) {
      deleteClient(deleteModal.id);
      setDeleteModal(null);
    }
  };

  // Fetch client bind statuses on mount
  React.useEffect(() => {
    bindApi.getClientStatus().then((res: any) => {
      if (res.success && res.data?.data) {
        const map: Record<string, string> = {};
        res.data.data.forEach((c: any) => { map[c.id] = c.bind_status || 'unbound'; });
        setBindStatuses(map);
      }
    }).catch(() => {});
  }, [clients.length]);

  const handleExport = () => {
    const headers = ['id','client_code','company_name','contact_person','email','phone','address','country',
      'smpp_username','smpp_password','smpp_ip','smpp_port','system_type','max_tps',
      'billing_mode','currency','balance','credit_limit',
      'api_enabled','webhook_url','force_dlr','routing_plan_id','rate_plan_id','status'];
    const csvRows = [headers.join(',')];
    for (const c of filteredClients) {
      csvRows.push(headers.map(h => {
        const val = (c as any)[h];
        if (val === null || val === undefined) return '';
        const str = String(val);
        return str.includes(',') || str.includes('"') ? `"${str.replace(/"/g, '""')}"` : str;
      }).join(','));
    }
    const blob = new Blob(['\ufeff' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `clients_export_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const { api } = await import('../../services/api');
      const res: any = await api.post('/clients/bulk', { csv: text });
      if (res.success) {
        window.location.reload();
      } else {
        alert('Import failed: ' + (res.error || 'Unknown error'));
      }
    } catch (err: any) {
      alert('Import failed: ' + (err?.message || 'Unknown error'));
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const columns = [
    {
      key: 'client_code',
      header: 'Client Code',
      render: (client: Client) => (
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-sm">
            {client.company_name.charAt(0)}
          </div>
          <div>
            <p className="font-medium text-gray-800">{client.client_code}</p>
            <p className="text-xs text-gray-500">{client.company_name}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'contact',
      header: 'Contact',
      render: (client: Client) => (
        <div>
          <p className="text-sm text-gray-800">{client.contact_person}</p>
          <p className="text-xs text-gray-500">{client.email}</p>
        </div>
      ),
    },
    {
      key: 'bind',
      header: 'Bind',
      hideOnMobile: true,
      render: (client: Client) => {
        const status = bindStatuses[client.id] || 'unbound';
        const isBound = status === 'bound';
        return (
          <div className="flex items-center gap-2">
            {isBound ? <Wifi size={16} className="text-green-500" /> : <WifiOff size={16} className="text-red-400" />}
            <Badge variant={isBound ? 'success' : 'danger'} size="sm" dot>
              {isBound ? 'BOUND' : 'UNBOUND'}
            </Badge>
          </div>
        );
      },
    },
    {
      key: 'smpp_username',
      header: 'SMPP User',
      hideOnMobile: true,
      render: (client: Client) => (
        <span className="text-sm font-mono bg-gray-100 px-2 py-0.5 rounded">{client.smpp_username}</span>
      ),
    },
    {
      key: 'balance',
      header: 'Balance',
      align: 'right' as const,
      hideOnMobile: true,
      render: (client: Client) => (
        <div className="text-right">
          <p className="font-semibold text-gray-800">€{Number(client.balance || 0).toFixed(4)}</p>
          <p className="text-xs text-gray-500">Limit: €{Number(client.credit_limit || 0).toFixed(4)}</p>
        </div>
      ),
    },
    {
      key: 'routing_plan',
      header: 'Route Plan',
      hideOnMobile: true,
      render: (client: Client) => (
        <Badge variant="info">{getRoutePlanName(client.routing_plan_id)}</Badge>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (client: Client) => (
        <Badge
          variant={client.status === 'active' ? 'success' : client.status === 'suspended' ? 'danger' : 'warning'}
          dot
        >
          {client.status}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right' as const,
      render: (client: Client) => (
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setActionMenu(actionMenu === client.id ? null : client.id);
            }}
            className="p-1.5 rounded hover:bg-gray-100"
          >
            <MoreVertical size={16} className="text-gray-500" />
          </button>
          {actionMenu === client.id && (
            <div className="absolute right-0 top-full mt-1 w-40 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-10">
              <button
                onClick={() => navigate(`/clients/${client.id}`)}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <Eye size={14} />
                View Details
              </button>
              <button
                onClick={() => navigate(`/clients/${client.id}/edit`)}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <Edit size={14} />
                Edit
              </button>
              <hr className="my-1" />
              <button
                onClick={() => {
                  setDeleteModal(client);
                  setActionMenu(null);
                }}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
              >
                <Trash2 size={14} />
                Delete
              </button>
              {(client as any).is_deleted && (
                <>
                  <hr className="my-1" />
                  <button
                    onClick={async () => {
                      try {
                        await restoreClient(client.id);
                        setActionMenu(null);
                      } catch (e) {
                        alert('Failed to restore client');
                      }
                    }}
                    className="w-full flex items-center gap-2 px-4 py-2 text-sm text-green-600 hover:bg-green-50"
                  >
                    <RotateCcw size={14} />
                    Restore
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Clients</h1>
          <p className="text-gray-500 mt-1">Manage your client accounts and SMPP connections</p>
        </div>
        <Link to="/clients/add">
          <Button icon={<Plus size={18} />}>Add Client</Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-sm text-gray-500">Total Clients</p>
          <p className="text-2xl font-bold text-gray-800 mt-1">{clients.filter(c => !c.is_deleted).length}</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-sm text-gray-500">Active</p>
          <p className="text-2xl font-bold text-green-600 mt-1">
            {clients.filter(c => c.status === 'active').length}
          </p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-sm text-gray-500">Suspended</p>
          <p className="text-2xl font-bold text-red-600 mt-1">
            {clients.filter(c => c.status === 'suspended').length}
          </p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-sm text-gray-500">Total Balance</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">
            €{clients.filter(c => !c.is_deleted).reduce((sum, c) => sum + Number(c.balance || 0), 0).toFixed(4)}
          </p>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search clients..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="suspended">Suspended</option>
            </select>
            <label className="flex items-center gap-2 px-3 py-2 border border-gray-300 rounded-lg text-sm cursor-pointer hover:bg-gray-50">
              <input
                type="checkbox"
                checked={showDeleted}
                onChange={(e) => setShowDeleted(e.target.checked)}
                className="rounded"
              />
              <span className={showDeleted ? 'text-red-600 font-medium' : 'text-gray-600'}>Show Deleted</span>
            </label>
            <Button variant="secondary" icon={<Filter size={16} />}>Filters</Button>
            <Button variant="secondary" icon={<Download size={16} />} onClick={handleExport}>Export</Button>
            <Button variant="secondary" icon={<Upload size={16} />} onClick={() => fileInputRef.current?.click()}>Import</Button>
            <input type="file" ref={fileInputRef} accept=".csv,.txt" onChange={handleImport} className="hidden" />
          </div>
        </div>
      </Card>

      {/* Table */}
      <Card noPadding>
        <Table
          columns={columns}
          data={paginatedClients}
          keyExtractor={(client) => client.id}
          onRowClick={(client) => navigate(`/clients/${client.id}`)}
        />
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          totalItems={filteredClients.length}
          itemsPerPage={itemsPerPage}
        />
      </Card>

      {/* Delete Modal */}
      <Modal
        isOpen={!!deleteModal}
        onClose={() => setDeleteModal(null)}
        title="Delete Client"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setDeleteModal(null)}>Cancel</Button>
            <Button variant="danger" onClick={handleDelete}>Delete Client</Button>
          </div>
        }
      >
        <p className="text-gray-600">
          Are you sure you want to delete <strong>{deleteModal?.company_name}</strong>?
          This will soft-delete the client, mark their SMPP session as unbound,
          clear any pending DLRs, and unassign them from the bind status page.
          SMS logs, CDR, payments, and financial data are preserved.
          You can restore this client later from the "Show Deleted" view.
        </p>
      </Modal>
    </div>
  );
};
