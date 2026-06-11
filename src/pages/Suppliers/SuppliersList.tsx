import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, Download, MoreVertical, Edit, Trash2, Eye, Wifi, WifiOff } from 'lucide-react';
import { useData } from '../../store/DataContext';
import { Card } from '../../components/UI/Card';
import { Button } from '../../components/UI/Button';
import { Badge } from '../../components/UI/Badge';
import { Table, Pagination } from '../../components/UI/Table';
import { Modal } from '../../components/UI/Modal';
import { Supplier } from '../../types';

export const SuppliersList: React.FC = () => {
  const navigate = useNavigate();
  const { suppliers, deleteSupplier } = useData();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [deleteModal, setDeleteModal] = useState<Supplier | null>(null);
  const [actionMenu, setActionMenu] = useState<string | null>(null);

  const itemsPerPage = 10;

  const filteredSuppliers = suppliers.filter(supplier => {
    const matchesSearch = 
      supplier.company_name.toLowerCase().includes(search.toLowerCase()) ||
      supplier.supplier_code.toLowerCase().includes(search.toLowerCase()) ||
      supplier.email.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === 'all' || supplier.status === statusFilter;
    const matchesType = typeFilter === 'all' || supplier.connection_type === typeFilter;
    return matchesSearch && matchesStatus && matchesType;
  });

  const totalPages = Math.ceil(filteredSuppliers.length / itemsPerPage);
  const paginatedSuppliers = filteredSuppliers.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  const handleDelete = () => {
    if (deleteModal) {
      deleteSupplier(deleteModal.id);
      setDeleteModal(null);
    }
  };

  const getConnectionTypeBadge = (type: string) => {
    const typeMap: Record<string, { label: string; variant: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'purple' }> = {
      smpp: { label: 'SMPP', variant: 'info' },
      http: { label: 'HTTP API', variant: 'purple' },
      ott_whatsapp: { label: 'WhatsApp', variant: 'success' },
      ott_telegram: { label: 'Telegram', variant: 'info' },
      voice_otp: { label: 'Voice OTP', variant: 'warning' },
      local_bypass: { label: 'Local Bypass', variant: 'default' },
      rcs: { label: 'RCS', variant: 'purple' },
    };
    const config = typeMap[type] || { label: type.toUpperCase(), variant: 'default' as const };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const columns = [
    {
      key: 'supplier_code',
      header: 'Supplier',
      render: (supplier: Supplier) => (
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-white font-bold text-sm">
            {supplier.company_name.charAt(0)}
          </div>
          <div>
            <p className="font-medium text-gray-800">{supplier.supplier_code}</p>
            <p className="text-xs text-gray-500">{supplier.company_name}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'contact',
      header: 'Contact',
      render: (supplier: Supplier) => (
        <div>
          <p className="text-sm text-gray-800">{supplier.contact_person}</p>
          <p className="text-xs text-gray-500">{supplier.email}</p>
        </div>
      ),
    },
    {
      key: 'connection_type',
      header: 'Type',
      render: (supplier: Supplier) => getConnectionTypeBadge(supplier.connection_type),
    },
    {
      key: 'bind_status',
      header: 'Bind Status',
      render: (supplier: Supplier) => (
        <div className="flex items-center gap-2">
          {supplier.bind_status === 'bound' ? (
            <Wifi size={16} className="text-green-500" />
          ) : (
            <WifiOff size={16} className="text-red-500" />
          )}
          <Badge
            variant={supplier.bind_status === 'bound' ? 'success' : supplier.bind_status === 'error' ? 'danger' : 'warning'}
          >
            {supplier.bind_status}
          </Badge>
        </div>
      ),
    },
    {
      key: 'failures',
      header: 'Failures',
      align: 'center' as const,
      render: (supplier: Supplier) => (
        <span className={`font-medium ${supplier.consecutive_failures > 10 ? 'text-red-600' : supplier.consecutive_failures > 0 ? 'text-yellow-600' : 'text-green-600'}`}>
          {supplier.consecutive_failures}
          {supplier.consecutive_failures >= 20 && (
            <span className="ml-1 text-xs text-red-500">(BLOCKED)</span>
          )}
        </span>
      ),
    },
    {
      key: 'balance',
      header: 'Balance',
      align: 'right' as const,
      render: (supplier: Supplier) => (
        <div className="text-right">
          <p className="font-semibold text-gray-800">€{supplier.balance.toLocaleString()}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (supplier: Supplier) => (
        <Badge
          variant={supplier.status === 'active' ? 'success' : supplier.status === 'suspended' ? 'danger' : 'warning'}
          dot
        >
          {supplier.status}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right' as const,
      render: (supplier: Supplier) => (
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setActionMenu(actionMenu === supplier.id ? null : supplier.id);
            }}
            className="p-1.5 rounded hover:bg-gray-100"
          >
            <MoreVertical size={16} className="text-gray-500" />
          </button>
          {actionMenu === supplier.id && (
            <div className="absolute right-0 top-full mt-1 w-40 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-10">
              <button
                onClick={() => navigate(`/suppliers/${supplier.id}`)}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <Eye size={14} />
                View Details
              </button>
              <button
                onClick={() => navigate(`/suppliers/${supplier.id}/edit`)}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <Edit size={14} />
                Edit
              </button>
              <hr className="my-1" />
              <button
                onClick={() => {
                  setDeleteModal(supplier);
                  setActionMenu(null);
                }}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
              >
                <Trash2 size={14} />
                Delete
              </button>
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
          <h1 className="text-2xl font-bold text-gray-800">Suppliers</h1>
          <p className="text-gray-500 mt-1">Manage vendor connections and gateways</p>
        </div>
        <Link to="/suppliers/add">
          <Button icon={<Plus size={18} />}>Add Supplier</Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-sm text-gray-500">Total Suppliers</p>
          <p className="text-2xl font-bold text-gray-800 mt-1">{suppliers.length}</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-sm text-gray-500">Active</p>
          <p className="text-2xl font-bold text-green-600 mt-1">
            {suppliers.filter(s => s.status === 'active').length}
          </p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-sm text-gray-500">Bound</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">
            {suppliers.filter(s => s.bind_status === 'bound').length}
          </p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-sm text-gray-500">SMPP</p>
          <p className="text-2xl font-bold text-purple-600 mt-1">
            {suppliers.filter(s => s.connection_type === 'smpp').length}
          </p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-sm text-gray-500">OTT</p>
          <p className="text-2xl font-bold text-indigo-600 mt-1">
            {suppliers.filter(s => ['ott_whatsapp', 'ott_telegram'].includes(s.connection_type)).length}
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
              placeholder="Search suppliers..."
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
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Types</option>
              <option value="smpp">SMPP</option>
              <option value="http">HTTP API</option>
              <option value="ott_whatsapp">WhatsApp</option>
              <option value="ott_telegram">Telegram</option>
              <option value="voice_otp">Voice OTP</option>
            </select>
            <Button variant="secondary" icon={<Download size={16} />}>Export</Button>
          </div>
        </div>
      </Card>

      {/* Table */}
      <Card noPadding>
        <Table
          columns={columns}
          data={paginatedSuppliers}
          keyExtractor={(supplier) => supplier.id}
          onRowClick={(supplier) => navigate(`/suppliers/${supplier.id}`)}
        />
        <Pagination
          currentPage={currentPage}
          totalPages={totalPages}
          onPageChange={setCurrentPage}
          totalItems={filteredSuppliers.length}
          itemsPerPage={itemsPerPage}
        />
      </Card>

      {/* Delete Modal */}
      <Modal
        isOpen={!!deleteModal}
        onClose={() => setDeleteModal(null)}
        title="Delete Supplier"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setDeleteModal(null)}>Cancel</Button>
            <Button variant="danger" onClick={handleDelete}>Delete Supplier</Button>
          </div>
        }
      >
        <p className="text-gray-600">
          Are you sure you want to delete <strong>{deleteModal?.company_name}</strong>? 
          This action cannot be undone.
        </p>
      </Modal>
    </div>
  );
};
