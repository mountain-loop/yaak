-- Add DNS resolution timing to http_responses
ALTER TABLE http_responses ADD COLUMN elapsed_dns INTEGER DEFAULT 0 NOT NULL;
