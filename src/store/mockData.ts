import { Client, Supplier, Trunk, Route, RoutePlan, Rate, MCCMNC, Invoice, Payment, SMSLog, EmailTemplate, OTTDevice, APIConnector, User, DashboardStats, Notification, Campaign, Translation, VoiceOTPConfig } from '../types';

// ==================== CLIENTS ====================
export const mockClients: Client[] = [
  {
    id: '1',
    client_code: 'CLT001',
    company_name: 'TechCorp Global',
    contact_person: 'John Smith',
    email: 'john@techcorp.com',
    phone: '+1234567890',
    address: '123 Tech Street, Silicon Valley',
    country: 'USA',
    smpp_username: 'techcorp_smpp',
    smpp_password: 'secure123',
    smpp_ip: '192.168.1.100',
    smpp_port: 2775,
    system_type: 'SMPP',
    max_tps: 100,
    billing_mode: 'dlr',
    currency: 'EUR',
    balance: 5000.00,
    credit_limit: 10000.00,
    api_enabled: true,
    webhook_url: 'https://techcorp.com/webhook',
    force_dlr: true,
    routing_plan_id: '1',
    rate_plan_id: '1',
    status: 'active',
    created_at: '2024-01-15T10:00:00Z',
    updated_at: '2024-03-20T14:30:00Z'
  },
  {
    id: '2',
    client_code: 'CLT002',
    company_name: 'MegaBank Ltd',
    contact_person: 'Sarah Johnson',
    email: 'sarah@megabank.com',
    phone: '+9876543210',
    address: '456 Finance Road, London',
    country: 'UK',
    smpp_username: 'megabank_smpp',
    smpp_password: 'bank456',
    smpp_ip: '192.168.1.101',
    smpp_port: 2775,
    system_type: 'SMPP',
    max_tps: 200,
    billing_mode: 'submit',
    currency: 'EUR',
    balance: 25000.00,
    credit_limit: 50000.00,
    api_enabled: true,
    webhook_url: 'https://megabank.com/sms/webhook',
    force_dlr: true,
    routing_plan_id: '1',
    rate_plan_id: '1',
    status: 'active',
    created_at: '2024-02-01T09:00:00Z',
    updated_at: '2024-03-18T11:20:00Z'
  },
  {
    id: '3',
    client_code: 'CLT003',
    company_name: 'EcomStore Inc',
    contact_person: 'Mike Brown',
    email: 'mike@ecomstore.com',
    phone: '+1122334455',
    address: '789 Commerce Ave, New York',
    country: 'USA',
    smpp_username: 'ecomstore_smpp',
    smpp_password: 'ecom789',
    smpp_ip: '192.168.1.102',
    smpp_port: 2775,
    system_type: 'HTTP',
    max_tps: 50,
    billing_mode: 'dlr',
    currency: 'USD',
    balance: 1500.00,
    credit_limit: 5000.00,
    api_enabled: true,
    webhook_url: '',
    force_dlr: false,
    routing_plan_id: '2',
    rate_plan_id: '2',
    status: 'active',
    created_at: '2024-02-15T14:00:00Z',
    updated_at: '2024-03-15T16:45:00Z'
  },
  {
    id: '4',
    client_code: 'CLT004',
    company_name: 'HealthCare Plus',
    contact_person: 'Dr. Emily White',
    email: 'emily@healthcareplus.com',
    phone: '+5566778899',
    address: '321 Medical Blvd, Boston',
    country: 'USA',
    smpp_username: 'healthcare_smpp',
    smpp_password: 'health321',
    smpp_ip: '192.168.1.103',
    smpp_port: 2775,
    system_type: 'SMPP',
    max_tps: 75,
    billing_mode: 'dlr',
    currency: 'EUR',
    balance: 8500.00,
    credit_limit: 15000.00,
    api_enabled: false,
    webhook_url: '',
    force_dlr: true,
    routing_plan_id: '1',
    rate_plan_id: '1',
    status: 'active',
    created_at: '2024-01-20T08:30:00Z',
    updated_at: '2024-03-22T10:15:00Z'
  },
  {
    id: '5',
    client_code: 'CLT005',
    company_name: 'TravelWorld Agency',
    contact_person: 'Lisa Chen',
    email: 'lisa@travelworld.com',
    phone: '+6677889900',
    address: '555 Tourism Lane, Miami',
    country: 'USA',
    smpp_username: 'travelworld_smpp',
    smpp_password: 'travel555',
    smpp_ip: '192.168.1.104',
    smpp_port: 2775,
    system_type: 'SMPP',
    max_tps: 30,
    billing_mode: 'submit',
    currency: 'USD',
    balance: 500.00,
    credit_limit: 2000.00,
    api_enabled: true,
    webhook_url: 'https://travelworld.com/api/sms',
    force_dlr: false,
    routing_plan_id: '2',
    rate_plan_id: '2',
    status: 'suspended',
    created_at: '2024-03-01T12:00:00Z',
    updated_at: '2024-03-25T09:00:00Z'
  }
];

