-- The working directory of a program outside an app, which names it better than its executable.
ALTER TABLE flows ADD COLUMN client_cwd TEXT;

-- Flows at or below this rowid are cleared: no listing or count sees them, and they are deleted
-- in the background, in batches. The row goes once they all are. One process deletes at a time:
-- `cleaner` names it, and `cleaner_at` (unix milliseconds) is when it last went on, so another
-- takes over once that is long past.
CREATE TABLE flow_clear_mark
(
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    max_rowid  INTEGER NOT NULL,
    cleaner    TEXT,
    cleaner_at INTEGER
);
