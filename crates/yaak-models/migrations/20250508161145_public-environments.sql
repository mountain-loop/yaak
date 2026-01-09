-- Add a public column to represent whether an environment can be shared or exported
ALTER TABLE environments
    ADD COLUMN public BOOLEAN DEFAULT FALSE;

-- Add a base column to represent whether an environment is a base or sub environment. We used to
-- do this with environment_id, but we need a more flexible solution now that envs can be optionally
-- synced. E.g., it's now possible to only import a sub environment from a different client without
-- its base environment "parent."
ALTER TABLE environments
    ADD COLUMN base BOOLEAN DEFAULT FALSE;

-- SQLite doesn't support dynamic default values, so we update `base` based on the value of
-- environment_id.
UPDATE environments
SET base = TRUE
WHERE environment_id IS NULL;

-- Finally, we drop the old `environment_id` column that will no longer be used
ALTER TABLE environments
    DROP COLUMN environment_id;
