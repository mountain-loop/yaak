ALTER TABLE workspaces
    ADD COLUMN setting_sync_dir TEXT;

CREATE TABLE sync_states
(
    id           TEXT                               NOT NULL
        PRIMARY KEY,
    model        TEXT     DEFAULT 'sync_state'      NOT NULL,
    workspace_id TEXT                               NOT NULL
        REFERENCES workspaces
            ON DELETE CASCADE,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    model_id     TEXT                               NOT NULL,
    last_flush   TEXT                               NULL,
    path         TEXT                               NOT NULL,
    dirty        BOOLEAN                            NOT NULL
);
