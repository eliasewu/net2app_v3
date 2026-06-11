import React, { useState } from 'react';
import { Plus, Search, Smartphone, Trash2, RefreshCw, QrCode, Power } from 'lucide-react';
import { useData } from '../../store/DataContext';
import { Card } from '../../components/UI/Card';
import { Button } from '../../components/UI/Button';
import { Badge } from '../../components/UI/Badge';
import { Modal } from '../../components/UI/Modal';
import { Input, Select } from '../../components/UI/Input';
import { OTTDevice } from '../../types';

export const OTTDevices: React.FC = () => {
  const { ottDevices, suppliers, addOTTDevice, updateOTTDevice, deleteOTTDevice } = useData();
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [deleteModal, setDeleteModal] = useState<OTTDevice | null>(null);
  const [qrModal, setQrModal] = useState<OTTDevice | null>(null);

  const [formData, setFormData] = useState({
    device_name: '',
    device_type: 'whatsapp' as 'whatsapp' | 'telegram',
    phone_number: '',
    supplier_id: '',
  });

  const filteredDevices = ottDevices.filter(device =>
    device.device_name.toLowerCase().includes(search.toLowerCase()) ||
    device.phone_number.includes(search)
  );

  const ottSuppliers = suppliers.filter(s => 
    ['ott_whatsapp', 'ott_telegram'].includes(s.connection_type)
  );

  const handleCreate = () => {
    addOTTDevice({
      ...formData,
      session_status: 'qr_pending',
      qr_code: 'QR_CODE_DATA_' + Date.now(),
      last_active: null,
    });
    setShowModal(false);
    setFormData({
      device_name: '',
      device_type: 'whatsapp',
      phone_number: '',
      supplier_id: '',
    });
  };

  const handleDelete = () => {
    if (deleteModal) {
      deleteOTTDevice(deleteModal.id);
      setDeleteModal(null);
    }
  };

  const handleConnect = (device: OTTDevice) => {
    updateOTTDevice(device.id, { 
      session_status: 'connected',
      qr_code: null,
      last_active: new Date().toISOString()
    });
  };

  const handleDisconnect = (device: OTTDevice) => {
    updateOTTDevice(device.id, { 
      session_status: 'disconnected',
      last_active: null
    });
  };

  const getStatusBadge = (status: string) => {
    const statusMap: Record<string, { variant: 'success' | 'warning' | 'danger' | 'default'; label: string }> = {
      connected: { variant: 'success', label: 'Connected' },
      disconnected: { variant: 'default', label: 'Disconnected' },
      qr_pending: { variant: 'warning', label: 'QR Pending' },
      error: { variant: 'danger', label: 'Error' },
    };
    const config = statusMap[status] || { variant: 'default' as const, label: status };
    return <Badge variant={config.variant} dot>{config.label}</Badge>;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">OTT Device Pairing</h1>
          <p className="text-gray-500 mt-1">Manage WhatsApp and Telegram device connections</p>
        </div>
        <Button icon={<Plus size={18} />} onClick={() => setShowModal(true)}>
          Add Device
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-sm text-gray-500">Total Devices</p>
          <p className="text-2xl font-bold text-gray-800 mt-1">{ottDevices.length}</p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-sm text-gray-500">Connected</p>
          <p className="text-2xl font-bold text-green-600 mt-1">
            {ottDevices.filter(d => d.session_status === 'connected').length}
          </p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-sm text-gray-500">WhatsApp</p>
          <p className="text-2xl font-bold text-green-600 mt-1">
            {ottDevices.filter(d => d.device_type === 'whatsapp').length}
          </p>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <p className="text-sm text-gray-500">Telegram</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">
            {ottDevices.filter(d => d.device_type === 'telegram').length}
          </p>
        </div>
      </div>

      {/* Search */}
      <Card>
        <div className="relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search devices..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </Card>

      {/* Devices Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredDevices.map(device => (
          <Card key={device.id} className="hover:shadow-md transition-shadow">
            <div className="space-y-4">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className={`p-3 rounded-xl ${device.device_type === 'whatsapp' ? 'bg-green-100' : 'bg-blue-100'}`}>
                    <Smartphone size={24} className={device.device_type === 'whatsapp' ? 'text-green-600' : 'text-blue-600'} />
                  </div>
                  <div>
                    <p className="font-semibold text-gray-800">{device.device_name}</p>
                    <p className="text-sm text-gray-500">{device.phone_number}</p>
                  </div>
                </div>
                {getStatusBadge(device.session_status)}
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Type:</span>
                  <span className="font-medium text-gray-700 capitalize">{device.device_type}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Last Active:</span>
                  <span className="font-medium text-gray-700">
                    {device.last_active ? new Date(device.last_active).toLocaleString() : 'Never'}
                  </span>
                </div>
              </div>

              <div className="flex gap-2">
                {device.session_status === 'qr_pending' && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<QrCode size={16} />}
                    className="flex-1"
                    onClick={() => setQrModal(device)}
                  >
                    Show QR
                  </Button>
                )}
                {device.session_status === 'connected' ? (
                  <Button
                    size="sm"
                    variant="danger"
                    icon={<Power size={16} />}
                    className="flex-1"
                    onClick={() => handleDisconnect(device)}
                  >
                    Disconnect
                  </Button>
                ) : device.session_status !== 'qr_pending' && (
                  <Button
                    size="sm"
                    variant="success"
                    icon={<RefreshCw size={16} />}
                    className="flex-1"
                    onClick={() => handleConnect(device)}
                  >
                    Connect
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<Trash2 size={16} />}
                  onClick={() => setDeleteModal(device)}
                />
              </div>
            </div>
          </Card>
        ))}

        {filteredDevices.length === 0 && (
          <div className="col-span-full text-center py-12 bg-white rounded-xl border border-gray-200">
            <Smartphone size={48} className="mx-auto text-gray-300 mb-4" />
            <p className="text-gray-600">No devices found</p>
            <p className="text-sm text-gray-400 mt-1">Add a new device to get started</p>
          </div>
        )}
      </div>

      {/* Add Device Modal */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title="Add OTT Device"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
            <Button onClick={handleCreate}>Add Device</Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input
            label="Device Name"
            value={formData.device_name}
            onChange={(e) => setFormData(prev => ({ ...prev, device_name: e.target.value }))}
            placeholder="WhatsApp Device 1"
            required
          />
          <Select
            label="Device Type"
            value={formData.device_type}
            onChange={(e) => setFormData(prev => ({ ...prev, device_type: e.target.value as 'whatsapp' | 'telegram' }))}
            options={[
              { value: 'whatsapp', label: 'WhatsApp' },
              { value: 'telegram', label: 'Telegram' },
            ]}
          />
          <Input
            label="Phone Number"
            value={formData.phone_number}
            onChange={(e) => setFormData(prev => ({ ...prev, phone_number: e.target.value }))}
            placeholder="+1234567890"
            required
          />
          <Select
            label="Supplier"
            value={formData.supplier_id}
            onChange={(e) => setFormData(prev => ({ ...prev, supplier_id: e.target.value }))}
            options={[
              { value: '', label: 'Select Supplier' },
              ...ottSuppliers.map(s => ({ value: s.id, label: `${s.supplier_code} - ${s.company_name}` }))
            ]}
            required
          />
        </div>
      </Modal>

      {/* QR Code Modal */}
      <Modal
        isOpen={!!qrModal}
        onClose={() => setQrModal(null)}
        title="Scan QR Code"
      >
        {qrModal && (
          <div className="text-center space-y-4">
            <div className="bg-white p-8 rounded-xl border-2 border-dashed border-gray-300 inline-block">
              <div className="w-48 h-48 bg-gray-100 rounded-lg flex items-center justify-center">
                <QrCode size={120} className="text-gray-400" />
              </div>
            </div>
            <p className="text-sm text-gray-600">
              Open {qrModal.device_type === 'whatsapp' ? 'WhatsApp' : 'Telegram'} on your phone
              and scan this QR code to connect.
            </p>
            <Button onClick={() => {
              handleConnect(qrModal);
              setQrModal(null);
            }}>
              I've Scanned the QR Code
            </Button>
          </div>
        )}
      </Modal>

      {/* Delete Modal */}
      <Modal
        isOpen={!!deleteModal}
        onClose={() => setDeleteModal(null)}
        title="Delete Device"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setDeleteModal(null)}>Cancel</Button>
            <Button variant="danger" onClick={handleDelete}>Delete Device</Button>
          </div>
        }
      >
        <p className="text-gray-600">
          Are you sure you want to delete <strong>{deleteModal?.device_name}</strong>?
          This will disconnect the device and remove all associated data.
        </p>
      </Modal>
    </div>
  );
};
