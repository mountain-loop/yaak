-- The working directory of a program outside an app, which names it better than its executable.
ALTER TABLE flows ADD COLUMN client_cwd TEXT;

-- Flows at or below this rowid are cleared: no listing or count sees them, and they are deleted
-- in the background, in batches. The row goes once they all are.
CREATE TABLE flow_clear_mark
(
    id        INTEGER PRIMARY KEY CHECK (id = 1),
    max_rowid INTEGER NOT NULL
);