// ==================== SUPPLIERS ====================
export const mockSuppliers: Supplier[] = [
  {
    id: '1',
    supplier_code: 'SUP001',
    company_name: 'GlobalSMS Gateway',
    contact_person: 'Alex Turner',
    email: 'alex@globalsms.com',
    phone: '+1111222233',
    connection_type: 'smpp',
    smpp_host: 'smpp.globalsms.com',
    smpp_port: 2775,
    smpp_username: 'net2app_client',
    smpp_password: 'gateway123',
    system_id: 'NET2APP',
    api_url: '',
    api_key: '',
    api_method: 'POST',
    balance: 50000.00,
    credit_limit: 100000.00,
    currency: 'EUR',
    bind_status: 'bound',
    status: 'active',
    consecutive_failures: 0,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-03-20T12:00:00Z'
  },
  {
    id: '2',
    supplier_code: 'SUP002',
    company_name: 'DirectRoute Pro',
    contact_person: 'Maria Garcia',
    email: 'maria@directroute.com',
    phone: '+2222333344',
    connection_type: 'smpp',
    smpp_host: 'smpp.directroute.com',
    smpp_port: 2775,
    smpp_username: 'net2app',
    smpp_password: 'direct456',
    system_id: 'NET2APP',
    api_url: '',
    api_key: '',
    api_method: 'POST',
    balance: 35000.00,
    credit_limit: 75000.00,
    currency: 'EUR',
    bind_status: 'bound',
    status: 'active',
    consecutive_failures: 2,
    created_at: '2024-01-10T00:00:00Z',
    updated_at: '2024-03-19T15:30:00Z'
  },
  {
    id: '3',
    supplier_code: 'SUP003',
    company_name: 'SIM OTP Services',
    contact_person: 'James Wilson',
    email: 'james@simotp.com',
    phone: '+3333444455',
    connection_type: 'smpp',
    smpp_host: 'otp.simotp.com',
    smpp_port: 2776,
    smpp_username: 'net2app_otp',
    smpp_password: 'otp789',
    system_id: 'OTP',
    api_url: '',
    api_key: '',
    api_method: 'POST',
    balance: 20000.00,
    credit_limit: 40000.00,
    currency: 'EUR',
    bind_status: 'bound',
    status: 'active',
    consecutive_failures: 0,
    created_at: '2024-02-01T00:00:00Z',
    updated_at: '2024-03-18T09:00:00Z'
  },
  {
    id: '4',
    supplier_code: 'SUP004',
    company_name: 'WhatsApp Business API',
    contact_person: 'Emma Davis',
    email: 'emma@wabusiness.com',
    phone: '+4444555566',
    connection_type: 'ott_whatsapp',
    smpp_host: '',
    smpp_port: 0,
    smpp_username: '',
    smpp_password: '',
    system_id: '',
    api_url: 'https://api.whatsapp.business/v1/messages',
    api_key: 'wa_api_key_123456',
    api_method: 'POST',
    balance: 15000.00,
    credit_limit: 30000.00,
    currency: 'EUR',
    bind_status: 'bound',
    status: 'active',
    consecutive_failures: 0,
    created_at: '2024-02-15T00:00:00Z',
    updated_at: '2024-03-17T14:00:00Z'
  },
  {
    id: '5',
    supplier_code: 'SUP005',
    company_name: 'Voice OTP Provider',
    contact_person: 'Robert Lee',
    email: 'robert@voiceotp.com',
    phone: '+5555666677',
    connection_type: 'voice_otp',
    smpp_host: 'sip.voiceotp.com',
    smpp_port: 5060,
    smpp_username: 'net2app_voice',
    smpp_password: 'voice321',
    system_id: 'VOICE',
    api_url: '',
    api_key: '',
    api_method: 'POST',
    balance: 10000.00,
    credit_limit: 20000.00,
    currency: 'EUR',
    bind_status: 'bound',
    status: 'active',
    consecutive_failures: 0,
    created_at: '2024-03-01T00:00:00Z',
    updated_at: '2024-03-16T11:00:00Z'
  },
  {
    id: '6',
    supplier_code: 'SUP006',
    company_name: 'Telegram Bot Services',
    contact_person: 'Anna Kim',
    email: 'anna@tgservices.com',
    phone: '+6666777788',
    connection_type: 'ott_telegram',
    smpp_host: '',
    smpp_port: 0,
    smpp_username: '',
    smpp_password: '',
    system_id: '',
    api_url: 'https://api.telegram.org/bot',
    api_key: 'tg_bot_token_789012',
    api_method: 'POST',
    balance: 8000.00,
    credit_limit: 15000.00,
    currency: 'EUR',
    bind_status: 'bound',
    status: 'active',
    consecutive_failures: 1,
    created_at: '2024-02-20T00:00:00Z',
    updated_at: '2024-03-15T16:30:00Z'
  },
  {
    id: '7',
    supplier_code: 'SUP007',
    company_name: 'Local Bypass Gateway',
    contact_person: 'Chris Martin',
    email: 'chris@localbypass.com',
    phone: '+7777888899',
    connection_type: 'local_bypass',
    smpp_host: 'local.bypass.gateway',
    smpp_port: 2777,
    smpp_username: 'local_net2app',
    smpp_password: 'local654',
    system_id: 'LOCAL',
    api_url: '',
    api_key: '',
    api_method: 'POST',
    balance: 5000.00,
    credit_limit: 10000.00,
    currency: 'EUR',
    bind_status: 'unbound',
    status: 'inactive',
    consecutive_failures: 25,
    created_at: '2024-01-25T00:00:00Z',
    updated_at: '2024-03-10T08:00:00Z'
  }
];

