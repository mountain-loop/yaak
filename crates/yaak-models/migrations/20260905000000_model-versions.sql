CREATE TABLE model_versions
(
    id           TEXT                               NOT NULL PRIMARY KEY,
    model        TEXT     DEFAULT 'model_version'   NOT NULL,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    workspace_id TEXT                               NOT NULL,
    model_type   TEXT                               NOT NULL,
    model_id     TEXT                               NOT NULL,
    content_hash TEXT                               NOT NULL,
    document     TEXT                               NOT NULL,
    reason       TEXT                               NOT NULL
);

-- Content addressing, enforced by the database rather than by every caller.
CREATE UNIQUE INDEX model_versions_content ON model_versions (model_id, content_hash);

ALTER TABLE http_responses ADD COLUMN version_id TEXT;
ALTER TABLE grpc_connections ADD COLUMN version_id TEXT;
ALTER TABLE websocket_connections ADD COLUMN version_id TEXT;
