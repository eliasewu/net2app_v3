-- ============================================================
-- Android SMS Gateway — Database Migration
-- ============================================================
-- Adds 'android_SMS' to the connection_type CHECK constraint
-- in the suppliers table so the Android Gateway can register.
-- ============================================================

-- 1. Drop existing constraint and re-add with 'android_SMS'
ALTER TABLE suppliers 
  DROP CONSTRAINT IF EXISTS suppliers_connection_type_check;

ALTER TABLE suppliers 
  ADD CONSTRAINT suppliers_connection_type_check 
  CHECK (connection_type IN (
    'smpp',
    'http',
    'ott_whatsapp',
    'ott_telegram',
    'voice_otp',
    'local_bypass',
    'rcs',
    'flash_sms',
    'android_SMS'
  ));

-- 2. Add indexes for gateway queries
CREATE INDEX IF NOT EXISTS idx_suppliers_connection_type ON suppliers(connection_type);
CREATE INDEX IF NOT EXISTS idx_suppliers_smpp_username_active ON suppliers(smpp_username, status);
CREATE INDEX IF NOT EXISTS idx_sms_logs_supplier_dest ON sms_logs(supplier_id, destination);
CREATE INDEX IF NOT EXISTS idx_sms_outbox_supplier_pending ON sms_outbox(supplier_id, status, queued_at) 
  WHERE status = 'pending';

-- 3. Add gateway metadata columns (optional)
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS device_name VARCHAR(255);
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMP;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS battery_level INTEGER;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS signal_strength INTEGER;

-- Done
SELECT 'android_SMS migration complete' AS status;
