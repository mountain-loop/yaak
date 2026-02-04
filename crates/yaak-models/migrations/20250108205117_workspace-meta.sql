CREATE TABLE workspace_metas
(
    id               TEXT                               NOT NULL
        PRIMARY KEY,
    model            TEXT     DEFAULT 'workspace_meta'  NOT NULL,
    workspace_id     TEXT                               NOT NULL
        REFERENCES workspaces ON DELETE CASCADE,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    setting_sync_dir TEXT
);
