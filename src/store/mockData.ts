import { Client, Supplier, Trunk, Route, RoutePlan, Rate, MCCMNC, Invoice, Payment, SMSLog, EmailTemplate, OTTDevice, APIConnector, User, DashboardStats, Notification, Campaign, Translation, VoiceOTPConfig } from '../types';

// ==================== CLIENTS (cleared — real data from PostgreSQL) ====================
export const mockClients: Client[] = [];

// ==================== SUPPLIERS (cleared — real data from PostgreSQL) ====================
export const mockSuppliers: Supplier[] = [];

// ==================== TRUNKS (cleared — real data from PostgreSQL) ====================
export const mockTrunks: Trunk[] = [];

// ==================== ROUTES (cleared — real data from PostgreSQL) ====================
export const mockRoutes: Route[] = [];

// ==================== ROUTE PLANS (cleared — real data from PostgreSQL) ====================
export const mockRoutePlans: RoutePlan[] = [];

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
  { id: '1', invoice_number: 'INV-2024-001', entity_type: 'client', entity_id: '1', entity_name: 'TechCorp Global', invoice_to_name: 'TechCorp Global', invoice_to_address: '123 Tech Street', invoice_to_email: 'john@techcorp.com', invoice_by_name: 'NET2APP Hub', invoice_by_address: '123 Tech Park', invoice_by_email: 'billing@net2app.com', invoice_by_vat: 'VAT-001', period_start: '2024-01-01', period_end: '2024-01-31', total_sms: 150000, total_amount: 3750.00, tax_amount: 712.50, tax_rate: 19.00, grand_total: 4462.50, currency: 'EUR', status: 'paid', due_date: '2024-02-15', paid_date: '2024-02-10', payment_method: 'bank_transfer', payment_reference: 'BT-123', notes: '', bank_name: 'Deutsche Bank', bank_account: 'DE123456', bank_iban: 'DE89370400440532013000', bank_bic: 'DEUTDEBB', created_at: '2024-02-01T00:00:00Z', sent_at: '2024-02-01T00:00:00Z' },
  { id: '2', invoice_number: 'INV-2024-002', entity_type: 'client', entity_id: '2', entity_name: 'MegaBank Ltd', invoice_to_name: 'MegaBank Ltd', invoice_to_address: '456 Finance Road', invoice_to_email: 'sarah@megabank.com', invoice_by_name: 'NET2APP Hub', invoice_by_address: '123 Tech Park', invoice_by_email: 'billing@net2app.com', invoice_by_vat: 'VAT-001', period_start: '2024-01-01', period_end: '2024-01-31', total_sms: 500000, total_amount: 11500.00, tax_amount: 2185.00, tax_rate: 19.00, grand_total: 13685.00, currency: 'EUR', status: 'paid', due_date: '2024-02-15', paid_date: '2024-02-12', payment_method: 'bank_transfer', payment_reference: 'BT-456', notes: '', bank_name: 'Deutsche Bank', bank_account: 'DE654321', bank_iban: 'DE89370400440532013001', bank_bic: 'DEUTDEBB', created_at: '2024-02-01T00:00:00Z', sent_at: '2024-02-01T00:00:00Z' },
  { id: '3', invoice_number: 'INV-2024-003', entity_type: 'client', entity_id: '1', entity_name: 'TechCorp Global', invoice_to_name: 'TechCorp Global', invoice_to_address: '123 Tech Street', invoice_to_email: 'john@techcorp.com', invoice_by_name: 'NET2APP Hub', invoice_by_address: '123 Tech Park', invoice_by_email: 'billing@net2app.com', invoice_by_vat: 'VAT-001', period_start: '2024-02-01', period_end: '2024-02-29', total_sms: 180000, total_amount: 4500.00, tax_amount: 855.00, tax_rate: 19.00, grand_total: 5355.00, currency: 'EUR', status: 'sent', due_date: '2024-03-15', paid_date: null, payment_method: '', payment_reference: '', notes: '', bank_name: '', bank_account: '', bank_iban: '', bank_bic: '', created_at: '2024-03-01T00:00:00Z', sent_at: '2024-03-01T00:00:00Z' },
  { id: '4', invoice_number: 'INV-2024-004', entity_type: 'supplier', entity_id: '1', entity_name: 'GlobalSMS Gateway', invoice_to_name: 'GlobalSMS Gateway', invoice_to_address: 'Gateway Street', invoice_to_email: 'alex@globalsms.com', invoice_by_name: 'NET2APP Hub', invoice_by_address: '123 Tech Park', invoice_by_email: 'billing@net2app.com', invoice_by_vat: 'VAT-001', period_start: '2024-02-01', period_end: '2024-02-29', total_sms: 800000, total_amount: 12000.00, tax_amount: 2280.00, tax_rate: 19.00, grand_total: 14280.00, currency: 'EUR', status: 'overdue', due_date: '2024-03-10', paid_date: null, payment_method: '', payment_reference: '', notes: 'Urgent payment required', bank_name: '', bank_account: '', bank_iban: '', bank_bic: '', created_at: '2024-03-01T00:00:00Z', sent_at: '2024-03-01T00:00:00Z' },
];