// ==================== TRUNKS ====================
export const mockTrunks: Trunk[] = [
  { id: '1', trunk_name: 'Global SMS Direct', trunk_type: 'direct_route_otp', supplier_id: '1', priority: 1, percentage: 70, is_active: true, mccmnc_allowed: ['310*', '311*', '234*'], created_at: '2024-01-15T00:00:00Z' },
  { id: '2', trunk_name: 'SIM OTP Primary', trunk_type: 'sim_otp', supplier_id: '3', priority: 1, percentage: 100, is_active: true, mccmnc_allowed: ['*'], created_at: '2024-01-20T00:00:00Z' },
  { id: '3', trunk_name: 'Direct Route Marketing', trunk_type: 'direct_route_marketing', supplier_id: '2', priority: 2, percentage: 30, is_active: true, mccmnc_allowed: ['310*', '311*'], created_at: '2024-02-01T00:00:00Z' },
  { id: '4', trunk_name: 'WhatsApp OTT', trunk_type: 'whatsapp', supplier_id: '4', priority: 1, percentage: 100, is_active: true, mccmnc_allowed: ['*'], created_at: '2024-02-15T00:00:00Z' },
  { id: '5', trunk_name: 'Voice OTP Main', trunk_type: 'voice_otp', supplier_id: '5', priority: 1, percentage: 100, is_active: true, mccmnc_allowed: ['*'], created_at: '2024-03-01T00:00:00Z' },
  { id: '6', trunk_name: 'Telegram Channel', trunk_type: 'telegram', supplier_id: '6', priority: 1, percentage: 100, is_active: true, mccmnc_allowed: ['*'], created_at: '2024-02-20T00:00:00Z' },
  { id: '7', trunk_name: 'Local Bypass EU', trunk_type: 'local_direct_otp', supplier_id: '7', priority: 3, percentage: 100, is_active: false, mccmnc_allowed: ['262*', '234*', '208*'], created_at: '2024-01-25T00:00:00Z' },
];

// ==================== ROUTES ====================
export const mockRoutes: Route[] = [
  { id: '1', route_name: 'Premium OTP Route', trunk_ids: ['2', '1'], route_method: 'priority', is_active: true, created_at: '2024-01-20T00:00:00Z' },
  { id: '2', route_name: 'Marketing Blend', trunk_ids: ['1', '3'], route_method: 'percentage', is_active: true, created_at: '2024-02-01T00:00:00Z' },
  { id: '3', route_name: 'OTT Messaging', trunk_ids: ['4', '6'], route_method: 'lcr', is_active: true, created_at: '2024-02-15T00:00:00Z' },
  { id: '4', route_name: 'Voice OTP Fallback', trunk_ids: ['5'], route_method: 'priority', is_active: true, created_at: '2024-03-01T00:00:00Z' },
];

// ==================== ROUTE PLANS ====================
export const mockRoutePlans: RoutePlan[] = [
  { id: '1', plan_name: 'Premium Plan', route_ids: ['1', '3', '4'], is_default: true, created_at: '2024-01-25T00:00:00Z' },
  { id: '2', plan_name: 'Marketing Plan', route_ids: ['2'], is_default: false, created_at: '2024-02-05T00:00:00Z' },
  { id: '3', plan_name: 'OTT Only Plan', route_ids: ['3'], is_default: false, created_at: '2024-02-20T00:00:00Z' },
];

