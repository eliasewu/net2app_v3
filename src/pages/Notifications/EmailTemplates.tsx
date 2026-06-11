import React, { useState } from 'react';
import { Search, Edit, Eye, Power } from 'lucide-react';
import { useData } from '../../store/DataContext';
import { Card } from '../../components/UI/Card';
import { Button } from '../../components/UI/Button';
import { Badge } from '../../components/UI/Badge';
import { Modal } from '../../components/UI/Modal';
import { Input, Textarea } from '../../components/UI/Input';
import { EmailTemplate } from '../../types';

export const EmailTemplates: React.FC = () => {
  const { emailTemplates } = useData();
  const [localTemplates, setLocalTemplates] = useState(emailTemplates);
  const updateEmailTemplate = (id: string, data: any) => { setLocalTemplates(prev => { return prev.map(t => t.id === id ? { ...t, ...data } : t); }); };
  const allTemplates = localTemplates;
  const [search, setSearch] = useState('');
  const [editModal, setEditModal] = useState<EmailTemplate | null>(null);
  const [previewModal, setPreviewModal] = useState<EmailTemplate | null>(null);

  const [formData, setFormData] = useState({
    subject: '',
    body: '',
    is_active: true,
  });

  const filteredTemplates = emailTemplates.filter(template =>
    template.template_name.toLowerCase().includes(search.toLowerCase()) ||
    template.subject.toLowerCase().includes(search.toLowerCase())
  );

  const openEdit = (template: EmailTemplate) => {
    setEditModal(template);
    setFormData({
      subject: template.subject,
      body: template.body,
      is_active: template.is_active,
    });
  };

  const handleSave = () => {
    if (editModal) {
      updateEmailTemplate(editModal.id, formData);
      setEditModal(null);
    }
  };

  const getPreviewContent = (template: EmailTemplate) => {
    const sampleData: Record<string, string> = {
      client_name: 'TechCorp Global',
      client_code: 'CLT001',
      smpp_username: 'techcorp_smpp',
      balance: '€5,000.00',
      platform_name: 'NET2APP Hub',
      company_name: 'TechCorp Global Inc',
      supplier_code: 'SUP001',
      contact_person: 'John Smith',
      connection_type: 'SMPP',
      invoice_number: 'INV-2024-001',
      period_start: '2024-01-01',
      period_end: '2024-01-31',
      total_amount: '€4,500.00',
      due_date: '2024-02-15',
      payment_number: 'PAY-2024-001',
      amount: '€10,000.00',
      payment_method: 'Bank Transfer',
      entity_name: 'TechCorp Global',
      entity_code: 'CLT001',
      destination_name: 'United States - All',
      new_rate: '€0.025',
      effective_date: '2024-03-01',
      entity_type: 'Client',
      route_name: 'Premium OTP Route',
      supplier_name: 'GlobalSMS Gateway',
      failure_count: '20',
      action_taken: 'Route blocked automatically',
      amount_due: '€5,355.00',
    };

    let preview = template.body;
    Object.entries(sampleData).forEach(([key, value]) => {
      preview = preview.replace(new RegExp(`{{${key}}}`, 'g'), value);
    });
    return preview;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Email Templates</h1>
          <p className="text-gray-500 mt-1">Manage notification email templates</p>
        </div>
      </div>

      {/* Search */}
      <Card>
        <div className="relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search templates..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </Card>

      {/* Templates Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredTemplates.map(template => (
          <Card key={template.id} className="hover:shadow-md transition-shadow">
            <div className="space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-gray-800">{template.template_name}</h3>
                  <Badge variant={template.is_active ? 'success' : 'danger'} size="sm">
                    {template.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => setPreviewModal(template)}
                    className="p-1.5 rounded hover:bg-gray-100"
                    title="Preview"
                  >
                    <Eye size={16} className="text-gray-500" />
                  </button>
                  <button
                    onClick={() => openEdit(template)}
                    className="p-1.5 rounded hover:bg-gray-100"
                    title="Edit"
                  >
                    <Edit size={16} className="text-gray-500" />
                  </button>
                  <button
                    onClick={() => updateEmailTemplate(template.id, { is_active: !template.is_active })}
                    className="p-1.5 rounded hover:bg-gray-100"
                    title={template.is_active ? 'Disable' : 'Enable'}
                  >
                    <Power size={16} className={template.is_active ? 'text-green-500' : 'text-red-500'} />
                  </button>
                </div>
              </div>

              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Subject</p>
                <p className="text-sm text-gray-700 mt-1 truncate">{template.subject}</p>
              </div>

              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wider">Variables</p>
                <div className="flex flex-wrap gap-1 mt-1">
                  {template.variables.slice(0, 4).map((v, i) => (
                    <span key={i} className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-mono">
                      {`{{${v}}}`}
                    </span>
                  ))}
                  {template.variables.length > 4 && (
                    <span className="text-xs text-gray-500">+{template.variables.length - 4} more</span>
                  )}
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Edit Modal */}
      <Modal
        isOpen={!!editModal}
        onClose={() => setEditModal(null)}
        title={`Edit: ${editModal?.template_name}`}
        size="lg"
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setEditModal(null)}>Cancel</Button>
            <Button onClick={handleSave}>Save Changes</Button>
          </div>
        }
      >
        {editModal && (
          <div className="space-y-4">
            <Input
              label="Subject"
              value={formData.subject}
              onChange={(e) => setFormData(prev => ({ ...prev, subject: e.target.value }))}
            />
            <Textarea
              label="Body"
              value={formData.body}
              onChange={(e) => setFormData(prev => ({ ...prev, body: e.target.value }))}
              rows={10}
              className="font-mono text-sm"
            />
            <div>
              <p className="text-sm text-gray-500 mb-2">Available Variables:</p>
              <div className="flex flex-wrap gap-2">
                {editModal.variables.map((v, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => {
                      setFormData(prev => ({ ...prev, body: prev.body + `{{${v}}}` }));
                    }}
                    className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-700 px-2 py-1 rounded font-mono"
                  >
                    {`{{${v}}}`}
                  </button>
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
        )}
      </Modal>

      {/* Preview Modal */}
      <Modal
        isOpen={!!previewModal}
        onClose={() => setPreviewModal(null)}
        title="Email Preview"
        size="lg"
      >
        {previewModal && (
          <div className="space-y-4">
            <div className="bg-gray-100 rounded-lg p-4">
              <p className="text-xs text-gray-500 uppercase">Subject</p>
              <p className="font-medium text-gray-800 mt-1">
                {getPreviewContent({ ...previewModal, body: previewModal.subject })}
              </p>
            </div>
            <div className="border rounded-lg p-4">
              <p className="text-xs text-gray-500 uppercase mb-2">Body</p>
              <div className="whitespace-pre-wrap text-sm text-gray-700">
                {getPreviewContent(previewModal)}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
