-- Add nullable settings columns to folders (NULL = inherit from parent)
ALTER TABLE folders ADD COLUMN setting_request_timeout INTEGER DEFAULT NULL;
ALTER TABLE folders ADD COLUMN setting_validate_certificates BOOLEAN DEFAULT NULL;
ALTER TABLE folders ADD COLUMN setting_follow_redirects BOOLEAN DEFAULT NULL;

-- Add nullable settings columns to http_requests (NULL = inherit from parent)
ALTER TABLE http_requests ADD COLUMN setting_request_timeout INTEGER DEFAULT NULL;
ALTER TABLE http_requests ADD COLUMN setting_validate_certificates BOOLEAN DEFAULT NULL;
ALTER TABLE http_requests ADD COLUMN setting_follow_redirects BOOLEAN DEFAULT NULL;