// ==================== MCC/MNC DATABASE ====================
export const mockMCCMNC: MCCMNC[] = [
  { id: '1', country: 'United States', country_code: 'US', mcc: '310', mnc: '260', operator: 'T-Mobile USA', network_type: 'GSM', status: 'active' },
  { id: '2', country: 'United States', country_code: 'US', mcc: '310', mnc: '410', operator: 'AT&T Mobility', network_type: 'GSM', status: 'active' },
  { id: '3', country: 'United States', country_code: 'US', mcc: '311', mnc: '480', operator: 'Verizon Wireless', network_type: 'CDMA', status: 'active' },
  { id: '4', country: 'United Kingdom', country_code: 'GB', mcc: '234', mnc: '10', operator: 'O2 UK', network_type: 'GSM', status: 'active' },
  { id: '5', country: 'United Kingdom', country_code: 'GB', mcc: '234', mnc: '15', operator: 'Vodafone UK', network_type: 'GSM', status: 'active' },
  { id: '6', country: 'United Kingdom', country_code: 'GB', mcc: '234', mnc: '20', operator: '3 UK', network_type: 'GSM', status: 'active' },
  { id: '7', country: 'Germany', country_code: 'DE', mcc: '262', mnc: '01', operator: 'Telekom Deutschland', network_type: 'GSM', status: 'active' },
  { id: '8', country: 'Germany', country_code: 'DE', mcc: '262', mnc: '02', operator: 'Vodafone Germany', network_type: 'GSM', status: 'active' },
  { id: '9', country: 'France', country_code: 'FR', mcc: '208', mnc: '01', operator: 'Orange France', network_type: 'GSM', status: 'active' },
  { id: '10', country: 'France', country_code: 'FR', mcc: '208', mnc: '10', operator: 'SFR', network_type: 'GSM', status: 'active' },
  { id: '11', country: 'Spain', country_code: 'ES', mcc: '214', mnc: '01', operator: 'Vodafone Spain', network_type: 'GSM', status: 'active' },
  { id: '12', country: 'Italy', country_code: 'IT', mcc: '222', mnc: '01', operator: 'TIM Italy', network_type: 'GSM', status: 'active' },
  { id: '13', country: 'Netherlands', country_code: 'NL', mcc: '204', mnc: '04', operator: 'Vodafone Netherlands', network_type: 'GSM', status: 'active' },
  { id: '14', country: 'Belgium', country_code: 'BE', mcc: '206', mnc: '01', operator: 'Proximus', network_type: 'GSM', status: 'active' },
  { id: '15', country: 'India', country_code: 'IN', mcc: '404', mnc: '10', operator: 'AirTel India', network_type: 'GSM', status: 'active' },
];

// ==================== RATES ====================
export const mockRates: Rate[] = [
  { id: '1', entity_type: 'client', entity_id: '1', mcc: '310', mnc: '*', country: 'United States', operator: 'All', rate: 0.025, currency: 'EUR', effective_from: '2024-01-01', effective_to: null, is_active: true },
  { id: '2', entity_type: 'client', entity_id: '1', mcc: '234', mnc: '*', country: 'United Kingdom', operator: 'All', rate: 0.022, currency: 'EUR', effective_from: '2024-01-01', effective_to: null, is_active: true },
  { id: '3', entity_type: 'client', entity_id: '2', mcc: '310', mnc: '*', country: 'United States', operator: 'All', rate: 0.023, currency: 'EUR', effective_from: '2024-02-01', effective_to: null, is_active: true },
  { id: '4', entity_type: 'supplier', entity_id: '1', mcc: '310', mnc: '*', country: 'United States', operator: 'All', rate: 0.015, currency: 'EUR', effective_from: '2024-01-01', effective_to: null, is_active: true },
  { id: '5', entity_type: 'supplier', entity_id: '1', mcc: '234', mnc: '*', country: 'United Kingdom', operator: 'All', rate: 0.012, currency: 'EUR', effective_from: '2024-01-01', effective_to: null, is_active: true },
  { id: '6', entity_type: 'supplier', entity_id: '2', mcc: '310', mnc: '*', country: 'United States', operator: 'All', rate: 0.018, currency: 'EUR', effective_from: '2024-01-15', effective_to: null, is_active: true },
];

