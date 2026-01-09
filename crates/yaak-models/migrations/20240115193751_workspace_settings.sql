-- Add existing request-related settings to workspace
ALTER TABLE workspaces ADD COLUMN setting_request_timeout INTEGER DEFAULT '0' NOT NULL;
ALTER TABLE workspaces ADD COLUMN setting_validate_certificates BOOLEAN DEFAULT TRUE NOT NULL;
ALTER TABLE workspaces ADD COLUMN setting_follow_redirects BOOLEAN DEFAULT TRUE NOT NULL;

-- Remove old settings that used to be global
ALTER TABLE settings DROP COLUMN request_timeout;
ALTER TABLE settings DROP COLUMN follow_redirects;
ALTER TABLE settings DROP COLUMN validate_certificates;
