-- ============================================================
-- NET2APP HUB - DATABASE MIGRATION
-- Adds all missing columns from schema audit
-- Uses ALTER TABLE ... ADD COLUMN IF NOT EXISTS (safe to rerun)
-- ============================================================

-- ==================== CLIENTS ====================
ALTER TABLE clients ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS rate_plan_id INTEGER;

-- ==================== SUPPLIERS ====================
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS smpp_version VARCHAR(20) DEFAULT 'auto';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS smpp_system_type VARCHAR(50) DEFAULT '';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS smpp_bind_type VARCHAR(10) DEFAULT 'trx';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS smpp_addr_ton INTEGER DEFAULT 0;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS smpp_addr_npi INTEGER DEFAULT 0;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS smpp_addr_range VARCHAR(100) DEFAULT '';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS is_inbound BOOLEAN DEFAULT false;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS api_secret TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS api_connector_id INTEGER;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS voice_otp_config_id INTEGER;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS whatsapp_device_ids TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS telegram_device_ids TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS force_dlr BOOLEAN DEFAULT false;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;

-- ==================== TRUNKS ====================
ALTER TABLE trunks ADD COLUMN IF NOT EXISTS mccmnc_denied TEXT[] DEFAULT '{}';

-- ==================== ROUTES ====================
ALTER TABLE routes ADD COLUMN IF NOT EXISTS preferred_channel VARCHAR(50);
ALTER TABLE routes ADD COLUMN IF NOT EXISTS mccmnc_allowed TEXT[] DEFAULT '{*}';
ALTER TABLE routes ADD COLUMN IF NOT EXISTS mccmnc_denied TEXT[] DEFAULT '{}';

-- ==================== ROUTE PLANS ====================
ALTER TABLE route_plans ADD COLUMN IF NOT EXISTS allowed_channels TEXT[] DEFAULT '{}';

-- ==================== API CONNECTORS ====================
-- Note: api_connectors was fully restructured. Run this transaction to add/replace columns safely.
ALTER TABLE api_connectors ADD COLUMN IF NOT EXISTS type VARCHAR(50) DEFAULT 'http';
ALTER TABLE api_connectors ADD COLUMN IF NOT EXISTS base_url TEXT;
ALTER TABLE api_connectors ADD COLUMN IF NOT EXISTS send_url TEXT;
ALTER TABLE api_connectors ADD COLUMN IF NOT EXISTS api_secret TEXT;
ALTER TABLE api_connectors ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE api_connectors ADD COLUMN IF NOT EXISTS username VARCHAR(255);
ALTER TABLE api_connectors ADD COLUMN IF NOT EXISTS password TEXT;
ALTER TABLE api_connectors ADD COLUMN IF NOT EXISTS phone_number_id VARCHAR(100);
ALTER TABLE api_connectors ADD COLUMN IF NOT EXISTS business_account_id VARCHAR(100);
ALTER TABLE api_connectors ADD COLUMN IF NOT EXISTS bot_token TEXT;
ALTER TABLE api_connectors ADD COLUMN IF NOT EXISTS connection_status VARCHAR(20) DEFAULT 'untested';

-- ==================== VOICE OTP CONFIGS ====================
ALTER TABLE voice_otp_configs ADD COLUMN IF NOT EXISTS country_prefix VARCHAR(10) DEFAULT '';
ALTER TABLE voice_otp_configs ADD COLUMN IF NOT EXISTS primary_language_code VARCHAR(10) DEFAULT 'en';
ALTER TABLE voice_otp_configs ADD COLUMN IF NOT EXISTS secondary_language_code VARCHAR(10) DEFAULT 'en';
ALTER TABLE voice_otp_configs ADD COLUMN IF NOT EXISTS primary_greeting_text TEXT;
ALTER TABLE voice_otp_configs ADD COLUMN IF NOT EXISTS primary_retry_text TEXT;
ALTER TABLE voice_otp_configs ADD COLUMN IF NOT EXISTS secondary_greeting_text TEXT;
ALTER TABLE voice_otp_configs ADD COLUMN IF NOT EXISTS secondary_retry_text TEXT;
ALTER TABLE voice_otp_configs ADD COLUMN IF NOT EXISTS greeting_audio_url TEXT;
ALTER TABLE voice_otp_configs ADD COLUMN IF NOT EXISTS secondary_greeting_audio_url TEXT;
ALTER TABLE voice_otp_configs ADD COLUMN IF NOT EXISTS audio_files JSONB DEFAULT '{}';
ALTER TABLE voice_otp_configs ADD COLUMN IF NOT EXISTS secondary_audio_files JSONB DEFAULT '{}';

