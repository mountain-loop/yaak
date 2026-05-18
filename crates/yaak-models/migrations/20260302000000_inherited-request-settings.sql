ALTER TABLE workspaces ADD COLUMN setting_send_cookies BOOLEAN DEFAULT TRUE NOT NULL;
ALTER TABLE workspaces ADD COLUMN setting_store_cookies BOOLEAN DEFAULT TRUE NOT NULL;

ALTER TABLE folders ADD COLUMN setting_send_cookies TEXT DEFAULT '{"enabled":false,"value":true}' NOT NULL;
ALTER TABLE folders ADD COLUMN setting_store_cookies TEXT DEFAULT '{"enabled":false,"value":true}' NOT NULL;
ALTER TABLE folders ADD COLUMN setting_request_timeout TEXT DEFAULT '{"enabled":false,"value":0}' NOT NULL;
ALTER TABLE folders ADD COLUMN setting_validate_certificates TEXT DEFAULT '{"enabled":false,"value":true}' NOT NULL;
ALTER TABLE folders ADD COLUMN setting_follow_redirects TEXT DEFAULT '{"enabled":false,"value":true}' NOT NULL;

ALTER TABLE http_requests ADD COLUMN setting_send_cookies TEXT DEFAULT '{"enabled":false,"value":true}' NOT NULL;
ALTER TABLE http_requests ADD COLUMN setting_store_cookies TEXT DEFAULT '{"enabled":false,"value":true}' NOT NULL;
ALTER TABLE http_requests ADD COLUMN setting_request_timeout TEXT DEFAULT '{"enabled":false,"value":0}' NOT NULL;
ALTER TABLE http_requests ADD COLUMN setting_validate_certificates TEXT DEFAULT '{"enabled":false,"value":true}' NOT NULL;
ALTER TABLE http_requests ADD COLUMN setting_follow_redirects TEXT DEFAULT '{"enabled":false,"value":true}' NOT NULL;

ALTER TABLE websocket_requests ADD COLUMN setting_send_cookies TEXT DEFAULT '{"enabled":false,"value":true}' NOT NULL;
ALTER TABLE websocket_requests ADD COLUMN setting_store_cookies TEXT DEFAULT '{"enabled":false,"value":true}' NOT NULL;
