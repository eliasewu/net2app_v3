// API Configuration
declare const __API_URL__: string;
const API_BASE_URL = (typeof __API_URL__ !== 'undefined' ? __API_URL__ : null) || '/api';

// Types for API responses
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// HTTP Client
class ApiClient {
  private baseUrl: string;
  private token: string | null = null;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
    this.token = localStorage.getItem('auth_token');
  }

  setToken(token: string | null) {
    this.token = token;
    if (token) {
      localStorage.setItem('auth_token', token);
    } else {
      localStorage.removeItem('auth_token');
    }
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(this.token && { Authorization: `Bearer ${this.token}` }),
      ...options.headers,
    };

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        ...options,
        headers,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Request failed');
      }

      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async get<T>(endpoint: string): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'GET' });
  }

  async post<T>(endpoint: string, body: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async put<T>(endpoint: string, body: unknown): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  async delete<T>(endpoint: string): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'DELETE' });
  }

  async upload<T>(endpoint: string, formData: FormData): Promise<ApiResponse<T>> {
    const headers: HeadersInit = {
      ...(this.token && { Authorization: `Bearer ${this.token}` }),
    };

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method: 'POST',
        headers,
        body: formData,
      });

      const data = await response.json();
      return { success: true, data };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Upload failed',
      };
    }
  }
}

export const api = new ApiClient(API_BASE_URL);

// ==================== AUTH API ====================
export const authApi = {
  login: (username: string, password: string) =>
    api.post<{ token: string; user: any }>('/auth/login', { username, password }),
  
  logout: () => api.post('/auth/logout', {}),
  
  refreshToken: () => api.post<{ token: string }>('/auth/refresh', {}),
  
  getProfile: () => api.get<any>('/auth/profile'),
  
  changePassword: (oldPassword: string, newPassword: string) =>
    api.post('/auth/change-password', { oldPassword, newPassword }),
};

// ==================== CLIENTS API ====================
export const clientsApi = {
  getAll: () => api.get<any[]>('/clients'),
  getById: (id: string) => api.get<any>(`/clients/${id}`),
  create: (data: any) => api.post<any>('/clients', data),
  update: (id: string, data: any) => api.put<any>(`/clients/${id}`, data),
  delete: (id: string) => api.delete(`/clients/${id}`),
  bulkDelete: (ids: string[]) => api.post('/clients/bulk-delete', { ids }),
  getUsage: (id: string, period: string) => api.get<any>(`/clients/${id}/usage?period=${period}`),
  getCDR: (id: string, filters: any) => api.post<any[]>(`/clients/${id}/cdr`, filters),
  updateBalance: (id: string, amount: number, type: 'credit' | 'debit') =>
    api.post(`/clients/${id}/balance`, { amount, type }),
  sendWelcomeEmail: (id: string) => api.post(`/clients/${id}/send-welcome`, {}),
};

// ==================== SUPPLIERS API ====================
export const suppliersApi = {
  getAll: () => api.get<any[]>('/suppliers'),
  getById: (id: string) => api.get<any>(`/suppliers/${id}`),
  create: (data: any) => api.post<any>('/suppliers', data),
  update: (id: string, data: any) => api.put<any>(`/suppliers/${id}`, data),
  delete: (id: string) => api.delete(`/suppliers/${id}`),
  bulkDelete: (ids: string[]) => api.post('/suppliers/bulk-delete', { ids }),
  getUsage: (id: string, period: string) => api.get<any>(`/suppliers/${id}/usage?period=${period}`),
  getCDR: (id: string, filters: any) => api.post<any[]>(`/suppliers/${id}/cdr`, filters),
  bind: (id: string) => api.post(`/suppliers/${id}/bind`, {}),
  unbind: (id: string) => api.post(`/suppliers/${id}/unbind`, {}),
  testConnection: (id: string) => api.post<any>(`/suppliers/${id}/test`, {}),
  resetFailures: (id: string) => api.post(`/suppliers/${id}/reset-failures`, {}),
};

