// ==================== CORE TYPES ====================

export type UserRole = 'super_admin' | 'admin' | 'support' | 'billing' | 'agent' | 'client' | 'supplier';

export type ConnectionType = 'smpp' | 'http' | 'rcs' | 'flash_sms' | 'ott_whatsapp' | 'ott_telegram' | 'voice_otp' | 'local_bypass';

export type BillingMode = 'submit' | 'dlr';

export type Currency = 'EUR' | 'USD' | 'GBP';

export type TrunkType = 'sim_otp' | 'sim_marketing' | 'voice_otp' | 'local_direct_otp' | 'local_direct_marketing' | 'direct_route_otp' | 'direct_route_marketing' | 'whatsapp' | 'telegram' | 'rcs';

export type RouteMethod = 'percentage' | 'lcr' | 'priority';

export type SMSStatus = 'pending' | 'sent' | 'delivered' | 'failed' | 'expired' | 'rejected';

export type BindStatus = 'bound' | 'unbound' | 'binding' | 'error';

export type EntityType = 'client' | 'supplier';

// ==================== CLIENT ====================

export interface Client {
  id: string;
  client_code: string;
  company_name: string;
  contact_person: string;
  email: string;
  phone: string;
  address: string;
  country: string;
  
  // SMPP Settings
  smpp_username: string;
  smpp_password: string;
  smpp_ip: string;
  smpp_port: number;
  system_type: string;
  max_tps: number;
  
  // Billing
  billing_mode: BillingMode;
  currency: Currency;
  balance: number;
  credit_limit: number;
  
  // Advanced
  api_enabled: boolean;
  webhook_url: string;
  force_dlr: boolean;
  
  // Routing
  routing_plan_id: string | null;
  rate_plan_id: string | null;
  
  status: 'active' | 'inactive' | 'suspended';
  created_at: string;
  updated_at: string;
}

// ==================== SUPPLIER ====================

export interface Supplier {
  id: string;
  supplier_code: string;
  company_name: string;
  contact_person: string;
  email: string;
  phone: string;
  
  // Connection
  connection_type: ConnectionType;
  smpp_host: string;
  smpp_port: number;
  smpp_username: string;
  smpp_password: string;
  system_id: string;
  
  // HTTP API
  api_url: string;
  api_key: string;
  api_method: 'GET' | 'POST';
  
  // Billing
  balance: number;
  credit_limit: number;
  currency: Currency;
  
  // Status
  bind_status: BindStatus;
  status: 'active' | 'inactive' | 'suspended';
  consecutive_failures: number;
  
  created_at: string;
  updated_at: string;
}

// ==================== ROUTING ====================

export interface Trunk {
  id: string;
  trunk_name: string;
  trunk_type: TrunkType;
  supplier_id: string;
  priority: number;
  percentage: number;
  is_active: boolean;
  mccmnc_allowed: string[];
  created_at: string;
}

export interface Route {
  id: string;
  route_name: string;
  trunk_ids: string[];
  route_method: RouteMethod;
  is_active: boolean;
  created_at: string;
}

export interface RoutePlan {
  id: string;
  plan_name: string;
  route_ids: string[];
  is_default: boolean;
  created_at: string;
}

export interface RouteMap {
  id: string;
  client_id: string;
  route_plan_id: string;
  mccmnc: string;
  priority: number;
  is_active: boolean;
}

// ==================== RATES ====================

export interface Rate {
  id: string;
  entity_type: EntityType;
  entity_id: string;
  mcc: string;
  mnc: string;
  country: string;
  operator: string;
  rate: number;
  currency: Currency;
  effective_from: string;
  effective_to: string | null;
  is_active: boolean;
  version?: number;
  created_at?: string;
}

export interface MCCMNC {
  id: string;
  country: string;
  country_code: string;
  mcc: string;
  mnc: string;
  operator: string;
  network_type: string;
  status: 'active' | 'inactive';
}

// ==================== BILLING ====================

export interface Invoice {
  id: string;
  invoice_number: string;
  entity_type: EntityType;
  entity_id: string;
  entity_name: string;
  period_start: string;
  period_end: string;
  total_sms: number;
  total_amount: number;
  tax_amount: number;
  grand_total: number;
  currency: Currency;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
  due_date: string;
  paid_date: string | null;
  notes: string;
  created_at: string;
}

