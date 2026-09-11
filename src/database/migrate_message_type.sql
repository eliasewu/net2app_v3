-- ============================================================
-- MESSAGE TYPE FOR DLR TIMEOUT POLICY
--   message_type = 'otp'       → expires after 5 min without DLR
--   message_type = 'marketing' → stays pending until real DLR arrives
-- Default 'otp' (transactional/OTP traffic is the norm).
-- ============================================================
ALTER TABLE sms_logs ADD COLUMN IF NOT EXISTS message_type VARCHAR(20) DEFAULT 'otp';
ALTER TABLE sms_outbox ADD COLUMN IF NOT EXISTS message_type VARCHAR(20) DEFAULT 'otp';

-- Backfill sms_logs: classify by trunk type (marketing trunks → marketing)
UPDATE sms_logs sl
SET message_type = 'marketing'
FROM trunks t
WHERE sl.trunk_id = t.id
  AND t.trunk_type ILIKE '%marketing%'
  AND sl.message_type IS DISTINCT FROM 'marketing';

-- Backfill sms_outbox: classify by matching trunk_name (no trunk_id column there)
UPDATE sms_outbox so
SET message_type = 'marketing'
FROM trunks t
WHERE so.trunk_name = t.trunk_name
  AND t.trunk_type ILIKE '%marketing%'
  AND so.message_type IS DISTINCT FROM 'marketing';