// ==================== PAYMENTS ====================
export const mockPayments: Payment[] = [
  { id: '1', payment_number: 'PAY-2024-001', entity_type: 'client', entity_id: '1', entity_name: 'TechCorp Global', amount: 10000.00, currency: 'EUR', payment_method: 'bank_transfer', reference: 'BT-123456', status: 'completed', notes: '', created_at: '2024-01-05T10:00:00Z' },
  { id: '2', payment_number: 'PAY-2024-002', entity_type: 'client', entity_id: '2', entity_name: 'MegaBank Ltd', amount: 50000.00, currency: 'EUR', payment_method: 'bank_transfer', reference: 'BT-789012', status: 'completed', notes: '', created_at: '2024-01-10T14:30:00Z' },
  { id: '3', payment_number: 'PAY-2024-003', entity_type: 'client', entity_id: '1', entity_name: 'TechCorp Global', amount: 5000.00, currency: 'EUR', payment_method: 'credit_card', reference: 'CC-345678', status: 'completed', notes: '', created_at: '2024-02-10T09:15:00Z' },
  { id: '4', payment_number: 'PAY-2024-004', entity_type: 'supplier', entity_id: '1', entity_name: 'GlobalSMS Gateway', amount: 25000.00, currency: 'EUR', payment_method: 'bank_transfer', reference: 'BT-901234', status: 'completed', notes: 'Payment for February invoices', created_at: '2024-02-15T11:00:00Z' },
];

// ==================== SMS LOGS (cleared — real data from PostgreSQL) ====================
export const mockSMSLogs: SMSLog[] = [];

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
  { id: '1', name: 'Vonage SMS', type: 'http', provider: 'Vonage', base_url: 'https://rest.nexmo.com/sms/json', send_url: '', api_key: 'vonage_key_123', api_secret: '', region: 'Global', description: 'Vonage SMS API connector', username: '', password: '', phone_number_id: '', business_account_id: '', bot_token: '', is_active: true, created_at: '2024-01-15T00:00:00Z' },
  { id: '2', name: 'Twilio SMS', type: 'http', provider: 'Twilio', base_url: 'https://api.twilio.com/2010-04-01/Accounts', send_url: '', api_key: 'twilio_auth_token', api_secret: '', region: 'Global', description: 'Twilio SMS API connector', username: '', password: '', phone_number_id: '', business_account_id: '', bot_token: '', is_active: true, created_at: '2024-01-20T00:00:00Z' },
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
  { id: '1', translation_type: 'sender_id', source_pattern: 'TECHCORP', target_value: 'TC-MSG', client_id: '1', supplier_id: '1', route_id: null, mcc: null, mnc: null, name: 'Sender ID Mask', description: 'Mask TECHCORP to TC-MSG', subtype: 'sender_id_masking', priority: 1, apply_to: 'client', apply_entity_id: '1', is_active: true, created_at: '2024-01-15T00:00:00Z' },
  { id: '2', translation_type: 'destination', source_pattern: '+44', target_value: '0044', client_id: null, supplier_id: '2', route_id: null, mcc: null, mnc: null, name: 'UK Prefix Rewrite', description: 'Rewrite +44 to 0044 for supplier', subtype: '', priority: 2, apply_to: 'supplier', apply_entity_id: '2', is_active: true, created_at: '2024-02-01T00:00:00Z' },
];

// ==================== VOICE OTP CONFIG ====================
export const mockVoiceOTPConfigs: VoiceOTPConfig[] = [
  {
    id: '1', language: 'English', language_code: 'en-US', country_prefix: '1',
    primary_language_code: 'en', secondary_language_code: 'en',
    primary_greeting_text: 'Your verification code is', primary_retry_text: 'I repeat, your code is',
    secondary_greeting_text: 'Your code is', secondary_retry_text: 'Repeating',
    greeting_text: 'Your verification code is', retry_text: 'I repeat, your code is',
    greeting_audio_url: null, secondary_greeting_audio_url: null,
    audio_0_9: null, audio_files: null, secondary_audio_files: null,
    is_active: true, created_at: '2024-01-01T00:00:00Z'
  },
  {
    id: '2', language: 'Spanish', language_code: 'es-ES', country_prefix: '34',
    primary_language_code: 'es', secondary_language_code: 'en',
    primary_greeting_text: 'Su código de verificación es', primary_retry_text: 'Repito, su código es',
    secondary_greeting_text: 'Your code is', secondary_retry_text: 'Repeating',
    greeting_text: 'Su código de verificación es', retry_text: 'Repito, su código es',
    greeting_audio_url: null, secondary_greeting_audio_url: null,
    audio_0_9: null, audio_files: null, secondary_audio_files: null,
    is_active: true, created_at: '2024-01-01T00:00:00Z'
  },
  {
    id: '3', language: 'French', language_code: 'fr-FR', country_prefix: '33',
    primary_language_code: 'fr', secondary_language_code: 'en',
    primary_greeting_text: 'Votre code de vérification est', primary_retry_text: 'Je répète, votre code est',
    secondary_greeting_text: 'Your code is', secondary_retry_text: 'Repeating',
    greeting_text: 'Votre code de vérification est', retry_text: 'Je répète, votre code est',
    greeting_audio_url: null, secondary_greeting_audio_url: null,
    audio_0_9: null, audio_files: null, secondary_audio_files: null,
    is_active: true, created_at: '2024-01-01T00:00:00Z'
  },
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
