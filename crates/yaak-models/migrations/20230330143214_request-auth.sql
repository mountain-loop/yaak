ALTER TABLE http_requests ADD COLUMN authentication TEXT NOT NULL DEFAULT '{}';
ALTER TABLE http_requests ADD COLUMN authentication_type TEXT;
