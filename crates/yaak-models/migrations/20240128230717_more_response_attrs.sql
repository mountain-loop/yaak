ALTER TABLE http_responses ADD COLUMN elapsed_headers INTEGER NOT NULL DEFAULT 0;
ALTER TABLE http_responses ADD COLUMN remote_addr TEXT;
ALTER TABLE http_responses ADD COLUMN version TEXT;