// ==================== INVOICES ====================
export const mockInvoices: Invoice[] = [
  { id: '1', invoice_number: 'INV-2024-001', entity_type: 'client', entity_id: '1', entity_name: 'TechCorp Global', period_start: '2024-01-01', period_end: '2024-01-31', total_sms: 150000, total_amount: 3750.00, tax_amount: 712.50, grand_total: 4462.50, currency: 'EUR', status: 'paid', due_date: '2024-02-15', paid_date: '2024-02-10', notes: '', created_at: '2024-02-01T00:00:00Z' },
  { id: '2', invoice_number: 'INV-2024-002', entity_type: 'client', entity_id: '2', entity_name: 'MegaBank Ltd', period_start: '2024-01-01', period_end: '2024-01-31', total_sms: 500000, total_amount: 11500.00, tax_amount: 2185.00, grand_total: 13685.00, currency: 'EUR', status: 'paid', due_date: '2024-02-15', paid_date: '2024-02-12', notes: '', created_at: '2024-02-01T00:00:00Z' },
  { id: '3', invoice_number: 'INV-2024-003', entity_type: 'client', entity_id: '1', entity_name: 'TechCorp Global', period_start: '2024-02-01', period_end: '2024-02-29', total_sms: 180000, total_amount: 4500.00, tax_amount: 855.00, grand_total: 5355.00, currency: 'EUR', status: 'sent', due_date: '2024-03-15', paid_date: null, notes: '', created_at: '2024-03-01T00:00:00Z' },
  { id: '4', invoice_number: 'INV-2024-004', entity_type: 'supplier', entity_id: '1', entity_name: 'GlobalSMS Gateway', period_start: '2024-02-01', period_end: '2024-02-29', total_sms: 800000, total_amount: 12000.00, tax_amount: 2280.00, grand_total: 14280.00, currency: 'EUR', status: 'overdue', due_date: '2024-03-10', paid_date: null, notes: 'Urgent payment required', created_at: '2024-03-01T00:00:00Z' },
];

// ==================== PAYMENTS ====================
export const mockPayments: Payment[] = [
  { id: '1', payment_number: 'PAY-2024-001', entity_type: 'client', entity_id: '1', entity_name: 'TechCorp Global', amount: 10000.00, currency: 'EUR', payment_method: 'bank_transfer', reference: 'BT-123456', status: 'completed', created_at: '2024-01-05T10:00:00Z' },
  { id: '2', payment_number: 'PAY-2024-002', entity_type: 'client', entity_id: '2', entity_name: 'MegaBank Ltd', amount: 50000.00, currency: 'EUR', payment_method: 'bank_transfer', reference: 'BT-789012', status: 'completed', created_at: '2024-01-10T14:30:00Z' },
  { id: '3', payment_number: 'PAY-2024-003', entity_type: 'client', entity_id: '1', entity_name: 'TechCorp Global', amount: 5000.00, currency: 'EUR', payment_method: 'credit_card', reference: 'CC-345678', status: 'completed', created_at: '2024-02-10T09:15:00Z' },
  { id: '4', payment_number: 'PAY-2024-004', entity_type: 'supplier', entity_id: '1', entity_name: 'GlobalSMS Gateway', amount: 25000.00, currency: 'EUR', payment_method: 'bank_transfer', reference: 'BT-901234', status: 'completed', created_at: '2024-02-15T11:00:00Z' },
];

// ==================== SMS LOGS ====================
export const mockSMSLogs: SMSLog[] = Array.from({ length: 100 }, (_, i) => ({
  id: `${i + 1}`,
  message_id: `MSG${String(i + 1).padStart(10, '0')}`,
  client_id: ['1', '2', '3', '4'][Math.floor(Math.random() * 4)],
  client_code: ['CLT001', 'CLT002', 'CLT003', 'CLT004'][Math.floor(Math.random() * 4)],
  supplier_id: ['1', '2', '3'][Math.floor(Math.random() * 3)],
  supplier_code: ['SUP001', 'SUP002', 'SUP003'][Math.floor(Math.random() * 3)],
  sender_id: ['TECHCORP', 'MEGABANK', 'ECOMSTORE', 'HEALTH'][Math.floor(Math.random() * 4)],
  destination: `+1${Math.floor(Math.random() * 9000000000 + 1000000000)}`,
  mcc: '310',
  mnc: ['260', '410', '480'][Math.floor(Math.random() * 3)],
  country: 'United States',
  operator: ['T-Mobile', 'AT&T', 'Verizon'][Math.floor(Math.random() * 3)],
  message: ['Your OTP is 123456', 'Your order has been shipped', 'Your appointment is confirmed', 'Password reset code: 789012'][Math.floor(Math.random() * 4)],
  message_parts: 1,
  client_rate: 0.025,
  supplier_rate: 0.015,
  profit: 0.01,
  currency: 'EUR',
  status: ['delivered', 'delivered', 'delivered', 'failed', 'pending'][Math.floor(Math.random() * 5)] as SMSLog['status'],
  dlr_status: ['DELIVRD', 'UNDELIV', null][Math.floor(Math.random() * 3)],
  dlr_timestamp: new Date(Date.now() - Math.random() * 86400000).toISOString(),
  error_code: Math.random() > 0.8 ? '001' : null,
  error_message: Math.random() > 0.8 ? 'Network unreachable' : null,
  route_name: 'Premium OTP Route',
  trunk_name: 'Global SMS Direct',
  submit_time: new Date(Date.now() - Math.random() * 86400000 * 7).toISOString(),
  delivery_time: new Date(Date.now() - Math.random() * 86400000 * 7 + 5000).toISOString(),
  created_at: new Date(Date.now() - Math.random() * 86400000 * 7).toISOString(),
}));

