import { api } from './api';

// ==================== REAL SMS SENDING ====================
export const smsService = {
  // Send SMS through the platform
  sendSMS: async (data: {
    client_id?: string;
    destination: string;
    sender_id: string;
    message: string;
    route_id?: string;
    force_route?: boolean;
    test_mode?: boolean;
  }) => {
    const response = await api.post<any>('/sms/send', {
      ...data,
      timestamp: new Date().toISOString(),
    });
    return response;
  },

  // Check balance & credit before sending
  validateSending: async (client_id: string, destination: string) => {
    const response = await api.post<any>('/sms/validate', {
      client_id,
      destination,
    });
    return response;
  },

  // Get DLR status
  getDLR: async (message_id: string) => {
    return api.get<any>(`/sms/dlr/${message_id}`);
  },

  // Batch DLR check
  batchDLR: async (message_ids: string[]) => {
    return api.post<any>('/sms/dlr/batch', { message_ids });
  },

  // Get SMS stats for a client
  getClientStats: async (client_id: string, period: string) => {
    return api.get<any>(`/sms/stats/client/${client_id}?period=${period}`);
  },

  // Get SMS stats for a supplier
  getSupplierStats: async (supplier_id: string, period: string) => {
    return api.get<any>(`/sms/stats/supplier/${supplier_id}?period=${period}`);
  },
};

// ==================== RATE MANAGEMENT WITH NOTIFICATION ====================
export const rateService = {
  // Create rate with auto-notification
  createRate: async (data: {
    entity_type: 'client' | 'supplier';
    entity_id: string;
    mcc: string;
    mnc: string;
    country: string;
    operator: string;
    rate: number;
    currency: string;
    effective_from: string;
    send_notification?: boolean;
  }) => {
    const response = await api.post<any>('/rates', data);
    
    // Auto-send rate change notification if requested
    if (data.send_notification && response.success) {
      await api.post('/rates/notify', {
        entity_type: data.entity_type,
        entity_id: data.entity_id,
        rate_ids: [response.data?.id],
      });
    }
    
    return response;
  },

  // Bulk create rates - deactivates old rates when new ones added
  bulkCreateRates: async (rates: Array<{
    entity_type: 'client' | 'supplier';
    entity_id: string;
    mcc: string;
    mnc: string;
    country: string;
    operator: string;
    rate: number;
    currency: string;
  }>) => {
    // First, deactivate existing rates for same destinations
    const rateKeys = rates.map(r => ({
      entity_type: r.entity_type,
      entity_id: r.entity_id,
      mcc: r.mcc,
      mnc: r.mnc,
    }));

    await api.post('/rates/deactivate-old', { rates: rateKeys });

    // Then create new rates
    const response = await api.post<any>('/rates/bulk', { rates });
    
    return response;
  },

  // Get rate history with timestamps
  getRateHistory: async (entity_type: string, entity_id: string, mcc: string, mnc: string) => {
    return api.get<any[]>(`/rates/history?entity_type=${entity_type}&entity_id=${entity_id}&mcc=${mcc}&mnc=${mnc}`);
  },

  // Send rate change notification to client/supplier
  sendRateNotification: async (entity_type: string, entity_id: string, rate_ids: string[]) => {
    return api.post('/rates/notify', { entity_type, entity_id, rate_ids });
  },

  // Get bulk rates by destination (all operators for a country)
  getDestinationRates: async (entity_type: string, entity_id: string, mcc: string) => {
    return api.get<any[]>(`/rates/destination?entity_type=${entity_type}&entity_id=${entity_id}&mcc=${mcc}`);
  },

  // Update rates for entire destination
  updateDestinationRates: async (data: {
    entity_type: string;
    entity_id: string;
    mcc: string;
    new_rate: number;
    mnc_list?: string[];
    send_notification?: boolean;
  }) => {
    return api.post<any>('/rates/update-destination', data);
  },
};

// ==================== BILLING - PROPER INVOICE ====================
export const invoiceService = {
  // Generate professional invoice
  generateInvoice: async (data: {
    entity_type: 'client' | 'supplier';
    entity_id: string;
    period_start: string;
    period_end: string;
    due_days?: number;
    notes?: string;
    auto_send?: boolean;
  }) => {
    const response = await api.post<any>('/invoices/generate', data);
    
    if (data.auto_send && response.success) {
      await api.post(`/invoices/${response.data?.id}/send`, {});
    }
    
    return response;
  },

  // Get invoice with destination-wise breakdown
  getInvoiceDetail: async (id: string) => {
    return api.get<any>(`/invoices/${id}`);
  },

  // Get invoice destination breakdown
  getInvoiceBreakdown: async (id: string) => {
    return api.get<any[]>(`/invoices/${id}/breakdown`);
  },

  // Send invoice via email
  sendInvoice: async (id: string, additional_emails?: string[]) => {
    return api.post(`/invoices/${id}/send`, { additional_emails });
  },

  // Mark invoice as paid
  markInvoicePaid: async (id: string, data: { payment_method: string; reference: string }) => {
    return api.post(`/invoices/${id}/mark-paid`, data);
  },

  // Get invoice PDF
  getInvoicePDF: async (id: string) => {
    return api.get<Blob>(`/invoices/${id}/pdf`);
  },

  // Generate bulk invoices for multiple clients
  generateBulkInvoices: async (data: {
    entity_type: 'client' | 'supplier';
    entity_ids: string[];
    period_start: string;
    period_end: string;
  }) => {
    return api.post<any>('/invoices/bulk-generate', data);
  },
};

