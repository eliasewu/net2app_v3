import React, { useState } from 'react';
import { Plus, Search, Edit, Trash2, MoreVertical, Power, GitBranch } from 'lucide-react';
import { useData } from '../../store/DataContext';
import { Card } from '../../components/UI/Card';
import { Button } from '../../components/UI/Button';
import { Badge } from '../../components/UI/Badge';
import { Table } from '../../components/UI/Table';
import { Modal } from '../../components/UI/Modal';
import { Input, Select } from '../../components/UI/Input';
import { Route, RouteMethod } from '../../types';

export const RoutesList: React.FC = () => {
  const { routes, trunks, addRoute, updateRoute, deleteRoute } = useData();
  const getTrunkById = (id: string) => trunks.find(t => t.id === id);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editingRoute, setEditingRoute] = useState<Route | null>(null);
  const [deleteModal, setDeleteModal] = useState<Route | null>(null);
  const [actionMenu, setActionMenu] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    route_name: '',
    trunk_ids: [] as string[],
    route_method: 'priority' as RouteMethod,
    is_active: true,
  });

  const filteredRoutes = routes.filter(route =>
    route.route_name.toLowerCase().includes(search.toLowerCase())
  );

  const getMethodBadge = (method: RouteMethod) => {
    const methodMap: Record<RouteMethod, { label: string; variant: 'default' | 'success' | 'info' }> = {
      priority: { label: 'Priority', variant: 'info' },
      percentage: { label: 'Percentage', variant: 'success' },
      lcr: { label: 'LCR', variant: 'default' },
    };
    return <Badge variant={methodMap[method].variant}>{methodMap[method].label}</Badge>;
  };

  const openModal = (route?: Route) => {
    if (route) {
      setEditingRoute(route);
      setFormData({
        route_name: route.route_name,
        trunk_ids: route.trunk_ids,
        route_method: route.route_method,
        is_active: route.is_active,
      });
    } else {
      setEditingRoute(null);
      setFormData({
        route_name: '',
        trunk_ids: [],
        route_method: 'priority',
        is_active: true,
      });
    }
    setShowModal(true);
  };

  const handleSubmit = () => {
    if (editingRoute) {
      updateRoute(editingRoute.id, formData);
    } else {
      addRoute(formData);
    }
    setShowModal(false);
  };

  const handleDelete = () => {
    if (deleteModal) {
      deleteRoute(deleteModal.id);
      setDeleteModal(null);
    }
  };

  const toggleTrunk = (trunkId: string) => {
    setFormData(prev => ({
      ...prev,
      trunk_ids: prev.trunk_ids.includes(trunkId)
        ? prev.trunk_ids.filter(id => id !== trunkId)
        : [...prev.trunk_ids, trunkId]
    }));
  };

  const columns = [
    {
      key: 'route_name',
      header: 'Route Name',
      render: (route: Route) => (
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg">
            <GitBranch size={16} className="text-white" />
          </div>
          <div>
            <p className="font-medium text-gray-800">{route.route_name}</p>
            <p className="text-xs text-gray-500">ID: {route.id}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'trunks',
      header: 'Trunks',
      render: (route: Route) => (
        <div className="flex flex-wrap gap-1">
          {route.trunk_ids.map((trunkId, i) => {
            const trunk = getTrunkById(trunkId);
            return trunk ? (
              <Badge key={i} variant="default" size="sm">{trunk.trunk_name}</Badge>
            ) : null;
          })}
          {route.trunk_ids.length === 0 && (
            <span className="text-sm text-gray-500">No trunks assigned</span>
          )}
        </div>
      ),
    },
    {
      key: 'route_method',
      header: 'Method',
      render: (route: Route) => getMethodBadge(route.route_method),
    },
    {
      key: 'status',
      header: 'Status',
      render: (route: Route) => (
        <Badge variant={route.is_active ? 'success' : 'danger'} dot>
          {route.is_active ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
    {
      key: 'created_at',
      header: 'Created',
      render: (route: Route) => (
        <span className="text-sm text-gray-500">
          {new Date(route.created_at).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right' as const,
      render: (route: Route) => (
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setActionMenu(actionMenu === route.id ? null : route.id);
            }}
            className="p-1.5 rounded hover:bg-gray-100"
          >
            <MoreVertical size={16} className="text-gray-500" />
          </button>
          {actionMenu === route.id && (
            <div className="absolute right-0 top-full mt-1 w-40 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-10">
              <button
                onClick={() => {
                  openModal(route);
                  setActionMenu(null);
                }}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <Edit size={14} />
                Edit
              </button>
              <button
                onClick={() => {
                  updateRoute(route.id, { is_active: !route.is_active });
                  setActionMenu(null);
                }}
                className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                <Power size={14} />
                {route.is_active ? 'Disable' : 'Enable'}
              </button>
              <hr className="my-1" />
              <button
                onClick={() => {
                  setDeleteModal(route);
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
          <h1 className="text-2xl font-bold text-gray-800">Routes</h1>
          <p className="text-gray-500 mt-1">Configure routing rules and trunk assignments</p>
        </div>
        <Button icon={<Plus size={18} />} onClick={() => openModal()}>Add Route</Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-sm text-gray-500">Total Routes</p>
          <p className="text-2xl font-bold text-gray-800 mt-1">{routes.length}</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-sm text-gray-500">Active</p>
          <p className="text-2xl font-bold text-green-600 mt-1">
            {routes.filter(r => r.is_active).length}
          </p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-sm text-gray-500">Priority Routes</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">
            {routes.filter(r => r.route_method === 'priority').length}
          </p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-sm text-gray-500">LCR Routes</p>
          <p className="text-2xl font-bold text-purple-600 mt-1">
            {routes.filter(r => r.route_method === 'lcr').length}
          </p>
        </div>
      </div>

      {/* Search */}
      <Card>
        <div className="relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search routes..."
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
          data={filteredRoutes}
          keyExtractor={(route) => route.id}
        />
      </Card>

      {/* Add/Edit Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editingRoute ? 'Edit Route' : 'Add Route'}
        size="lg"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={handleSubmit}>{editingRoute ? 'Update' : 'Create'} Route</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input
            label="Route Name"
            value={formData.route_name}
            onChange={(e) => setFormData(prev => ({ ...prev, route_name: e.target.value }))}
            placeholder="Premium OTP Route"
            required
          />
          <Select
            label="Routing Method"
            value={formData.route_method}
            onChange={(e) => setFormData(prev => ({ ...prev, route_method: e.target.value as RouteMethod }))}
            options={[
              { value: 'priority', label: 'Priority - Use first available' },
              { value: 'percentage', label: 'Percentage - Split by percentage' },
              { value: 'lcr', label: 'LCR - Least cost routing' },
            ]}
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select Trunks
            </label>
            <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto p-2 border border-gray-200 rounded-lg">
              {trunks.map(trunk => (
                <label
                  key={trunk.id}
                  className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    formData.trunk_ids.includes(trunk.id)
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={formData.trunk_ids.includes(trunk.id)}
                    onChange={() => toggleTrunk(trunk.id)}
                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-800">{trunk.trunk_name}</p>
                    <p className="text-xs text-gray-500">{trunk.trunk_type}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
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
      </Modal>

      {/* Delete Modal */}
      <Modal
        isOpen={!!deleteModal}
        onClose={() => setDeleteModal(null)}
        title="Delete Route"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setDeleteModal(null)}>Cancel</Button>
            <Button variant="danger" onClick={handleDelete}>Delete Route</Button>
          </div>
        }
      >
        <p className="text-gray-600">
          Are you sure you want to delete <strong>{deleteModal?.route_name}</strong>? 
          This action cannot be undone.
        </p>
      </Modal>
    </div>
  );
};
