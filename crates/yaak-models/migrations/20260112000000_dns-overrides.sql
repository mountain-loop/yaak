-- Add DNS overrides setting to workspaces
ALTER TABLE workspaces ADD COLUMN setting_dns_overrides TEXT DEFAULT '[]' NOT NULL;
