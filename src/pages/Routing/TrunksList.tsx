import React, { useState } from 'react';
import { Plus, Search, Edit, Trash2, MoreVertical, Power } from 'lucide-react';
import { useData } from '../../store/DataContext';
import { Card } from '../../components/UI/Card';
import { Button } from '../../components/UI/Button';
import { Badge } from '../../components/UI/Badge';
import { Table } from '../../components/UI/Table';
import { Modal } from '../../components/UI/Modal';
import { Input, Select } from '../../components/UI/Input';
import { Trunk, TrunkType } from '../../types';

export const TrunksList: React.FC = () => {
  const { trunks, suppliers, addTrunk, updateTrunk, deleteTrunk, getSupplierById } = useData();
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingTrunk, setEditingTrunk] = useState<Trunk | null>(null);
  const [deleteModal, setDeleteModal] = useState<Trunk | null>(null);
  const [actionMenu, setActionMenu] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    trunk_name: '',
    trunk_type: 'sim_otp' as TrunkType,
    supplier_id: '',
    priority: 1,
    percentage: 100,
    is_active: true,
    mccmnc_allowed: ['*'],
  });

  const filteredTrunks = trunks.filter(trunk =>
    trunk.trunk_name.toLowerCase().includes(search.toLowerCase())
  );

  const getTrunkTypeBadge = (type: string) => {
    const typeMap: Record<string, { label: string; variant: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'purple' }> = {
      sim_otp: { label: 'SIM OTP', variant: 'success' },
      sim_marketing: { label: 'SIM Marketing', variant: 'info' },
      voice_otp: { label: 'Voice OTP', variant: 'warning' },
      local_direct_otp: { label: 'Local Direct OTP', variant: 'purple' },
      local_direct_marketing: { label: 'Local Direct MKT', variant: 'default' },
      direct_route_otp: { label: 'Direct Route OTP', variant: 'success' },
      direct_route_marketing: { label: 'Direct Route MKT', variant: 'info' },
      whatsapp: { label: 'WhatsApp', variant: 'success' },
      telegram: { label: 'Telegram', variant: 'info' },
      rcs: { label: 'RCS', variant: 'purple' },
    };
    const config = typeMap[type] || { label: type, variant: 'default' as const };
    return <Badge variant={config.variant}>{config.label}</Badge>;
  };

  const openModal = (trunk?: Trunk) => {
    if (trunk) {
      setEditingTrunk(trunk);
      setFormData({
        trunk_name: trunk.trunk_name,
        trunk_type: trunk.trunk_type,
        supplier_id: trunk.supplier_id,
        priority: trunk.priority,
        percentage: trunk.percentage,
        is_active: trunk.is_active,
        mccmnc_allowed: trunk.mccmnc_allowed,
      });
    } else {
      setEditingTrunk(null);
      setFormData({
        trunk_name: '',
        trunk_type: 'sim_otp',
        supplier_id: '',
        priority: 1,
        percentage: 100,
        is_active: true,
        mccmnc_allowed: ['*'],
      });
    }
    setShowModal(true);
  };

  const handleSubmit = () => {
    if (editingTrunk) {
      updateTrunk(editingTrunk.id, formData);
    } else {
      addTrunk(formData);
    }
    setShowModal(false);
  };

  const handleDelete = () => {
    if (deleteModal) {
      deleteTrunk(deleteModal.id);
      setDeleteModal(null);
    }
  };

  const columns = [
    {
      key: 'trunk_name',
      header: 'Trunk Name',
      render: (trunk: Trunk) => (
        <div>
          <p className="font-medium text-gray-800">{trunk.trunk_name}</p>
          <p className="text-xs text-gray-500">ID: {trunk.id}</p>
        </div>
      ),
    },
    {
      key: 'trunk_type',
      header: 'Type',
      render: (trunk: Trunk) => getTrunkTypeBadge(trunk.trunk_type),
    },
    {
      key: 'supplier',
      header: 'Supplier',
      render: (trunk: Trunk) => {
        const supplier = getSupplierById(trunk.supplier_id);
        return supplier ? (
          <div>
            <p className="text-sm text-gray-800">{supplier.company_name}</p>
            <p className="text-xs text-gray-500">{supplier.supplier_code}</p>
          </div>
        ) : '-';
      },
    },
    {
      key: 'priority',
      header: 'Priority',
      align: 'center' as const,
      render: (trunk: Trunk) => (
        <span className="font-medium text-gray-700">{trunk.priority}</span>
      ),
    },
    {
      key: 'percentage',
      header: 'Percentage',
      align: 'center' as const,
      render: (trunk: Trunk) => (
        <span className="font-medium text-gray-700">{trunk.percentage}%</span>
      ),
    },
    {
      key: 'mccmnc',
      header: 'MCCMNC Allowed',
      render: (trunk: Trunk) => (
        <div className="flex flex-wrap gap-1">
          {trunk.mccmnc_allowed.slice(0, 3).map((m, i) => (
            <Badge key={i} variant="default" size="sm">{m}</Badge>
          ))}
          {trunk.mccmnc_allowed.length > 3 && (
            <Badge variant="default" size="sm">+{trunk.mccmnc_allowed.length - 3}</Badge>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (trunk: Trunk) => (
        <Badge variant={trunk.is_active ? 'success' : 'danger'} dot>
          {trunk.is_active ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right' as const,
      render: (trunk: Trunk) => (
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setActionMenu(actionMenu === trunk.id ? null : trunk.id);
            }}
            className="p-1.5 rounded hover:bg-gray-100"
          >
            <MoreVertical size={16} className="text-gray-500" />
          </button>
          {actionMenu === trunk.id && (
            <div className="absolute right-0 top-full mt-1 w-40 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-10">
              <button
                onClick={() => {
                  openModal(trunk);
                  setActionMenu(null);
                }}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <Edit size={14} />
                Edit
              </button>
              <button
                onClick={() => {
                  updateTrunk(trunk.id, { is_active: !trunk.is_active });
                  setActionMenu(null);
                }}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <Power size={14} />
                {trunk.is_active ? 'Disable' : 'Enable'}
              </button>
              <hr className="my-1" />
              <button
                onClick={() => {
                  setDeleteModal(trunk);
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
          <h1 className="text-2xl font-bold text-gray-800">Trunks</h1>
          <p className="text-gray-500 mt-1">Manage supplier trunk configurations</p>
        </div>
        <Button icon={<Plus size={18} />} onClick={() => openModal()}>Add Trunk</Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-sm text-gray-500">Total Trunks</p>
          <p className="text-2xl font-bold text-gray-800 mt-1">{trunks.length}</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-sm text-gray-500">Active</p>
          <p className="text-2xl font-bold text-green-600 mt-1">
            {trunks.filter(t => t.is_active).length}
          </p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-sm text-gray-500">OTP Trunks</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">
            {trunks.filter(t => t.trunk_type.includes('otp')).length}
          </p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-sm text-gray-500">OTT Trunks</p>
          <p className="text-2xl font-bold text-purple-600 mt-1">
            {trunks.filter(t => ['whatsapp', 'telegram', 'rcs'].includes(t.trunk_type)).length}
          </p>
        </div>
      </div>

      {/* Search */}
      <Card>
        <div className="relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search trunks..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </Card>

      {/* Table */}
      <Card noPadding>
        <Table
          columns={columns}
          data={filteredTrunks}
          keyExtractor={(trunk) => trunk.id}
        />
      </Card>

      {/* Add/Edit Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editingTrunk ? 'Edit Trunk' : 'Add Trunk'}
        size="lg"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={handleSubmit}>{editingTrunk ? 'Update' : 'Create'} Trunk</Button>
          </div>
        }
      >
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Trunk Name"
            value={formData.trunk_name}
            onChange={(e) => setFormData(prev => ({ ...prev, trunk_name: e.target.value }))}
            placeholder="SIM OTP Primary"
            required
          />
          <Select
            label="Trunk Type"
            value={formData.trunk_type}
            onChange={(e) => setFormData(prev => ({ ...prev, trunk_type: e.target.value as TrunkType }))}
            options={[
              { value: 'sim_otp', label: 'SIM OTP' },
              { value: 'sim_marketing', label: 'SIM Marketing' },
              { value: 'voice_otp', label: 'Voice OTP' },
              { value: 'local_direct_otp', label: 'Local Direct OTP' },
              { value: 'local_direct_marketing', label: 'Local Direct Marketing' },
              { value: 'direct_route_otp', label: 'Direct Route OTP' },
              { value: 'direct_route_marketing', label: 'Direct Route Marketing' },
              { value: 'whatsapp', label: 'WhatsApp' },
              { value: 'telegram', label: 'Telegram' },
              { value: 'rcs', label: 'RCS' },
            ]}
          />
          <Select
            label="Supplier"
            value={formData.supplier_id}
            onChange={(e) => setFormData(prev => ({ ...prev, supplier_id: e.target.value }))}
            options={[
              { value: '', label: 'Select Supplier' },
              ...suppliers.map(s => ({ value: s.id, label: `${s.supplier_code} - ${s.company_name}` }))
            ]}
            required
          />
          <Input
            label="Priority"
            type="number"
            value={formData.priority}
            onChange={(e) => setFormData(prev => ({ ...prev, priority: parseInt(e.target.value) }))}
            min={1}
          />
          <Input
            label="Percentage"
            type="number"
            value={formData.percentage}
            onChange={(e) => setFormData(prev => ({ ...prev, percentage: parseInt(e.target.value) }))}
            min={0}
            max={100}
          />
          <div className="flex items-center">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formData.is_active}
                onChange={(e) => setFormData(prev => ({ ...prev, is_active: e.target.checked }))}
                className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="text-sm text-gray-700">Active</span>
            </label>
          </div>
          <div className="col-span-2">
            <Input
              label="MCCMNC Allowed (comma-separated)"
              value={formData.mccmnc_allowed.join(', ')}
              onChange={(e) => setFormData(prev => ({ ...prev, mccmnc_allowed: e.target.value.split(',').map(s => s.trim()) }))}
              placeholder="310*, 311*, 234*"
              hint="Use * for wildcard matching"
            />
          </div>
        </div>
      </Modal>

      {/* Delete Modal */}
      <Modal
        isOpen={!!deleteModal}
        onClose={() => setDeleteModal(null)}
        title="Delete Trunk"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setDeleteModal(null)}>Cancel</Button>
            <Button variant="danger" onClick={handleDelete}>Delete Trunk</Button>
          </div>
        }
      >
        <p className="text-gray-600">
          Are you sure you want to delete <strong>{deleteModal?.trunk_name}</strong>? 
          This action cannot be undone.
        </p>
      </Modal>
    </div>
  );
};
