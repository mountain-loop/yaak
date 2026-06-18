ALTER TABLE http_requests ADD COLUMN is_saved BOOLEAN DEFAULT TRUE NOT NULL;
ALTER TABLE http_requests ADD COLUMN history_updated_at TEXT;
