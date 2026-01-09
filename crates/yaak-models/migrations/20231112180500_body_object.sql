-- Rename old column to backup name
ALTER TABLE http_requests
    RENAME COLUMN body TO body_old;

-- Create desired new body column
ALTER TABLE http_requests
    ADD COLUMN body TEXT NOT NULL DEFAULT '{}';

-- Copy data from old to new body, in new JSON format
UPDATE http_requests
SET body = CASE WHEN body_old IS NULL THEN '{}' ELSE JSON_OBJECT('text', body_old) END
WHERE TRUE;

-- Drop old column
ALTER TABLE http_requests
    DROP COLUMN body_old;
