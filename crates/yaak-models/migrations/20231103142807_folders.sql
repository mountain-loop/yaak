CREATE TABLE folders
(
    id            TEXT                               NOT NULL
        PRIMARY   KEY,
    model         TEXT     DEFAULT 'folder'          NOT NULL,
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at    DATETIME,
    workspace_id  TEXT                               NOT NULL
        REFERENCES workspaces
            ON DELETE CASCADE,
    folder_id     TEXT                               NULL
        REFERENCES folders
            ON DELETE CASCADE,
    name          TEXT                               NOT NULL,
    sort_priority REAL     DEFAULT 0                 NOT NULL
);

ALTER TABLE http_requests ADD COLUMN folder_id TEXT REFERENCES folders(id) ON DELETE CASCADE;
