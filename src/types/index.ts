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

export type ChannelType = 'sms' | 'whatsapp' | 'telegram' | 'voice_otp' | 'rcs' | 'viber' | 'imessage';

// ==================== USERS ====================

export interface User {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  client_id: string | null;
  supplier_id: string | null;
  permissions?: string[];
  name?: string;
  is_active: boolean;
  last_login: string | null;
  created_at: string;
  updated_at?: string;
}

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
  dlr_timeout?: number;
  api_key?: string;
  dlr_callback_url?: string;

  // Channels
  allowed_channels?: ChannelType[];
  preferred_channel?: string;
  force_dlr_timeout_mode?: string;
  connection_type?: string;

  // Voice OTP
  play_count?: number;
  otp_extraction_pattern?: string;
  force_dlr_override?: boolean;
  voice_otp_use_secondary?: boolean;

  // Connector/Config links
  api_connector_id?: string | null;
  voice_otp_config_id?: string | null;
  voice_otp_mode?: string | null;
  whatsapp_device_ids?: string[] | null;
  telegram_device_ids?: string[] | null;

  // Routing
  routing_plan_id: string | null;
  rate_plan_id: string | null;

  client_ips?: string;
  status: 'active' | 'inactive' | 'suspended';
  is_deleted?: boolean;
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

  // SMPP Advanced
  smpp_version: string;
  smpp_system_type: string;
  smpp_bind_type: string;
  smpp_addr_ton: number;
  smpp_addr_npi: number;
  smpp_addr_range: string;
  is_inbound: boolean;

  // HTTP API
  api_url: string;
  api_key: string;
  api_secret?: string;
  api_method: 'GET' | 'POST';

  // Voice OTP fields
  dst_sip_address?: string;
  audio_codec?: string;
  capacity?: number;
  reconnect_schedule?: string;
  rate_per_second?: number;

  // Connector/Device links
  api_connector_id: string | null;
  voice_otp_config_id: string | null;
  voice_otp_mode?: string | null;
  whatsapp_device_ids: string | null;
  telegram_device_ids: string | null;

  // Billing
  balance: number;
  credit_limit: number;
  currency: Currency;
  force_dlr: boolean;
  dlr_timeout?: number;

  // Status
  bind_status: BindStatus;
  status: 'active' | 'inactive' | 'suspended';
  is_deleted?: boolean;
  consecutive_failures: number;
  max_failures?: number;
  routed_via_asterisk?: boolean;
  force_dlr_timeout_mode?: string;

  created_at: string;
  updated_at: string;
}

// ==================== ROUTING ====================

export interface Trunk {
  id: string;
  trunk_name: string;
  trunk_type: TrunkType;
  supplier_id: string;
  voice_otp_config_id?: string | null;
  priority: number;
  percentage: number;
  is_active: boolean;
  mccmnc_allowed: string[];
  mccmnc_denied?: string[];
  created_at: string;
}

export interface Route {
  id: string;
  route_name: string;
  trunk_ids: string[];
  voice_otp_config_id?: string | null;
  route_method: RouteMethod;
  preferred_channel?: string;
  mccmnc_allowed?: string[];
  mccmnc_denied?: string[];
  is_active: boolean;
  created_at: string;
}

export interface RoutePlan {
  id: string;
  plan_name: string;
  route_ids: string[];
  is_default: boolean;
  allowed_channels?: string[];
  created_at: string;
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
  calling_code?: string;
  is_deleted?: boolean;
  created_at?: string;
}

// ==================== BILLING ====================

export interface Invoice {
  id: string;
  invoice_number: string;
  entity_type: EntityType;
  entity_id: string;
  entity_name: string;
  invoice_to_name: string;
  invoice_to_address: string;
  invoice_to_email: string;
  invoice_by_name: string;
  invoice_by_address: string;
  invoice_by_email: string;
  invoice_by_vat: string;
  period_start: string;
  period_end: string;
  total_sms: number;
  total_amount: number;
  tax_amount: number;
  tax_rate: number;
  grand_total: number;
  currency: Currency;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
  due_date: string;
  paid_date: string | null;
  payment_method: string;
  payment_reference: string;
  notes: string;
  bank_name: string;
  bank_account: string;
  bank_iban: string;
  bank_bic: string;
  is_deleted?: boolean;
  created_at: string;
  sent_at: string | null;
}

export interface Payment {
  id: string;
  payment_number: string;
  entity_type: EntityType;
  entity_id: string;
  entity_name: string;
  amount: number;
  currency: Currency;
  payment_method: string;
  reference: string;
  status: 'pending' | 'completed' | 'failed' | 'refunded';
  notes: string;
  is_deleted?: boolean;
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
  original_sender_id?: string;
  original_message?: string;
  original_destination?: string;
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

  route_id?: string | null;
  route_name: string | null;
  trunk_id?: string | null;
  trunk_name: string | null;

  smpp_message_id?: string;
  registered_delivery?: number;
  data_coding?: number;
  esm_class?: number;