// ==================== EMAIL TEMPLATES ====================
export const mockEmailTemplates: EmailTemplate[] = [
  { id: '1', template_name: 'Low Balance Alert', subject: 'Low Balance Alert — {{client_name}} ({{client_code}})', body: 'Dear {{client_name}},\n\nYour account balance is low. Current balance: {{balance}}\n\nPlease top up your account to continue service.\n\nBest regards,\nNET2APP Hub', variables: ['client_name', 'client_code', 'smpp_username', 'balance'], is_active: true, created_at: '2024-01-01T00:00:00Z' },
  { id: '2', template_name: 'Client Account Created', subject: 'Welcome to {{platform_name}} — Your SMPP Account', body: 'Dear {{client_name}},\n\nWelcome to {{platform_name}}!\n\nYour SMPP account has been created.\nCompany: {{company_name}}\nClient Code: {{client_code}}\nSMPP Username: {{smpp_username}}\n\nBest regards,\nNET2APP Hub Team', variables: ['client_name', 'company_name', 'client_code', 'smpp_username', 'platform_name'], is_active: true, created_at: '2024-01-01T00:00:00Z' },
  { id: '3', template_name: 'Supplier Account Created', subject: 'Supplier Account Created — {{supplier_code}}', body: 'Dear {{contact_person}},\n\nYour supplier account has been created.\nCompany: {{company_name}}\nSupplier Code: {{supplier_code}}\nConnection Type: {{connection_type}}\n\nBest regards,\nNET2APP Hub', variables: ['contact_person', 'company_name', 'supplier_code', 'connection_type'], is_active: true, created_at: '2024-01-01T00:00:00Z' },
  { id: '4', template_name: 'Invoice Generated', subject: 'Invoice {{invoice_number}} — {{client_name}}', body: 'Dear {{client_name}},\n\nInvoice {{invoice_number}} has been generated.\nPeriod: {{period_start}} to {{period_end}}\nTotal Amount: {{total_amount}}\nDue Date: {{due_date}}\n\nPlease make payment by the due date.\n\nBest regards,\nNET2APP Hub', variables: ['client_name', 'invoice_number', 'period_start', 'period_end', 'total_amount', 'due_date'], is_active: true, created_at: '2024-01-01T00:00:00Z' },
  { id: '5', template_name: 'Payment Received', subject: 'Payment Received — {{amount}} — {{entity_name}}', body: 'Dear {{entity_name}},\n\nWe have received your payment.\nPayment Number: {{payment_number}}\nAmount: {{amount}}\nPayment Method: {{payment_method}}\n\nThank you for your payment.\n\nBest regards,\nNET2APP Hub', variables: ['entity_name', 'payment_number', 'amount', 'payment_method'], is_active: true, created_at: '2024-01-01T00:00:00Z' },
  { id: '6', template_name: 'Rate Change Notice', subject: 'Rate Update Notice — {{destination_name}}', body: 'Dear {{entity_name}},\n\nThis is to notify you of a rate change.\nEntity Code: {{entity_code}}\nSMPP Username: {{smpp_username}}\nDestination: {{destination_name}}\nNew Rate: {{new_rate}}\nEffective From: {{effective_date}}\n\nBest regards,\nNET2APP Hub', variables: ['entity_name', 'entity_code', 'smpp_username', 'destination_name', 'new_rate', 'effective_date'], is_active: true, created_at: '2024-01-01T00:00:00Z' },
  { id: '7', template_name: 'Channel Disconnect', subject: '⚠ Channel Disconnected — {{entity_code}}', body: 'Alert!\n\nChannel disconnected.\nEntity Code: {{entity_code}}\nEntity Name: {{entity_name}}\nEntity Type: {{entity_type}}\nSMPP Username: {{smpp_username}}\n\nPlease check the connection immediately.\n\nNET2APP Hub System', variables: ['entity_code', 'entity_name', 'entity_type', 'smpp_username'], is_active: true, created_at: '2024-01-01T00:00:00Z' },
  { id: '8', template_name: 'Payment Reminder', subject: 'Payment Reminder — Invoice {{invoice_number}}', body: 'Dear {{client_name}},\n\nThis is a reminder for invoice {{invoice_number}}.\nAmount Due: {{amount_due}}\nDue Date: {{due_date}}\n\nPlease make payment as soon as possible.\n\nBest regards,\nNET2APP Hub', variables: ['client_name', 'invoice_number', 'amount_due', 'due_date'], is_active: true, created_at: '2024-01-01T00:00:00Z' },
  { id: '9', template_name: 'DLR Failure Alert', subject: 'DLR Failure Alert — Route {{route_name}}', body: 'Alert!\n\nHigh DLR failure rate detected.\nRoute: {{route_name}}\nSupplier: {{supplier_name}}\nFailure Count: {{failure_count}}\nAction: {{action_taken}}\n\nNET2APP Hub System', variables: ['route_name', 'supplier_name', 'failure_count', 'action_taken'], is_active: true, created_at: '2024-01-01T00:00:00Z' },
];