export interface Payment {
  id: string;
  payment_number: string;
  entity_type: EntityType;
  entity_id: string;
  entity_name: string;
  amount: number;
  currency: Currency;
  payment_method: 'bank_transfer' | 'credit_card' | 'paypal' | 'crypto' | 'manual';
  reference: string;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  created_at: string;
}

// ==================== SMS LOG ====================

export interface SMSLog {
  id: string;
  message_id: string;
  client_id: string;
  client_code: string;
  supplier_id: string | null;
  supplier_code: string | null;
  
  sender_id: string;
  destination: string;
  mcc: string;
  mnc: string;
  country: string;
  operator: string;
  
  message: string;
  message_parts: number;
  
  client_rate: number;
  supplier_rate: number;
  profit: number;
  currency: Currency;
  
  status: SMSStatus;
  dlr_status: string | null;
  dlr_timestamp: string | null;
  error_code: string | null;
  error_message: string | null;
  
  route_name: string | null;
  trunk_name: string | null;
  
  submit_time: string;
  delivery_time: string | null;
  
  created_at: string;
}

// ==================== TRANSLATIONS ====================

export interface Translation {
  id: string;
  translation_type: 'sender_id' | 'destination' | 'content' | 'origination';
  source_pattern: string;
  target_value: string;
  client_id: string | null;
  supplier_id: string | null;
  route_id: string | null;
  is_active: boolean;
  created_at: string;
}

// ==================== EMAIL TEMPLATES ====================

export interface EmailTemplate {
  id: string;
  template_name: string;
  subject: string;
  body: string;
  variables: string[];
  is_active: boolean;
  created_at: string;
}

// ==================== NOTIFICATIONS ====================

export interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'error' | 'success';
  entity_type: EntityType | 'system';
  entity_id: string | null;
  is_read: boolean;
  created_at: string;
}

// ==================== OTT DEVICES ====================

export interface OTTDevice {
  id: string;
  device_name: string;
  device_type: 'whatsapp' | 'telegram';
  phone_number: string;
  session_status: 'connected' | 'disconnected' | 'qr_pending' | 'error';
  qr_code: string | null;
  last_active: string | null;
  supplier_id: string;
  created_at: string;
}

// ==================== VOICE OTP ====================

export interface VoiceOTPConfig {
  id: string;
  language: string;
  language_code: string;
  greeting_text: string;
  retry_text: string;
  audio_file_url: string | null;
  sip_host: string;
  sip_port: number;
  caller_id: string;
  is_active: boolean;
}

export interface VoiceOTPLog {
  id: string;
  call_id: string;
  destination: string;
  otp_code: string;
  language: string;
  duration: number;
  status: 'initiated' | 'ringing' | 'answered' | 'completed' | 'failed' | 'busy' | 'no_answer';
  created_at: string;
}

// ==================== API CONNECTOR ====================

export interface APIConnector {
  id: string;
  name: string;
  provider: string;
  region: string;
  auth_type: 'api_key' | 'basic' | 'oauth2' | 'bearer';
  http_method: 'GET' | 'POST';
  api_key: string;
  send_url_template: string;
  dlr_url_template: string;
  submit_success_pattern: string;
  dlr_success_pattern: string;
  dlr_success_value: string;
  is_active: boolean;
  created_at: string;
}

// ==================== USERS ====================

export interface User {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  client_id: string | null;
  supplier_id: string | null;
  is_active: boolean;
  last_login: string | null;
  created_at: string;
}

// ==================== DASHBOARD STATS ====================

export interface DashboardStats {
  total_clients: number;
  active_clients: number;
  total_suppliers: number;
  active_suppliers: number;
  total_sms_today: number;
  total_sms_month: number;
  delivered_percentage: number;
  failed_percentage: number;
  revenue_today: number;
  revenue_month: number;
  cost_today: number;
  cost_month: number;
  profit_today: number;
  profit_month: number;
  active_binds: number;
  total_binds: number;
}

// ==================== CAMPAIGN ====================

export interface Campaign {
  id: string;
  campaign_name: string;
  client_id: string;
  sender_id: string;
  message_template: string;
  recipients_count: number;
  sent_count: number;
  delivered_count: number;
  failed_count: number;
  status: 'draft' | 'scheduled' | 'running' | 'paused' | 'completed' | 'cancelled';
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
}
