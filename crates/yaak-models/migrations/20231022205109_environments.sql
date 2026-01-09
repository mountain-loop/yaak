CREATE TABLE environments
(
    id          TEXT                               NOT NULL
        PRIMARY KEY,
    model       TEXT     DEFAULT 'workspace'       NOT NULL,
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at  DATETIME,
    workspace_id TEXT                               NOT NULL
        REFERENCES workspaces
            ON DELETE CASCADE,
    name        TEXT                               NOT NULL,
    data        TEXT                               NOT NULL
        DEFAULT '{}'
);