// ==================== OTT DEVICES ====================
export const mockOTTDevices: OTTDevice[] = [
  { id: '1', device_name: 'WhatsApp Device 1', device_type: 'whatsapp', phone_number: '+1234567890', session_status: 'connected', qr_code: null, last_active: '2024-03-20T14:30:00Z', supplier_id: '4', created_at: '2024-02-15T00:00:00Z' },
  { id: '2', device_name: 'WhatsApp Device 2', device_type: 'whatsapp', phone_number: '+1987654321', session_status: 'connected', qr_code: null, last_active: '2024-03-20T14:25:00Z', supplier_id: '4', created_at: '2024-02-16T00:00:00Z' },
  { id: '3', device_name: 'WhatsApp Device 3', device_type: 'whatsapp', phone_number: '+1555666777', session_status: 'qr_pending', qr_code: 'QR_CODE_DATA_HERE', last_active: null, supplier_id: '4', created_at: '2024-03-10T00:00:00Z' },
  { id: '4', device_name: 'Telegram Bot 1', device_type: 'telegram', phone_number: 'N/A', session_status: 'connected', qr_code: null, last_active: '2024-03-20T14:28:00Z', supplier_id: '6', created_at: '2024-02-20T00:00:00Z' },
];

// ==================== API CONNECTORS ====================
export const mockAPIConnectors: APIConnector[] = [
  { id: '1', name: 'Vonage SMS', provider: 'Vonage', region: 'Global', auth_type: 'api_key', http_method: 'POST', api_key: 'vonage_key_123', send_url_template: 'https://rest.nexmo.com/sms/json?api_key={{apiKey}}&to={{to}}&from={{from}}&text={{text}}', dlr_url_template: 'https://rest.nexmo.com/dlr', submit_success_pattern: '"status":"0"', dlr_success_pattern: '"status":"delivered"', dlr_success_value: 'delivered', is_active: true, created_at: '2024-01-15T00:00:00Z' },
  { id: '2', name: 'Twilio SMS', provider: 'Twilio', region: 'Global', auth_type: 'basic', http_method: 'POST', api_key: 'twilio_auth_token', send_url_template: 'https://api.twilio.com/2010-04-01/Accounts/{{accountSid}}/Messages.json', dlr_url_template: '', submit_success_pattern: '"status":"queued"', dlr_success_pattern: '"status":"delivered"', dlr_success_value: 'delivered', is_active: true, created_at: '2024-01-20T00:00:00Z' },
];

// ==================== USERS ====================
export const mockUsers: User[] = [
  { id: '1', username: 'admin', email: 'admin@net2app.com', role: 'super_admin', client_id: null, supplier_id: null, is_active: true, last_login: '2024-03-20T10:00:00Z', created_at: '2024-01-01T00:00:00Z' },
  { id: '2', username: 'support1', email: 'support1@net2app.com', role: 'support', client_id: null, supplier_id: null, is_active: true, last_login: '2024-03-20T09:30:00Z', created_at: '2024-01-05T00:00:00Z' },
  { id: '3', username: 'billing1', email: 'billing@net2app.com', role: 'billing', client_id: null, supplier_id: null, is_active: true, last_login: '2024-03-19T16:00:00Z', created_at: '2024-01-10T00:00:00Z' },
  { id: '4', username: 'techcorp_user', email: 'user@techcorp.com', role: 'client', client_id: '1', supplier_id: null, is_active: true, last_login: '2024-03-20T08:00:00Z', created_at: '2024-01-15T00:00:00Z' },
  { id: '5', username: 'globalsms_user', email: 'user@globalsms.com', role: 'supplier', client_id: null, supplier_id: '1', is_active: true, last_login: '2024-03-18T14:00:00Z', created_at: '2024-01-20T00:00:00Z' },
];

// ==================== NOTIFICATIONS ====================
export const mockNotifications: Notification[] = [
  { id: '1', title: 'Low Balance Alert', message: 'TravelWorld Agency balance is below threshold', type: 'warning', entity_type: 'client', entity_id: '5', is_read: false, created_at: '2024-03-20T10:00:00Z' },
  { id: '2', title: 'Route Blocked', message: 'Local Bypass EU route blocked due to 25 consecutive failures', type: 'error', entity_type: 'supplier', entity_id: '7', is_read: false, created_at: '2024-03-19T15:30:00Z' },
  { id: '3', title: 'New Client', message: 'New client HealthCare Plus registered', type: 'info', entity_type: 'client', entity_id: '4', is_read: true, created_at: '2024-03-18T09:00:00Z' },
  { id: '4', title: 'Payment Received', message: 'Payment of €50,000 received from MegaBank Ltd', type: 'success', entity_type: 'client', entity_id: '2', is_read: true, created_at: '2024-03-17T14:00:00Z' },
];

