-- Migration: Add otp_pattern column to translations table
-- Allows custom regex patterns for OTP extraction (e.g., 'ABC-\d{6}' for branded OTPs)
-- When set, this overrides the digit-length (otp_length_min/max) extraction.

ALTER TABLE translations ADD COLUMN IF NOT EXISTS otp_pattern VARCHAR(500);

-- Update existing otp_extract rules: set a default empty pattern (no-op, uses digit length)
-- This is informational only — NULL is treated as "use digit length" by the engine.
COMMENT ON COLUMN translations.otp_pattern IS 'Custom regex for OTP extraction. Overrides otp_length_min/max when set. Example: ABC-\\d{6} for branded OTPs.';
