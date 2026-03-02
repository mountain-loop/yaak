ALTER TABLE plugins
    ADD COLUMN source TEXT DEFAULT 'filesystem' NOT NULL;

-- Existing registry installs have a URL; classify them first.
UPDATE plugins
SET source = 'registry'
WHERE url IS NOT NULL;

-- Best-effort bundled backfill for legacy rows.
UPDATE plugins
SET source = 'bundled'
WHERE source = 'filesystem'
  AND (
    -- Normalize separators so this also works for Windows paths.
    replace(directory, '\', '/') LIKE '%/vendored/plugins/%'
        OR replace(directory, '\', '/') LIKE '%/vendored-plugins/%'
        OR replace(directory, '\', '/') LIKE '%/plugins/%'
    );

-- Keep one row per exact directory before adding uniqueness.
-- Tie-break by recency.
WITH ranked AS (SELECT id,
                       ROW_NUMBER() OVER (
                           PARTITION BY directory
                           ORDER BY updated_at DESC,
                               created_at DESC
                           ) AS row_num
                FROM plugins)
DELETE
FROM plugins
WHERE id IN (SELECT id FROM ranked WHERE row_num > 1);

CREATE UNIQUE INDEX IF NOT EXISTS idx_plugins_directory_unique
    ON plugins (directory);
