// ============================================================
// NET2APP HUB - COMPLETE API ENDPOINTS
// All endpoints connect to PostgreSQL database
// ============================================================

export const API_BASE = '/api';

export const API_ENDPOINTS = {
  // ============================================================
  // AUTHENTICATION
  // ============================================================
  AUTH: {
    LOGIN:               { method: 'POST',   path: '/auth/login',        desc: 'Authenticate user & get JWT token' },
    LOGOUT:              { method: 'POST',   path: '/auth/logout',       desc: 'Invalidate current token' },
    REFRESH:             { method: 'POST',   path: '/auth/refresh',      desc: 'Refresh JWT token' },
    PROFILE:             { method: 'GET',    path: '/auth/profile',      desc: 'Get current user profile' },
    CHANGE_PASSWORD:     { method: 'PUT',    path: '/auth/password',     desc: 'Change user password' },
    VALIDATE_TOKEN:      { method: 'GET',    path: '/auth/validate',     desc: 'Validate token validity' },
  },

  // ============================================================
  // USERS
  // ============================================================
  USERS: {
    LIST:                { method: 'GET',    path: '/users',             desc: 'List all users' },
    GET:                 { method: 'GET',    path: '/users/:id',         desc: 'Get user by ID' },
    CREATE:              { method: 'POST',   path: '/users',             desc: 'Create new user' },
    UPDATE:              { method: 'PUT',    path: '/users/:id',         desc: 'Update user' },
    DELETE:              { method: 'DELETE', path: '/users/:id',         desc: 'Delete user' },
    ROLES:               { method: 'GET',    path: '/users/roles',       desc: 'Get all roles' },
    UPDATE_ROLE:         { method: 'PUT',    path: '/users/:id/role',    desc: 'Update user role & permissions' },
  },

  // ============================================================
  // CLIENTS
  // ============================================================
  CLIENTS: {
    LIST:                { method: 'GET',    path: '/clients',           desc: 'List all clients' },
    GET:                 { method: 'GET',    path: '/clients/:id',       desc: 'Get client by ID' },
    CREATE:              { method: 'POST',   path: '/clients',           desc: 'Create new client' },
    UPDATE:              { method: 'PUT',    path: '/clients/:id',       desc: 'Update client' },
    DELETE:              { method: 'DELETE', path: '/clients/:id',       desc: 'Delete client' },
    BULK_DELETE:         { method: 'POST',   path: '/clients/bulk-delete', desc: 'Bulk delete clients' },
    BALANCE:             { method: 'POST',   path: '/clients/:id/balance', desc: 'Update client balance (credit/debit)' },
    CDR:                 { method: 'POST',   path: '/clients/:id/cdr',   desc: 'Get client CDR with filters' },
    USAGE:               { method: 'GET',    path: '/clients/:id/usage', desc: 'Get client usage stats' },
    RATES:               { method: 'GET',    path: '/clients/:id/rates', desc: 'Get client rates' },
    INVOICES:            { method: 'GET',    path: '/clients/:id/invoices', desc: 'Get client invoices' },
    PAYMENTS:            { method: 'GET',    path: '/clients/:id/payments', desc: 'Get client payments' },
    SEND_WELCOME:        { method: 'POST',   path: '/clients/:id/welcome', desc: 'Send welcome email' },
  },

  // ============================================================
  // SUPPLIERS
  // ============================================================
  SUPPLIERS: {
    LIST:                { method: 'GET',    path: '/suppliers',         desc: 'List all suppliers' },
    GET:                 { method: 'GET',    path: '/suppliers/:id',     desc: 'Get supplier by ID' },
    CREATE:              { method: 'POST',   path: '/suppliers',         desc: 'Create new supplier' },
    UPDATE:              { method: 'PUT',    path: '/suppliers/:id',     desc: 'Update supplier' },
    DELETE:              { method: 'DELETE', path: '/suppliers/:id',     desc: 'Delete supplier' },
    BULK_DELETE:         { method: 'POST',   path: '/suppliers/bulk-delete', desc: 'Bulk delete suppliers' },
    BALANCE:             { method: 'POST',   path: '/suppliers/:id/balance', desc: 'Update supplier balance' },
    CDR:                 { method: 'POST',   path: '/suppliers/:id/cdr', desc: 'Get supplier CDR' },
    USAGE:               { method: 'GET',    path: '/suppliers/:id/usage', desc: 'Get supplier usage' },
    TEST_CONNECTION:     { method: 'POST',   path: '/suppliers/:id/test', desc: 'Test supplier connection' },
    RESET_FAILURES:      { method: 'POST',   path: '/suppliers/:id/reset-failures', desc: 'Reset consecutive failures' },
  },

  // ============================================================
  // BIND STATUS (SMPP)
  // ============================================================
  BIND: {
    STATUS:              { method: 'GET',    path: '/bind/status',       desc: 'Get all bind statuses' },
    SUPPLIER_STATUS:     { method: 'GET',    path: '/bind/status/:id',   desc: 'Get supplier bind status' },
    BIND:                { method: 'POST',    path: '/bind/:id/connect', desc: 'Bind SMPP connection' },
    UNBIND:              { method: 'POST',   path: '/bind/:id/disconnect', desc: 'Unbind SMPP connection' },
    RECONNECT:           { method: 'POST',   path: '/bind/:id/reconnect', desc: 'Reconnect SMPP' },
    TEST:                { method: 'POST',   path: '/bind/test',         desc: 'Test SMPP connection' },
    HISTORY:             { method: 'GET',    path: '/bind/:id/history',  desc: 'Get bind history' },
  },

  // ============================================================
  // SMS SENDING
  // ============================================================
  SMS: {
    SEND:                { method: 'POST',   path: '/sms/send',          desc: 'Send SMS through platform' },
    VALIDATE:            { method: 'POST',   path: '/sms/validate',      desc: 'Validate message before sending' },
    LOGS:                { method: 'POST',   path: '/sms/logs',          desc: 'Get SMS logs with filters' },
    GET_LOG:             { method: 'GET',    path: '/sms/logs/:id',      desc: 'Get single SMS log' },
    TEST:                { method: 'POST',   path: '/sms/test',          desc: 'Send test SMS' },
    RESEND:              { method: 'POST',   path: '/sms/:id/resend',    desc: 'Resend failed SMS' },
    STATS:               { method: 'GET',    path: '/sms/stats',         desc: 'Get SMS statistics' },
    DLR:                 { method: 'GET',    path: '/sms/dlr/:id',       desc: 'Get DLR status for message' },
    BATCH_DLR:           { method: 'POST',   path: '/sms/dlr/batch',     desc: 'Batch DLR check' },
  },

  // ============================================================
  // ROUTING
  // ============================================================
  ROUTING: {
    // Trunks
    TRUNKS_LIST:         { method: 'GET',    path: '/routing/trunks',    desc: 'List all trunks' },
    TRUNK_CREATE:        { method: 'POST',   path: '/routing/trunks',    desc: 'Create trunk' },
    TRUNK_UPDATE:        { method: 'PUT',    path: '/routing/trunks/:id', desc: 'Update trunk' },
    TRUNK_DELETE:        { method: 'DELETE', path: '/routing/trunks/:id', desc: 'Delete trunk' },
    
    // Routes
    ROUTES_LIST:         { method: 'GET',    path: '/routing/routes',    desc: 'List all routes' },
    ROUTE_CREATE:        { method: 'POST',   path: '/routing/routes',    desc: 'Create route' },
    ROUTE_UPDATE:        { method: 'PUT',    path: '/routing/routes/:id', desc: 'Update route' },
    ROUTE_DELETE:        { method: 'DELETE', path: '/routing/routes/:id', desc: 'Delete route' },
    
    // Route Plans
    PLANS_LIST:          { method: 'GET',    path: '/routing/plans',     desc: 'List route plans' },
    PLAN_CREATE:         { method: 'POST',   path: '/routing/plans',     desc: 'Create route plan' },
    PLAN_UPDATE:         { method: 'PUT',    path: '/routing/plans/:id', desc: 'Update route plan' },
    PLAN_DELETE:         { method: 'DELETE', path: '/routing/plans/:id', desc: 'Delete route plan' },
    
    // Route Maps
    MAPS_LIST:           { method: 'GET',    path: '/routing/maps',      desc: 'List all route maps' },
    MAPS_BY_CLIENT:      { method: 'GET',    path: '/routing/maps/client/:id', desc: 'Get route maps by client' },
    MAP_CREATE:          { method: 'POST',   path: '/routing/maps',      desc: 'Create route map' },
    MAP_UPDATE:          { method: 'PUT',    path: '/routing/maps/:id',  desc: 'Update route map' },
    MAP_DELETE:          { method: 'DELETE', path: '/routing/maps/:id',  desc: 'Delete route map' },
  },

  // ============================================================
  // RATES
  // ============================================================
  RATES: {
    LIST:                { method: 'GET',    path: '/rates',             desc: 'List all rates' },
    CLIENT_RATES:        { method: 'GET',    path: '/rates/client/:id',  desc: 'Get client rates' },
    SUPPLIER_RATES:      { method: 'GET',    path: '/rates/supplier/:id', desc: 'Get supplier rates' },
    CREATE:              { method: 'POST',   path: '/rates',             desc: 'Create rate (deactivates old)' },
    UPDATE:              { method: 'PUT',    path: '/rates/:id',         desc: 'Update rate' },
    DELETE:              { method: 'DELETE', path: '/rates/:id',         desc: 'Delete rate' },
    BULK:                { method: 'POST',   path: '/rates/bulk',        desc: 'Bulk create rates' },
    BULK_DELETE:         { method: 'POST',   path: '/rates/bulk-delete', desc: 'Bulk delete rates' },
    HISTORY:             { method: 'GET',    path: '/rates/history',     desc: 'Get rate version history' },
    IMPORT:              { method: 'POST',   path: '/rates/import',      desc: 'Import rates from CSV' },
    EXPORT:              { method: 'GET',    path: '/rates/export',      desc: 'Export rates to CSV' },
    NOTIFY:              { method: 'POST',   path: '/rates/notify',      desc: 'Send rate change notification' },
    DESTINATION:         { method: 'GET',    path: '/rates/destination', desc: 'Get rates by destination' },
    UPDATE_DESTINATION:  { method: 'POST',   path: '/rates/update-destination', desc: 'Update entire destination rates' },
    DEACTIVATE_OLD:      { method: 'POST',   path: '/rates/deactivate-old', desc: 'Deactivate old rates' },
  },

  // ============================================================
  // MCC/MNC DATABASE
  // ============================================================
  MCCMNC: {
    LIST:                { method: 'GET',    path: '/mccmnc',            desc: 'List all MCCMNC entries' },
    CREATE:              { method: 'POST',   path: '/mccmnc',            desc: 'Add MCCMNC entry' },
    UPDATE:              { method: 'PUT',    path: '/mccmnc/:id',        desc: 'Update MCCMNC entry' },
    DELETE:              { method: 'DELETE', path: '/mccmnc/:id',        desc: 'Delete MCCMNC entry' },
    BULK:                { method: 'POST',   path: '/mccmnc/bulk',       desc: 'Bulk add MCCMNC' },
    BULK_DELETE:         { method: 'POST',   path: '/mccmnc/bulk-delete', desc: 'Bulk delete MCCMNC' },
    IMPORT:              { method: 'POST',   path: '/mccmnc/import',     desc: 'Import from CSV' },
    EXPORT:              { method: 'GET',    path: '/mccmnc/export',     desc: 'Export to CSV' },
    SEARCH:              { method: 'GET',    path: '/mccmnc/search',     desc: 'Search MCCMNC' },
  },

  // ============================================================
  // BILLING
  // ============================================================
  BILLING: {
    // Invoices
    INVOICES_LIST:       { method: 'POST',   path: '/billing/invoices',  desc: 'List invoices with filters' },
    INVOICE_GET:         { method: 'GET',    path: '/billing/invoices/:id', desc: 'Get invoice details' },
    INVOICE_CREATE:      { method: 'POST',   path: '/billing/invoices',  desc: 'Generate invoice' },
    INVOICE_UPDATE:      { method: 'PUT',    path: '/billing/invoices/:id', desc: 'Update invoice' },
    INVOICE_DELETE:      { method: 'DELETE', path: '/billing/invoices/:id', desc: 'Delete invoice' },
    INVOICE_SEND:        { method: 'POST',   path: '/billing/invoices/:id/send', desc: 'Send invoice via email' },
    INVOICE_MARK_PAID:   { method: 'POST',   path: '/billing/invoices/:id/mark-paid', desc: 'Mark invoice as paid' },
    INVOICE_PDF:         { method: 'GET',    path: '/billing/invoices/:id/pdf', desc: 'Download invoice PDF' },
    INVOICE_BREAKDOWN:   { method: 'GET',    path: '/billing/invoices/:id/breakdown', desc: 'Get destination breakdown' },
    INVOICE_BULK:        { method: 'POST',   path: '/billing/invoices/bulk', desc: 'Generate bulk invoices' },
    
    // Payments
    PAYMENTS_LIST:       { method: 'POST',   path: '/billing/payments',  desc: 'List payments' },
    PAYMENT_CREATE:      { method: 'POST',   path: '/billing/payments',  desc: 'Create payment' },
    PAYMENT_UPDATE:      { method: 'PUT',    path: '/billing/payments/:id', desc: 'Update payment' },
    
    // Balance Operations
    TOPUP:               { method: 'POST',   path: '/billing/topup',     desc: 'Top up balance' },
    OVERVIEW:            { method: 'GET',    path: '/billing/overview',  desc: 'Get billing overview stats' },
  },

  // ============================================================
  // NOTIFICATIONS
  // ============================================================
  NOTIFICATIONS: {
    LIST:                { method: 'GET',    path: '/notifications',     desc: 'List notifications' },
    MARK_READ:           { method: 'POST',   path: '/notifications/:id/read', desc: 'Mark notification as read' },
    MARK_ALL_READ:       { method: 'POST',   path: '/notifications/read-all', desc: 'Mark all as read' },
    DELETE:              { method: 'DELETE', path: '/notifications/:id', desc: 'Delete notification' },
    SEND:                { method: 'POST',   path: '/notifications/send',desc: 'Send notification' },
    LOW_BALANCE:         { method: 'POST',   path: '/notifications/low-balance', desc: 'Send low balance alert' },
    RATE_CHANGE:         { method: 'POST',   path: '/notifications/rate-change', desc: 'Send rate change notification' },
    DLR_FAILURE:         { method: 'POST',   path: '/notifications/dlr-failure', desc: 'Send DLR failure alert' },
    
    // Templates
    TEMPLATES_LIST:      { method: 'GET',    path: '/notifications/templates', desc: 'List email templates' },
    TEMPLATE_UPDATE:     { method: 'PUT',    path: '/notifications/templates/:id', desc: 'Update template' },
    TEMPLATE_TEST:       { method: 'POST',   path: '/notifications/templates/:id/test', desc: 'Test email template' },
  },

  // ============================================================
  // OTT DEVICES (WhatsApp/Telegram)
  // ============================================================
  OTT: {
    LIST:                { method: 'GET',    path: '/ott/devices',       desc: 'List OTT devices' },
    CREATE:              { method: 'POST',   path: '/ott/devices',       desc: 'Add OTT device' },
    UPDATE:              { method: 'PUT',    path: '/ott/devices/:id',   desc: 'Update device' },
    DELETE:              { method: 'DELETE', path: '/ott/devices/:id',   desc: 'Delete device' },
    QR_CODE:             { method: 'GET',    path: '/ott/devices/:id/qr',desc: 'Get QR code for pairing' },
    CONNECT:             { method: 'POST',   path: '/ott/devices/:id/connect', desc: 'Connect device' },
    DISCONNECT:          { method: 'POST',   path: '/ott/devices/:id/disconnect', desc: 'Disconnect device' },
    VALIDATE_NUMBER:     { method: 'POST',   path: '/ott/devices/:id/validate', desc: 'Validate sender number' },
  },

  // ============================================================
  // API CONNECTORS
  // ============================================================
  API_CONNECTORS: {
    LIST:                { method: 'GET',    path: '/api-connectors',    desc: 'List API connectors' },
    CREATE:              { method: 'POST',   path: '/api-connectors',    desc: 'Create connector' },
    UPDATE:              { method: 'PUT',    path: '/api-connectors/:id', desc: 'Update connector' },
    DELETE:              { method: 'DELETE', path: '/api-connectors/:id', desc: 'Delete connector' },
    TEST:                { method: 'POST',   path: '/api-connectors/:id/test', desc: 'Test connector' },
    SEND:                { method: 'POST',   path: '/api-connectors/:id/send', desc: 'Send via connector' },
  },

  // ============================================================
  // VOICE OTP
  // ============================================================
  VOICE_OTP: {
    CONFIGS_LIST:        { method: 'GET',    path: '/voice-otp/configs', desc: 'List voice OTP configs' },
    CONFIG_CREATE:       { method: 'POST',   path: '/voice-otp/configs', desc: 'Create voice OTP config' },
    CONFIG_UPDATE:       { method: 'PUT',    path: '/voice-otp/configs/:id', desc: 'Update config' },
    CONFIG_DELETE:       { method: 'DELETE', path: '/voice-otp/configs/:id', desc: 'Delete config' },
    UPLOAD_AUDIO:        { method: 'POST',   path: '/voice-otp/configs/:id/audio', desc: 'Upload audio file' },
    SEND:                { method: 'POST',   path: '/voice-otp/send',    desc: 'Send voice OTP call' },
    CALL_STATUS:         { method: 'GET',    path: '/voice-otp/calls/:id', desc: 'Get call status' },
    LOGS:                { method: 'POST',   path: '/voice-otp/logs',    desc: 'Get call logs' },
    TEST:                { method: 'POST',   path: '/voice-otp/test',    desc: 'Test voice call' },
    SIP_SETTINGS:        { method: 'PUT',    path: '/voice-otp/sip',     desc: 'Update SIP settings' },
    LANGUAGES:           { method: 'GET',    path: '/voice-otp/languages', desc: 'Get supported languages' },
  },

  // ============================================================
  // CAMPAIGNS
  // ============================================================
  CAMPAIGNS: {
    LIST:                { method: 'GET',    path: '/campaigns',         desc: 'List campaigns' },
    GET:                 { method: 'GET',    path: '/campaigns/:id',     desc: 'Get campaign details' },
    CREATE:              { method: 'POST',   path: '/campaigns',         desc: 'Create campaign' },
    UPDATE:              { method: 'PUT',    path: '/campaigns/:id',     desc: 'Update campaign' },
    DELETE:              { method: 'DELETE', path: '/campaigns/:id',     desc: 'Delete campaign' },
    START:               { method: 'POST',   path: '/campaigns/:id/start', desc: 'Start campaign' },
    PAUSE:               { method: 'POST',   path: '/campaigns/:id/pause', desc: 'Pause campaign' },
    CANCEL:              { method: 'POST',   path: '/campaigns/:id/cancel', desc: 'Cancel campaign' },
    UPLOAD_RECIPIENTS:   { method: 'POST',   path: '/campaigns/:id/recipients', desc: 'Upload recipient list' },
  },

  // ============================================================
  // TRANSLATIONS
  // ============================================================
  TRANSLATIONS: {
    LIST:                { method: 'GET',    path: '/translations',      desc: 'List translations' },
    CREATE:              { method: 'POST',   path: '/translations',      desc: 'Create translation rule' },
    UPDATE:              { method: 'PUT',    path: '/translations/:id',  desc: 'Update translation' },
    DELETE:              { method: 'DELETE', path: '/translations/:id',  desc: 'Delete translation' },
    TEST:                { method: 'POST',   path: '/translations/test', desc: 'Test translation' },
    APPLY:               { method: 'POST',   path: '/translations/apply',desc: 'Apply translation to message' },
  },

  // ============================================================
  // REPORTS
  // ============================================================
  REPORTS: {
    REALTIME:            { method: 'GET',    path: '/reports/realtime',  desc: 'Real-time SMS statistics' },
    HOURLY:              { method: 'GET',    path: '/reports/hourly',    desc: 'Hourly traffic report' },
    DAILY:               { method: 'GET',    path: '/reports/daily',     desc: 'Daily traffic report' },
    MONTHLY:             { method: 'GET',    path: '/reports/monthly',   desc: 'Monthly traffic report' },
    CLIENT:              { method: 'GET',    path: '/reports/client/:id',desc: 'Client report' },
    SUPPLIER:            { method: 'GET',    path: '/reports/supplier/:id', desc: 'Supplier report' },
    EXPORT:              { method: 'POST',   path: '/reports/export',    desc: 'Export report to CSV/PDF' },
  },

  // ============================================================
  // SYSTEM
  // ============================================================
  SYSTEM: {
    // Settings
    SETTINGS_GET:        { method: 'GET',    path: '/system/settings',   desc: 'Get platform settings' },
    SETTINGS_UPDATE:     { method: 'PUT',    path: '/system/settings',   desc: 'Update platform settings' },
    
    // SMTP
    SMTP_GET:            { method: 'GET',    path: '/system/smtp',       desc: 'Get SMTP config' },
    SMTP_UPDATE:         { method: 'PUT',    path: '/system/smtp',       desc: 'Update SMTP config' },
    SMTP_TEST:           { method: 'POST',   path: '/system/smtp/test',  desc: 'Test SMTP connection' },
    
    // Database
    DATABASE_STATUS:     { method: 'GET',    path: '/system/database',   desc: 'Get database status' },
    DATABASE_TABLES:     { method: 'GET',    path: '/system/database/tables', desc: 'List all tables' },
    
    // Backup
    BACKUP_CREATE:       { method: 'POST',   path: '/system/backup',     desc: 'Create database backup' },
    BACKUP_LIST:         { method: 'GET',    path: '/system/backups',    desc: 'List backup files' },
    BACKUP_RESTORE:      { method: 'POST',   path: '/system/backup/restore', desc: 'Restore from backup' },
    BACKUP_DOWNLOAD:     { method: 'GET',    path: '/system/backups/:id', desc: 'Download backup file' },
    BACKUP_DELETE:       { method: 'DELETE', path: '/system/backups/:id', desc: 'Delete backup file' },
    
    // Audit Logs
    AUDIT_LOGS:          { method: 'GET',    path: '/system/audit-logs', desc: 'Get audit logs' },
    
    // System Status
    STATUS:              { method: 'GET',    path: '/system/status',     desc: 'Get system status' },
    HEALTH:              { method: 'GET',    path: '/system/health',     desc: 'Health check endpoint' },
  },

  // ============================================================
  // LICENSE
  // ============================================================
  LICENSE: {
    INFO:                { method: 'GET',    path: '/license/info',      desc: 'Get license information' },
    ACTIVATE:            { method: 'POST',   path: '/license/activate',  desc: 'Activate license key' },
    DEACTIVATE:          { method: 'POST',   path: '/license/deactivate',desc: 'Deactivate license' },
    VALIDATE:            { method: 'POST',   path: '/license/validate',  desc: 'Validate license key' },
    GENERATE:            { method: 'POST',   path: '/license/generate',  desc: 'Generate license key' },
    SYSTEM_INFO:         { method: 'GET',    path: '/license/system-info', desc: 'Get system info for licensing' },
    
    // Tenants
    TENANTS_LIST:        { method: 'GET',    path: '/license/tenants',   desc: 'List tenants' },
    TENANT_CREATE:       { method: 'POST',   path: '/license/tenants',   desc: 'Create tenant' },
    TENANT_UPDATE:       { method: 'PUT',    path: '/license/tenants/:id', desc: 'Update tenant' },
    TENANT_DELETE:       { method: 'DELETE', path: '/license/tenants/:id', desc: 'Delete tenant' },
    TENANT_USAGE:        { method: 'GET',    path: '/license/tenants/:id/usage', desc: 'Get tenant usage' },
  },

  // ============================================================
  // DASHBOARD
  // ============================================================
  DASHBOARD: {
    STATS:               { method: 'GET',    path: '/dashboard/stats',   desc: 'Get dashboard statistics' },
    TRAFFIC:             { method: 'GET',    path: '/dashboard/traffic', desc: 'Get traffic data for charts' },
    REVENUE:             { method: 'GET',    path: '/dashboard/revenue', desc: 'Get revenue data' },
    TOP_DESTINATIONS:    { method: 'GET',    path: '/dashboard/top-destinations', desc: 'Get top destinations' },
  },
} as const;

export type ApiEndpoint = typeof API_ENDPOINTS;

export default API_ENDPOINTS;