-- ==================== VOICE OTP LOGS ====================
ALTER TABLE voice_otp_logs ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE voice_otp_logs ADD COLUMN IF NOT EXISTS sip_call_id VARCHAR(100);
ALTER TABLE voice_otp_logs ADD COLUMN IF NOT EXISTS client_id INTEGER;
ALTER TABLE voice_otp_logs ADD COLUMN IF NOT EXISTS next_retry_at TIMESTAMP;
ALTER TABLE voice_otp_logs ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;

-- ==================== TRANSLATIONS ====================
ALTER TABLE translations ADD COLUMN IF NOT EXISTS mcc VARCHAR(10);
ALTER TABLE translations ADD COLUMN IF NOT EXISTS mnc VARCHAR(10);
ALTER TABLE translations ADD COLUMN IF NOT EXISTS name VARCHAR(255) DEFAULT '';
ALTER TABLE translations ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';
ALTER TABLE translations ADD COLUMN IF NOT EXISTS subtype VARCHAR(100) DEFAULT '';
ALTER TABLE translations ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 1;
ALTER TABLE translations ADD COLUMN IF NOT EXISTS apply_to VARCHAR(20) DEFAULT 'client';
ALTER TABLE translations ADD COLUMN IF NOT EXISTS apply_entity_id VARCHAR(50) DEFAULT 'all';

-- ==================== SMS LOGS ====================
ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS source VARCHAR(100);
ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;

-- ==================== INVOICES ====================
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;

-- ==================== PAYMENTS ====================
ALTER TABLE payments ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;

-- ==================== MCCMNC ====================
ALTER TABLE mccmnc ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;

-- ==================== CAMPAIGNS ====================
ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;

-- ==================== DLR QUEUE ====================
ALTER TABLE dlr_queue ADD COLUMN IF NOT EXISTS dlr_timeout INTEGER DEFAULT 150;
ALTER TABLE dlr_queue ADD COLUMN IF NOT EXISTS dlr_result VARCHAR(50);

-- ==================== NOTIFICATIONS ====================
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS entity_name VARCHAR(255);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS recipient_email VARCHAR(255);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS recipient_role VARCHAR(50);
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS is_emailed BOOLEAN DEFAULT false;

-- ============================================================
-- VERIFICATION QUERY — Run after migration to confirm
-- SELECT column_name, table_name FROM information_schema.columns
-- WHERE table_name IN ('clients','suppliers','trunks','routes','route_plans','api_connectors',
--   'voice_otp_configs','voice_otp_logs','translations','sms_logs','invoices','payments',
--   'mccmnc','campaigns','dlr_queue','notifications')
-- ORDER BY table_name, ordinal_position;
-- ============================================================

-- ============================================================
-- USAGE INSTRUCTIONS:
--   1. Copy this file to the database server
--   2. Run: psql -U sms_user -d sms_platform -f db_migration_add_missing_columns.sql
--   3. Or: cat db_migration_add_missing_columns.sql | psql -U sms_user -d sms_platform
--   4. Verify with the SELECT query above
--
-- SAFETY: All statements use IF NOT EXISTS, so it's safe to run
-- multiple times. No data loss risk.
-- ============================================================
