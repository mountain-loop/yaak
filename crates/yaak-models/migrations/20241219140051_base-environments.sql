-- Add the new field
ALTER TABLE environments
    ADD COLUMN environment_id TEXT REFERENCES environments (id) ON DELETE CASCADE;

-- Create temporary column so we know which rows are meant to be base environments. We'll use this to update
-- child environments to point to them.
ALTER TABLE environments
    ADD COLUMN migrated_base_env BOOLEAN DEFAULT FALSE NOT NULL;

-- Create a base environment for each workspace
INSERT INTO environments (id, workspace_id, name, variables, migrated_base_env)
SELECT (
           -- This is the best way to generate a random string in SQLite, apparently
           'ev_' || SUBSTR('abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23457789', (ABS(RANDOM()) % 57) + 1, 1) ||
           SUBSTR('abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23457789', (ABS(RANDOM()) % 57) + 1, 1) ||
           SUBSTR('abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23457789', (ABS(RANDOM()) % 57) + 1, 1) ||
           SUBSTR('abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23457789', (ABS(RANDOM()) % 57) + 1, 1) ||
           SUBSTR('abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23457789', (ABS(RANDOM()) % 57) + 1, 1) ||
           SUBSTR('abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23457789', (ABS(RANDOM()) % 57) + 1, 1) ||
           SUBSTR('abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23457789', (ABS(RANDOM()) % 57) + 1, 1) ||
           SUBSTR('abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23457789', (ABS(RANDOM()) % 57) + 1, 1) ||
           SUBSTR('abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23457789', (ABS(RANDOM()) % 57) + 1, 1) ||
           SUBSTR('abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23457789', (ABS(RANDOM()) % 57) + 1, 1)
           ),
       workspaces.id,
       'Global Variables',
       variables,
       TRUE
FROM workspaces;

-- Update all non-base environments to point to newly created base environments
UPDATE environments
SET environment_id = ( SELECT base_env.id
                       FROM environments AS base_env
                       WHERE base_env.workspace_id = environments.workspace_id
                         AND base_env.migrated_base_env IS TRUE )
WHERE migrated_base_env IS FALSE;

-- Drop temporary column
ALTER TABLE environments
    DROP COLUMN migrated_base_env;

-- Drop the old variables column
-- IMPORTANT: Skip to give the user the option to roll back to a previous app version. We can drop it once the migration working in the real world
-- ALTER TABLE workspaces DROP COLUMN variables;
