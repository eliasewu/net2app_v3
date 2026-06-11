-- Check what status values are allowed
SELECT conname, consrc FROM pg_constraint WHERE conrelid = 'sms_logs'::regclass AND conname LIKE '%status%';
