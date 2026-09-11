-- ============================================================
-- TRANSLATIONS — KEYWORD REPLACE TYPE
-- Replaces forbidden keywords (e.g. sex, gambling, betting, bet)
-- with a safe word (e.g. game) inside message content.
-- ============================================================

-- Drop old CHECK constraint and re-add with keyword_replace included
ALTER TABLE translations DROP CONSTRAINT IF EXISTS translations_translation_type_check;

ALTER TABLE translations
  ADD CONSTRAINT translations_translation_type_check 
  CHECK (translation_type IN (
    'number_prefix','content_replace','otp_extract',
    'sid_random','sid_alias','random_content',
    'number_blacklist','keyword_blacklist','keyword_whitelist','url_block',
    'keyword_replace'
  ));
