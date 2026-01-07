DELETE FROM main.http_responses;
ALTER TABLE http_responses DROP COLUMN body;
ALTER TABLE http_responses ADD COLUMN body BLOB;
ALTER TABLE http_responses ADD COLUMN body_path TEXT;
ALTER TABLE http_responses ADD COLUMN content_length INTEGER;
