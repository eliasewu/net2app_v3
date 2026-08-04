-- Migration: Add blocking/filtering rule types to translations
-- Adds number_blacklist, keyword_blacklist, keyword_whitelist, url_block
-- These block SMS delivery rather than transforming content.

-- 1. Drop existing CHECK constraint and recreate with new types
-- PostgreSQL doesn't support ALTER CONSTRAINT, so we rebuild it.
ALTER TABLE translations DROP CONSTRAINT IF EXISTS translations_translation_type_check;

ALTER TABLE translations ADD CONSTRAINT translations_translation_type_check 
    CHECK (translation_type IN (
        'number_prefix','content_replace','otp_extract','sid_random','sid_alias','random_content',
        'number_blacklist','keyword_blacklist','keyword_whitelist','url_block'
    ));

-- 2. Add columns needed by blocking rules (if not already present)
--    Existing columns are sufficient:
--    - source_pattern: number/prefix to block (number_blacklist), URL pattern (url_block)
--    - match_content: keywords to block/allow (keyword_blacklist, keyword_whitelist)  
--    - subtype: 'exact' or 'prefix' for number_blacklist
--    - is_active: enable/disable the block rule
--    - apply_to / apply_entity_id: scope to client, supplier, or both

COMMENT ON COLUMN translations.subtype IS 'For number_blacklist: exact|prefix. For keyword rules: comma-separated keywords or regex pattern.';
