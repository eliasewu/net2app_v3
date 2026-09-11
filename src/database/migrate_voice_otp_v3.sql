-- ============================================================
-- Voice OTP Pipeline v3 Migration
-- Adds columns needed for the full Voice OTP routing pipeline:
--   Client SMS → Route → Supplier(VoiceOTP) → NumberAnalysis →
--   LanguageResolution → OTPExtraction → AudioBuild →
--   AsteriskOriginate → CallResult → RetryEngine → DLREngine → Billing
-- ============================================================

-- ============================================================
-- CLIENTS: Voice OTP settings
-- ============================================================
ALTER TABLE clients
    ADD COLUMN IF NOT EXISTS play_count INTEGER DEFAULT 1 CHECK (play_count >= 1 AND play_count <= 3),
    ADD COLUMN IF NOT EXISTS otp_extraction_pattern VARCHAR(255) DEFAULT '',
    ADD COLUMN IF NOT EXISTS force_dlr_override BOOLEAN DEFAULT false;

COMMENT ON COLUMN clients.play_count IS 'Voice OTP playback repeat count (1-3). Uniform per-client — same count for every call.';
COMMENT ON COLUMN clients.otp_extraction_pattern IS 'Regex template to extract OTP digits from SMS body. Empty = extract ALL digit sequences (prefer longest).';
COMMENT ON COLUMN clients.force_dlr_override IS 'If true, client-facing DLR always reports Delivered. Internal billing/CDR still records true outcome.';

-- ============================================================
-- SUPPLIERS: Voice OTP connection details
-- ============================================================
ALTER TABLE suppliers
    ADD COLUMN IF NOT EXISTS dst_sip_address VARCHAR(255) DEFAULT '',
    ADD COLUMN IF NOT EXISTS audio_codec VARCHAR(20) DEFAULT 'G729',
    ADD COLUMN IF NOT EXISTS capacity INTEGER DEFAULT 10,
    ADD COLUMN IF NOT EXISTS reconnect_schedule VARCHAR(100) DEFAULT '0,1,2',
    ADD COLUMN IF NOT EXISTS rate_per_second DECIMAL(10,6) DEFAULT 0.000000;

COMMENT ON COLUMN suppliers.dst_sip_address IS 'SIP server address for outbound Voice OTP calls (e.g. 198.27.76.34:5060)';
COMMENT ON COLUMN suppliers.audio_codec IS 'Preferred audio codec: G729, PCMU, PCMA, GSM';
COMMENT ON COLUMN suppliers.capacity IS 'Maximum concurrent Voice OTP calls this supplier can handle';
COMMENT ON COLUMN suppliers.reconnect_schedule IS 'Comma-separated retry delay intervals in minutes (e.g. 0,1,2 = immediate, +1min, +2min)';
COMMENT ON COLUMN suppliers.rate_per_second IS 'Per-second SIP cost from supplier for billing calculations';

-- ============================================================
-- VOICE OTP CONFIGS: Per-language play_count override
-- ============================================================
ALTER TABLE voice_otp_configs
    ADD COLUMN IF NOT EXISTS play_count INTEGER DEFAULT 1 CHECK (play_count >= 1 AND play_count <= 3),
    ADD COLUMN IF NOT EXISTS audio_0_9_primary JSONB DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS audio_0_9_secondary JSONB DEFAULT '{}';

COMMENT ON COLUMN voice_otp_configs.play_count IS 'Per-language group play_count (overridden by client.play_count if set)';
COMMENT ON COLUMN voice_otp_configs.audio_0_9_primary IS 'Primary language digit audio file paths (0-9 → URL)';
COMMENT ON COLUMN voice_otp_configs.audio_0_9_secondary IS 'Secondary/fallback language digit audio file paths (0-9 → URL)';

-- ============================================================
-- VOICE OTP LOGS: Additional tracking columns
-- ============================================================
ALTER TABLE voice_otp_logs
    ADD COLUMN IF NOT EXISTS extracted_otp VARCHAR(20),
    ADD COLUMN IF NOT EXISTS audio_file_path TEXT,
    ADD COLUMN IF NOT EXISTS supplier_id INTEGER REFERENCES suppliers(id),
    ADD COLUMN IF NOT EXISTS trunk_id INTEGER REFERENCES trunks(id),
    ADD COLUMN IF NOT EXISTS route_id INTEGER REFERENCES routes(id),
    ADD COLUMN IF NOT EXISTS total_cost DECIMAL(10,6) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS client_cost DECIMAL(10,6) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS force_dlr_applied BOOLEAN DEFAULT false,
    ADD COLUMN IF NOT EXISTS reconnect_trace TEXT[] DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS billing_status VARCHAR(20) DEFAULT 'pending' CHECK (billing_status IN ('pending','billed','void'));

COMMENT ON COLUMN voice_otp_logs.extracted_otp IS 'OTP digits extracted from the SMS body';
COMMENT ON COLUMN voice_otp_logs.audio_file_path IS 'Path to concatenated audio file streamed to Asterisk';
COMMENT ON COLUMN voice_otp_logs.supplier_id IS 'Voice OTP supplier that placed the call';
COMMENT ON COLUMN voice_otp_logs.total_cost IS 'True supplier cost (per-second SIP rate × duration)';
COMMENT ON COLUMN voice_otp_logs.client_cost IS 'Amount billed to client for this call';
COMMENT ON COLUMN voice_otp_logs.force_dlr_applied IS 'True if force_dlr_override changed client-facing DLR status';
COMMENT ON COLUMN voice_otp_logs.reconnect_trace IS 'Array of retry timestamps and results for audit trail';
COMMENT ON COLUMN voice_otp_logs.billing_status IS 'Whether this call has been billed to the client';

-- ============================================================
-- VOICE OTP AUDIO CACHE: Pre-concatenated audio files
-- ============================================================
CREATE TABLE IF NOT EXISTS voice_otp_audio_cache (
    id SERIAL PRIMARY KEY,
    cache_key VARCHAR(255) UNIQUE NOT NULL,
    language_code VARCHAR(10) NOT NULL,
    digit_sequence VARCHAR(50) NOT NULL,
    play_count INTEGER DEFAULT 1,
    audio_format VARCHAR(10) DEFAULT 'wav',
    audio_data BYTEA,
    file_path TEXT,
    file_size_bytes INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_accessed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE voice_otp_audio_cache IS 'Pre-concatenated audio files for common OTP digit sequences to avoid repeated audio processing';

CREATE INDEX IF NOT EXISTS idx_voice_otp_audio_cache_key ON voice_otp_audio_cache(cache_key);
CREATE INDEX IF NOT EXISTS idx_voice_otp_audio_cache_lang ON voice_otp_audio_cache(language_code, digit_sequence);
