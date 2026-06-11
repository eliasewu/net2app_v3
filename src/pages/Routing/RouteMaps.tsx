import React, { useState } from 'react';
import { Plus, Search, Edit, Trash2, GitBranch } from 'lucide-react';
import { useData } from '../../store/DataContext';
import { Card } from '../../components/UI/Card';
import { Button } from '../../components/UI/Button';
import { Badge } from '../../components/UI/Badge';
import { Modal } from '../../components/UI/Modal';
import { Input, Select } from '../../components/UI/Input';

interface RouteMapEntry {
  id: string;
  client_id: string;
  route_id: string;
  supplier_id: string;
  mccmnc_pattern: string;
  priority: number;
  percentage: number;
  is_active: boolean;
  created_at: string;
}

export const RouteMaps: React.FC = () => {
  const { clients, routes, suppliers, getSupplierById } = useData();
  
  // Mock route maps data
  const [routeMaps, setRouteMaps] = useState<RouteMapEntry[]>([
    {
      id: '1',
      client_id: '1',
      route_id: '1',
      supplier_id: '1',
      mccmnc_pattern: '310*',
      priority: 1,
      percentage: 100,
      is_active: true,
      created_at: '2024-01-15',
    },
    {
      id: '2',
      client_id: '1',
      route_id: '2',
      supplier_id: '3',
      mccmnc_pattern: '234*',
      priority: 2,
      percentage: 100,
      is_active: true,
      created_at: '2024-01-20',
    },
    {
      id: '3',
      client_id: '2',
      route_id: '1',
      supplier_id: '2',
      mccmnc_pattern: '*',
      priority: 1,
      percentage: 70,
      is_active: true,
      created_at: '2024-02-01',
    },
  ]);

  const [search, setSearch] = useState('');
  const [clientFilter, setClientFilter] = useState<string>('all');
  const [showModal, setShowModal] = useState(false);
  const [editingMap, setEditingMap] = useState<RouteMapEntry | null>(null);

  const [formData, setFormData] = useState({
    client_id: '',
    route_id: '',
    supplier_id: '',
    mccmnc_pattern: '*',
    priority: 1,
    percentage: 100,
    is_active: true,
  });

  const filteredMaps = routeMaps.filter(map => {
    const client = clients.find(c => c.id === map.client_id);
    const matchesSearch = client?.company_name.toLowerCase().includes(search.toLowerCase()) ||
      map.mccmnc_pattern.includes(search);
    const matchesClient = clientFilter === 'all' || map.client_id === clientFilter;
    return matchesSearch && matchesClient;
  });

  

  const getRouteName = (id: string) => {
    const route = routes.find(r => r.id === id);
    return route?.route_name || 'Unknown';
  };

  const getSupplierName = (id: string) => {
    const supplier = getSupplierById(id);
    return supplier ? `${supplier.supplier_code} - ${supplier.company_name}` : 'Unknown';
  };

  const openModal = (map?: RouteMapEntry) => {
    if (map) {
      setEditingMap(map);
      setFormData({
        client_id: map.client_id,
        route_id: map.route_id,
        supplier_id: map.supplier_id,
        mccmnc_pattern: map.mccmnc_pattern,
        priority: map.priority,
        percentage: map.percentage,
        is_active: map.is_active,
      });
    } else {
      setEditingMap(null);
      setFormData({
        client_id: clientFilter !== 'all' ? clientFilter : '',
        route_id: '',
        supplier_id: '',
        mccmnc_pattern: '*',
        priority: 1,
        percentage: 100,
        is_active: true,
      });
    }
    setShowModal(true);
  };

  const handleSubmit = () => {
    if (editingMap) {
      setRouteMaps(prev => prev.map(m =>
        m.id === editingMap.id ? { ...m, ...formData } : m
      ));
    } else {
      const newMap: RouteMapEntry = {
        id: Date.now().toString(),
        ...formData,
        created_at: new Date().toISOString().split('T')[0],
      };
      setRouteMaps(prev => [...prev, newMap]);
    }
    setShowModal(false);
  };

  const handleDelete = (id: string) => {
    setRouteMaps(prev => prev.filter(m => m.id !== id));
  };

  // Group maps by client for visual display
  const groupedMaps = clients.map(client => ({
    client,
    maps: filteredMaps.filter(m => m.client_id === client.id),
  })).filter(g => g.maps.length > 0 || clientFilter === g.client.id);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Route Maps</h1>
          <p className="text-gray-500 mt-1">Configure client-specific routing to suppliers</p>
        </div>
        <Button icon={<Plus size={18} />} onClick={() => openModal()}>
          Add Route Map
        </Button>
      </div>

      {/* Info Box */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
        <h3 className="font-medium text-blue-800 mb-2">Routing Flow:</h3>
        <p className="text-sm text-blue-700">
          Client → Route Map (MCCMNC Match) → Route → Trunk(s) → Supplier
        </p>
        <p className="text-sm text-blue-600 mt-2">
          Each client can have multiple route maps for different destinations. 
          Messages are matched by MCCMNC pattern and routed to the specified supplier.
        </p>
      </div>

      {/* Filters */}
      <Card>
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1 relative">
            <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by client, MCCMNC..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Clients</option>
            {clients.map(c => (
              <option key={c.id} value={c.id}>{c.client_code} - {c.company_name}</option>
            ))}
          </select>
        </div>
      </Card>

      {/* Route Maps by Client */}
      {groupedMaps.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <GitBranch size={48} className="mx-auto text-gray-300 mb-4" />
            <p className="text-gray-600">No route maps configured</p>
            <p className="text-sm text-gray-400 mt-1">Add a route map to start routing</p>
          </div>
        </Card>
      ) : (
        groupedMaps.map(({ client, maps }) => (
          <Card key={client.id}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold">
                {client.company_name.charAt(0)}
              </div>
              <div>
                <h3 className="font-semibold text-gray-800">{client.company_name}</h3>
                <p className="text-sm text-gray-500">{client.client_code}</p>
              </div>
              <Badge variant={client.status === 'active' ? 'success' : 'danger'}>
                {client.status}
              </Badge>
            </div>

            {maps.length === 0 ? (
              <div className="bg-gray-50 rounded-lg p-6 text-center">
                <p className="text-gray-500">No routes configured for this client</p>
                <Button size="sm" variant="secondary" className="mt-2" onClick={() => {
                  setFormData(prev => ({ ...prev, client_id: client.id }));
                  openModal();
                }}>
                  Add Route
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {maps.map(map => (
                  <div
                    key={map.id}
                    className={`flex items-center justify-between p-4 rounded-lg border ${
                      map.is_active ? 'border-green-200 bg-green-50' : 'border-gray-200 bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center gap-6">
                      {/* MCCMNC Pattern */}
                      <div className="text-center">
                        <p className="text-xs text-gray-500 uppercase">MCCMNC</p>
                        <p className="font-mono font-semibold text-gray-800">{map.mccmnc_pattern}</p>
                      </div>

                      {/* Arrow */}
                      <div className="text-gray-400">→</div>

                      {/* Route */}
                      <div className="text-center">
                        <p className="text-xs text-gray-500 uppercase">Route</p>
                        <Badge variant="info">{getRouteName(map.route_id)}</Badge>
                      </div>

                      {/* Arrow */}
                      <div className="text-gray-400">→</div>

                      {/* Supplier */}
                      <div className="text-center">
                        <p className="text-xs text-gray-500 uppercase">Supplier</p>
                        <Badge variant="purple">{getSupplierName(map.supplier_id)}</Badge>
                      </div>

                      {/* Priority & Percentage */}
                      <div className="flex gap-4">
                        <div className="text-center">
                          <p className="text-xs text-gray-500">Priority</p>
                          <p className="font-semibold text-gray-700">{map.priority}</p>
                        </div>
                        <div className="text-center">
                          <p className="text-xs text-gray-500">Split</p>
                          <p className="font-semibold text-gray-700">{map.percentage}%</p>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Badge variant={map.is_active ? 'success' : 'danger'} dot>
                        {map.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                      <button
                        onClick={() => openModal(map)}
                        className="p-1.5 rounded hover:bg-white"
                      >
                        <Edit size={16} className="text-gray-500" />
                      </button>
                      <button
                        onClick={() => handleDelete(map.id)}
                        className="p-1.5 rounded hover:bg-white"
                      >
                        <Trash2 size={16} className="text-red-500" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        ))
      )}

      {/* Add/Edit Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title={editingMap ? 'Edit Route Map' : 'Add Route Map'}
        size="lg"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={handleSubmit}>{editingMap ? 'Update' : 'Create'} Route Map</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Select
            label="Client"
            value={formData.client_id}
            onChange={(e) => setFormData(prev => ({ ...prev, client_id: e.target.value }))}
            options={[
              { value: '', label: 'Select Client' },
              ...clients.map(c => ({ value: c.id, label: `${c.client_code} - ${c.company_name}` }))
            ]}
            required
          />

          <Input
            label="MCCMNC Pattern"
            value={formData.mccmnc_pattern}
            onChange={(e) => setFormData(prev => ({ ...prev, mccmnc_pattern: e.target.value }))}
            placeholder="310* or * for all"
            hint="Use * as wildcard. Example: 310* matches all US operators"
            required
          />

          <Select
            label="Route"
            value={formData.route_id}
            onChange={(e) => setFormData(prev => ({ ...prev, route_id: e.target.value }))}
            options={[
              { value: '', label: 'Select Route' },
              ...routes.map(r => ({ value: r.id, label: r.route_name }))
            ]}
            required
          />

          <Select
            label="Supplier"
            value={formData.supplier_id}
            onChange={(e) => setFormData(prev => ({ ...prev, supplier_id: e.target.value }))}
            options={[
              { value: '', label: 'Select Supplier' },
              ...suppliers.map(s => ({ value: s.id, label: `${s.supplier_code} - ${s.company_name} (${s.connection_type.toUpperCase()})` }))
            ]}
            required
          />

          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Priority"
              type="number"
              value={formData.priority}
              onChange={(e) => setFormData(prev => ({ ...prev, priority: parseInt(e.target.value) }))}
              min={1}
              hint="Lower number = higher priority"
            />
            <Input
              label="Traffic Split (%)"
              type="number"
              value={formData.percentage}
              onChange={(e) => setFormData(prev => ({ ...prev, percentage: parseInt(e.target.value) }))}
              min={0}
              max={100}
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={formData.is_active}
              onChange={(e) => setFormData(prev => ({ ...prev, is_active: e.target.checked }))}
              className="w-4 h-4 rounded border-gray-300 text-blue-600"
            />
            <span className="text-sm text-gray-700">Active</span>
          </label>
        </div>
      </Modal>
    </div>
  );
};
