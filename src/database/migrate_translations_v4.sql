-- ============================================================
-- TRANSLATIONS V4 MIGRATION — 6 new translation types
-- ============================================================

-- Drop old CHECK constraint and add expanded one
ALTER TABLE translations DROP CONSTRAINT IF EXISTS translations_translation_type_check;

ALTER TABLE translations
  ADD CONSTRAINT translations_translation_type_check 
  CHECK (translation_type IN (
    'number_prefix','content_replace','otp_extract',
    'sid_random','sid_alias','random_content'
  ));

-- Number Translation columns (strip/add prefix)
ALTER TABLE translations ADD COLUMN IF NOT EXISTS strip_prefix_digits INTEGER DEFAULT 0;
ALTER TABLE translations ADD COLUMN IF NOT EXISTS add_prefix_text VARCHAR(50) DEFAULT '';

-- Content Translation columns (search & replace with OTP awareness)
ALTER TABLE translations ADD COLUMN IF NOT EXISTS match_content TEXT DEFAULT '';
ALTER TABLE translations ADD COLUMN IF NOT EXISTS replace_content TEXT DEFAULT '';
ALTER TABLE translations ADD COLUMN IF NOT EXISTS is_otp_extract BOOLEAN DEFAULT false;
ALTER TABLE translations ADD COLUMN IF NOT EXISTS otp_length_min INTEGER DEFAULT 4;
ALTER TABLE translations ADD COLUMN IF NOT EXISTS otp_length_max INTEGER DEFAULT 8;

-- Random Content / SID Random columns (template data as JSON array)
ALTER TABLE translations ADD COLUMN IF NOT EXISTS template_data JSONB DEFAULT '[]';

-- SID Alias / Random SID columns
ALTER TABLE translations ADD COLUMN IF NOT EXISTS sid_match_type VARCHAR(20) DEFAULT 'exact';
-- 'exact' = exact match, 'wildcard' = * pattern match, 'random_mccmnc' = random by MCCMNC
ALTER TABLE translations ADD COLUMN IF NOT EXISTS mccmnc_list INTEGER[] DEFAULT '{}';

-- Index for faster lookups during SMS routing
CREATE INDEX IF NOT EXISTS idx_translations_active_type ON translations(translation_type, is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_translations_apply ON translations(apply_to, apply_entity_id) WHERE is_active = true;

COMMENT ON TABLE translations IS 'Message routing and content translation rules — supports number prefix, content replace, OTP extract, SID random/alias, random content templates';