// ==================== PAYMENT SERVICE ====================
export const paymentService = {
  // Add payment for client or supplier
  addPayment: async (data: {
    entity_type: 'client' | 'supplier';
    entity_id: string;
    amount: number;
    currency: string;
    payment_method: string;
    reference: string;
    notes?: string;
    update_balance?: boolean;
  }) => {
    const response = await api.post<any>('/payments', data);
    
    // Auto-update balance if requested
    if (data.update_balance && response.success) {
      const endpoint = data.entity_type === 'client' 
        ? `/clients/${data.entity_id}/balance`
        : `/suppliers/${data.entity_id}/balance`;
      
      await api.post(endpoint, {
        amount: data.amount,
        type: 'credit',
        reference: data.reference,
      });
    }
    
    return response;
  },

  // Get payment history for entity
  getPaymentHistory: async (entity_type: string, entity_id: string) => {
    return api.get<any[]>(`/payments/history?entity_type=${entity_type}&entity_id=${entity_id}`);
  },

  // Get all payments with filters
  getPayments: async (filters?: {
    entity_type?: string;
    status?: string;
    date_from?: string;
    date_to?: string;
  }) => {
    return api.post<any[]>('/payments/list', filters || {});
  },

  // Update payment status
  updatePaymentStatus: async (id: string, status: string) => {
    return api.put(`/payments/${id}/status`, { status });
  },
};

// ==================== VOICE OTP SERVICE ====================
export const voiceOtpService = {
  // Send voice OTP
  sendVoiceOTP: async (data: {
    destination: string;
    otp_code: string;
    language: string;
    caller_id?: string;
    max_retries?: number;
    retry_interval?: number;
  }) => {
    return api.post<any>('/voice-otp/send', {
      ...data,
      max_retries: data.max_retries || 4,
      retry_interval: data.retry_interval || 30,
    });
  },

  // Upload language audio files (0-9, a-z)
  uploadLanguageAudio: async (language_code: string, formData: FormData) => {
    return api.upload<any>(`/voice-otp/languages/${language_code}/audio`, formData);
  },

  // Upload greeting audio
  uploadGreeting: async (config_id: string, formData: FormData) => {
    return api.upload<any>(`/voice-otp/configs/${config_id}/greeting`, formData);
  },

  // Get call status
  getCallStatus: async (call_id: string) => {
    return api.get<any>(`/voice-otp/calls/${call_id}`);
  },

  // Get call logs with filtering
  getCallLogs: async (filters: {
    date_from?: string;
    date_to?: string;
    status?: string;
    language?: string;
  }) => {
    return api.post<any[]>('/voice-otp/logs', filters);
  },

  // Test voice OTP call
  testCall: async (data: { destination: string; language: string }) => {
    return api.post<any>('/voice-otp/test', data);
  },

  // Get language configurations
  getLanguages: async () => {
    return api.get<any[]>('/voice-otp/languages');
  },

  // Update SIP/Asterisk settings
  updateSIPSettings: async (data: {
    host: string;
    port: number;
    username: string;
    password: string;
    caller_id: string;
  }) => {
    return api.put('/voice-otp/sip-settings', data);
  },
};

// ==================== TRANSLATION SERVICE ====================
export const translationService = {
  // Apply translations to SMS
  applyTranslation: async (data: {
    client_id?: string;
    supplier_id?: string;
    route_id?: string;
    sender_id: string;
    destination: string;
    message: string;
  }) => {
    return api.post<any>('/translations/apply', data);
  },

  // Create translation rule
  createTranslation: async (data: {
    translation_type: 'sender_id' | 'destination' | 'content' | 'origination';
    source_pattern: string;
    target_value: string;
    client_id?: string;
    supplier_id?: string;
    route_id?: string;
  }) => {
    return api.post<any>('/translations', data);
  },

  // Test translation
  testTranslation: async (data: {
    translation_type: string;
    source_pattern: string;
    target_value: string;
    test_input: string;
  }) => {
    return api.post<any>('/translations/test', data);
  },

  // Get all translations
  getTranslations: async (filters?: { type?: string; entity_type?: string }) => {
    return api.post<any[]>('/translations/list', filters || {});
  },
};