  dlr_callback_url?: string;
  channel?: string;
  source?: string;

  trace?: any;
  is_billed?: boolean;
  billing_mode_snapshot?: string;
  is_force_dlr?: boolean;
  refund_amount?: number;
  is_deleted?: boolean;

  submit_time: string;
  delivery_time: string | null;

  created_at: string;
}

// ==================== TRANSLATIONS ====================

export type TranslationType = 'number_prefix' | 'content_replace' | 'otp_extract' | 'sid_random' | 'sid_alias' | 'random_content';

export interface Translation {
  id: string;
  translation_type: TranslationType;
  source_pattern: string;
  target_value: string;
  client_id: string | null;
  supplier_id: string | null;
  route_id: string | null;
  mcc: string | null;
  mnc: string | null;
  name: string;
  description: string;
  subtype: string;
  priority: number;
  apply_to: 'client' | 'supplier' | 'both';
  apply_entity_id: string;
  is_active: boolean;
  created_at: string;
  // V4 new fields
  strip_prefix_digits?: number;
  add_prefix_text?: string;
  match_content?: string;
  replace_content?: string;
  is_otp_extract?: boolean;
  otp_length_min?: number;
  otp_length_max?: number;
  otp_pattern?: string;
  template_data?: string[] | string;
  sid_match_type?: 'exact' | 'wildcard' | 'random_mccmnc';
  mccmnc_list?: number[];
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
  entity_name?: string;
  entity_id: string | null;
  recipient_email?: string;
  recipient_role?: string;
  is_read: boolean;
  is_emailed?: boolean;
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

export interface SipServer {
  id?: string;
  name: string;
  host: string;
  port: number;
  username: string;
  password: string;
  caller_id: string;
  codec: 'g729' | 'g711' | 'gsm';
  is_e164: boolean;
  mccmnc_allowed: string;
}

export interface VoiceOTPConfig {
  id: string;
  language: string;
  language_code: string;
  country_prefix: string;
  primary_language_code: string;
  secondary_language_code: string;
  primary_greeting_text: string;
  primary_retry_text: string;
  secondary_greeting_text: string;
  secondary_retry_text: string;
  greeting_text: string;
  retry_text: string;
  retry_language_code?: string;
  greeting_audio_url: string | null;
  secondary_greeting_audio_url: string | null;
  audio_0_9: Record<string, string> | null;
  audio_0_9_primary?: Record<string, string> | null;
  audio_0_9_secondary?: Record<string, string> | null;
  audio_files: any;
  secondary_audio_files: any;
  retry_count?: number;
  play_count?: number;
  is_active: boolean;
  created_at: string;
}

export interface VoiceOTPLog {
  id: string;
  call_id: string;
  destination: string;
  otp_code: string;
  language: string;
  duration: number;
  retry_count: number;
  max_retries: number;
  status: 'initiated' | 'ringing' | 'answered' | 'completed' | 'failed' | 'busy' | 'no_answer' | 'timeout';
  dlr_status: string | null;
  error_message: string | null;
  sip_call_id: string | null;
  channel?: string;
  asterisk_channel_id?: string;
  dial_status?: string;
  sip_server_id?: string;
  client_id: string | null;
  next_retry_at: string | null;
  created_at: string;
  completed_at: string | null;
}

// ==================== API CONNECTOR ====================

export interface APIConnector {
  id: string;
  name: string;
  type: string;
  provider: string;
  base_url: string;
  send_url: string;
  api_key: string;
  api_secret: string;
  region: string;
  description: string;
  username: string;
  password: string;
  phone_number_id: string;
  business_account_id: string;
  bot_token: string;
  is_active: boolean;
  connection_status?: string;
  created_at: string;
  // Additional DB columns
  auth_type?: string;
  http_method?: string;
  dlr_url?: string;
  submit_pattern?: string;
  dlr_pattern?: string;
  dlr_value?: string;
  params?: string;
  connector_type?: string;
  dlr_webhook_secret?: string;
  dlr_status_mapping?: Record<string, string>;
  test_payload?: any;
  last_tested_at?: string | null;
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
  is_deleted?: boolean;
  created_at: string;
}

// ==================== ADDITIONAL DB TABLES ====================

export interface SMTPConfig {
  id: string;
  host: string;
  port: number;
  encryption: string;
  username: string;
  password: string;
  from_email: string;
  from_name: string;
  is_active: boolean;
  test_status?: string;
  updated_at?: string;
}

export interface PlatformSetting {
  id: string;
  key: string;
  value: string;
  updated_at?: string;
}

export interface DLRQueue {
  id: string;
  message_id: string;
  smpp_message_id?: string;
  destination: string;
  status?: string;
  retry_count?: number;
  max_retries?: number;
  force_dlr?: boolean;
  dlr_timeout?: number;
  submitted_at?: string;
  last_retry_at?: string;
  dlr_received_at?: string;
  dlr_result?: string;
  channel?: string;
}
