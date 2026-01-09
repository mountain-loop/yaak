ALTER TABLE settings
    ADD COLUMN hide_license_badge BOOLEAN DEFAULT FALSE;

-- 2. Backfill based on old JSON
UPDATE settings
SET hide_license_badge = 1
WHERE EXISTS ( SELECT 1
               FROM key_values kv
               WHERE kv.key = 'license_confirmation'
                 AND JSON_EXTRACT(kv.value, '$.confirmedPersonalUse') = TRUE );
