import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, RefreshCw } from 'lucide-react';
import { useData } from '../../store/DataContext';
import { Card } from '../../components/UI/Card';
import { Button } from '../../components/UI/Button';
import { Input, Select, Textarea } from '../../components/UI/Input';
import { Client, BillingMode, Currency } from '../../types';

export const AddClient: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { addClient, updateClient, getClientById, routePlans } = useData();
  const existingClient = id ? getClientById(id) : undefined;
  
  const defaultForm = {
    client_code: '', company_name: '', contact_person: '', email: '', phone: '', address: '', country: '',
    smpp_username: '', smpp_password: '', smpp_ip: '', smpp_port: 2775, system_type: 'SMPP', max_tps: 100,
    billing_mode: 'dlr' as BillingMode, currency: 'EUR' as Currency, balance: 0, credit_limit: 0,
    api_enabled: false, webhook_url: '', force_dlr: true, routing_plan_id: '', rate_plan_id: '',
    status: 'active' as const,
  };

  const initForm = existingClient ? {
    client_code: existingClient.client_code, company_name: existingClient.company_name,
    contact_person: existingClient.contact_person, email: existingClient.email,
    phone: existingClient.phone, address: existingClient.address, country: existingClient.country,
    smpp_username: existingClient.smpp_username, smpp_password: existingClient.smpp_password,
    smpp_ip: existingClient.smpp_ip, smpp_port: existingClient.smpp_port,
    system_type: existingClient.system_type, max_tps: existingClient.max_tps,
    billing_mode: existingClient.billing_mode, currency: existingClient.currency,
    balance: existingClient.balance, credit_limit: existingClient.credit_limit,
    api_enabled: existingClient.api_enabled, webhook_url: existingClient.webhook_url,
    force_dlr: existingClient.force_dlr, routing_plan_id: existingClient.routing_plan_id || '',
    rate_plan_id: existingClient.rate_plan_id || '', status: existingClient.status as 'active'|'inactive'|'suspended',
  } : defaultForm;

  const [formData, setFormData] = useState(initForm);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  const generatePassword = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
    let password = '';
    for (let i = 0; i < 12; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setFormData(prev => ({ ...prev, smpp_password: password }));
  };

  const generateClientCode = () => {
    const code = 'CLT' + String(Math.floor(Math.random() * 9000) + 1000);
    setFormData(prev => ({ ...prev, client_code: code }));
  };

  const validate = () => {
    const newErrors: Record<string, string> = {};
    
    if (!formData.client_code) newErrors.client_code = 'Client code is required';
    if (!formData.company_name) newErrors.company_name = 'Company name is required';
    if (!formData.contact_person) newErrors.contact_person = 'Contact person is required';
    if (!formData.email) newErrors.email = 'Email is required';
    else if (!/\S+@\S+\.\S+/.test(formData.email)) newErrors.email = 'Invalid email format';
    if (!formData.smpp_username) newErrors.smpp_username = 'SMPP username is required';
    if (!formData.smpp_password) newErrors.smpp_password = 'SMPP password is required';
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    await new Promise(resolve => setTimeout(resolve, 500));
    if (existingClient) {
      updateClient(existingClient.id, formData as Partial<Client>);
    } else {
      addClient(formData as Omit<Client, 'id' | 'created_at' | 'updated_at'>);
    }
    setLoading(false);
    navigate('/clients');
  };

  const updateField = (field: string, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft size={20} className="text-gray-600" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-800">{existingClient ? 'Edit Client' : 'Add New Client'}</h1>
          <p className="text-gray-500 mt-1">{existingClient ? `Update ${existingClient.company_name} (${existingClient.client_code})` : 'Create a new client account with SMPP credentials'}</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Company Information */}
        <Card title="Company Information">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  label="Client Code"
                  value={formData.client_code}
                  onChange={(e) => updateField('client_code', e.target.value)}
                  placeholder="CLT001"
                  error={errors.client_code}
                  required
                />
              </div>
              <button
                type="button"
                onClick={generateClientCode}
                className="mt-7 p-2.5 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                <RefreshCw size={18} className="text-gray-600" />
              </button>
            </div>
            <Input
              label="Company Name"
              value={formData.company_name}
              onChange={(e) => updateField('company_name', e.target.value)}
              placeholder="TechCorp Global"
              error={errors.company_name}
              required
            />
            <Input
              label="Contact Person"
              value={formData.contact_person}
              onChange={(e) => updateField('contact_person', e.target.value)}
              placeholder="John Smith"
              error={errors.contact_person}
              required
            />
            <Input
              label="Email"
              type="email"
              value={formData.email}
              onChange={(e) => updateField('email', e.target.value)}
              placeholder="john@techcorp.com"
              error={errors.email}
              required
            />
            <Input
              label="Phone"
              value={formData.phone}
              onChange={(e) => updateField('phone', e.target.value)}
              placeholder="+1234567890"
            />
            <Input
              label="Country"
              value={formData.country}
              onChange={(e) => updateField('country', e.target.value)}
              placeholder="United States"
            />
            <div className="md:col-span-2">
              <Textarea
                label="Address"
                value={formData.address}
                onChange={(e) => updateField('address', e.target.value)}
                placeholder="123 Tech Street, Silicon Valley"
                rows={2}
              />
            </div>
          </div>
        </Card>

        {/* SMPP Settings */}
        <Card title="SMPP/HTTP Settings">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Input
              label="SMPP Username"
              value={formData.smpp_username}
              onChange={(e) => updateField('smpp_username', e.target.value)}
              placeholder="techcorp_smpp"
              error={errors.smpp_username}
              required
            />
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  label="SMPP Password"
                  type="text"
                  value={formData.smpp_password}
                  onChange={(e) => updateField('smpp_password', e.target.value)}
                  placeholder="Generated password"
                  error={errors.smpp_password}
                  required
                />
              </div>
              <button
                type="button"
                onClick={generatePassword}
                className="mt-7 p-2.5 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                <RefreshCw size={18} className="text-gray-600" />
              </button>
            </div>
            <Input
              label="Allowed IP"
              value={formData.smpp_ip}
              onChange={(e) => updateField('smpp_ip', e.target.value)}
              placeholder="192.168.1.100"
              hint="Leave empty to allow all IPs"
            />
            <Input
              label="SMPP Port"
              type="number"
              value={formData.smpp_port}
              onChange={(e) => updateField('smpp_port', parseInt(e.target.value))}
            />
            <Select
              label="System Type"
              value={formData.system_type}
              onChange={(e) => updateField('system_type', e.target.value)}
              options={[
                { value: 'SMPP', label: 'SMPP' },
                { value: 'HTTP', label: 'HTTP API' },
                { value: 'BOTH', label: 'Both' },
              ]}
            />
            <Input
              label="Max TPS"
              type="number"
              value={formData.max_tps}
              onChange={(e) => updateField('max_tps', parseInt(e.target.value))}
              hint="Maximum transactions per second"
            />
          </div>
        </Card>

        {/* Billing Settings */}
        <Card title="Billing Settings">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Select
              label="Billing Mode"
              value={formData.billing_mode}
              onChange={(e) => updateField('billing_mode', e.target.value)}
              options={[
                { value: 'submit', label: 'On Submit' },
                { value: 'dlr', label: 'On DLR (Delivery)' },
              ]}
            />
            <Select
              label="Currency"
              value={formData.currency}
              onChange={(e) => updateField('currency', e.target.value)}
              options={[
                { value: 'EUR', label: 'Euro (EUR)' },
                { value: 'USD', label: 'US Dollar (USD)' },
                { value: 'GBP', label: 'British Pound (GBP)' },
              ]}
            />
            <Input
              label="Initial Balance (Payment Received from Client)"
              type="number"
              value={formData.balance}
              onChange={(e) => updateField('balance', parseFloat(e.target.value))}
              hint="Prepaid balance received from client. If 0, system uses credit limit"
            />
            <Input
              label="Credit Limit"
              type="number"
              value={formData.credit_limit}
              onChange={(e) => updateField('credit_limit', parseFloat(e.target.value))}
              hint="Maximum credit allowed when balance is 0. SMS blocked when both balance AND credit exhausted"
            />
          </div>
        </Card>

        {/* Routing & Advanced */}
        <Card title="Routing & Advanced Settings">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Select
              label="Routing Plan"
              value={formData.routing_plan_id}
              onChange={(e) => updateField('routing_plan_id', e.target.value)}
              options={[
                { value: '', label: 'Select Route Plan' },
                ...routePlans.map(p => ({ value: p.id, label: p.plan_name }))
              ]}
            />
            <Select
              label="Status"
              value={formData.status}
              onChange={(e) => updateField('status', e.target.value)}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
                { value: 'suspended', label: 'Suspended' },
              ]}
            />
            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.api_enabled}
                  onChange={(e) => updateField('api_enabled', e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">Enable HTTP API</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.force_dlr}
                  onChange={(e) => updateField('force_dlr', e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">Force DLR</span>
              </label>
            </div>
            <Input
              label="Webhook URL"
              value={formData.webhook_url}
              onChange={(e) => updateField('webhook_url', e.target.value)}
              placeholder="https://example.com/webhook"
              hint="For DLR callbacks"
            />
          </div>
        </Card>

        {/* Actions */}
        <div className="flex justify-end gap-4">
          <Button variant="secondary" type="button" onClick={() => navigate(-1)}>
            Cancel
          </Button>
          <Button type="submit" icon={<Save size={18} />} loading={loading}>
            {existingClient ? 'Update Client' : 'Create Client'}
          </Button>
        </div>
      </form>
    </div>
  );
};
