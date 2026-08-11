-- Migration: Add dlr_match_ids column to sms_outbox
-- Stores ALL known IDs for each outbox entry so DLR matching
-- can check against any of them (our message_id, SMSC's connector_transaction_id,
-- gateway-forwarded IDs like GWT..., etc.)
ALTER TABLE sms_outbox ADD COLUMN IF NOT EXISTS dlr_match_ids TEXT[];

-- Backfill existing rows: populate with message_id so existing entries
-- don't miss DLRs after the migration
UPDATE sms_outbox 
SET dlr_match_ids = ARRAY[message_id]::TEXT[]
WHERE dlr_match_ids IS NULL;

-- Also append existing connector_transaction_id if present
UPDATE sms_outbox 
SET dlr_match_ids = array_append(dlr_match_ids, connector_transaction_id)
WHERE connector_transaction_id IS NOT NULL 
  AND connector_transaction_id != ''
  AND NOT (connector_transaction_id = ANY(dlr_match_ids));

-- Create a GIN index for fast ANY() matching
CREATE INDEX IF NOT EXISTS idx_sms_outbox_dlr_match_ids 
  ON sms_outbox USING GIN (dlr_match_ids);
