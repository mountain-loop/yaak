-- Auth
ALTER TABLE workspaces
    ADD COLUMN default_authentication TEXT NOT NULL DEFAULT '{}';
ALTER TABLE folders
    ADD COLUMN default_authentication TEXT NOT NULL DEFAULT '{}';

-- Headers
ALTER TABLE workspaces
    ADD COLUMN default_headers TEXT NOT NULL DEFAULT '[]';
ALTER TABLE folders
    ADD COLUMN default_headers TEXT NOT NULL DEFAULT '[]';
