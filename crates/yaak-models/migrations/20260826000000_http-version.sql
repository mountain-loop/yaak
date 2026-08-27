ALTER TABLE workspaces ADD COLUMN setting_http_version TEXT DEFAULT 'auto' NOT NULL;

ALTER TABLE folders ADD COLUMN setting_http_version TEXT DEFAULT '{"enabled":false,"value":"auto"}' NOT NULL;

ALTER TABLE http_requests ADD COLUMN setting_http_version TEXT DEFAULT '{"enabled":false,"value":"auto"}' NOT NULL;