// ==================== RATES API ====================
export const ratesApi = {
  getClientRates: (clientId: string) => api.get<any[]>(`/rates/client/${clientId}`),
  getSupplierRates: (supplierId: string) => api.get<any[]>(`/rates/supplier/${supplierId}`),
  create: (data: any) => api.post<any>('/rates', data),
  update: (id: string, data: any) => api.put<any>(`/rates/${id}`, data),
  delete: (id: string) => api.delete(`/rates/${id}`),
  bulkCreate: (rates: any[]) => api.post<any>('/rates/bulk', { rates }),
  bulkDelete: (ids: string[]) => api.post('/rates/bulk-delete', { ids }),
  import: (formData: FormData) => api.upload<any>('/rates/import', formData),
  export: (entityType: string, entityId: string) =>
    api.get<Blob>(`/rates/export?entity_type=${entityType}&entity_id=${entityId}`),
  sendRateNotification: (entityType: string, entityId: string, rateIds: string[]) =>
    api.post('/rates/notify', { entityType, entityId, rateIds }),
};

// ==================== ROUTING API ====================
export const routingApi = {
  // Trunks
  getTrunks: () => api.get<any[]>('/routing/trunks'),
  createTrunk: (data: any) => api.post<any>('/routing/trunks', data),
  updateTrunk: (id: string, data: any) => api.put<any>(`/routing/trunks/${id}`, data),
  deleteTrunk: (id: string) => api.delete(`/routing/trunks/${id}`),
  
  // Routes
  getRoutes: () => api.get<any[]>('/routing/routes'),
  createRoute: (data: any) => api.post<any>('/routing/routes', data),
  updateRoute: (id: string, data: any) => api.put<any>(`/routing/routes/${id}`, data),
  deleteRoute: (id: string) => api.delete(`/routing/routes/${id}`),
  
  // Route Plans
  getRoutePlans: () => api.get<any[]>('/routing/plans'),
  createRoutePlan: (data: any) => api.post<any>('/routing/plans', data),
  updateRoutePlan: (id: string, data: any) => api.put<any>(`/routing/plans/${id}`, data),
  deleteRoutePlan: (id: string) => api.delete(`/routing/plans/${id}`),
  
  // Route Maps (Client -> Route -> Supplier mapping)
  getRouteMaps: () => api.get<any[]>('/routing/maps'),
  getClientRouteMaps: (clientId: string) => api.get<any[]>(`/routing/maps/client/${clientId}`),
  createRouteMap: (data: any) => api.post<any>('/routing/maps', data),
  updateRouteMap: (id: string, data: any) => api.put<any>(`/routing/maps/${id}`, data),
  deleteRouteMap: (id: string) => api.delete(`/routing/maps/${id}`),
};

// ==================== MCCMNC API ====================
export const mccmncApi = {
  getAll: () => api.get<any[]>('/mccmnc'),
  create: (data: any) => api.post<any>('/mccmnc', data),
  update: (id: string, data: any) => api.put<any>(`/mccmnc/${id}`, data),
  delete: (id: string) => api.delete(`/mccmnc/${id}`),
  bulkCreate: (entries: any[]) => api.post<any>('/mccmnc/bulk', { entries }),
  bulkDelete: (ids: string[]) => api.post('/mccmnc/bulk-delete', { ids }),
  import: (formData: FormData) => api.upload<any>('/mccmnc/import', formData),
  export: () => api.get<Blob>('/mccmnc/export'),
};

// ==================== BILLING API ====================
export const billingApi = {
  // Invoices
  getInvoices: (filters?: any) => api.post<any[]>('/billing/invoices/list', filters || {}),
  getInvoice: (id: string) => api.get<any>(`/billing/invoices/${id}`),
  createInvoice: (data: any) => api.post<any>('/billing/invoices', data),
  updateInvoice: (id: string, data: any) => api.put<any>(`/billing/invoices/${id}`, data),
  deleteInvoice: (id: string) => api.delete(`/billing/invoices/${id}`),
  sendInvoice: (id: string) => api.post(`/billing/invoices/${id}/send`, {}),
  markPaid: (id: string, paymentData: any) => api.post(`/billing/invoices/${id}/mark-paid`, paymentData),
  generatePDF: (id: string) => api.get<Blob>(`/billing/invoices/${id}/pdf`),
  
  // Payments
  getPayments: (filters?: any) => api.post<any[]>('/billing/payments/list', filters || {}),
  createPayment: (data: any) => api.post<any>('/billing/payments', data),
  
  // Balance Operations
  topup: (entityType: string, entityId: string, amount: number, method: string) =>
    api.post('/billing/topup', { entityType, entityId, amount, method }),
};

