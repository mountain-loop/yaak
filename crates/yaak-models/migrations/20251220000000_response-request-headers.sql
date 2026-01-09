-- Add request_headers and content_length_compressed columns to http_responses table
ALTER TABLE http_responses ADD COLUMN request_headers TEXT NOT NULL DEFAULT '[]';
ALTER TABLE http_responses ADD COLUMN content_length_compressed INTEGER;
