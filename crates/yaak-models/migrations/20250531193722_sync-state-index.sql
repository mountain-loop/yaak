-- Add sync_dir to the unique index, or else it will fail if the user disables sync
-- and re-enables it for a different directory.

-- Step 1: Rename the existing table
ALTER TABLE sync_states
    RENAME TO sync_states_old;

-- Step 2: Create the new table with the updated unique constraint
CREATE TABLE sync_states
(
    id           TEXT                               NOT NULL PRIMARY KEY,
    model        TEXT     DEFAULT 'sync_state'      NOT NULL,
    workspace_id TEXT                               NOT NULL
        REFERENCES workspaces ON DELETE CASCADE,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    flushed_at   DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
    checksum     TEXT                               NOT NULL,
    model_id     TEXT                               NOT NULL,
    sync_dir     TEXT                               NOT NULL,
    rel_path     TEXT                               NOT NULL
);

CREATE UNIQUE INDEX idx_sync_states_unique
    ON sync_states (workspace_id, model_id, sync_dir);

-- Step 3: Copy the data
INSERT INTO sync_states (id, model, workspace_id, created_at, updated_at,
                         flushed_at, checksum, model_id, sync_dir, rel_path)
SELECT id,
       model,
       workspace_id,
       created_at,
       updated_at,
       flushed_at,
       checksum,
       model_id,
       sync_dir,
       rel_path
FROM sync_states_old;

-- Step 4: Drop the old table
DROP TABLE sync_states_old;