// ==================== SMS API ====================
export const smsApi = {
  getLogs: (filters: any) => api.post<any[]>('/sms/logs', filters),
  getLog: (id: string) => api.get<any>(`/sms/logs/${id}`),
  sendTest: (data: any) => api.post<any>('/sms/test', data),
  getStats: (period: string) => api.get<any>(`/sms/stats?period=${period}`),
  resend: (id: string) => api.post(`/sms/${id}/resend`, {}),
};

// ==================== BIND STATUS API ====================
export const bindApi = {
  getStatus: () => api.get<any[]>('/bind/status'),
  reconnect: (supplierId: string) => api.post(`/bind/${supplierId}/reconnect`, {}),
  disconnect: (supplierId: string) => api.post(`/bind/${supplierId}/disconnect`, {}),
  getHistory: (supplierId: string) => api.get<any[]>(`/bind/${supplierId}/history`),
};

// ==================== OTT DEVICES API ====================
export const ottApi = {
  getDevices: () => api.get<any[]>('/ott/devices'),
  createDevice: (data: any) => api.post<any>('/ott/devices', data),
  updateDevice: (id: string, data: any) => api.put<any>(`/ott/devices/${id}`, data),
  deleteDevice: (id: string) => api.delete(`/ott/devices/${id}`),
  getQRCode: (id: string) => api.get<{ qr: string }>(`/ott/devices/${id}/qr`),
  connect: (id: string) => api.post(`/ott/devices/${id}/connect`, {}),
  disconnect: (id: string) => api.post(`/ott/devices/${id}/disconnect`, {}),
  validateNumber: (id: string, number: string) => 
    api.post<{ valid: boolean }>(`/ott/devices/${id}/validate`, { number }),
};

// ==================== NOTIFICATIONS API ====================
export const notificationsApi = {
  getAll: () => api.get<any[]>('/notifications'),
  markRead: (id: string) => api.post(`/notifications/${id}/read`, {}),
  markAllRead: () => api.post('/notifications/read-all', {}),
  delete: (id: string) => api.delete(`/notifications/${id}`),
  getTemplates: () => api.get<any[]>('/notifications/templates'),
  updateTemplate: (id: string, data: any) => api.put<any>(`/notifications/templates/${id}`, data),
  testTemplate: (id: string, testData: any) => api.post(`/notifications/templates/${id}/test`, testData),
};

// ==================== USERS API ====================
export const usersApi = {
  getAll: () => api.get<any[]>('/users'),
  getById: (id: string) => api.get<any>(`/users/${id}`),
  create: (data: any) => api.post<any>('/users', data),
  update: (id: string, data: any) => api.put<any>(`/users/${id}`, data),
  delete: (id: string) => api.delete(`/users/${id}`),
  getRoles: () => api.get<any[]>('/users/roles'),
  updateRole: (id: string, permissions: string[]) => 
    api.put(`/users/roles/${id}`, { permissions }),
};

// ==================== REPORTS API ====================
export const reportsApi = {
  getRealtime: () => api.get<any>('/reports/realtime'),
  getHourly: (date: string) => api.get<any>(`/reports/hourly?date=${date}`),
  getDaily: (month: string) => api.get<any>(`/reports/daily?month=${month}`),
  getMonthly: (year: string) => api.get<any>(`/reports/monthly?year=${year}`),
  getClientReport: (clientId: string, period: string) => 
    api.get<any>(`/reports/client/${clientId}?period=${period}`),
  getSupplierReport: (supplierId: string, period: string) => 
    api.get<any>(`/reports/supplier/${supplierId}?period=${period}`),
  export: (type: string, filters: any) => api.post<Blob>(`/reports/export/${type}`, filters),
};

