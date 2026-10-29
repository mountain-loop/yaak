-- The app that opened the flow's client connection, where the platform can tell.
ALTER TABLE flows ADD COLUMN client_pid INTEGER;
ALTER TABLE flows ADD COLUMN client_name TEXT;
ALTER TABLE flows ADD COLUMN client_bundle_id TEXT;
ALTER TABLE flows ADD COLUMN client_path TEXT;

-- Flows list and page newest first, by start and then id.
DROP INDEX idx_flows_started_at;
CREATE INDEX idx_flows_started_at_id ON flows (started_at, id);
