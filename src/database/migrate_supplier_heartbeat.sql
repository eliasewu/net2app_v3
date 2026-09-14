-- Suppliers: track last gateway heartbeat for Android device online/offline status.
-- NULL = never seen (or non-gateway supplier); UI shows offline for android_SMS
-- devices whose last heartbeat is older than 15s (3 missed 5s beats).
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS last_heartbeat_at TIMESTAMP;