// ==================== SYSTEM API ====================
export const systemApi = {
  getSettings: () => api.get<any>('/system/settings'),
  updateSettings: (data: any) => api.put<any>('/system/settings', data),
  getDatabase: () => api.get<any>('/system/database'),
  backup: () => api.post<any>('/system/backup', {}),
  restore: (formData: FormData) => api.upload<any>('/system/restore', formData),
  getLogs: (type: string) => api.get<any[]>(`/system/logs/${type}`),
};

// ==================== LICENSE API ====================
export const licenseApi = {
  getInfo: () => api.get<any>('/license/info'),
  getLimits: () => api.get<any>('/license/limits'),
  activate: (key: string) => api.post<any>('/license/activate', { key }),
  deactivate: () => api.post('/license/deactivate', {}),
  validateKey: (key: string) => api.post<any>('/license/validate', { key }),
  getSystemInfo: () => api.get<any>('/license/system-info'),
  
  // Tenant Management
  getTenants: () => api.get<any[]>('/license/tenants'),
  createTenant: (data: any) => api.post<any>('/license/tenants', data),
  updateTenant: (id: string, data: any) => api.put<any>(`/license/tenants/${id}`, data),
  deleteTenant: (id: string) => api.delete(`/license/tenants/${id}`),
  getTenantUsage: (id: string) => api.get<any>(`/license/tenants/${id}/usage`),
  
  // License Key Generation (for admin)
  generateKey: (data: any) => api.post<{ key: string }>('/license/generate', data),
};

// ==================== CAMPAIGNS API ====================
export const campaignsApi = {
  getAll: () => api.get<any[]>('/campaigns'),
  getById: (id: string) => api.get<any>(`/campaigns/${id}`),
  create: (data: any) => api.post<any>('/campaigns', data),
  update: (id: string, data: any) => api.put<any>(`/campaigns/${id}`, data),
  delete: (id: string) => api.delete(`/campaigns/${id}`),
  start: (id: string) => api.post(`/campaigns/${id}/start`, {}),
  pause: (id: string) => api.post(`/campaigns/${id}/pause`, {}),
  resume: (id: string) => api.post(`/campaigns/${id}/resume`, {}),
  cancel: (id: string) => api.post(`/campaigns/${id}/cancel`, {}),
  uploadRecipients: (id: string, formData: FormData) => 
    api.upload<any>(`/campaigns/${id}/recipients`, formData),
};

// ==================== TRANSLATIONS API ====================
export const translationsApi = {
  getAll: () => api.get<any[]>('/translations'),
  create: (data: any) => api.post<any>('/translations', data),
  update: (id: string, data: any) => api.put<any>(`/translations/${id}`, data),
  delete: (id: string) => api.delete(`/translations/${id}`),
  test: (data: any) => api.post<any>('/translations/test', data),
};

// ==================== VOICE OTP API ====================
export const voiceOtpApi = {
  getConfigs: () => api.get<any[]>('/voice-otp/configs'),
  createConfig: (data: any) => api.post<any>('/voice-otp/configs', data),
  updateConfig: (id: string, data: any) => api.put<any>(`/voice-otp/configs/${id}`, data),
  deleteConfig: (id: string) => api.delete(`/voice-otp/configs/${id}`),
  uploadAudio: (id: string, formData: FormData) => 
    api.upload<any>(`/voice-otp/configs/${id}/audio`, formData),
  getLogs: (filters: any) => api.post<any[]>('/voice-otp/logs', filters),
  testCall: (data: any) => api.post<any>('/voice-otp/test', data),
};

// ==================== API CONNECTORS ====================
export const apiConnectorsApi = {
  getAll: () => api.get<any[]>('/api-connectors'),
  create: (data: any) => api.post<any>('/api-connectors', data),
  update: (id: string, data: any) => api.put<any>(`/api-connectors/${id}`, data),
  delete: (id: string) => api.delete(`/api-connectors/${id}`),
  test: (id: string) => api.post<any>(`/api-connectors/${id}/test`, {}),
};

export default api;

// Export commonly used functions
export const getAll = api.get;
export const loginApi = api.post;

