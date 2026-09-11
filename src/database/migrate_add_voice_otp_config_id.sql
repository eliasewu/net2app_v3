-- ============================================================
-- MIGRATION: Add voice_otp_config_id to routes and trunks
-- ============================================================
-- Allows routing to select a specific Voice OTP config per route/trunk
-- instead of auto-resolving by destination prefix.
-- Priority: route.voice_otp_config_id > trunk.voice_otp_config_id > supplier.voice_otp_config_id

-- Add to trunks table (plain INTEGER — FK can be added separately if desired)
ALTER TABLE trunks
    ADD COLUMN IF NOT EXISTS voice_otp_config_id INTEGER;

-- Add to routes table
ALTER TABLE routes
    ADD COLUMN IF NOT EXISTS voice_otp_config_id INTEGER;

-- Optional: add FK constraints after confirming voice_otp_configs exists
-- ALTER TABLE trunks ADD CONSTRAINT fk_trunks_voice_otp_config
--     FOREIGN KEY (voice_otp_config_id) REFERENCES voice_otp_configs(id);
-- ALTER TABLE routes ADD CONSTRAINT fk_routes_voice_otp_config
--     FOREIGN KEY (voice_otp_config_id) REFERENCES voice_otp_configs(id);

-- Verification
-- SELECT column_name, table_name FROM information_schema.columns
-- WHERE table_name IN ('routes','trunks') AND column_name = 'voice_otp_config_id';
