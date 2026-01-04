-- Add setting for maximum filter history items
ALTER TABLE workspaces ADD COLUMN setting_max_filter_history INTEGER NOT NULL DEFAULT 20;