// ==================== CAMPAIGNS ====================
export const mockCampaigns: Campaign[] = [
  { id: '1', campaign_name: 'Spring Sale 2024', client_id: '3', sender_id: 'ECOMSTORE', message_template: 'Spring Sale! Get 20% off with code SPRING20. Shop now!', recipients_count: 50000, sent_count: 50000, delivered_count: 47500, failed_count: 2500, status: 'completed', scheduled_at: '2024-03-01T09:00:00Z', started_at: '2024-03-01T09:00:00Z', completed_at: '2024-03-01T12:30:00Z', created_at: '2024-02-28T00:00:00Z' },
  { id: '2', campaign_name: 'Health Checkup Reminder', client_id: '4', sender_id: 'HEALTH', message_template: 'Dear Patient, your annual health checkup is due. Book now!', recipients_count: 10000, sent_count: 8500, delivered_count: 8200, failed_count: 300, status: 'running', scheduled_at: '2024-03-20T10:00:00Z', started_at: '2024-03-20T10:00:00Z', completed_at: null, created_at: '2024-03-19T00:00:00Z' },
];

// ==================== TRANSLATIONS ====================
export const mockTranslations: Translation[] = [
  { id: '1', translation_type: 'sender_id', source_pattern: 'TECHCORP', target_value: 'TC-MSG', client_id: '1', supplier_id: '1', route_id: null, is_active: true, created_at: '2024-01-15T00:00:00Z' },
  { id: '2', translation_type: 'destination', source_pattern: '+44', target_value: '0044', client_id: null, supplier_id: '2', route_id: null, is_active: true, created_at: '2024-02-01T00:00:00Z' },
];

// ==================== VOICE OTP CONFIG ====================
export const mockVoiceOTPConfigs: VoiceOTPConfig[] = [
  { id: '1', language: 'English', language_code: 'en-US', greeting_text: 'Your verification code is', retry_text: 'I repeat, your code is', audio_file_url: null, sip_host: 'sip.voiceotp.com', sip_port: 5060, caller_id: '+18001234567', is_active: true },
  { id: '2', language: 'Spanish', language_code: 'es-ES', greeting_text: 'Su código de verificación es', retry_text: 'Repito, su código es', audio_file_url: null, sip_host: 'sip.voiceotp.com', sip_port: 5060, caller_id: '+18001234568', is_active: true },
  { id: '3', language: 'French', language_code: 'fr-FR', greeting_text: 'Votre code de vérification est', retry_text: 'Je répète, votre code est', audio_file_url: null, sip_host: 'sip.voiceotp.com', sip_port: 5060, caller_id: '+18001234569', is_active: true },
];

// ==================== DASHBOARD STATS ====================
export const mockDashboardStats: DashboardStats = {
  total_clients: 5,
  active_clients: 4,
  total_suppliers: 7,
  active_suppliers: 6,
  total_sms_today: 125000,
  total_sms_month: 3500000,
  delivered_percentage: 94.5,
  failed_percentage: 5.5,
  revenue_today: 3125.00,
  revenue_month: 87500.00,
  cost_today: 1875.00,
  cost_month: 52500.00,
  profit_today: 1250.00,
  profit_month: 35000.00,
  active_binds: 8,
  total_binds: 10,
};

// Chart data for dashboard
export const hourlyTrafficData = Array.from({ length: 24 }, (_, i) => ({
  hour: `${String(i).padStart(2, '0')}:00`,
  sent: Math.floor(Math.random() * 10000 + 3000),
  delivered: Math.floor(Math.random() * 9500 + 2800),
  failed: Math.floor(Math.random() * 500 + 50),
}));

export const dailyRevenueData = Array.from({ length: 30 }, (_, i) => ({
  date: `Mar ${i + 1}`,
  revenue: Math.floor(Math.random() * 5000 + 2000),
  cost: Math.floor(Math.random() * 3000 + 1000),
  profit: Math.floor(Math.random() * 2000 + 500),
}));

export const topDestinations = [
  { country: 'United States', count: 850000, percentage: 24.3 },
  { country: 'United Kingdom', count: 620000, percentage: 17.7 },
  { country: 'Germany', count: 480000, percentage: 13.7 },
  { country: 'France', count: 350000, percentage: 10.0 },
  { country: 'Spain', count: 280000, percentage: 8.0 },
  { country: 'Italy', count: 250000, percentage: 7.1 },
  { country: 'Netherlands', count: 180000, percentage: 5.1 },
  { country: 'Others', count: 490000, percentage: 14.1 },
];
