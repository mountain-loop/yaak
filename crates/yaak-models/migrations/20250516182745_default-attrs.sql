-- Auth
ALTER TABLE workspaces
    ADD COLUMN authentication TEXT NOT NULL DEFAULT '{}';
ALTER TABLE folders
    ADD COLUMN authentication TEXT NOT NULL DEFAULT '{}';
ALTER TABLE workspaces
    ADD COLUMN authentication_type TEXT;
ALTER TABLE folders
    ADD COLUMN authentication_type TEXT;

-- Headers
ALTER TABLE workspaces
    ADD COLUMN headers TEXT NOT NULL DEFAULT '[]';
ALTER TABLE folders
    ADD COLUMN headers TEXT NOT NULL DEFAULT '[]';
