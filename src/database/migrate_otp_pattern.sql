-- Migration: Add otp_pattern + otp_strict_mode columns to translations table
-- otp_pattern: custom regex for OTP extraction (e.g., 'ABC-\d{6}' for branded OTPs).
--              When set, this overrides the digit-length (otp_length_min/max) extraction.
-- otp_strict_mode: when true (default), a failed OTP extraction BLOCKS delivery;
--              when false (lenient), the original message is forwarded unchanged.

ALTER TABLE translations ADD COLUMN IF NOT EXISTS otp_pattern VARCHAR(500);
ALTER TABLE translations ADD COLUMN IF NOT EXISTS otp_strict_mode BOOLEAN DEFAULT true;

-- Update existing otp_extract rules: set a default empty pattern (no-op, uses digit length)
-- This is informational only — NULL is treated as "use digit length" by the engine.
COMMENT ON COLUMN translations.otp_pattern IS 'Custom regex for OTP extraction. Overrides otp_length_min/max when set. Example: ABC-\\d{6} for branded OTPs.';
COMMENT ON COLUMN translations.otp_strict_mode IS 'Strict (true) blocks delivery when OTP extraction fails; lenient (false) forwards the original message.';
