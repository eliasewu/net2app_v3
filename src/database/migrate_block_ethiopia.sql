-- Migration: Block SMS to Ethiopia (+251)
-- Adds number_blacklist rules so the gateway rejects any message destined to
-- Ethiopia (country code +251) BEFORE it is enqueued/sent.
-- Applies to both the HTTP/curl send path and the SMPP relay path
-- (both call checkTranslationsBlock()).
-- Covers '+251…' / '251…' and '00251…' number formats.
-- Idempotent: safe to run multiple times.

INSERT INTO translations (
    translation_type, source_pattern, target_value, subtype, name, description,
    priority, apply_to, apply_entity_id, is_active
)
SELECT 'number_blacklist', '251', '', 'prefix',
       'Block Ethiopia (+251)', 'Reject all SMS destined to Ethiopia numbers (prefix 251).',
       1, 'both', 'all', true
WHERE NOT EXISTS (
    SELECT 1 FROM translations
    WHERE translation_type = 'number_blacklist' AND source_pattern = '251' AND subtype = 'prefix'
);

INSERT INTO translations (
    translation_type, source_pattern, target_value, subtype, name, description,
    priority, apply_to, apply_entity_id, is_active
)
SELECT 'number_blacklist', '00251', '', 'prefix',
       'Block Ethiopia (00251)', 'Reject all SMS destined to Ethiopia numbers in 00251 format.',
       1, 'both', 'all', true
WHERE NOT EXISTS (
    SELECT 1 FROM translations
    WHERE translation_type = 'number_blacklist' AND source_pattern = '00251' AND subtype = 'prefix'
);