// ==================== REAL API CONNECTORS ====================
export const connectorService = {
  // Test a connector
  testConnector: async (connector_id: string) => {
    return api.post<any>(`/api-connectors/${connector_id}/test`, {});
  },

  // Send SMS via a specific connector
  sendViaConnector: async (connector_id: string, data: {
    to: string;
    from: string;
    text: string;
  }) => {
    return api.post<any>(`/api-connectors/${connector_id}/send`, data);
  },

  // Get all pre-configured connectors
  getConnectors: async () => {
    return api.get<any[]>('/api-connectors');
  },

  // Save connector configuration
  saveConnector: async (data: any) => {
    return api.post<any>('/api-connectors', data);
  },

  // Update connector
  updateConnector: async (id: string, data: any) => {
    return api.put<any>(`/api-connectors/${id}`, data);
  },

  // Delete connector
  deleteConnector: async (id: string) => {
    return api.delete(`/api-connectors/${id}`);
  },
};

// ==================== NOTIFICATION SERVICE ====================
export const notificationService = {
  // Send notification (email/SMS/dashboard)
  sendNotification: async (data: {
    template_name: string;
    variables: Record<string, string>;
    recipients: string[];
    channel?: 'email' | 'sms' | 'dashboard' | 'all';
  }) => {
    return api.post('/notifications/send', data);
  },

  // Get all notifications
  getNotifications: async (filters?: { type?: string; read?: boolean }) => {
    return api.post<any[]>('/notifications/list', filters || {});
  },

  // Mark notification as read
  markAsRead: async (id: string) => {
    return api.post(`/notifications/${id}/read`, {});
  },

  // Mark all as read
  markAllAsRead: async () => {
    return api.post('/notifications/read-all', {});
  },

  // Send rate change notification
  sendRateChangeNotification: async (data: {
    entity_type: string;
    entity_id: string;
    destination: string;
    old_rate: number;
    new_rate: number;
    effective_date: string;
  }) => {
    return api.post('/notifications/rate-change', data);
  },

  // Send low balance alert
  sendLowBalanceAlert: async (data: {
    entity_type: string;
    entity_id: string;
    balance: number;
    threshold: number;
  }) => {
    return api.post('/notifications/low-balance', data);
  },

  // Send DLR failure alert
  sendDLRFailureAlert: async (data: {
    route_name: string;
    supplier_name: string;
    failure_count: number;
    action_taken: string;
  }) => {
    return api.post('/notifications/dlr-failure', data);
  },
};

// ==================== BILLING MODE SERVICE ====================
export const billingModeService = {
  // Set billing mode for entity
  setBillingMode: async (data: {
    entity_type: 'client' | 'supplier';
    entity_id: string;
    billing_mode: 'submit' | 'dlr';
    force_dlr?: boolean;
    dlr_timeout?: number; // seconds to wait for DLR
  }) => {
    return api.put(`/billing/mode`, data);
  },

  // On submit billing - charge on message submission
  chargeOnSubmit: async (data: {
    entity_type: string;
    entity_id: string;
    message_id: string;
    amount: number;
  }) => {
    return api.post('/billing/charge/submit', data);
  },

  // On DLR billing - charge only on delivery
  chargeOnDLR: async (data: {
    entity_type: string;
    entity_id: string;
    message_id: string;
    amount: number;
    dlr_status: string;
  }) => {
    return api.post('/billing/charge/dlr', data);
  },

  // Process DLR with force DLR timeout
  processForceDLR: async (data: {
    message_id: string;
    timeout_seconds: number;
  }) => {
    return api.post('/billing/force-dlr', data);
  },
};

// ==================== REAL BIND STATUS ====================
export const bindService = {
  // Get real-time bind status for all suppliers
  getAllBindStatus: async () => {
    return api.get<any[]>('/bind/status');
  },

  // Get bind status for specific supplier
  getSupplierBindStatus: async (supplier_id: string) => {
    return api.get<any>(`/bind/status/${supplier_id}`);
  },

  // Bind SMPP connection
  bindSMPP: async (supplier_id: string) => {
    return api.post<any>(`/bind/${supplier_id}/connect`, {});
  },

  // Unbind SMPP connection
  unbindSMPP: async (supplier_id: string) => {
    return api.post<any>(`/bind/${supplier_id}/disconnect`, {});
  },

  // Reconnect (unbind + bind)
  reconnect: async (supplier_id: string) => {
    return api.post<any>(`/bind/${supplier_id}/reconnect`, {});
  },

  // Test SMPP connectivity
  testSMPP: async (data: { host: string; port: number; username: string; password: string }) => {
    return api.post<any>('/bind/test', data);
  },

  // Get bind history
  getBindHistory: async (supplier_id: string) => {
    return api.get<any[]>(`/bind/${supplier_id}/history`);
  },
};
