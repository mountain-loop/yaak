-- Create temporary table for migration
CREATE TABLE environments__new
(
    id           TEXT                               NOT NULL PRIMARY KEY,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    deleted_at   DATETIME,
    workspace_id TEXT                               NOT NULL
        REFERENCES workspaces ON DELETE CASCADE,

    name         TEXT                               NOT NULL,
    variables    TEXT     DEFAULT '[]'              NOT NULL,
    model        TEXT     DEFAULT 'environment',
    public       BOOLEAN  DEFAULT FALSE,
    color        TEXT,

    -- NEW
    parent_model TEXT     DEFAULT 'workspace'       NOT NULL,
    parent_id    TEXT
);

-- Backfill the data from the old table
--    - base=1  -> (workspace, NULL)
--    - base=0  -> (environment, id_of_workspace_base)  (fallback to workspace,NULL if none)
INSERT INTO environments__new
(id, created_at, updated_at, deleted_at, workspace_id, name, variables, model, public, color, parent_model, parent_id)
SELECT
    e.id,
    e.created_at,
    e.updated_at,
    e.deleted_at,
    e.workspace_id,
    e.name,
    e.variables,
    e.model,
    e.public,
    e.color,
    CASE
        WHEN e.base = 1 THEN 'workspace'
        WHEN (
                 SELECT COUNT(1)
                 FROM environments b
                 WHERE b.workspace_id = e.workspace_id AND b.base = 1
             ) > 0 THEN 'environment'
        ELSE 'workspace'
        END AS parent_model,
    CASE
        WHEN e.base = 1 THEN NULL
        ELSE (
            SELECT b.id
            FROM environments b
            WHERE b.workspace_id = e.workspace_id AND b.base = 1
            ORDER BY b.created_at ASC, b.id ASC
            LIMIT 1
        )
        END AS parent_id
FROM environments e;

-- Move everything to the new table
DROP TABLE environments;
ALTER TABLE environments__new
    RENAME TO environments;
